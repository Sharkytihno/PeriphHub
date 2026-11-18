// Utilisation du processeur, de la carte graphique et de la mémoire, pour la barre des tâches.
//
// Mêmes chiffres que le Gestionnaire des tâches, sans droits administrateur ni service :
// - processeur : GetSystemTimes (temps actif / temps total entre deux relevés) ;
// - mémoire : GlobalMemoryStatusEx (dwMemoryLoad) ;
// - carte graphique : compteurs « GPU Engine » de Windows. Comme le Gestionnaire des tâches, on
//   additionne les processus de chaque moteur (3D, copie, vidéo…) et on garde le moteur le plus occupé.
//
// Un fil relève toutes les 2 secondes, seulement quand au moins une mesure est affichée ; la carte
// graphique (des centaines de compteurs) n'est interrogée que si elle est demandée.

use std::collections::HashMap;
use std::ptr::{null, null_mut};
use std::sync::Mutex;
use std::time::Duration;
use windows_sys::Win32::Foundation::FILETIME;
use windows_sys::Win32::System::Performance::*;
use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows_sys::Win32::System::Threading::GetSystemTimes;

/// Pourcentages 0 à 100, -1 tant qu'inconnu
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Usage {
    pub cpu: i32,
    pub gpu: i32,
    pub ram: i32,
}

impl Default for Usage {
    fn default() -> Self {
        Usage { cpu: -1, gpu: -1, ram: -1 }
    }
}

static LAST: Mutex<Usage> = Mutex::new(Usage { cpu: -1, gpu: -1, ram: -1 });

pub fn last() -> Usage {
    *LAST.lock().unwrap_or_else(|e| e.into_inner())
}

fn ft(f: FILETIME) -> u64 {
    (f.dwHighDateTime as u64) << 32 | f.dwLowDateTime as u64
}

/// (inactif, total) depuis le démarrage, en unités de 100 ns
fn cpu_times() -> Option<(u64, u64)> {
    let z = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
    let (mut idle, mut kernel, mut user) = (z, z, z);
    // Le temps « noyau » comprend le temps inactif
    (unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) } != 0).then(|| (ft(idle), ft(kernel) + ft(user)))
}

fn cpu_percent(prev: (u64, u64), now: (u64, u64)) -> i32 {
    let idle = now.0.saturating_sub(prev.0);
    let total = now.1.saturating_sub(prev.1);
    if total == 0 {
        return -1;
    }
    (((total.saturating_sub(idle)) as f64 * 100.0 / total as f64).round() as i32).clamp(0, 100)
}

fn ram_percent() -> i32 {
    let mut m: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    m.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    if unsafe { GlobalMemoryStatusEx(&mut m) } == 0 {
        return -1;
    }
    m.dwMemoryLoad as i32
}

/// Moteur de la carte graphique d'une instance « pid_1234_luid_0x0_0xD1C7_phys_0_eng_3_engtype_3D »
fn engine_of(instance: &str) -> &str {
    instance.find("luid_").map(|i| &instance[i..]).unwrap_or(instance)
}

/// Moteur le plus occupé, chaque moteur étant la somme de ses processus
fn gpu_from(values: &[(String, f64)]) -> i32 {
    let mut per: HashMap<&str, f64> = HashMap::new();
    for (name, v) in values {
        if v.is_finite() && *v > 0.0 {
            *per.entry(engine_of(name)).or_default() += v;
        }
    }
    per.values().cloned().fold(0.0, f64::max).round().clamp(0.0, 100.0) as i32
}

struct Gpu {
    query: PDH_HQUERY,
    counter: PDH_HCOUNTER,
    primed: bool,
}

impl Gpu {
    fn open() -> Option<Gpu> {
        unsafe {
            let mut query: PDH_HQUERY = std::mem::zeroed();
            if PdhOpenQueryW(null(), 0, &mut query) != 0 {
                return None;
            }
            let path: Vec<u16> = "\\GPU Engine(*)\\Utilization Percentage\0".encode_utf16().collect();
            let mut counter: PDH_HCOUNTER = std::mem::zeroed();
            if PdhAddEnglishCounterW(query, path.as_ptr(), 0, &mut counter) != 0 {
                PdhCloseQuery(query);
                return None;
            }
            Some(Gpu { query, counter, primed: false })
        }
    }

