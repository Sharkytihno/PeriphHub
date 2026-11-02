// Ce qui se lance tout seul avec Windows : clés Run, dossiers Démarrage, services, tâches planifiées.
// Lecture seule.
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
use winreg::RegKey;

const NO_WINDOW: u32 = 0x0800_0000;

pub struct Entry {
    /// "run" | "dossier" | "service" | "tâche"
    pub kind: &'static str,
    pub name: String,
    /// Commande, chemin ou nom de fichier : ce qu'on compare à la base de données
    pub target: String,
    /// Services : "auto" | "manuel" | "désactivé"
    pub mode: Option<&'static str>,
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
            HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run",
        ),
    ];
    for (hive, path) in keys {
        let Ok(k) = RegKey::predef(hive).open_subkey_with_flags(path, KEY_READ) else {
            continue;
        };
        for (name, _) in k.enum_values().flatten() {
            let target: String = k.get_value(&name).unwrap_or_default();
            out.push(Entry {
                kind: "run",
                name,
                target,
                mode: None,
            });
        }
    }
    out
}

fn startup_folders() -> Vec<Entry> {
    let mut dirs = Vec::new();
    if let Ok(a) = std::env::var("APPDATA") {
        dirs.push(PathBuf::from(a).join(r"Microsoft\Windows\Start Menu\Programs\Startup"));
    }
    if let Ok(p) = std::env::var("PROGRAMDATA") {
        dirs.push(PathBuf::from(p).join(r"Microsoft\Windows\Start Menu\Programs\StartUp"));
    }
    let mut out = Vec::new();
    for d in dirs {
        for f in std::fs::read_dir(d).into_iter().flatten().flatten() {
            let name = f.file_name().to_string_lossy().to_string();
            if name.eq_ignore_ascii_case("desktop.ini") {
                continue;
            }
            out.push(Entry {
                kind: "dossier",
                target: name.clone(),
                name,
                mode: None,
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
        });
    }
    out
}

// `schtasks /query /fo csv /v /nh` : colonne 1 = nom de la tâche, colonne 8 = programme lancé
fn tasks() -> Vec<Entry> {
    let Ok(o) = Command::new("schtasks")
        .args(["/query", "/fo", "csv", "/v", "/nh"])
        .creation_flags(NO_WINDOW)
        .output()
    else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&o.stdout);
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for line in text.lines() {
        let cols = csv_line(line);
        if cols.len() < 9 || !seen.insert(cols[1].clone()) {
            continue;
        }
        let name = cols[1].trim_start_matches('\\').to_string();
        out.push(Entry {
            kind: "tâche",
            name,
            target: cols[8].clone(),
            mode: None,
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
