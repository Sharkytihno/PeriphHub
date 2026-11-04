// Passerelle HID native pour l'interface : imite l'essentiel de WebHID
// (open / sendReport / sendFeatureReport / événements inputreport) via hidapi.
// Chaque interface ouverte a deux handles : un pour écrire, un lu par un thread
// qui pousse les reports entrants vers la WebView (événement « hid-input »).
//
// Règle d'or : un appareil qui ne répond pas ne bloque que lui-même. Chaque échange a un délai
// (hidapi corrigé, voir vendor/README.md), un verrou propre à l'appareil et un garde-fou au cas où
// Windows ne rendrait jamais la main ; la fermeture ne se fait jamais sur le fil de la fenêtre.
use crate::pnp::HidIface;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

// Liste blanche : seuls les appareils déclarés dans data/devices.json (VID + PID, ou PID « * »)
// peuvent être ouverts, plus la collection VIA des claviers QMK / Vial (page 0xFF60, usage 0x61 :
// une interface faite exprès pour les configurateurs, quel que soit le fabricant).
// Un module ne parle jamais à un appareil qu'il ne connaît pas.
const VIA_USAGE: (u16, u16) = (0xFF60, 0x61);

// Fabricants (ou puces) des souris que savent piloter les protocoles d'OpenMouse
// (ui/vendor/openmouse, voir js/drivers/openmouse.js). Chaque protocole vérifie ensuite
// lui-même le modèle exact (PID, interface) avant d'ouvrir l'appareil.
const OPENMOUSE_VIDS: &[u16] = &[
    0x03EB, 0x03F0, 0x0483, 0x045E, 0x046D, 0x04D9, 0x04F3, 0x093A, 0x0951, 0x0B05, 0x0BDA,
    0x1038, 0x1532, 0x1915, 0x1A2C, 0x1B1C, 0x1CAA, 0x1D57, 0x2023, 0x22D4, 0x24AE, 0x2516,
    0x258A, 0x25A7, 0x260D, 0x2FE3, 0x3057, 0x3151, 0x31E3, 0x320F, 0x33E4, 0x3367, 0x3434,
    0x3554, 0x361D, 0x362D, 0x36A7, 0x3710, 0x372E, 0x373B, 0x373E, 0x3770, 0x3794, 0x37B0,
    0x3837, 0x3879, 0xA8A4, 0xA8A5,
];

// Manettes PlayStation (ui/js/drivers/playstation.js) : DualShock 4 (v1, v2, adaptateur sans fil),
// DualSense, DualSense Edge. Seulement la collection manette (page 0x01, usage 0x05).
const PLAYSTATION: &[u16] = &[0x05C4, 0x09CC, 0x0BA0, 0x0CE6, 0x0DF2];

// Clés de sécurité FIDO / U2F : jamais visibles, même chez un fabricant de la liste
const FIDO_PAGE: u16 = 0xF1D0;

// Modes de mise à jour (bootloader / DFU) : jamais visibles, quelle que soit la liste.
// PeriphHub n'écrit jamais de firmware.
const NEVER: &[(u16, u16)] = &[(0x373B, 0x215C)];

fn bootloader(d: &HidIface) -> bool {
    if NEVER.contains(&(d.vid, d.pid)) {
        return true;
    }
    let p = d.product.to_lowercase();
    ["boot", "dfu", "isp ", "firmware update"].iter().any(|w| p.contains(w))
}

fn allowed_info(d: &HidIface) -> bool {
    if bootloader(d) || d.usage_page == FIDO_PAGE {
        return false;
    }
    allowed(d.vid, d.pid)
        || (d.usage_page, d.usage) == VIA_USAGE
        || OPENMOUSE_VIDS.contains(&d.vid)
        || (d.vid == 0x054C && PLAYSTATION.contains(&d.pid) && (d.usage_page, d.usage) == (0x01, 0x05))
}

fn allowed(vid: u16, pid: u16) -> bool {
    static LIST: std::sync::OnceLock<Vec<(u16, Option<u16>)>> = std::sync::OnceLock::new();
    LIST.get_or_init(|| {
        crate::vendors::support()
            .iter()
            .filter(|s| !s.plugin.is_empty())
            .filter_map(|s| {
                let vid = u16::from_str_radix(&s.vid, 16).ok()?;
                let pid = if s.pid == "*" { None } else { Some(u16::from_str_radix(&s.pid, 16).ok()?) };
                Some((vid, pid))
            })
            .collect()
    })
    .iter()
    .any(|&(v, p)| v == vid && p.is_none_or(|p| p == pid))
}

