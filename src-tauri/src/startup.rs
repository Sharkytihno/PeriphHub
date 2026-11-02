// Ce qui se lance tout seul avec Windows : clés Run, dossiers Démarrage, services, tâches planifiées.
// Lecture seule.
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_SET_VALUE, REG_BINARY};
use winreg::{RegKey, RegValue, HKEY};

const NO_WINDOW: u32 = 0x0800_0000;

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

// `schtasks /query /fo csv /v /nh` : colonne 1 = nom de la tâche, colonne 8 = programme lancé,
// colonne 11 = état (« Activée » / « Désactivée », « Enabled » / « Disabled » selon la langue)
fn tasks() -> Vec<Entry> {
    // Délai : le Planificateur de tâches peut rester figé (service bloqué, tâches corrompues)
    let mut cmd = Command::new(crate::sign::system_exe("schtasks.exe"));
    cmd.args(["/query", "/fo", "csv", "/v", "/nh"]).creation_flags(NO_WINDOW);
    let Some(stdout) = crate::watchdog::output(cmd, std::time::Duration::from_secs(20)) else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&stdout);
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for line in text.lines() {
        let cols = csv_line(line);
        if cols.len() < 9 || !seen.insert(cols[1].clone()) {
            continue;
        }
        let name = cols[1].trim_start_matches('\\').to_string();
        let state = cols.get(11).map(|s| s.to_lowercase()).unwrap_or_default();
        out.push(Entry {
            kind: "tâche",
            name,
            target: cols[8].clone(),
            mode: on_off(state.contains("sactiv") || state.contains("disabl")),
            scope: "",
        });
    }
    out
}

fn csv_line(line: &str) -> Vec<String> {
    let mut cols = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted && chars.peek() == Some(&'"') => {
                cur.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            ',' if !quoted => cols.push(std::mem::take(&mut cur)),
            _ => cur.push(c),
        }
    }
    cols.push(cur);
    cols
}