    /// -1 au premier relevé (un taux demande deux relevés) ou si les compteurs sont absents
    fn sample(&mut self) -> i32 {
        unsafe {
            if PdhCollectQueryData(self.query) != 0 {
                return -1;
            }
            if !self.primed {
                self.primed = true;
                return -1;
            }
            let (mut size, mut count) = (0u32, 0u32);
            let r = PdhGetFormattedCounterArrayW(self.counter, PDH_FMT_DOUBLE | 0x0000_8000 /* PDH_FMT_NOCAP100 */, &mut size, &mut count, null_mut());
            if r != PDH_MORE_DATA || size == 0 {
                // Aucune instance : pas de carte graphique compatible WDDM 2.0, ou au repos complet
                return if r == 0 { 0 } else { -1 };
            }
            // Tampon aligné sur 8 octets (les valeurs sont des f64)
            let mut buf = vec![0u64; (size as usize).div_ceil(8) + 1];
            let items = buf.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
            if PdhGetFormattedCounterArrayW(self.counter, PDH_FMT_DOUBLE | 0x0000_8000 /* PDH_FMT_NOCAP100 */, &mut size, &mut count, items) != 0 {
                return -1;
            }
            let mut values = Vec::with_capacity(count as usize);
            for i in 0..count as usize {
                let it = &*items.add(i);
                if it.FmtValue.CStatus != 0 || it.szName.is_null() {
                    continue;
                }
                let mut n = 0;
                while *it.szName.add(n) != 0 {
                    n += 1;
                }
                let name = String::from_utf16_lossy(std::slice::from_raw_parts(it.szName, n));
                values.push((name, it.FmtValue.Anonymous.doubleValue));
            }
            gpu_from(&values)
        }
    }
}

impl Drop for Gpu {
    fn drop(&mut self) {
        unsafe {
            PdhCloseQuery(self.query);
        }
    }
}

/// Fil de relevé ; `wanted()` dit quelles mesures sont affichées, `changed` prévient la barre des tâches
pub fn run(wanted: fn() -> (bool, bool, bool), changed: fn()) {
    let mut prev_cpu: Option<(u64, u64)> = None;
    let mut gpu: Option<Gpu> = None;
    let mut gpu_failed = false;
    loop {
        let (want_cpu, want_gpu, want_ram) = wanted();
        let mut u = Usage::default();
        if want_cpu {
            let now = cpu_times();
            if let (Some(p), Some(n)) = (prev_cpu, now) {
                u.cpu = cpu_percent(p, n);
            }
            prev_cpu = now;
        } else {
            prev_cpu = None;
        }
        if want_gpu && !gpu_failed {
            if gpu.is_none() {
                gpu = Gpu::open();
                gpu_failed = gpu.is_none();
            }
            if let Some(g) = gpu.as_mut() {
                u.gpu = g.sample();
            }
        } else if !want_gpu {
            gpu = None; // libère les compteurs
            gpu_failed = false;
        }
        if want_ram {
            u.ram = ram_percent();
        }
        let differs = {
            let mut l = LAST.lock().unwrap_or_else(|e| e.into_inner());
            // Une valeur inconnue le temps d'un relevé garde l'ancienne (pas de « ? » qui clignote)
            if u.cpu < 0 && want_cpu { u.cpu = l.cpu; }
            if u.gpu < 0 && want_gpu && !gpu_failed { u.gpu = l.gpu; }
            let d = *l != u;
            *l = u;
            d
        };
        if differs {
            changed();
        }
        std::thread::sleep(Duration::from_secs(if want_cpu || want_gpu || want_ram { 2 } else { 3 }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn processeur() {
        assert_eq!(cpu_percent((100, 1000), (150, 1100)), 50);
        assert_eq!(cpu_percent((100, 1000), (200, 1100)), 0);
        assert_eq!(cpu_percent((100, 1000), (100, 1100)), 100);
        assert_eq!(cpu_percent((100, 1000), (100, 1000)), -1);
        let a = cpu_times().expect("GetSystemTimes");
        std::thread::sleep(Duration::from_millis(200));
        let b = cpu_times().unwrap();
        assert!((0..=100).contains(&cpu_percent(a, b)));
    }

    #[test]
    fn memoire() {
        assert!((1..=100).contains(&ram_percent()));
    }

    #[test]
    fn carte_graphique_moteur_le_plus_occupe() {
        let v = |n: &str, x: f64| (n.to_string(), x);
        let vals = [
            v("pid_10_luid_0x0_0xD1C7_phys_0_eng_0_engtype_3D", 30.0),
            v("pid_22_luid_0x0_0xD1C7_phys_0_eng_0_engtype_3D", 25.5),
            v("pid_22_luid_0x0_0xD1C7_phys_0_eng_3_engtype_VideoDecode", 40.0),
            v("pid_9_luid_0x0_0xAAAA_phys_0_eng_0_engtype_3D", 12.0),
        ];
        assert_eq!(gpu_from(&vals), 56);
        assert_eq!(gpu_from(&[]), 0);
        assert_eq!(gpu_from(&[v("pid_1_luid_0x0_0x1_phys_0_eng_0_engtype_3D", 180.0)]), 100);
    }

    #[test]
    fn carte_graphique_reelle() {
        // Deux relevés : le second donne un pourcentage (ou -1 sans compteurs GPU, ex. machine virtuelle)
        if let Some(mut g) = Gpu::open() {
            assert_eq!(g.sample(), -1);
            std::thread::sleep(Duration::from_millis(500));
            let p = g.sample();
            assert!((-1..=100).contains(&p), "{p}");
            eprintln!("carte graphique : {p} %");
        }
    }
}