#[derive(Serialize, Clone)]
pub struct HidInfo {
    pub path: String,
    pub vid: u16,
    pub pid: u16,
    pub usage_page: u16,
    pub usage: u16,
    pub interface: i32,
    pub product: String,
    pub serial: String,
    // Descripteur HID (reconstruit par Windows) : l'interface en déduit les rapports
    // et leurs tailles, comme le fait WebHID dans Chrome
    pub descriptor: Vec<u8>,
}

struct Open {
    dev: Mutex<hidapi::HidDevice>,
    stop: Arc<AtomicBool>,
    path: String,
    // Début de l'échange en cours : repère un appel resté bloqué dans Windows
    busy: Mutex<Option<Instant>>,
    // Un échange n'a jamais rendu la main : plus rien n'est envoyé à cette interface
    stuck: AtomicBool,
}

/// Bilan des échanges d'une interface, pour le diagnostic
#[derive(Default, Clone)]
struct Tally {
    ok: u32,
    failed: u32,
    last: String,
}

#[derive(Default)]
pub struct Hid {
    open: Mutex<HashMap<u32, Arc<Open>>>,
    next: AtomicU32,
    descriptors: Mutex<HashMap<String, Vec<u8>>>,
    // Interfaces qui n'ont pas répondu à temps : écartées tant qu'elles restent branchées,
    // pour ne pas relancer à chaque relecture un appel qui reste bloqué dans Windows
    stuck: Mutex<HashSet<String>>,
    // Lecture de descripteur qui a dépassé son délai mais continue dans son fil : si Windows finit par
    // répondre (appareil occupé un moment par un autre logiciel, OpenRGB qui démarre…), l'interface
    // revient au passage suivant au lieu de rester écartée jusqu'au débranchement
    late: Mutex<HashMap<String, Arc<Mutex<Option<Result<Vec<u8>, String>>>>>>,
    // Pourquoi le descripteur n'a pas pu être lu (pour le diagnostic)
    notes: Mutex<HashMap<String, String>>,
    tally: Mutex<HashMap<String, Tally>>,
}

// Un verrou « empoisonné » (panique d'un autre fil) reste utilisable : ce ne sont que des listes
fn lk<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub const NO_ANSWER: &str = "le périphérique ne répond pas";
const WEDGED: &str = "le périphérique ne répond plus à Windows (débranchez-le puis rebranchez-le)";

// Messages de hidapi rendus lisibles (le délai dépassé arrive sous la forme « WinError: WaitTimedOut »)
fn hid_err(e: hidapi::HidError) -> String {
    let s = e.to_string();
    if s.contains("WaitTimedOut") {
        format!("{NO_ANSWER} (délai dépassé)")
    } else {
        s
    }
}

fn note(hid: &Hid, path: &str, r: Result<(), &str>) {
    let mut t = lk(&hid.tally);
    let e = t.entry(path.to_string()).or_default();
    match r {
        Ok(()) => e.ok += 1,
        Err(m) => {
            e.failed += 1;
            e.last = m.chars().take(160).collect();
        }
    }
}

// hidapi sans énumération : la liste vient de pnp.rs, on n'ouvre que l'interface demandée
fn api() -> Result<hidapi::HidApi, String> {
    static NO_DISCOVERY: std::sync::Once = std::sync::Once::new();
    NO_DISCOVERY.call_once(hidapi::HidApi::disable_device_discovery);
    hidapi::HidApi::new().map_err(|e| e.to_string())
}

// Lu une seule fois par interface (ouverture sans accès si Windows réserve l'appareil)
fn read_descriptor(path: &str) -> Result<Vec<u8>, String> {
    let cpath = std::ffi::CString::new(path).map_err(|_| "chemin invalide".to_string())?;
    let api = api().map_err(|e| format!("hidapi : {e}"))?;
    let dev = api.open_path(&cpath).map_err(|e| format!("ouverture refusée : {}", hid_err(e)))?;
    let mut buf = vec![0u8; 4096];
    // hidapi reconstruit le descripteur à partir de ce que Windows en a gardé : sur un appareil
    // exotique, cette reconstruction peut paniquer. L'interface est alors écartée, pas PeriphHub.
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| dev.get_report_descriptor(&mut buf))) {
        Ok(Ok(n)) => Ok(buf[..n.min(buf.len())].to_vec()),
        Ok(Err(e)) => Err(format!("descripteur illisible : {}", hid_err(e))),
        Err(_) => Err("descripteur illisible : erreur interne de hidapi".into()),
    }
}

