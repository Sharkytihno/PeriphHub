// Allègement guidé et réversible des logiciels constructeurs.
//
// Principes :
// - rien n'est supprimé ni désinstallé : les lancements automatiques sont coupés avec les
//   interrupteurs officiels de Windows (ceux du Gestionnaire des tâches), les services passent
//   en démarrage manuel, les tâches planifiées sont désactivées ;
// - chaque modification est notée dans un journal avec l'état d'avant, et s'annule en un clic ;
// - ce qui demande les droits administrateur passe par une seule fenêtre de validation Windows
//   (UAC) : PeriphHub se relance en administrateur le temps d'appliquer la liste, puis s'arrête.
//   Cette instance n'accepte que des actions sur des logiciels de la base de données (revérifiées
//   par elle-même), jamais sur un anti-triche ou une protection système.
use crate::{procs, scan, startup, vendors};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Command;

// ---------- Journal ----------

#[derive(Serialize, Deserialize, Clone)]
pub struct Action {
    /// "run" | "dossier" | "service" | "tâche"
    pub kind: String,
    #[serde(default)]
    pub scope: String,
    pub name: String,
    /// Services : valeur « Start » d'origine (2 = automatique) et démarrage différé
    #[serde(default)]
    pub start: u32,
    #[serde(default)]
    pub delayed: bool,
}

