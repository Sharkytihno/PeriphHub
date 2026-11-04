// Ce qui se lance tout seul avec Windows : clés Run, dossiers Démarrage, services, tâches planifiées.
// Lecture seule.
use std::path::PathBuf;
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_SET_VALUE, REG_BINARY};
use winreg::{RegKey, RegValue, HKEY};

pub struct Entry {
    /// "run" | "dossier" | "service" | "tâche"
    pub kind: &'static str,
    pub name: String,
    /// Commande, chemin ou nom de fichier : ce qu'on compare à la base de données
    pub target: String,
    /// Services : "auto" | "manuel" | "désactivé" ; autres : "actif" | "désactivé"
    pub mode: Option<&'static str>,
    /// Emplacement : "HKCU" | "HKLM" | "HKLM32" (run), "user" | "common" (dossier), "" sinon
    pub scope: &'static str,
}

// Interrupteurs « Démarrage » du Gestionnaire des tâches (Explorer\StartupApproved) :
// valeur binaire de 12 octets, premier octet impair = désactivé. C'est le mécanisme officiel
// de Windows : l'entrée d'origine n'est jamais modifiée, et l'utilisateur la retrouve dans
// le Gestionnaire des tâches.
const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved";

fn approved_key(kind: &str, scope: &str) -> Option<(HKEY, String)> {
    let (hive, sub) = match (kind, scope) {
        ("run", "HKCU") => (HKEY_CURRENT_USER, "Run"),
        ("run", "HKLM") => (HKEY_LOCAL_MACHINE, "Run"),
        ("run", "HKLM32") => (HKEY_LOCAL_MACHINE, "Run32"),
        ("dossier", "user") => (HKEY_CURRENT_USER, "StartupFolder"),
        ("dossier", "common") => (HKEY_LOCAL_MACHINE, "StartupFolder"),
        _ => return None,
    };
    Some((hive, format!("{APPROVED}\\{sub}")))
}

/// Écrire dans HKLM demande les droits administrateur
pub fn approved_needs_admin(kind: &str, scope: &str) -> bool {
    approved_key(kind, scope).is_some_and(|(h, _)| h == HKEY_LOCAL_MACHINE)
}

pub fn approved_disabled(kind: &str, scope: &str, name: &str) -> bool {
    let Some((hive, path)) = approved_key(kind, scope) else {
        return false;
    };
    RegKey::predef(hive)
        .open_subkey_with_flags(path, KEY_READ)
        .and_then(|k| k.get_raw_value(name))
        .is_ok_and(|v| v.bytes.first().is_some_and(|b| b & 1 == 1))
}

pub fn set_approved(kind: &str, scope: &str, name: &str, enabled: bool) -> Result<(), String> {
    let (hive, path) = approved_key(kind, scope).ok_or("emplacement inconnu")?;
    let (key, _) = RegKey::predef(hive)
        .create_subkey_with_flags(path, KEY_SET_VALUE)
        .map_err(|e| e.to_string())?;
    let mut bytes = vec![if enabled { 2u8 } else { 3u8 }, 0, 0, 0];
    // date de désactivation (FILETIME), comme le Gestionnaire des tâches
    let ft = if enabled {
        0u64
    } else {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64 / 100 + 116_444_736_000_000_000)
            .unwrap_or(0)
    };
    bytes.extend_from_slice(&ft.to_le_bytes());
    key.set_raw_value(name, &RegValue { bytes: bytes.into(), vtype: REG_BINARY })
        .map_err(|e| e.to_string())
}

fn on_off(disabled: bool) -> Option<&'static str> {
    Some(if disabled { "désactivé" } else { "actif" })
}

pub fn all() -> Vec<Entry> {
    let mut v = run_keys();
    v.extend(startup_folders());
    v.extend(services());
    v.extend(tasks());
    v
}

fn run_keys() -> Vec<Entry> {
    let mut out = Vec::new();
    let keys = [
        (
            "HKCU",
            HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
        ),
        (
            "HKLM",
            HKEY_LOCAL_MACHINE,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
        ),
        (
            "HKLM32",
            HKEY_LOCAL_MACHINE,
            r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run",
        ),
    ];
    for (scope, hive, path) in keys {
        let Ok(k) = RegKey::predef(hive).open_subkey_with_flags(path, KEY_READ) else {
            continue;
        };
        for (name, _) in k.enum_values().flatten() {
            let target: String = k.get_value(&name).unwrap_or_default();
            out.push(Entry {
                kind: "run",
                mode: on_off(approved_disabled("run", scope, &name)),
                name,
                target,
                scope,
            });
        }
    }
    out
}

