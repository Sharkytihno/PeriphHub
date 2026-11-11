// Températures, ventilateurs et charge : processeur, carte mère, cartes graphiques, disques.
//
// Windows ne laisse lire les puces de la carte mère et les registres du processeur qu'à un administrateur,
// avec un pilote du noyau. Le module capteurs (sensors/PeriphHubSensors.cs, LibreHardwareMonitorLib)
// tourne donc en service Windows « PeriphHubSensors », installé sur un clic de l'utilisateur avec UNE
// validation Windows (`periphhub.exe --sensors-service install`) :
//   1. copie du module livré dans %ProgramFiles%\PeriphHub-Sensors (modifiable seulement par un
//      administrateur), chaque fichier revérifié à son arrivée (empreintes relevées à la compilation,
//      build.rs) ;
//   2. PawnIO (pilote signé, https://pawnio.eu), comme pour l'éclairage de la mémoire ;
//   3. service en démarrage MANUEL, que les utilisateurs du PC ont le droit de démarrer (rien d'autre).
// Ensuite PeriphHub, sans droits, démarre le service en ouvrant la page et lit ses mesures sur le canal
// \\.\pipe\PeriphHubSensors. Le service s'arrête de lui-même 3 minutes après la dernière lecture.
// Le canal n'est lu que s'il appartient bien au processus du service (un autre programme qui l'aurait
// créé avant lui ne peut pas fournir de fausses mesures).
use crate::openrgb_service::{manager, open, state, stop_and_wait, wide, Handle};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use windows_sys::Win32::System::Services::*;

include!(concat!(env!("OUT_DIR"), "/sensor_files.rs"));

pub const SERVICE: &str = "PeriphHubSensors";
const PIPE: &str = r"\\.\pipe\PeriphHubSensors";
const CMD_PIPE: &str = r"\\.\pipe\PeriphHubSensorsCmd";
const EXE: &str = "PeriphHubSensors.exe";

/// Droits du service : système et administrateurs comme d'habitude ; tout utilisateur connecté peut le
/// démarrer (RP) et voir son état (LC, CC), pas l'arrêter, le modifier ni le supprimer. Le système (le
/// service lui-même) peut changer son démarrage (DC) : automatique tant qu'un ventilateur est piloté.
const SDDL: &str = "D:(A;;CCDCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)(A;;CCLCSWRPLORC;;;AU)";

/// %ProgramFiles%\PeriphHub-Sensors (version 64 bits de Program Files)
pub fn service_dir() -> Option<PathBuf> {
    let base = std::env::var("ProgramW6432").or_else(|_| std::env::var("ProgramFiles")).ok()?;
    Some(PathBuf::from(base).join("PeriphHub-Sensors"))
}

fn verify(dir: &Path) -> Result<(), String> {
    if SENSOR_FILES.is_empty() {
        return Err("module capteurs absent de cette version".into());
    }
    for (name, want) in SENSOR_FILES {
        match crate::openrgb::sha256_file(&dir.join(name)) {
            None => return Err(format!("module capteurs incomplet ({name} manquant)")),
            Some(h) if h != *want => return Err(format!("module capteurs modifié ({name})")),
            _ => {}
        }
    }
    Ok(())
}

fn label(st: Option<u32>) -> &'static str {
    match st {
        None => "absent",
        Some(SERVICE_RUNNING) => "running",
        Some(SERVICE_START_PENDING) => "starting",
        Some(SERVICE_STOP_PENDING) => "stopping",
        Some(_) => "stopped",
    }
}

/// Pour l'interface et le diagnostic (aucun chemin)
pub fn info() -> Value {
    let st = state(SERVICE);
    let exe_hash = SENSOR_FILES.iter().find(|(n, _)| *n == EXE).map(|(_, h)| *h);
    let stale = st.is_some() && service_dir().and_then(|d| crate::openrgb::sha256_cached(&d.join(EXE))).as_deref() != exe_hash;
    json!({
        "module": !SENSOR_FILES.is_empty(),
        "service": label(st),
        "stale": stale,
        "pawnio": state("PawnIO").is_some(),
    })
}