impl Action {
    fn id(&self) -> String {
        format!("{}|{}|{}", self.kind, self.scope, self.name)
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct VendorLog {
    pub vendor: String,
    pub name: String,
    /// Secondes depuis 1970
    pub date: u64,
    pub actions: Vec<Action>,
    /// Programme à lancer pour « Ouvrir à la demande »
    pub launch: Option<String>,
    /// Mémoire du logiciel avant l'allègement, puis juste après
    pub before_bytes: u64,
    pub after_bytes: u64,
}

fn journal_path() -> Option<PathBuf> {
    let base = std::env::var("LOCALAPPDATA").ok()?;
    Some(PathBuf::from(base).join("PeriphHub").join("allegement.json"))
}

pub fn journal() -> Vec<VendorLog> {
    journal_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save_journal(j: &[VendorLog]) -> Result<(), String> {
    let p = journal_path().ok_or("dossier LOCALAPPDATA introuvable")?;
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // écriture atomique : un journal à moitié écrit ferait perdre la possibilité d'annuler
    let tmp = p.with_extension("tmp");
    let text = serde_json::to_string_pretty(j).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ---------- État actuel ----------

fn vendor(id: &str) -> Result<(usize, Vec<vendors::Vendor>), String> {
    let all = vendors::all();
    let i = all.iter().position(|v| v.id == id).ok_or("logiciel inconnu")?;
    Ok((i, all))
}

/// Service : (Start, DelayedAutostart) lus dans le registre (lisible sans droits administrateur)
fn service_start(name: &str) -> Option<(u32, bool)> {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};
    let k = winreg::RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags(format!(r"SYSTEM\CurrentControlSet\Services\{name}"), KEY_READ)
        .ok()?;
    let start: u32 = k.get_value("Start").ok()?;
    let delayed: u32 = k.get_value("DelayedAutostart").unwrap_or(0);
    Some((start, delayed == 1))
}

/// Lancements automatiques actifs de ce logiciel (ce qu'on propose de couper)
fn active_entries(v: &vendors::Vendor) -> Vec<startup::Entry> {
    startup::all()
        .into_iter()
        .filter(|e| v.owns_entry(e))
        .filter(|e| match e.kind {
            "service" => e.mode == Some("auto"),
            _ => e.mode == Some("actif"),
        })
        .collect()
}

fn needs_admin(e: &startup::Entry) -> bool {
    match e.kind {
        "run" | "dossier" => startup::approved_needs_admin(e.kind, e.scope),
        _ => true,
    }
}

fn entry_id(e: &startup::Entry) -> String {
    format!("{}|{}|{}", e.kind, e.scope, e.name)
}

/// Processus du logiciel (y compris ses moteurs web) : (pid, nom, octets)
fn vendor_procs(vi: usize, all: &[vendors::Vendor]) -> Vec<(u32, String, u64)> {
    let list = procs::list();
    let owners = scan::attribute(&list, all);
    list.into_iter()
        .zip(owners)
        .filter(|(_, o)| *o == Some(vi))
        .map(|(p, _)| (p.pid, p.name, p.bytes))
        .collect()
}

/// Programme principal du logiciel, pour l'ouvrir à la demande
fn guess_launch(v: &vendors::Vendor, entries: &[startup::Entry]) -> Option<String> {
    let from_cmd = |cmd: &str| -> Option<String> {
        let c = cmd.trim();
        let path = if let Some(rest) = c.strip_prefix('"') {
            rest.split('"').next()?.to_string()
        } else {
            let end = c.to_lowercase().find(".exe")? + 4;
            c[..end].to_string()
        };
        std::path::Path::new(&path).is_file().then_some(path)
    };
    entries
        .iter()
        .filter(|e| e.kind == "run")
        .find_map(|e| from_cmd(&e.target))
        .or_else(|| {
            procs::list()
                .into_iter()
                .filter(|p| v.processes.iter().any(|n| n.eq_ignore_ascii_case(&p.name)))
                .find_map(|p| p.path)
        })
}

// ---------- Plan proposé à l'utilisateur ----------

pub fn plan(id: &str) -> Result<Value, String> {
    let (vi, all) = vendor(id)?;
    let v = &all[vi];
    let entries = active_entries(v);
    let running = vendor_procs(vi, &all);
    let items: Vec<Value> = entries
        .iter()
        .map(|e| {
            json!({
                "id": entry_id(e), "kind": e.kind, "name": e.name,
                "admin": needs_admin(e),
            })
        })
        .collect();
    Ok(json!({
        "vendor": v.id, "name": v.name,
        "items": items,
        "running": running.len(),
        "bytes": running.iter().map(|p| p.2).sum::<u64>(),
        "launch": guess_launch(v, &entries),
    }))
}

// ---------- Opérations (exécutées ici ou dans l'instance administrateur) ----------

#[derive(Serialize, Deserialize)]
#[serde(tag = "op")]
enum Op {
    Approve { kind: String, scope: String, name: String, enable: bool },
    SvcManual { name: String },
    SvcRestore { name: String, delayed: bool },
    SvcStop { name: String },
    SvcStart { name: String },
    Task { name: String, enable: bool },
    Kill { pid: u32 },
}

/// Services, par l'API du Gestionnaire de services de Windows (aucun sc.exe lancé : les
/// antivirus surveillent les programmes qui en pilotent d'autres en ligne de commande)
mod svc {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_SERVICE_ALREADY_RUNNING, ERROR_SERVICE_NOT_ACTIVE};
    use windows_sys::Win32::System::Services::{
        ChangeServiceConfig2W, ChangeServiceConfigW, CloseServiceHandle, ControlService, OpenSCManagerW, OpenServiceW,
        StartServiceW, SC_HANDLE, SC_MANAGER_CONNECT, SERVICE_AUTO_START, SERVICE_CHANGE_CONFIG,
        SERVICE_CONFIG_DELAYED_AUTO_START_INFO, SERVICE_CONTROL_STOP, SERVICE_DELAYED_AUTO_START_INFO,
        SERVICE_DEMAND_START, SERVICE_NO_CHANGE, SERVICE_START, SERVICE_STATUS, SERVICE_STOP,
    };

    struct Handle(SC_HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe { CloseServiceHandle(self.0) };
        }
    }

    fn failed(name: &str, code: u32) -> String {
        match code {
            5 => format!("service {name} : accès refusé"),
            1060 => format!("service {name} : introuvable"),
            c => format!("service {name} : erreur {c}"),
        }
    }

    fn open(name: &str, access: u32) -> Result<(Handle, Handle), String> {
        let wide: Vec<u16> = std::ffi::OsStr::new(name).encode_wide().chain(Some(0)).collect();
        unsafe {
            let scm = OpenSCManagerW(std::ptr::null(), std::ptr::null(), SC_MANAGER_CONNECT);
            if scm.is_null() {
                return Err(failed(name, GetLastError()));
            }
            let scm = Handle(scm);
            let s = OpenServiceW(scm.0, wide.as_ptr(), access);
            if s.is_null() {
                return Err(failed(name, GetLastError()));
            }
            Ok((scm, Handle(s)))
        }
    }

    /// Démarrage manuel, ou automatique (différé ou non) pour revenir à l'état d'origine
    pub fn set_start(name: &str, auto: bool, delayed: bool) -> Result<(), String> {
        let (_scm, s) = open(name, SERVICE_CHANGE_CONFIG)?;
        let null = std::ptr::null();
        unsafe {
            let start = if auto { SERVICE_AUTO_START } else { SERVICE_DEMAND_START };
            let ok = ChangeServiceConfigW(
                s.0,
                SERVICE_NO_CHANGE,
                start,
                SERVICE_NO_CHANGE,
                null,
                null,
                std::ptr::null_mut(),
                null,
                null,
                null,
                null,
            );
            if ok == 0 {
                return Err(failed(name, GetLastError()));
            }
            if auto {
                let info = SERVICE_DELAYED_AUTO_START_INFO { fDelayedAutostart: delayed as i32 };
                let p = &info as *const SERVICE_DELAYED_AUTO_START_INFO as *const core::ffi::c_void;
                if ChangeServiceConfig2W(s.0, SERVICE_CONFIG_DELAYED_AUTO_START_INFO, p) == 0 {
                    return Err(failed(name, GetLastError()));
                }
            }
        }
        Ok(())
    }

    /// Demande l'arrêt (comme `sc stop`, sans attendre) ; déjà arrêté = réussite
    pub fn stop(name: &str) -> Result<(), String> {
        let (_scm, s) = open(name, SERVICE_STOP)?;
        let mut st: SERVICE_STATUS = unsafe { std::mem::zeroed() };
        if unsafe { ControlService(s.0, SERVICE_CONTROL_STOP, &mut st) } == 0 {
            let e = unsafe { GetLastError() };
            if e != ERROR_SERVICE_NOT_ACTIVE {
                return Err(failed(name, e));
            }
        }
        Ok(())
    }

    /// Démarre le service ; déjà démarré = réussite
    pub fn start(name: &str) -> Result<(), String> {
        let (_scm, s) = open(name, SERVICE_START)?;
        if unsafe { StartServiceW(s.0, 0, std::ptr::null()) } == 0 {
            let e = unsafe { GetLastError() };
            if e != ERROR_SERVICE_ALREADY_RUNNING {
                return Err(failed(name, e));
            }
        }
        Ok(())
    }
}

fn kill(pid: u32) -> Result<(), String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
    unsafe {
        let h = OpenProcess(PROCESS_TERMINATE, 0, pid);
        if h.is_null() {
            return Err("accès refusé".into());
        }
        let ok = TerminateProcess(h, 0);
        CloseHandle(h);
        if ok == 0 {
            return Err("arrêt refusé".into());
        }
    }
    Ok(())
}

