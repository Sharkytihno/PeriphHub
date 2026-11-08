// Informations système pour le diagnostic, et journal des erreurs internes (paniques).
//
// Le diagnostic doit suffire à corriger un problème du premier coup : version réelle de Windows
// (10 ou 11, build, édition), WebView2, version Store ou installeur, droits, Smart App Control…
// Rien de personnel : ni nom d'utilisateur, ni nom du PC, ni numéro de série.

use serde_json::{json, Value};
use std::io::Write;
use std::path::PathBuf;
use winreg::enums::HKEY_LOCAL_MACHINE;
use winreg::RegKey;

/// %LOCALAPPDATA%\PeriphHub (journal d'allègement, journal d'erreurs)
pub fn data_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|b| PathBuf::from(b).join("PeriphHub"))
}

fn crash_path() -> Option<PathBuf> {
    data_dir().map(|d| d.join("erreurs.log"))
}

const CRASH_KEEP: usize = 16 * 1024;

fn now() -> String {
    use windows_sys::Win32::System::SystemInformation::GetLocalTime;
    let t = unsafe {
        let mut t = std::mem::zeroed();
        GetLocalTime(&mut t);
        t
    };
    format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond)
}

// Ni chemin d'appareil (numéro de série), ni dossier de l'utilisateur dans le journal
fn scrub(s: &str) -> String {
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    let s = if home.len() > 3 { s.replace(&home, "%USERPROFILE%") } else { s.to_string() };
    s.split(' ')
        .map(|w| if w.contains("\\\\?\\") || w.contains("#{") || w.to_ascii_lowercase().contains("hid#") { "<chemin>" } else { w })
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(400)
        .collect()
}

// Emplacement court : les 4 derniers éléments du chemin du fichier source (sans le dossier de compilation)
fn short_location(file: &str, line: u32) -> String {
    let parts: Vec<&str> = file.split(['\\', '/']).collect();
    format!("{}:{line}", parts[parts.len().saturating_sub(4)..].join("/"))
}

/// Toute panique (erreur interne) est notée dans erreurs.log, même rattrapée : le diagnostic la joint.
pub fn install_crash_log() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let p = info.payload();
        let msg = p
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| p.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "?".into());
        let loc = info.location().map(|l| short_location(l.file(), l.line())).unwrap_or_default();
        let line = format!(
            "{} · {} · fil {} · {} · {}\n",
            now(),
            env!("CARGO_PKG_VERSION"),
            std::thread::current().name().unwrap_or("?"),
            loc,
            scrub(&msg)
        );
        append_crash(&line);
        default(info);
    }));
}

fn append_crash(line: &str) {
    let Some(p) = crash_path() else { return };
    if let Some(d) = p.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    // On ne garde que la fin du journal
    if std::fs::metadata(&p).map(|m| m.len() as usize > CRASH_KEEP).unwrap_or(false) {
        if let Ok(old) = std::fs::read_to_string(&p) {
            let keep: String = old.lines().rev().take(20).collect::<Vec<_>>().into_iter().rev().map(|l| format!("{l}\n")).collect();
            let _ = std::fs::write(&p, keep);
        }
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&p) {
        let _ = f.write_all(line.as_bytes());
    }
}

/// Les dernières erreurs internes (les plus récentes en dernier)
pub fn crash_lines(max: usize) -> Vec<String> {
    let text = crash_path().and_then(|p| std::fs::read_to_string(p).ok()).unwrap_or_default();
    let lines: Vec<String> = text.lines().filter(|l| !l.trim().is_empty()).map(String::from).collect();
    lines[lines.len().saturating_sub(max)..].to_vec()
}

fn os() -> Value {
    let k = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion");
    let get = |name: &str| -> String { k.as_ref().ok().and_then(|k| k.get_value::<String, _>(name).ok()).unwrap_or_default() };
    let build: u32 = get("CurrentBuildNumber").parse().unwrap_or(0);
    let ubr: u32 = k.as_ref().ok().and_then(|k| k.get_value::<u32, _>("UBR").ok()).unwrap_or(0);
    let mut product = get("ProductName");
    // Windows 11 se déclare encore « Windows 10 » dans ProductName : c'est le build qui fait foi
    if build >= 22000 {
        product = product.replace("Windows 10", "Windows 11");
    }
    let display = Some(get("DisplayVersion")).filter(|s| !s.is_empty()).unwrap_or_else(|| get("ReleaseId"));
    let arch = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment")
        .and_then(|k| k.get_value::<String, _>("PROCESSOR_ARCHITECTURE"))
        .unwrap_or_default();
    json!({
        "name": product,
        "version": display,
        "build": format!("{build}.{ubr}"),
        "edition": get("EditionID"),
        "arch": arch,
    })
}