/// Identifiant du processus du service (0 s'il ne tourne pas)
fn service_pid() -> u32 {
    let Some(scm) = manager(SC_MANAGER_CONNECT) else { return 0 };
    let Some(svc) = open(&scm, SERVICE, SERVICE_QUERY_STATUS) else { return 0 };
    let mut st: SERVICE_STATUS_PROCESS = unsafe { std::mem::zeroed() };
    let mut need = 0u32;
    let ok = unsafe {
        QueryServiceStatusEx(
            svc.0,
            SC_STATUS_PROCESS_INFO,
            &mut st as *mut _ as *mut u8,
            std::mem::size_of::<SERVICE_STATUS_PROCESS>() as u32,
            &mut need,
        )
    };
    if ok != 0 && st.dwCurrentState == SERVICE_RUNNING {
        st.dwProcessId
    } else {
        0
    }
}

fn start_service() -> Result<(), String> {
    let scm = manager(SC_MANAGER_CONNECT).ok_or("gestionnaire de services inaccessible")?;
    let svc = open(&scm, SERVICE, SERVICE_START | SERVICE_QUERY_STATUS).ok_or("service des capteurs inaccessible")?;
    if unsafe { StartServiceW(svc.0, 0, std::ptr::null()) } == 0 {
        let e = std::io::Error::last_os_error();
        // 1056 : déjà démarré
        if e.raw_os_error() != Some(1056) {
            return Err(format!("démarrage du service des capteurs impossible ({e})"));
        }
    }
    Ok(())
}