fn run_op(op: &Op) -> Result<(), String> {
    match op {
        Op::Approve { kind, scope, name, enable } => startup::set_approved(kind, scope, name, *enable),
        Op::SvcManual { name } => svc::set_start(name, false, false),
        Op::SvcRestore { name, delayed } => svc::set_start(name, true, *delayed),
        Op::SvcStop { name } => svc::stop(name),
        Op::SvcStart { name } => svc::start(name),
        Op::Task { name, enable } => startup::set_task_enabled(name, *enable),
        Op::Kill { pid } => kill(*pid),
    }
}

/// L'instance administrateur ne fait confiance à personne : chaque opération doit viser un
/// lancement automatique ou un processus attribué à un logiciel de la base de données.
fn permitted(op: &Op, all: &[vendors::Vendor], entries: &[startup::Entry], owned_pids: &[u32]) -> bool {
    let owned = |kind: &str, name: &str| {
        entries
            .iter()
            .any(|e| e.kind == kind && e.name.eq_ignore_ascii_case(name) && all.iter().any(|v| v.owns_entry(e)))
    };
    match op {
        Op::Approve { kind, name, .. } => owned(kind, name),
        Op::SvcManual { name } | Op::SvcRestore { name, .. } | Op::SvcStop { name } | Op::SvcStart { name } => {
            owned("service", name)
        }
        Op::Task { name, .. } => owned("tâche", name),
        Op::Kill { pid } => owned_pids.contains(pid),
    }
}

/// Point d'entrée de l'instance administrateur (`periphhub.exe --elevated <hex>`).
/// Code de sortie = nombre d'opérations refusées ou en échec.
pub fn elevated_main(hex: &str) -> i32 {
    let bytes: Option<Vec<u8>> = (0..hex.len())
        .step_by(2)
        .map(|i| hex.get(i..i + 2).and_then(|b| u8::from_str_radix(b, 16).ok()))
        .collect();
    let Some(ops) = bytes.and_then(|b| serde_json::from_slice::<Vec<Op>>(&b).ok()) else {
        return 255;
    };
    let all = vendors::all();
    let entries = startup::all();
    let list = procs::list();
    let owners = scan::attribute(&list, &all);
    let owned_pids: Vec<u32> = list.iter().zip(&owners).filter(|(_, o)| o.is_some()).map(|(p, _)| p.pid).collect();
    let mut failed = 0;
    for op in &ops {
        if !permitted(op, &all, &entries, &owned_pids) || run_op(op).is_err() {
            failed += 1;
        }
    }
    failed
}