const DESCRIPTOR_LIMIT: Duration = Duration::from_secs(3);

#[derive(Serialize, Clone)]
struct InputEvent {
    handle: u32,
    report_id: u8,
    data: Vec<u8>,
}

// Toutes les commandes HID tournent hors du fil de la fenêtre : un appareil qui ne répond pas ne doit
// jamais figer PeriphHub (« Ne répond pas »). L'énumération et l'ouverture ont en plus un délai.
const HID_LIMIT: Duration = Duration::from_secs(10);

// Un échange (écriture, feature report) : hidapi abandonne au bout de 1 à 2,5 s. Ce garde-fou ne sert
// que si Windows ne rend jamais la main malgré l'annulation (pilote défaillant).
const EXCHANGE_LIMIT: Duration = Duration::from_secs(8);
const WEDGED_AFTER: Duration = Duration::from_secs(6);

async fn off_main<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn hid_devices(app: AppHandle) -> Result<Vec<HidInfo>, String> {
    off_main(move || devices_now(&app.state::<Hid>())).await
}

// La liste ne bloque jamais (pnp.rs). Seules les interfaces prises en charge sont ouvertes, une par une
// et chacune avec son délai, pour lire leur descripteur : un appareil figé est écarté, les autres restent.
fn devices_now(hid: &Hid) -> Result<Vec<HidInfo>, String> {
    let infos: Vec<HidIface> = crate::pnp::hid_interfaces().into_iter().filter(allowed_info).collect();
    let present = |p: &str| infos.iter().any(|d| d.path == p);
    lk(&hid.descriptors).retain(|p, _| present(p));
    lk(&hid.stuck).retain(|p| present(p));
    lk(&hid.late).retain(|p, _| present(p));
    lk(&hid.notes).retain(|p, _| present(p));
    lk(&hid.tally).retain(|p, _| present(p));
    let mut out = Vec::new();
    for d in infos {
        if lk(&hid.stuck).contains(&d.path) {
            // Lecture en retard enfin terminée : l'interface revient
            let done = lk(&hid.late).get(&d.path).and_then(|slot| lk(slot).take());
            match done {
                Some(r) => {
                    lk(&hid.late).remove(&d.path);
                    lk(&hid.stuck).remove(&d.path);
                    let x = r.unwrap_or_else(|e| {
                        lk(&hid.notes).insert(d.path.clone(), e);
                        Vec::new()
                    });
                    lk(&hid.descriptors).insert(d.path.clone(), x);
                }
                None => continue,
            }
        }
        let cached = lk(&hid.descriptors).get(&d.path).cloned();
        let descriptor = match cached {
            Some(x) => x,
            None => {
                let p = d.path.clone();
                let slot: Arc<Mutex<Option<Result<Vec<u8>, String>>>> = Arc::new(Mutex::new(None));
                let s2 = slot.clone();
                let r = crate::watchdog::timed(DESCRIPTOR_LIMIT, move || {
                    let r = read_descriptor(&p);
                    *lk(&s2) = Some(r.clone());
                    r
                });
                match r {
                    Some(r) => {
                        let x = r.unwrap_or_else(|e| {
                            lk(&hid.notes).insert(d.path.clone(), e);
                            Vec::new()
                        });
                        lk(&hid.descriptors).insert(d.path.clone(), x.clone());
                        x
                    }
                    None => {
                        lk(&hid.stuck).insert(d.path.clone());
                        lk(&hid.late).insert(d.path.clone(), slot);
                        continue;
                    }
                }
            }
        };
        out.push(HidInfo {
            path: d.path,
            vid: d.vid,
            pid: d.pid,
            usage_page: d.usage_page,
            usage: d.usage,
            interface: d.interface,
            product: d.product,
            serial: String::new(),
            descriptor,
        });
    }
    out.sort_by_key(|a| (a.vid, a.pid, a.interface, a.usage_page));
    Ok(out)
}