// Smart App Control (Windows 11) : bloque les programmes non signés, y compris le module casques
fn smart_app_control() -> &'static str {
    let v: Option<u32> = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("SYSTEM\\CurrentControlSet\\Control\\CI\\Policy")
        .and_then(|k| k.get_value("VerifiedAndReputablePolicyState"))
        .ok();
    match v {
        Some(1) => "activé",
        Some(2) => "en évaluation",
        Some(0) => "désactivé",
        _ => "absent",
    }
}

// Carte mère, processeur et cartes graphiques (registre, sans droits) : le diagnostic dit d'emblée quelles
// puces de capteurs attendre. Modèles seulement, aucun numéro de série.
fn hardware() -> Value {
    let hk = RegKey::predef(HKEY_LOCAL_MACHINE);
    let bios = hk.open_subkey("HARDWARE\\DESCRIPTION\\System\\BIOS");
    let b = |name: &str| -> String { bios.as_ref().ok().and_then(|k| k.get_value::<String, _>(name).ok()).unwrap_or_default().trim().to_string() };
    let cpu = hk
        .open_subkey("HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0")
        .and_then(|k| k.get_value::<String, _>("ProcessorNameString"))
        .unwrap_or_default();
    let mut gpus: Vec<String> = Vec::new();
    if let Ok(class) = hk.open_subkey("SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}") {
        for sub in class.enum_keys().flatten().filter(|k| k.chars().all(|c| c.is_ascii_digit())) {
            if let Ok(k) = class.open_subkey(&sub) {
                if let Ok(d) = k.get_value::<String, _>("DriverDesc") {
                    if !gpus.contains(&d) && !d.contains("Basic Display") && !d.contains("Remote Display") {
                        gpus.push(d);
                    }
                }
            }
        }
    }
    json!({
        "board": format!("{} {}", b("BaseBoardManufacturer"), b("BaseBoardProduct")).trim(),
        "system": format!("{} {}", b("SystemManufacturer"), b("SystemProductName")).trim(),
        "bios": b("BIOSVersion"),
        "cpu": cpu.trim(),
        "gpus": gpus,
    })
}

fn is_admin() -> bool {
    unsafe { windows_sys::Win32::UI::Shell::IsUserAnAdmin() != 0 }
}

#[tauri::command]
pub fn sys_info() -> Value {
    json!({
        "periphhub": env!("CARGO_PKG_VERSION"),
        "os": os(),
        "hardware": hardware(),
        "sensors": crate::sensors::info(),
        "webview2": tauri::webview_version().unwrap_or_else(|e| format!("introuvable ({e})")),
        "store": crate::update::from_store(),
        "admin": is_admin(),
        "smart_app_control": smart_app_control(),
        "notify": crate::notify::status(),
        "errors": crash_lines(8),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nettoie_les_chemins() {
        let s = scrub(r"échec sur \\?\hid#vid_046d&pid_c539&mi_02#7&abc&0&0000#{4d1e55b2-f16f-11cf-88cb-001111000030} ok");
        assert!(!s.contains("vid_046d&pid_c539&mi_02#7"));
        assert!(s.contains("<chemin>") && s.ends_with("ok"));
        assert_eq!(
            short_location(r"C:\Users\x\.cargo\registry\src\index\hidapi-2.6.7\src\windows_native\mod.rs", 12),
            "hidapi-2.6.7/src/windows_native/mod.rs:12"
        );
        assert_eq!(short_location("src/hid.rs", 3), "src/hid.rs:3");
    }

    #[test]
    fn infos_systeme() {
        let v = sys_info();
        assert!(v["os"]["build"].as_str().unwrap().contains('.'));
        assert!(v["os"]["name"].as_str().unwrap().starts_with("Windows"));
    }
}