/// Une lecture du canal du service (JSON), seulement s'il appartient au processus du service
fn read_pipe(pid: u32) -> Result<Value, String> {
    use windows_sys::Win32::Foundation::{CloseHandle, GENERIC_READ, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{CreateFileW, ReadFile, OPEN_EXISTING};
    use windows_sys::Win32::System::Pipes::{GetNamedPipeServerProcessId, WaitNamedPipeW};
    let name = wide(PIPE);
    let mut h = INVALID_HANDLE_VALUE;
    for _ in 0..3 {
        h = unsafe { CreateFileW(name.as_ptr(), GENERIC_READ, 0, std::ptr::null(), OPEN_EXISTING, 0, std::ptr::null_mut()) };
        if h != INVALID_HANDLE_VALUE {
            break;
        }
        // Canal occupé (une autre lecture en cours) ou pas encore créé : on attend un peu
        unsafe { WaitNamedPipeW(name.as_ptr(), 1000) };
    }
    if h == INVALID_HANDLE_VALUE {
        return Err("canal des capteurs indisponible".into());
    }
    let mut server = 0u32;
    let owned = unsafe { GetNamedPipeServerProcessId(h, &mut server) } != 0 && server == pid && pid != 0;
    let mut data = Vec::new();
    if owned {
        let mut buf = [0u8; 16384];
        loop {
            let mut n = 0u32;
            let ok = unsafe { ReadFile(h, buf.as_mut_ptr(), buf.len() as u32, &mut n, std::ptr::null_mut()) };
            if ok == 0 || n == 0 {
                break; // fin : le service ferme le canal après l'envoi
            }
            data.extend_from_slice(&buf[..n as usize]);
            if data.len() > 4 << 20 {
                break;
            }
        }
    }
    unsafe { CloseHandle(h) };
    if !owned {
        return Err("canal des capteurs tenu par un autre programme : mesures ignorées".into());
    }
    serde_json::from_slice(&data).map_err(|e| format!("réponse du service des capteurs illisible ({e})"))
}

/// Mesures actuelles. Le service est démarré s'il le faut ; tant qu'il prépare ses capteurs (2 à 5 s
/// à son lancement), `ready` vaut false.
pub fn read() -> Result<Value, String> {
    let mut st = state(SERVICE);
    if st.is_none() {
        return Ok(json!({ "installed": false, "info": info() }));
    }
    if st != Some(SERVICE_RUNNING) {
        if st != Some(SERVICE_START_PENDING) {
            start_service()?;
        }
        for _ in 0..40 {
            st = state(SERVICE);
            if st == Some(SERVICE_RUNNING) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        if st != Some(SERVICE_RUNNING) {
            return Ok(json!({ "installed": true, "ready": false, "info": info() }));
        }
    }
    let mut v = read_pipe(service_pid())?;
    v["installed"] = json!(true);
    v["info"] = info();
    Ok(v)
}

/// Une commande au service (ventilateurs) : une ligne JSON, une ligne JSON en réponse. Même garde que la
/// lecture : le canal doit appartenir au processus du service.
pub fn command(cmd: &Value) -> Result<Value, String> {
    use windows_sys::Win32::Foundation::{CloseHandle, GENERIC_READ, GENERIC_WRITE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{CreateFileW, ReadFile, WriteFile, OPEN_EXISTING};
    use windows_sys::Win32::System::Pipes::{GetNamedPipeServerProcessId, WaitNamedPipeW};
    let line = serde_json::to_string(cmd).map_err(|e| e.to_string())? + "\n";
    if line.len() > 60000 {
        return Err("commande trop longue".into());
    }
    // Service arrêté : démarré comme pour une lecture
    let st = read()?;
    if st.get("installed") != Some(&json!(true)) {
        return Err("service des capteurs non installé".into());
    }
    let name = wide(CMD_PIPE);
    let mut h = INVALID_HANDLE_VALUE;
    for _ in 0..10 {
        h = unsafe { CreateFileW(name.as_ptr(), GENERIC_READ | GENERIC_WRITE, 0, std::ptr::null(), OPEN_EXISTING, 0, std::ptr::null_mut()) };
        if h != INVALID_HANDLE_VALUE {
            break;
        }
        unsafe { WaitNamedPipeW(name.as_ptr(), 500) };
    }
    if h == INVALID_HANDLE_VALUE {
        return Err("le service des capteurs ne prend pas encore de commandes : mettez-le à jour (page Températures)".into());
    }
    let pid = service_pid();
    let mut server = 0u32;
    let owned = unsafe { GetNamedPipeServerProcessId(h, &mut server) } != 0 && server == pid && pid != 0;
    let mut data = Vec::new();
    if owned {
        let mut n = 0u32;
        let ok = unsafe { WriteFile(h, line.as_ptr(), line.len() as u32, &mut n, std::ptr::null_mut()) };
        if ok != 0 {
            let mut buf = [0u8; 16384];
            loop {
                let mut n = 0u32;
                let ok = unsafe { ReadFile(h, buf.as_mut_ptr(), buf.len() as u32, &mut n, std::ptr::null_mut()) };
                if ok == 0 || n == 0 {
                    break;
                }
                data.extend_from_slice(&buf[..n as usize]);
                if data.ends_with(b"\n") || data.len() > 1 << 20 {
                    break;
                }
            }
        }
    }
    unsafe { CloseHandle(h) };
    if !owned {
        return Err("canal des commandes tenu par un autre programme : rien n’a été envoyé".into());
    }
    let v: Value = serde_json::from_slice(&data).map_err(|e| format!("réponse du service illisible ({e})"))?;
    if v.get("ok") == Some(&json!(true)) {
        Ok(v)
    } else {
        Err(v.get("error").and_then(|e| e.as_str()).unwrap_or("commande refusée").to_string())
    }
}

/// Instance administrateur : `periphhub.exe --sensors-service install|uninstall`.
/// Code de sortie : 0 réussi, 1 module livré invalide, 2 copie impossible, 3 PawnIO, 4 service, 5 inconnu.
pub fn elevated_main(action: &str) -> i32 {
    match action {
        "install" => install(),
        "uninstall" => uninstall(),
        _ => 5,
    }
}

fn install() -> i32 {
    let Some(res) = crate::openrgb_service::exe_dir().map(|d| d.join("resources")) else { return 1 };
    let src = res.join("sensors");
    if verify(&src).is_err() {
        return 1;
    }
    let Some(dst) = service_dir() else { return 2 };
    let Some(scm) = manager(SC_MANAGER_CONNECT | SC_MANAGER_CREATE_SERVICE) else { return 4 };
    let existing = open(&scm, SERVICE, SERVICE_ALL_ACCESS);
    if let Some(s) = &existing {
        stop_and_wait(s);
    }
    if std::fs::create_dir_all(&dst).is_err() {
        return 2;
    }
    // Fichiers d'une version précédente qui ne font plus partie du module : retirés
    if let Ok(rd) = std::fs::read_dir(&dst) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().into_owned();
            if !SENSOR_FILES.iter().any(|(f, _)| *f == n) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    for (name, _) in SENSOR_FILES {
        if std::fs::copy(src.join(name), dst.join(name)).is_err() {
            return 2;
        }
    }
    // Revérifié à l'arrivée, dans le dossier protégé : c'est cette copie que le service lancera
    if verify(&dst).is_err() {
        return 2;
    }
    if !crate::openrgb_service::ensure_pawnio(&res, &dst) {
        return 3;
    }

    let path = wide(&format!("\"{}\"", dst.join(EXE).display()));
    let svc = match existing {
        Some(s) => {
            let ok = unsafe {
                ChangeServiceConfigW(
                    s.0, SERVICE_WIN32_OWN_PROCESS, SERVICE_DEMAND_START, SERVICE_ERROR_NORMAL, path.as_ptr(),
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
            let (name, display) = (wide(SERVICE), wide("Capteurs (PeriphHub)"));
            let h = unsafe {
                CreateServiceW(
                    scm.0, name.as_ptr(), display.as_ptr(), SERVICE_ALL_ACCESS, SERVICE_WIN32_OWN_PROCESS,
                    SERVICE_DEMAND_START, SERVICE_ERROR_NORMAL, path.as_ptr(), std::ptr::null(), std::ptr::null_mut(),
                    std::ptr::null(), std::ptr::null(), std::ptr::null(),
                )
            };
            if h.is_null() {
                return 4;
            }
            Handle(h)
        }
    };
    let mut desc = wide("Températures et ventilateurs pour PeriphHub. Démarré à la demande, s'arrête seul sauf si un ventilateur est réglé à la main.");
    let d = SERVICE_DESCRIPTIONW { lpDescription: desc.as_mut_ptr() };
    unsafe { ChangeServiceConfig2W(svc.0, SERVICE_CONFIG_DESCRIPTION, &d as *const _ as *const _) };
    if !set_security(&svc) {
        return 4;
    }
    if unsafe { StartServiceW(svc.0, 0, std::ptr::null()) } == 0 && state(SERVICE) != Some(SERVICE_RUNNING) {
        return 4;
    }
    0
}

fn set_security(svc: &Handle) -> bool {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::{ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1};
    use windows_sys::Win32::Security::{DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR};
    let sddl = wide(SDDL);
    let mut sd: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
    if unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), SDDL_REVISION_1, &mut sd, std::ptr::null_mut()) } == 0 {
        return false;
    }
    let ok = unsafe { SetServiceObjectSecurity(svc.0, DACL_SECURITY_INFORMATION, sd) } != 0;
    unsafe { LocalFree(sd as _) };
    ok
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
        // Le processus peut mettre un instant à libérer ses fichiers
        for _ in 0..20 {
            if std::fs::remove_dir_all(&dir).is_ok() || !dir.exists() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn droits_du_service() {
        // Les utilisateurs (AU) peuvent démarrer (RP) mais ni arrêter (WP), ni modifier (DC), ni supprimer (SD)
        let au = SDDL.split('(').find(|a| a.ends_with(";;;AU)")).unwrap();
        // Le service lui-même (système) règle son démarrage, sans pouvoir se supprimer ni changer ses droits
        let sy = SDDL.split('(').find(|a| a.ends_with(";;;SY)")).unwrap();
        assert!(sy.contains("DC") && !sy.contains("SD") && !sy.contains("WD"));
        assert!(au.contains("RP"));
        for bad in ["WP", "DC", "SD", "WD", "WO", "DT"] {
            assert!(!au.contains(bad), "{bad}");
        }
    }

    #[test]
    fn module_present_si_livre() {
        // Avec scripts/fetch-sensors.ps1 lancé, la liste contient le programme du service
        if !SENSOR_FILES.is_empty() {
            assert!(SENSOR_FILES.iter().any(|(n, _)| *n == EXE));
            assert!(SENSOR_FILES.iter().any(|(n, _)| *n == "LibreHardwareMonitorLib.dll"));
        }
    }
}
