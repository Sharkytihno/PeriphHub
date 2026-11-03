// Passerelle HID native pour l'interface : imite l'essentiel de WebHID
// (open / sendReport / sendFeatureReport / événements inputreport) via hidapi.
// Chaque interface ouverte a deux handles : un pour écrire, un lu par un thread
// qui pousse les reports entrants vers la WebView (événement « hid-input »).
use crate::pnp::HidIface;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

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
    writer: Mutex<hidapi::HidDevice>,
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct Hid {
    open: Mutex<HashMap<u32, Open>>,
    next: AtomicU32,
    descriptors: Mutex<HashMap<String, Vec<u8>>>,
    // Interfaces qui n'ont pas répondu à temps : écartées tant qu'elles restent branchées,
    // pour ne pas relancer à chaque relecture un appel qui reste bloqué dans Windows
    stuck: Mutex<HashSet<String>>,
    // Pourquoi le descripteur n'a pas pu être lu (pour le diagnostic)
    notes: Mutex<HashMap<String, String>>,
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
    let dev = api.open_path(&cpath).map_err(|e| format!("ouverture refusée : {e}"))?;
    let mut buf = vec![0u8; 4096];
    match dev.get_report_descriptor(&mut buf) {
        Ok(n) => Ok(buf[..n].to_vec()),
        Err(e) => Err(format!("descripteur illisible : {e}")),
    }
}

const DESCRIPTOR_LIMIT: std::time::Duration = std::time::Duration::from_secs(3);

#[derive(Serialize, Clone)]
struct InputEvent {
    handle: u32,
    report_id: u8,
    data: Vec<u8>,
}

// Toutes les commandes HID tournent hors du fil de la fenêtre : un appareil qui ne répond pas ne doit
// jamais figer PeriphHub (« Ne répond pas »). L'énumération et l'ouverture ont en plus un délai.
const HID_LIMIT: std::time::Duration = std::time::Duration::from_secs(10);

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
    hid.descriptors.lock().unwrap().retain(|p, _| present(p));
    hid.stuck.lock().unwrap().retain(|p| present(p));
    hid.notes.lock().unwrap().retain(|p, _| present(p));
    let mut out = Vec::new();
    for d in infos {
        if hid.stuck.lock().unwrap().contains(&d.path) {
            continue;
        }
        let cached = hid.descriptors.lock().unwrap().get(&d.path).cloned();
        let descriptor = match cached {
            Some(x) => x,
            None => {
                let p = d.path.clone();
                match crate::watchdog::timed(DESCRIPTOR_LIMIT, move || read_descriptor(&p)) {
                    Some(r) => {
                        let x = r.unwrap_or_else(|e| {
                            hid.notes.lock().unwrap().insert(d.path.clone(), e);
                            Vec::new()
                        });
                        hid.descriptors.lock().unwrap().insert(d.path.clone(), x.clone());
                        x
                    }
                    None => {
                        hid.stuck.lock().unwrap().insert(d.path.clone());
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
    state: String,
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
                } else if hid.stuck.lock().unwrap().contains(&d.path) {
                    "bloquée : ne répond pas à Windows".to_string()
                } else if let Some(n) = hid.notes.lock().unwrap().get(&d.path) {
                    n.clone()
                } else {
                    match hid.descriptors.lock().unwrap().get(&d.path) {
                        Some(x) if x.is_empty() => "descripteur vide".to_string(),
                        Some(x) => format!("ok, descripteur {} octets", x.len()),
                        None => "pas encore lue".to_string(),
                    }
                };
                HidProbe { vid: d.vid, pid: d.pid, interface: d.interface, usage_page: d.usage_page, usage: d.usage, state }
            })
            .collect();
        out.sort_by_key(|a| (a.vid, a.pid, a.interface, a.usage_page));
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn hid_open(app: AppHandle, path: String, unnumbered: bool) -> Result<u32, String> {
    off_main(move || crate::watchdog::hid(HID_LIMIT, move || open_now(app, path, unnumbered))?).await
}

fn open_now(app: AppHandle, path: String, unnumbered: bool) -> Result<u32, String> {
    let hid = app.state::<Hid>();
    // Seulement les périphériques des fabricants pris en charge (comme la liste de hid_devices)
    if !crate::pnp::hid_interfaces().iter().any(|d| d.path.eq_ignore_ascii_case(&path) && allowed_info(d)) {
        return Err("périphérique non pris en charge".into());
    }
    let cpath = std::ffi::CString::new(path).map_err(|e| e.to_string())?;
    let api = api()?;
    let writer = api.open_path(&cpath).map_err(|e| e.to_string())?;
    let reader = api.open_path(&cpath).map_err(|e| e.to_string())?;
    let handle = hid.next.fetch_add(1, Ordering::SeqCst) + 1;
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 1025];
        while !stop2.load(Ordering::Relaxed) {
            match reader.read_timeout(&mut buf, 200) {
                Ok(0) => {}
                Ok(n) => {
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
    });
    hid.open.lock().unwrap().insert(handle, Open { writer: Mutex::new(writer), stop });
    Ok(handle)
}

#[tauri::command]
pub fn hid_close(hid: State<'_, Hid>, handle: u32) {
    if let Some(o) = hid.open.lock().unwrap().remove(&handle) {
        o.stop.store(true, Ordering::Relaxed);
    }
}

fn frame(report_id: u8, data: &[u8]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(data.len() + 1);
    buf.push(report_id);
    buf.extend_from_slice(data);
    buf
}

#[tauri::command]
pub async fn hid_send(app: AppHandle, handle: u32, report_id: u8, data: Vec<u8>) -> Result<(), String> {
    off_main(move || {
        let hid = app.state::<Hid>();
        let open = hid.open.lock().unwrap();
        let o = open.get(&handle).ok_or("périphérique fermé")?;
        let dev = o.writer.lock().unwrap();
        dev.write(&frame(report_id, &data)).map(|_| ()).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn hid_send_feature(app: AppHandle, handle: u32, report_id: u8, data: Vec<u8>) -> Result<(), String> {
    off_main(move || {
        let hid = app.state::<Hid>();
        let open = hid.open.lock().unwrap();
        let o = open.get(&handle).ok_or("périphérique fermé")?;
        let dev = o.writer.lock().unwrap();
        dev.send_feature_report(&frame(report_id, &data)).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn hid_get_feature(app: AppHandle, handle: u32, report_id: u8, len: usize) -> Result<Vec<u8>, String> {
    off_main(move || {
        let hid = app.state::<Hid>();
        let open = hid.open.lock().unwrap();
        let o = open.get(&handle).ok_or("périphérique fermé")?;
        let dev = o.writer.lock().unwrap();
        let mut buf = vec![0u8; len.min(4096) + 1];
        buf[0] = report_id;
        let n = dev.get_feature_report(&mut buf).map_err(|e| e.to_string())?;
        Ok(buf[1..n].to_vec())
    })
    .await
}
