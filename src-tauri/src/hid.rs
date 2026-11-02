// Passerelle HID native pour l'interface : imite l'essentiel de WebHID
// (open / sendReport / sendFeatureReport / événements inputreport) via hidapi.
// Chaque interface ouverte a deux handles : un pour écrire, un lu par un thread
// qui pousse les reports entrants vers la WebView (événement « hid-input »).
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

// Liste blanche : seuls les appareils déclarés dans data/devices.json (VID + PID, ou PID « * »)
// peuvent être ouverts. Un module ne parle jamais à un appareil qu'il ne connaît pas.
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
}

struct Open {
    writer: Mutex<hidapi::HidDevice>,
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct Hid {
    api: Mutex<Option<hidapi::HidApi>>,
    open: Mutex<HashMap<u32, Open>>,
    next: AtomicU32,
}

#[derive(Serialize, Clone)]
struct InputEvent {
    handle: u32,
    report_id: u8,
    data: Vec<u8>,
}

fn with_api<T>(hid: &Hid, f: impl FnOnce(&mut hidapi::HidApi) -> Result<T, String>) -> Result<T, String> {
    let mut guard = hid.api.lock().unwrap();
    if guard.is_none() {
        *guard = Some(hidapi::HidApi::new().map_err(|e| e.to_string())?);
    }
    f(guard.as_mut().unwrap())
}

#[tauri::command]
pub fn hid_devices(hid: State<'_, Hid>) -> Result<Vec<HidInfo>, String> {
    with_api(&hid, |api| {
        api.refresh_devices().map_err(|e| e.to_string())?;
        let mut out: Vec<HidInfo> = api
            .device_list()
            .filter(|d| allowed(d.vendor_id(), d.product_id()))
            .map(|d| HidInfo {
                path: d.path().to_string_lossy().to_string(),
                vid: d.vendor_id(),
                pid: d.product_id(),
                usage_page: d.usage_page(),
                usage: d.usage(),
                interface: d.interface_number(),
                product: d.product_string().unwrap_or_default().to_string(),
                serial: d.serial_number().unwrap_or_default().to_string(),
            })
            .collect();
        out.sort_by_key(|a| (a.vid, a.pid, a.interface, a.usage_page));
        Ok(out)
    })
}

#[tauri::command]
pub fn hid_open(app: AppHandle, hid: State<'_, Hid>, path: String, unnumbered: bool) -> Result<u32, String> {
    let cpath = std::ffi::CString::new(path).map_err(|e| e.to_string())?;
    let (writer, reader) = with_api(&hid, |api| {
        // Seulement les périphériques des fabricants pris en charge (comme la liste de hid_devices)
        api.refresh_devices().map_err(|e| e.to_string())?;
        if !api.device_list().any(|d| d.path() == cpath.as_c_str() && allowed(d.vendor_id(), d.product_id())) {
            return Err("périphérique non pris en charge".into());
        }
        let w = api.open_path(&cpath).map_err(|e| e.to_string())?;
        let r = api.open_path(&cpath).map_err(|e| e.to_string())?;
        Ok((w, r))
    })?;
    let handle = hid.next.fetch_add(1, Ordering::SeqCst) + 1;
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
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
                    let _ = app.emit("hid-input", ev);
                }
                Err(_) => {
                    let _ = app.emit("hid-closed", handle);
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
pub fn hid_send(hid: State<'_, Hid>, handle: u32, report_id: u8, data: Vec<u8>) -> Result<(), String> {
    let open = hid.open.lock().unwrap();
    let o = open.get(&handle).ok_or("périphérique fermé")?;
    let dev = o.writer.lock().unwrap();
    dev.write(&frame(report_id, &data)).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hid_send_feature(hid: State<'_, Hid>, handle: u32, report_id: u8, data: Vec<u8>) -> Result<(), String> {
    let open = hid.open.lock().unwrap();
    let o = open.get(&handle).ok_or("périphérique fermé")?;
    let dev = o.writer.lock().unwrap();
    dev.send_feature_report(&frame(report_id, &data)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hid_get_feature(hid: State<'_, Hid>, handle: u32, report_id: u8, len: usize) -> Result<Vec<u8>, String> {
    let open = hid.open.lock().unwrap();
    let o = open.get(&handle).ok_or("périphérique fermé")?;
    let dev = o.writer.lock().unwrap();
    let mut buf = vec![0u8; len.min(4096) + 1];
    buf[0] = report_id;
    let n = dev.get_feature_report(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf[1..n].to_vec())
}
