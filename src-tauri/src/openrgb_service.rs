// Éclairage de la mémoire (RAM) et des puces protégées de la carte mère : OpenRGB en service Windows.
//
// Windows ne laisse lire ces puces (bus SMBus) qu'avec un pilote du noyau et les droits administrateur.
// Sur un clic de l'utilisateur, et avec UNE validation Windows (une fois pour toutes), l'instance
// administrateur de PeriphHub (`periphhub.exe --openrgb-service install`) :
//   1. copie l'OpenRGB livré dans %ProgramFiles%\PeriphHub-OpenRGB (dossier modifiable seulement par un
//      administrateur : un service lancé depuis un dossier de l'utilisateur serait une faille) et revérifie
//      chaque fichier à son arrivée ;
//   2. installe PawnIO (pilote signé, https://pawnio.eu) avec son installeur officiel, sans fenêtre, s'il
//      n'est pas déjà là ;
//   3. enregistre OpenRGB comme service « PeriphHubOpenRGB » (démarrage automatique). Lancé ainsi,
//      OpenRGB démarre de lui-même en serveur SDK sur 127.0.0.1 (startup/main_Windows.cpp d'OpenRGB),
//      ses réglages dans service_config à côté de lui.
// Ensuite PeriphHub n'a plus besoin de droits : il se connecte au serveur comme avant.
// `--openrgb-service uninstall` retire le service et son dossier (PawnIO reste : d'autres logiciels
// s'en servent). La désinstallation de PeriphHub le demande aussi (windows/hooks.nsh).
use crate::openrgb::{verify_dir, FILES};
use serde_json::{json, Value};
use std::path::PathBuf;
use windows_sys::Win32::System::Services::*;

pub const SERVICE: &str = "PeriphHubOpenRGB";
// PawnIO 2.2.0 (à changer avec scripts/fetch-openrgb.ps1)
const PAWNIO_SHA256: &str = "1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032";

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

/// %ProgramFiles%\PeriphHub-OpenRGB (version 64 bits de Program Files). Pas dans %ProgramFiles%\PeriphHub :
/// une installation de PeriphHub « pour tous les utilisateurs » y vit, et sa désinstallation l'effacerait.
pub fn service_dir() -> Option<PathBuf> {
    let base = std::env::var("ProgramW6432").or_else(|_| std::env::var("ProgramFiles")).ok()?;
    Some(PathBuf::from(base).join("PeriphHub-OpenRGB"))
}

struct Handle(SC_HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CloseServiceHandle(self.0) };
        }
    }
}

fn manager(access: u32) -> Option<Handle> {
    let h = unsafe { OpenSCManagerW(std::ptr::null(), std::ptr::null(), access) };
    (!h.is_null()).then_some(Handle(h))
}

fn open(scm: &Handle, name: &str, access: u32) -> Option<Handle> {
    let n = wide(name);
    let h = unsafe { OpenServiceW(scm.0, n.as_ptr(), access) };
    (!h.is_null()).then_some(Handle(h))
}

/// État d'un service : None s'il n'existe pas (lisible sans droits administrateur)
pub fn state(name: &str) -> Option<u32> {
    let scm = manager(SC_MANAGER_CONNECT)?;
    let svc = open(&scm, name, SERVICE_QUERY_STATUS)?;
    let mut st: SERVICE_STATUS = unsafe { std::mem::zeroed() };
    (unsafe { QueryServiceStatus(svc.0, &mut st) } != 0).then_some(st.dwCurrentState)
}

/// Pour l'interface et le diagnostic (aucun chemin)
pub fn info() -> Value {
    let st = state(SERVICE);
    let label = match st {
        None => "absent",
        Some(SERVICE_RUNNING) => "running",
        Some(SERVICE_START_PENDING) => "starting",
        Some(_) => "stopped",
    };
    // Copie de Program Files d'une autre version qu'OpenRGB livré (PeriphHub mis à jour depuis) : à refaire.
    // Seul l'exe est comparé ici (il change à chaque version ; relu toutes les 30 s) : la copie entière
    // est vérifiée à l'installation.
    let exe_hash = FILES.iter().find(|(n, _)| *n == "OpenRGB.exe").map(|(_, h)| *h);
    let stale = st.is_some()
        && service_dir().and_then(|d| crate::openrgb::sha256_file(&d.join("OpenRGB.exe"))).as_deref() != exe_hash;
    json!({ "service": label, "serviceStale": stale, "pawnio": state("PawnIO").is_some() })
}