/// Relance PeriphHub en administrateur (fenêtre de validation Windows) et attend la fin.
/// false : l'utilisateur a refusé la validation. Le résultat réel est relu ensuite dans Windows.
fn elevate(ops: &[Op]) -> Result<bool, String> {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError};
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
    use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

    let json = serde_json::to_vec(ops).map_err(|e| e.to_string())?;
    let hex: String = json.iter().map(|b| format!("{b:02x}")).collect();
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let (verb, file, params) = (wide("runas"), wide(&exe.to_string_lossy()), wide(&format!("--elevated {hex}")));
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
            return if GetLastError() == 1223 {
                Ok(false)
            } else {
                Err("impossible d'obtenir les droits administrateur".into())
            };
        }
        if info.hProcess.is_null() {
            return Err("instance administrateur introuvable".into());
        }
        WaitForSingleObject(info.hProcess, 180_000);
        let mut failed = 0u32;
        GetExitCodeProcess(info.hProcess, &mut failed);
        CloseHandle(info.hProcess);
        if failed != 0 {
            eprintln!("[allègement] {failed} opération(s) refusée(s) ou en échec");
        }
        Ok(true)
    }
}

/// Exécute les opérations : d'abord celles possibles sans droits, puis le reste en une seule
/// validation Windows. Renvoie false si l'utilisateur a refusé la validation.
fn execute(user: Vec<Op>, mut admin: Vec<Op>) -> Result<bool, String> {
    for op in user {
        if run_op(&op).is_err() {
            admin.push(op);
        }
    }
    if admin.is_empty() {
        return Ok(true);
    }
    elevate(&admin)
}

fn measure(vi: usize, all: &[vendors::Vendor]) -> u64 {
    vendor_procs(vi, all).iter().map(|p| p.2).sum()
}

// ---------- Alléger ----------

pub fn apply(id: &str, ids: &[String], close: bool) -> Result<Value, String> {
    let (vi, all) = vendor(id)?;
    let v = &all[vi];
    let entries = active_entries(v);
    let chosen: Vec<&startup::Entry> = entries.iter().filter(|e| ids.contains(&entry_id(e))).collect();
    let before_bytes = measure(vi, &all);
    let launch = guess_launch(v, &entries);

    let mut actions = Vec::new();
    let (mut user, mut admin) = (Vec::new(), Vec::new());
    for e in &chosen {
        let mut a = Action { kind: e.kind.into(), scope: e.scope.into(), name: e.name.clone(), start: 0, delayed: false };
        match e.kind {
            "run" | "dossier" => {
                let op = Op::Approve { kind: e.kind.into(), scope: e.scope.into(), name: e.name.clone(), enable: false };
                if needs_admin(e) { admin.push(op) } else { user.push(op) }
            }
            "service" => {
                let (start, delayed) = service_start(&e.name).unwrap_or((2, false));
                (a.start, a.delayed) = (start, delayed);
                admin.push(Op::SvcManual { name: e.name.clone() });
                if close {
                    admin.push(Op::SvcStop { name: e.name.clone() });
                }
            }
            _ => admin.push(Op::Task { name: e.name.clone(), enable: false }),
        }
        actions.push(a);
    }
    if close {
        // les services s'arrêtent d'abord (sinon ils relancent leurs programmes)
        for (pid, _, _) in vendor_procs(vi, &all) {
            if kill(pid).is_err() {
                admin.push(Op::Kill { pid });
            }
        }
    }
    // Validation refusée : ce qui a pu se faire sans droits est quand même noté (relu plus bas)
    let validated = execute(user, admin)?;
    if close && validated {
        // ce qui a survécu (programme relancé par un service arrêté entre-temps)
        std::thread::sleep(std::time::Duration::from_millis(800));
        for (pid, _, _) in vendor_procs(vi, &all) {
            let _ = kill(pid);
        }
    }

    // On ne note que ce qui a vraiment changé (relu dans Windows)
    let still: Vec<String> = active_entries(v).iter().map(entry_id).collect();
    let (done, failed): (Vec<Action>, Vec<Action>) = actions.into_iter().partition(|a| !still.contains(&a.id()));
    std::thread::sleep(std::time::Duration::from_millis(1200));
    let after_bytes = measure(vi, &all);

    let mut j = journal();
    if let Some(log) = j.iter_mut().find(|l| l.vendor == v.id) {
        log.actions.extend(done.iter().cloned());
        log.after_bytes = after_bytes;
        if log.launch.is_none() {
            log.launch = launch;
        }
    } else if !done.is_empty() || close {
        j.push(VendorLog {
            vendor: v.id.clone(),
            name: v.name.clone(),
            date: now(),
            actions: done.clone(),
            launch,
            before_bytes,
            after_bytes,
        });
    }
    save_journal(&j)?;
    Ok(json!({
        "cancelled": !validated,
        "done": done.len(), "failed": failed.iter().map(|a| &a.name).collect::<Vec<_>>(),
        "before_bytes": before_bytes, "after_bytes": after_bytes,
    }))
}