fn startup_folders() -> Vec<Entry> {
    let mut dirs = Vec::new();
    if let Ok(a) = std::env::var("APPDATA") {
        dirs.push(("user", PathBuf::from(a).join(r"Microsoft\Windows\Start Menu\Programs\Startup")));
    }
    if let Ok(p) = std::env::var("PROGRAMDATA") {
        dirs.push(("common", PathBuf::from(p).join(r"Microsoft\Windows\Start Menu\Programs\StartUp")));
    }
    let mut out = Vec::new();
    for (scope, d) in dirs {
        for f in std::fs::read_dir(d).into_iter().flatten().flatten() {
            let name = f.file_name().to_string_lossy().to_string();
            if name.eq_ignore_ascii_case("desktop.ini") {
                continue;
            }
            out.push(Entry {
                kind: "dossier",
                target: name.clone(),
                mode: on_off(approved_disabled("dossier", scope, &name)),
                name,
                scope,
            });
        }
    }
    out
}

fn services() -> Vec<Entry> {
    let mut out = Vec::new();
    let Ok(root) = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags(r"SYSTEM\CurrentControlSet\Services", KEY_READ)
    else {
        return out;
    };
    for name in root.enum_keys().flatten() {
        let Ok(k) = root.open_subkey_with_flags(&name, KEY_READ) else {
            continue;
        };
        let ty: u32 = k.get_value("Type").unwrap_or(0);
        // 0x10 / 0x20 = services applicatifs (on ignore les pilotes)
        if ty & 0x30 == 0 {
            continue;
        }
        let image: String = k.get_value("ImagePath").unwrap_or_default();
        // certaines valeurs du registre traînent des caractères de fin invalides
        let image = image.trim_end_matches(['\0', '\u{ffff}']).to_string();
        let start: u32 = k.get_value("Start").unwrap_or(3);
        let mode = match start {
            0..=2 => "auto",
            4 => "désactivé",
            _ => "manuel",
        };
        out.push(Entry {
            kind: "service",
            name,
            target: image,
            mode: Some(mode),
            scope: "",
        });
    }
    out
}

// Tâches planifiées : nom complet sans le « \ » initial, programme(s) lancé(s), état.
fn tasks() -> Vec<Entry> {
    sched::list()
        .unwrap_or_default()
        .into_iter()
        .map(|t| Entry {
            kind: "tâche",
            name: t.path.trim_start_matches('\\').to_string(),
            target: t.target,
            mode: on_off(!t.enabled),
            scope: "",
        })
        .collect()
}

/// Active ou désactive une tâche planifiée (nom avec ou sans « \ » initial)
pub fn set_task_enabled(name: &str, enable: bool) -> Result<(), String> {
    sched::set_enabled(name, enable)
}

/// Planificateur de tâches par son API (COM), comme la console de Windows : l'état « désactivée »
/// ne dépend plus de la langue (schtasks l'écrivait en toutes lettres, « Deaktiviert » en
/// allemand…), et aucun schtasks.exe n'est lancé en arrière-plan.
mod sched {
    use std::time::Duration;
    use windows::core::{Interface, BSTR};
    use windows::Win32::Foundation::{VARIANT_FALSE, VARIANT_TRUE};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
    use windows::Win32::System::TaskScheduler::{
        IExecAction, ITaskDefinition, ITaskService, TaskScheduler, TASK_ACTION_EXEC, TASK_ACTION_TYPE, TASK_ENUM_HIDDEN,
    };
    use windows::Win32::System::Variant::VARIANT;

    pub struct Task {
        pub path: String,
        pub target: String,
        pub enabled: bool,
    }

