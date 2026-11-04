// Garde-fous contre les blocages de Windows.
//
// Lister les périphériques HID oblige Windows à interroger chacun d'eux : un seul appareil dont le
// pilote ne répond plus (dongle sans fil, manette virtuelle, appareil Bluetooth endormi…) bloque
// l'appel pour toujours. Idem pour `schtasks.exe` quand le Planificateur de tâches est figé.
// Ces fonctions rendent la main au bout d'un délai, quoi qu'il arrive : l'appel bloqué continue
// dans son propre fil (Windows ne permet pas de l'interrompre) mais ne fige plus PeriphHub.

use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// Exécute `f` dans un fil à part ; `None` si elle n'a pas fini dans le délai.
pub fn timed<T: Send + 'static>(limit: Duration, f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    let (tx, rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("periphhub-watchdog".into())
        .spawn(move || {
            let _ = tx.send(f());
        })
        .ok()?;
    rx.recv_timeout(limit).ok()
}

/// Appels à hidapi (énumération, ouverture) avec délai, un seul à la fois. Si un appel précédent
/// est bloqué dans Windows depuis plus longtemps que `STUCK`, les suivants échouent tout de suite
/// au lieu d'empiler des fils bloqués ; sinon ils attendent leur tour (dans la limite du délai).
static HID_SINCE: std::sync::Mutex<Option<Instant>> = std::sync::Mutex::new(None);
const STUCK: Duration = Duration::from_secs(10);
pub const HID_BLOCKED: &str = "un périphérique USB ne répond pas à Windows";

pub fn hid<T: Send + 'static>(limit: Duration, f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    let deadline = Instant::now() + limit;
    loop {
        {
            let mut since = HID_SINCE.lock().unwrap_or_else(|e| e.into_inner());
            match *since {
                None => {
                    *since = Some(Instant::now());
                    break;
                }
                Some(t) if t.elapsed() > STUCK => return Err(HID_BLOCKED.into()),
                Some(_) => {}
            }
        }
        if Instant::now() >= deadline {
            return Err(HID_BLOCKED.into());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let left = deadline.saturating_duration_since(Instant::now()).max(Duration::from_millis(100));
    let r = timed(left, move || {
        let r = f();
        *HID_SINCE.lock().unwrap_or_else(|e| e.into_inner()) = None;
        r
    });
    // Délai dépassé : le verrou reste pris jusqu'à ce que l'appel bloqué finisse (s'il finit)
    r.ok_or_else(|| HID_BLOCKED.into())
}

/// Lance un programme et lit sa sortie standard ; le tue s'il dépasse le délai.
pub fn output(mut cmd: Command, limit: Duration) -> Option<Vec<u8>> {
    let mut child = cmd.stdout(Stdio::piped()).stderr(Stdio::null()).stdin(Stdio::null()).spawn().ok()?;
    // Lecture dans un fil : sinon un programme bavard remplit le tuyau et ne se termine jamais
    let mut out = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = out.read_to_end(&mut buf);
        buf
    });
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() < limit => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    reader.join().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timed_rend_la_main() {
        let t = Instant::now();
        assert_eq!(timed(Duration::from_millis(100), || { std::thread::sleep(Duration::from_secs(5)); 1 }), None);
        assert!(t.elapsed() < Duration::from_secs(2));
        assert_eq!(timed(Duration::from_secs(2), || 7), Some(7));
    }

    #[test]
    fn hid_attend_son_tour_puis_refuse_si_bloque() {
        // Un appel lent mais pas bloqué : le suivant attend son tour
        let a = std::thread::spawn(|| hid(Duration::from_secs(5), || { std::thread::sleep(Duration::from_millis(300)); 1 }));
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(hid(Duration::from_secs(5), || 2), Ok(2));
        assert_eq!(a.join().unwrap(), Ok(1));
        // Un appel bloqué plus longtemps que STUCK : refus immédiat des suivants
        assert!(hid(Duration::from_millis(100), || std::thread::sleep(STUCK + Duration::from_secs(1))).is_err());
        std::thread::sleep(STUCK);
        let t = Instant::now();
        assert!(hid(Duration::from_secs(5), || 3).is_err());
        assert!(t.elapsed() < Duration::from_millis(100));
        std::thread::sleep(Duration::from_secs(2));
        assert_eq!(hid(Duration::from_secs(5), || 4), Ok(4));
    }

    /// Outil de Windows par son chemin absolu (jamais résolu par nom depuis le dossier courant)
    fn system_exe(rel: &str) -> std::path::PathBuf {
        let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        std::path::Path::new(&root).join("System32").join(rel)
    }

    #[test]
    fn output_tue_le_programme_trop_long() {
        let mut c = Command::new(system_exe("ping.exe"));
        c.args(["-n", "30", "127.0.0.1"]);
        let t = Instant::now();
        assert!(output(c, Duration::from_millis(500)).is_none());
        assert!(t.elapsed() < Duration::from_secs(5));
        let mut c = Command::new(system_exe("cmd.exe"));
        c.args(["/c", "echo", "ok"]);
        assert!(String::from_utf8_lossy(&output(c, Duration::from_secs(10)).unwrap()).contains("ok"));
    }
}