// ---------- Annuler ----------

pub fn undo(id: &str) -> Result<Value, String> {
    let mut j = journal();
    let Some(pos) = j.iter().position(|l| l.vendor == id) else {
        return Ok(json!({ "restored": 0 }));
    };
    let log = j[pos].clone();
    let (mut user, mut admin) = (Vec::new(), Vec::new());
    for a in &log.actions {
        match a.kind.as_str() {
            "run" | "dossier" => {
                let op = Op::Approve { kind: a.kind.clone(), scope: a.scope.clone(), name: a.name.clone(), enable: true };
                if startup::approved_needs_admin(&a.kind, &a.scope) { admin.push(op) } else { user.push(op) }
            }
            // seuls les services d'origine automatiques ont été modifiés
            "service" if a.start == 2 => admin.push(Op::SvcRestore { name: a.name.clone(), delayed: a.delayed }),
            "service" => {}
            _ => admin.push(Op::Task { name: a.name.clone(), enable: true }),
        }
    }
    let validated = execute(user, admin)?;
    // Ce qui est revenu à l'état d'origine sort du journal ; le reste y reste pour réessayer
    let entries = startup::all();
    let left: Vec<Action> = log.actions.iter().filter(|a| !restored(a, &entries, service_gone)).cloned().collect();
    let n = log.actions.len() - left.len();
    if left.is_empty() {
        j.remove(pos);
    } else {
        j[pos].actions = left.clone();
    }
    save_journal(&j)?;
    Ok(json!({ "cancelled": !validated, "restored": n, "failed": left.iter().map(|a| &a.name).collect::<Vec<_>>() }))
}

/// Le service n'existe plus du tout (logiciel désinstallé ou mis à jour depuis l'allègement).
/// Seule l'absence certaine de sa clé compte : une erreur de lecture ne vaut pas « disparu ».
fn service_gone(name: &str) -> bool {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};
    winreg::RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags(format!(r"SYSTEM\CurrentControlSet\Services\{name}"), KEY_READ)
        .is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound)
}

/// Une action du journal est-elle revenue à l'état d'origine ?
/// Un lancement automatique que le logiciel a retiré depuis (désinstallation, mise à jour qui le
/// renomme) n'a plus rien à remettre : sans ça, « Annuler l'allègement » restait bloqué à vie sur
/// « remis en partie, à réessayer ». Les tâches planifiées gardent la règle stricte : leur liste peut
/// être incomplète quand le Planificateur ne répond pas, et une tâche encore désactivée ne doit
/// jamais sortir du journal.
fn restored(a: &Action, entries: &[startup::Entry], service_gone: impl Fn(&str) -> bool) -> bool {
    let mut same = entries.iter().filter(|e| e.kind == a.kind && e.scope == a.scope && e.name == a.name);
    match a.kind.as_str() {
        "service" => a.start != 2 || service_start(&a.name).is_some_and(|(s, _)| s == 2) || service_gone(&a.name),
        "run" | "dossier" => same.next().is_none_or(|e| e.mode == Some("actif")),
        _ => same.any(|e| e.mode == Some("actif")),
    }
}

// ---------- À la demande ----------