    /// Dans un fil à part (COM initialisé pour lui seul), avec un délai : le service du
    /// Planificateur peut rester figé (tâches corrompues, service bloqué).
    fn with<T: Send + 'static>(
        f: impl FnOnce(&ITaskService) -> windows::core::Result<T> + Send + 'static,
    ) -> Result<T, String> {
        crate::watchdog::timed(Duration::from_secs(20), move || unsafe {
            let init = CoInitializeEx(None, COINIT_MULTITHREADED);
            let r = (|| {
                let svc: ITaskService = CoCreateInstance(&TaskScheduler, None, CLSCTX_INPROC_SERVER)?;
                let none = VARIANT::default();
                svc.Connect(&none, &none, &none, &none)?;
                f(&svc)
            })();
            if init.is_ok() {
                CoUninitialize();
            }
            r.map_err(|e| e.message())
        })
        .unwrap_or_else(|| Err("le Planificateur de tâches ne répond pas".into()))
    }

    pub fn list() -> Result<Vec<Task>, String> {
        with(|svc| unsafe {
            let mut out = Vec::new();
            let mut folders = vec![svc.GetFolder(&BSTR::from("\\"))?];
            while let Some(folder) = folders.pop() {
                // Dossiers illisibles sans droits administrateur : ignorés, comme par schtasks
                if let Ok(subs) = folder.GetFolders(0) {
                    for i in 1..=subs.Count().unwrap_or(0) {
                        if let Ok(f) = subs.get_Item(&VARIANT::from(i)) {
                            folders.push(f);
                        }
                    }
                }
                let Ok(tasks) = folder.GetTasks(TASK_ENUM_HIDDEN.0) else {
                    continue;
                };
                for i in 1..=tasks.Count().unwrap_or(0) {
                    let Ok(t) = tasks.get_Item(&VARIANT::from(i)) else {
                        continue;
                    };
                    let Ok(path) = t.Path() else {
                        continue;
                    };
                    out.push(Task {
                        path: path.to_string(),
                        target: t.Definition().map(|d| exec_target(&d)).unwrap_or_default(),
                        enabled: t.Enabled().map(|b| b.0 != 0).unwrap_or(true),
                    });
                }
            }
            Ok(out)
        })
    }

    /// Programmes lancés par la tâche (« chemin arguments », séparés par « ; » s'il y en a plusieurs)
    unsafe fn exec_target(def: &ITaskDefinition) -> String {
        let Ok(actions) = def.Actions() else {
            return String::new();
        };
        let mut n = 0;
        if actions.Count(&mut n).is_err() {
            return String::new();
        }
        let mut parts = Vec::new();
        for i in 1..=n {
            let Ok(a) = actions.get_Item(i) else {
                continue;
            };
            let mut ty = TASK_ACTION_TYPE(-1);
            if a.Type(&mut ty).is_err() || ty != TASK_ACTION_EXEC {
                continue;
            }
            let Ok(exec) = a.cast::<IExecAction>() else {
                continue;
            };
            let (mut path, mut args) = (BSTR::new(), BSTR::new());
            if exec.Path(&mut path).is_err() || path.is_empty() {
                continue;
            }
            let _ = exec.Arguments(&mut args);
            parts.push(if args.is_empty() { path.to_string() } else { format!("{path} {args}") });
        }
        parts.join(" ; ")
    }

    pub fn set_enabled(name: &str, enable: bool) -> Result<(), String> {
        let full = format!("\\{}", name.trim_start_matches('\\'));
        let (dir, leaf) = full.rsplit_once('\\').unwrap_or(("", &full));
        let (dir, leaf) = (if dir.is_empty() { "\\".to_string() } else { dir.to_string() }, leaf.to_string());
        with(move |svc| unsafe {
            let task = svc.GetFolder(&BSTR::from(dir.as_str()))?.GetTask(&BSTR::from(leaf.as_str()))?;
            task.SetEnabled(if enable { VARIANT_TRUE } else { VARIANT_FALSE })
        })
        .map_err(|e| format!("tâche {name} : {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn taches_planifiees_lues_par_com() {
        let list = sched::list().expect("Planificateur de tâches");
        // Windows en a toujours dans \Microsoft\Windows\…, et certaines sont désactivées d'origine
        assert!(list.iter().any(|t| t.path.starts_with(r"\Microsoft\Windows\")));
        assert!(list.iter().any(|t| t.target.contains(".exe") || t.target.contains(".EXE")));
        let entries = tasks();
        assert_eq!(entries.len(), list.len());
        assert!(entries.iter().all(|e| !e.name.starts_with('\\') && e.mode.is_some()));
        eprintln!(
            "{} tâches, {} désactivées, {} avec un programme",
            list.len(),
            list.iter().filter(|t| !t.enabled).count(),
            list.iter().filter(|t| !t.target.is_empty()).count()
        );
    }

    #[test]
    fn tache_inconnue_refusee_sans_blocage() {
        let e = set_task_enabled(r"\PeriphHub\tâche-qui-n-existe-pas", false).unwrap_err();
        assert!(e.starts_with("tâche "), "{e}");
    }
}