/// Pour le diagnostic : toutes les interfaces HID que Windows connaît (sans chemin ni numéro de série),
/// et pour chacune ce que PeriphHub en a fait. Ne lit rien sur les appareils : relit l'état de `hid_devices`.
#[derive(Serialize)]
pub struct HidProbe {
    vid: u16,
    pid: u16,
    interface: i32,
    usage_page: u16,
    usage: u16,
    product: String,
    state: String,
    // Bilan des échanges depuis le lancement (« 12 réussis, 2 échecs (dernier : …) »), vide si aucun
    exchanges: String,
}

#[tauri::command]
pub async fn hid_probe(app: AppHandle) -> Result<Vec<HidProbe>, String> {
    off_main(move || {
        let hid = app.state::<Hid>();
        let mut out: Vec<HidProbe> = crate::pnp::hid_interfaces()
            .into_iter()
            .map(|d| {
                let state = if bootloader(&d) || d.usage_page == FIDO_PAGE {
                    "jamais ouverte (sécurité ou mise à jour)".to_string()
                } else if !allowed_info(&d) {
                    "non prise en charge".to_string()
                } else if lk(&hid.stuck).contains(&d.path) {
                    "bloquée : ne répond pas à Windows".to_string()
                } else if let Some(n) = lk(&hid.notes).get(&d.path) {
                    n.clone()
                } else {
                    match lk(&hid.descriptors).get(&d.path) {
                        Some(x) if x.is_empty() => "descripteur vide".to_string(),
                        Some(x) => format!("ok, descripteur {} octets", x.len()),
                        None => "pas encore lue".to_string(),
                    }
                };
                let exchanges = match lk(&hid.tally).get(&d.path) {
                    Some(t) if t.failed > 0 => format!("{} réussis, {} échecs (dernier : {})", t.ok, t.failed, t.last),
                    Some(t) => format!("{} réussis", t.ok),
                    None => String::new(),
                };
                HidProbe {
                    vid: d.vid,
                    pid: d.pid,
                    interface: d.interface,
                    usage_page: d.usage_page,
                    usage: d.usage,
                    product: d.product.clone(),
                    state,
                    exchanges,
                }
            })
            .collect();
        out.sort_by_key(|a| (a.vid, a.pid, a.interface, a.usage_page));
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn hid_open(app: AppHandle, path: String, unnumbered: bool) -> Result<u32, String> {
    let p = path.clone();
    let app2 = app.clone();
    let r = off_main(move || crate::watchdog::hid(HID_LIMIT, move || open_now(app2, path, unnumbered))?).await;
    if let Err(e) = &r {
        note(&app.state::<Hid>(), &p, Err(&format!("ouverture : {e}")));
    }
    r
}

fn open_now(app: AppHandle, path: String, unnumbered: bool) -> Result<u32, String> {
    let hid = app.state::<Hid>();
    // Seulement les périphériques des fabricants pris en charge (comme la liste de hid_devices)
    if !crate::pnp::hid_interfaces().iter().any(|d| d.path.eq_ignore_ascii_case(&path) && allowed_info(d)) {
        return Err("périphérique non pris en charge".into());
    }
    if lk(&hid.stuck).contains(&path) {
        return Err(WEDGED.into());
    }
    let cpath = std::ffi::CString::new(path.clone()).map_err(|e| e.to_string())?;
    let api = api()?;
    let writer = api.open_path(&cpath).map_err(hid_err)?;
    let reader = api.open_path(&cpath).map_err(hid_err)?;
    let handle = hid.next.fetch_add(1, Ordering::SeqCst) + 1;
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    let app2 = app.clone();
    std::thread::Builder::new()
        .name("periphhub-hid-read".into())
        .spawn(move || {
            let mut buf = [0u8; 1025];
            while !stop2.load(Ordering::Relaxed) {
                match reader.read_timeout(&mut buf, 200) {
                    Ok(0) => {}
                    Ok(n) => {
                        let n = n.min(buf.len());
                        // hidapi (Windows) retire l'octet 0 des reports non numérotés ;
                        // sinon le 1er octet est l'ID du report
                        let ev = if unnumbered {
                            InputEvent { handle, report_id: 0, data: buf[..n].to_vec() }
                        } else {
                            InputEvent { handle, report_id: buf[0], data: buf[1..n].to_vec() }
                        };
                        let _ = app2.emit("hid-input", ev);
                    }
                    Err(_) => {
                        let _ = app2.emit("hid-closed", handle);
                        break;
                    }
                }
            }
            // `reader` est fermé ici, dans ce fil : si Windows tarde à rendre la lecture, rien d'autre n'attend
        })
        .map_err(|e| e.to_string())?;
    let open = Open { dev: Mutex::new(writer), stop, path, busy: Mutex::new(None), stuck: AtomicBool::new(false) };
    lk(&hid.open).insert(handle, Arc::new(open));
    Ok(handle)
}

// Asynchrone : la fermeture attend que Windows rende les échanges en cours, jamais sur le fil de la fenêtre
#[tauri::command]
pub async fn hid_close(app: AppHandle, handle: u32) {
    let o = lk(&app.state::<Hid>().open).remove(&handle);
    if let Some(o) = o {
        o.stop.store(true, Ordering::Relaxed);
        let _ = std::thread::Builder::new().name("periphhub-hid-close".into()).spawn(move || drop(o));
    }
}

fn frame(report_id: u8, data: &[u8]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(data.len() + 1);
    buf.push(report_id);
    buf.extend_from_slice(data);
    buf
}

/// Un échange avec une interface ouverte : verrou propre à l'appareil (les autres continuent),
/// délai de hidapi, et garde-fou si Windows ne rend jamais la main (l'interface est alors écartée).
fn exchange<T: Send + 'static>(
    app: &AppHandle,
    handle: u32,
    f: impl FnOnce(&hidapi::HidDevice) -> hidapi::HidResult<T> + Send + 'static,
) -> Result<T, String> {
    let hid = app.state::<Hid>();
    let o = lk(&hid.open).get(&handle).cloned().ok_or("périphérique fermé")?;
    if o.stuck.load(Ordering::Relaxed) {
        return Err(WEDGED.into());
    }
    // L'appelant a abandonné (délai) : un échange encore en file d'attente n'est pas envoyé en retard
    let gave_up = Arc::new(AtomicBool::new(false));
    let (o2, g2) = (o.clone(), gave_up.clone());
    let r = crate::watchdog::timed(EXCHANGE_LIMIT, move || {
        let dev = lk(&o2.dev);
        if g2.load(Ordering::Relaxed) {
            return Err(NO_ANSWER.to_string());
        }
        *lk(&o2.busy) = Some(Instant::now());
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(&dev)));
        *lk(&o2.busy) = None;
        match r {
            Ok(r) => r.map_err(hid_err),
            Err(_) => Err("erreur interne de hidapi".into()),
        }
    });
    let r = r.unwrap_or_else(|| {
        gave_up.store(true, Ordering::Relaxed);
        if lk(&o.busy).is_some_and(|t| t.elapsed() >= WEDGED_AFTER) {
            o.stuck.store(true, Ordering::Relaxed);
            lk(&hid.stuck).insert(o.path.clone());
            Err(WEDGED.into())
        } else {
            Err(format!("{NO_ANSWER} (file d'attente)"))
        }
    });
    note(&hid, &o.path, r.as_ref().map(|_| ()).map_err(|e| e.as_str()));
    r
}

#[tauri::command]
pub async fn hid_send(app: AppHandle, handle: u32, report_id: u8, data: Vec<u8>) -> Result<(), String> {
    off_main(move || exchange(&app, handle, move |d| d.write(&frame(report_id, &data)).map(|_| ()))).await
}

#[tauri::command]
pub async fn hid_send_feature(app: AppHandle, handle: u32, report_id: u8, data: Vec<u8>) -> Result<(), String> {
    off_main(move || exchange(&app, handle, move |d| d.send_feature_report(&frame(report_id, &data)))).await
}

#[tauri::command]
pub async fn hid_get_feature(app: AppHandle, handle: u32, report_id: u8, len: usize) -> Result<Vec<u8>, String> {
    off_main(move || {
        exchange(&app, handle, move |d| {
            let mut buf = vec![0u8; len.min(4096) + 1];
            buf[0] = report_id;
            // Rapport 0 : hidapi compte l'octet d'ID en plus ; une réponse vide ne doit pas faire paniquer
            let n = d.get_feature_report(&mut buf)?.min(buf.len());
            Ok(buf.get(1..n).unwrap_or_default().to_vec())
        })
    })
    .await
}