/// Ouvre le logiciel le temps d'un réglage : redémarre ses services, puis lance son programme
pub fn open(id: &str) -> Result<Value, String> {
    let log = journal().into_iter().find(|l| l.vendor == id);
    let (vi, all) = vendor(id)?;
    let launch = log
        .as_ref()
        .and_then(|l| l.launch.clone())
        .or_else(|| guess_launch(&all[vi], &active_entries(&all[vi])))
        .ok_or("programme du logiciel introuvable")?;
    let services: Vec<Op> = log
        .iter()
        .flat_map(|l| &l.actions)
        .filter(|a| a.kind == "service")
        .map(|a| Op::SvcStart { name: a.name.clone() })
        .collect();
    if !execute(Vec::new(), services)? {
        return Ok(json!({ "cancelled": true }));
    }
    let dir = std::path::Path::new(&launch).parent().map(|p| p.to_path_buf());
    let mut cmd = Command::new(&launch);
    if let Some(d) = dir {
        cmd.current_dir(d);
    }
    cmd.spawn().map_err(|e| format!("lancement impossible : {e}"))?;
    Ok(json!({ "launched": launch }))
}

/// Referme complètement le logiciel (programmes, moteurs web et services)
pub fn close(id: &str) -> Result<Value, String> {
    let (vi, all) = vendor(id)?;
    let before = measure(vi, &all);
    let mut admin: Vec<Op> = journal()
        .into_iter()
        .filter(|l| l.vendor == id)
        .flat_map(|l| l.actions)
        .filter(|a| a.kind == "service")
        .map(|a| Op::SvcStop { name: a.name })
        .collect();
    for (pid, _, _) in vendor_procs(vi, &all) {
        if kill(pid).is_err() {
            admin.push(Op::Kill { pid });
        }
    }
    if !execute(Vec::new(), admin)? {
        return Ok(json!({ "cancelled": true }));
    }
    std::thread::sleep(std::time::Duration::from_millis(1200));
    Ok(json!({ "before_bytes": before, "after_bytes": measure(vi, &all) }))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Uniquement des services qui n'existent pas : la CI tourne en administrateur, un vrai service
    // serait réellement modifié.
    #[test]
    fn service_inconnu_refuse_sans_lancer_de_programme() {
        let name = "PeriphHub-service-inexistant";
        for r in [svc::stop(name), svc::start(name), svc::set_start(name, false, false)] {
            assert!(r.unwrap_err().contains("introuvable"));
        }
    }

    #[test]
    fn annulation_un_lancement_disparu_sort_du_journal() {
        let act = |kind: &str, name: &str| Action { kind: kind.into(), scope: "HKCU".into(), name: name.into(), start: 2, delayed: false };
        let entry = |kind: &'static str, name: &str, mode: &'static str| startup::Entry {
            kind,
            name: name.into(),
            target: String::new(),
            mode: Some(mode),
            scope: "HKCU",
        };
        let entries = [entry("run", "Remis", "actif"), entry("run", "Encore coupé", "désactivé"), entry("tâche", "Tâche remise", "actif")];
        let (gone, here) = (|_: &str| true, |_: &str| false);
        // Clé Run : remise, encore coupée, ou retirée par le logiciel depuis (plus rien à remettre)
        assert!(restored(&act("run", "Remis"), &entries, here));
        assert!(!restored(&act("run", "Encore coupé"), &entries, here));
        assert!(restored(&act("run", "Retiré depuis"), &entries, here));
        // Tâche planifiée : jamais « remise » sur la seule foi d'une liste où elle manque
        assert!(restored(&act("tâche", "Tâche remise"), &entries, here));
        assert!(!restored(&act("tâche", "Tâche absente de la liste"), &entries, here));
        // Service qui n'existe plus : remis seulement si sa clé a vraiment disparu
        assert!(restored(&act("service", "PeriphHub-service-inexistant"), &entries, gone));
        assert!(!restored(&act("service", "PeriphHub-service-inexistant"), &entries, here));
    }

    #[test]
    fn instance_admin_refuse_ce_qui_n_est_pas_a_un_constructeur() {
        let all = vendors::all();
        let entries = startup::all();
        for op in [
            Op::SvcManual { name: "WinDefend".into() },
            Op::SvcStop { name: "vgc".into() },
            Op::Task { name: r"Microsoft\Windows\Defrag\ScheduledDefrag".into(), enable: false },
            Op::Kill { pid: std::process::id() },
        ] {
            assert!(!permitted(&op, &all, &entries, &[]));
        }
    }
}