fn stop_and_wait(svc: &Handle) {
    let mut st: SERVICE_STATUS = unsafe { std::mem::zeroed() };
    unsafe { ControlService(svc.0, SERVICE_CONTROL_STOP, &mut st) };
    for _ in 0..40 {
        if unsafe { QueryServiceStatus(svc.0, &mut st) } == 0 || st.dwCurrentState == SERVICE_STOPPED {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
}

/// Instance administrateur : `periphhub.exe --openrgb-service install|uninstall`.
/// Code de sortie : 0 réussi, 1 OpenRGB livré invalide, 2 copie impossible, 3 PawnIO, 4 service, 5 inconnu.
pub fn elevated_main(action: &str) -> i32 {
    match action {
        "install" => install(),
        "uninstall" => uninstall(),
        _ => 5,
    }
}

fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(PathBuf::from)
}

fn install() -> i32 {
    let Some(res) = exe_dir().map(|d| d.join("resources")) else { return 1 };
    let src = res.join("openrgb");
    if verify_dir(&src).is_err() {
        return 1;
    }
    let Some(dst) = service_dir() else { return 2 };
    let Some(scm) = manager(SC_MANAGER_CONNECT | SC_MANAGER_CREATE_SERVICE) else { return 4 };
    // Service déjà là (mise à jour d'OpenRGB) : arrêté pendant la copie
    let existing = open(&scm, SERVICE, SERVICE_ALL_ACCESS);
    if let Some(s) = &existing {
        stop_and_wait(s);
    }
    for (name, _) in FILES {
        let to = dst.join(name);
        if let Some(p) = to.parent() {
            if std::fs::create_dir_all(p).is_err() {
                return 2;
            }
        }
        if std::fs::copy(src.join(name), &to).is_err() {
            return 2;
        }
    }
    // Revérifié à l'arrivée, dans le dossier protégé : c'est cette copie que le service lancera
    if verify_dir(&dst).is_err() {
        return 2;
    }

    // PawnIO : installeur officiel, copié lui aussi dans le dossier protégé avant vérification et lancement
    if state("PawnIO").is_none() {
        let setup = dst.join("PawnIO_setup.exe");
        if std::fs::copy(res.join("PawnIO_setup.exe"), &setup).is_err() {
            return 3;
        }
        let ok = crate::openrgb::sha256_file(&setup).as_deref() == Some(PAWNIO_SHA256)
            && std::process::Command::new(&setup)
                .args(["-install", "-silent"])
                .status()
                .ok()
                .and_then(|s| s.code())
                .is_some_and(|c| c == 0 || c == 3010); // 3010 : redémarrage conseillé
        let _ = std::fs::remove_file(&setup);
        if !ok {
            return 3;
        }
    }

    let path = wide(&format!("\"{}\"", dst.join("OpenRGB.exe").display()));
    let svc = match existing {
        Some(s) => {
            let ok = unsafe {
                ChangeServiceConfigW(
                    s.0, SERVICE_WIN32_OWN_PROCESS, SERVICE_AUTO_START, SERVICE_ERROR_NORMAL, path.as_ptr(),
                    std::ptr::null(), std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(),
                    std::ptr::null(),
                )
            };
            if ok == 0 {
                return 4;
            }
            s
        }
        None => {
            let (name, display) = (wide(SERVICE), wide("OpenRGB (PeriphHub)"));
            let h = unsafe {
                CreateServiceW(
                    scm.0, name.as_ptr(), display.as_ptr(), SERVICE_ALL_ACCESS, SERVICE_WIN32_OWN_PROCESS,
                    SERVICE_AUTO_START, SERVICE_ERROR_NORMAL, path.as_ptr(), std::ptr::null(), std::ptr::null_mut(),
                    std::ptr::null(), std::ptr::null(), std::ptr::null(),
                )
            };
            if h.is_null() {
                return 4;
            }
            Handle(h)
        }
    };
    let mut desc = wide("Éclairage RGB de la mémoire et de la carte mère pour PeriphHub (serveur OpenRGB local, 127.0.0.1).");
    let d = SERVICE_DESCRIPTIONW { lpDescription: desc.as_mut_ptr() };
    unsafe { ChangeServiceConfig2W(svc.0, SERVICE_CONFIG_DESCRIPTION, &d as *const _ as *const _) };
    if unsafe { StartServiceW(svc.0, 0, std::ptr::null()) } == 0 && state(SERVICE) != Some(SERVICE_RUNNING) {
        return 4;
    }
    0
}

fn uninstall() -> i32 {
    if let Some(scm) = manager(SC_MANAGER_CONNECT) {
        if let Some(s) = open(&scm, SERVICE, SERVICE_ALL_ACCESS) {
            stop_and_wait(&s);
            if unsafe { DeleteService(s.0) } == 0 {
                return 4;
            }
        }
    }
    if let Some(dir) = service_dir() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    0
}

/// Relance PeriphHub en administrateur pour `action` (une fenêtre de validation Windows) et attend.
/// Ok(None) : l'utilisateur a refusé ; Ok(Some(code)) : code de sortie de l'instance administrateur.
pub fn elevate(action: &str) -> Result<Option<u32>, String> {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError};
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
    use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;
    if !matches!(action, "install" | "uninstall") {
        return Err("action inconnue".into());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let (verb, file, params) = (wide("runas"), wide(&exe.to_string_lossy()), wide(&format!("--openrgb-service {action}")));
    unsafe {
        let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_NOCLOSEPROCESS;
        info.lpVerb = verb.as_ptr();
        info.lpFile = file.as_ptr();
        info.lpParameters = params.as_ptr();
        info.nShow = SW_HIDE;
        if ShellExecuteExW(&mut info) == 0 {
            // 1223 : l'utilisateur a refusé la fenêtre de validation
            return if GetLastError() == 1223 { Ok(None) } else { Err("impossible d’obtenir les droits administrateur".into()) };
        }
        if info.hProcess.is_null() {
            return Err("instance administrateur introuvable".into());
        }
        // Installation de PawnIO comprise : jusqu'à 3 minutes
        WaitForSingleObject(info.hProcess, 180_000);
        let mut code = 0u32;
        GetExitCodeProcess(info.hProcess, &mut code);
        CloseHandle(info.hProcess);
        Ok(Some(code))
    }
}
