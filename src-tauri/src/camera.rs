// Webcams : Logitech (C920, C922, Brio, StreamCam), Razer Kiyo, Elgato Facecam, AVerMedia, Microsoft,
// Insta360 Link, caméras intégrées… par les réglages vidéo standard de Windows (classe UVC, exposés
// par DirectShow : IAMCameraControl et IAMVideoProcAmp, plus l'anti-scintillement par KS).
// Aucune marque à connaître : chaque caméra annonce elle-même ses réglages, leurs bornes et leur pas ;
// PeriphHub n'envoie rien en dehors.
use crate::audio::Com;
use serde_json::{json, Value};
use windows::core::Interface;
use windows::Win32::Media::DirectShow::{IAMCameraControl, IAMVideoProcAmp, IBaseFilter, ICreateDevEnum};
use windows::Win32::Media::KernelStreaming::{IKsControl, KSIDENTIFIER, KSPROPERTY_VIDEOPROCAMP_S, PROPSETID_VIDCAP_VIDEOPROCAMP};
use windows::Win32::Media::MediaFoundation::{CLSID_SystemDeviceEnum, CLSID_VideoInputDeviceCategory};
use windows::Win32::System::Com::StructuredStorage::IPropertyBag;
use windows::Win32::System::Com::{CoCreateInstance, IMoniker, CLSCTX_INPROC_SERVER};
use windows::Win32::System::Variant::{VariantClear, VariantToStringAlloc, VARIANT};

// Noms internes → rang DirectShow (CameraControlProperty / VideoProcAmpProperty)
pub const CAMERA: &[(&str, i32)] = &[("pan", 0), ("tilt", 1), ("roll", 2), ("zoom", 3), ("exposure", 4), ("iris", 5), ("focus", 6)];
pub const VIDEO: &[(&str, i32)] = &[
    ("brightness", 0), ("contrast", 1), ("hue", 2), ("saturation", 3), ("sharpness", 4), ("gamma", 5),
    ("color", 6), ("white_balance", 7), ("backlight", 8), ("gain", 9),
];
const POWERLINE: u32 = 13; // KSPROPERTY_VIDEOPROCAMP_POWERLINE_FREQUENCY : 0 désactivé, 1 50 Hz, 2 60 Hz, 3 auto
const FLAG_AUTO: i32 = 1;
const FLAG_MANUAL: i32 = 2;
const KSPROPERTY_TYPE_GET: u32 = 1;
const KSPROPERTY_TYPE_SET: u32 = 2;

fn err(e: windows::core::Error) -> String {
    format!("la caméra a refusé ({:#010x})", e.code().0)
}

struct Cam {
    name: String,
    path: String,
    filter: IBaseFilter,
}

fn bag_text(bag: &IPropertyBag, key: &str) -> String {
    unsafe {
        let mut v = VARIANT::default();
        let k: Vec<u16> = key.encode_utf16().chain(Some(0)).collect();
        if bag.Read(windows::core::PCWSTR(k.as_ptr()), &mut v, None).is_err() {
            return String::new();
        }
        let s = VariantToStringAlloc(&v)
            .map(|p| {
                let s = p.to_string().unwrap_or_default();
                windows::Win32::System::Com::CoTaskMemFree(Some(p.0 as _));
                s
            })
            .unwrap_or_default();
        let _ = VariantClear(&mut v);
        s
    }
}

fn cameras() -> Result<Vec<Cam>, String> {
    let mut out = Vec::new();
    unsafe {
        let devenum: ICreateDevEnum = CoCreateInstance(&CLSID_SystemDeviceEnum, None, CLSCTX_INPROC_SERVER).map_err(err)?;
        let mut en = None;
        devenum.CreateClassEnumerator(&CLSID_VideoInputDeviceCategory, &mut en, 0).map_err(err)?;
        // S_FALSE : aucune caméra (en reste à None)
        let Some(en) = en else { return Ok(out) };
        loop {
            let mut m: [Option<IMoniker>; 1] = [None];
            if en.Next(&mut m, None) != windows::core::HRESULT(0) {
                break;
            }
            let Some(m) = m[0].take() else { break };
            let Ok(bag) = m.BindToStorage::<_, _, IPropertyBag>(None, None) else { continue };
            let name = bag_text(&bag, "FriendlyName");
            let path = bag_text(&bag, "DevicePath");
            // Caméras virtuelles (OBS, logiciels de visio) : pas de chemin de périphérique, rien à régler
            if path.is_empty() {
                continue;
            }
            if let Ok(filter) = m.BindToObject::<_, _, IBaseFilter>(None, None) {
                out.push(Cam { name, path, filter });
            }
        }
    }
    Ok(out)
}

fn ids(path: &str) -> (Option<u16>, Option<u16>) {
    let low = path.to_lowercase();
    let hex_after = |tag: &str| low.find(tag).and_then(|i| low.get(i + tag.len()..i + tag.len() + 4)).and_then(|h| u16::from_str_radix(h, 16).ok());
    (hex_after("vid_"), hex_after("pid_"))
}

fn ks_powerline(filter: &IBaseFilter, set: Option<i32>) -> Option<i32> {
    let ks: IKsControl = filter.cast().ok()?;
    let mut s = KSPROPERTY_VIDEOPROCAMP_S::default();
    let mut id = KSIDENTIFIER::default();
    id.Anonymous.Anonymous.Set = PROPSETID_VIDCAP_VIDEOPROCAMP;
    id.Anonymous.Anonymous.Id = POWERLINE;
    id.Anonymous.Anonymous.Flags = if set.is_some() { KSPROPERTY_TYPE_SET } else { KSPROPERTY_TYPE_GET };
    s.Property = id;
    if let Some(v) = set {
        s.Value = v;
        s.Flags = FLAG_MANUAL as u32;
    }
    let size = std::mem::size_of::<KSPROPERTY_VIDEOPROCAMP_S>() as u32;
    let mut ret = 0u32;
    unsafe { ks.KsProperty(&s.Property, size, &mut s as *mut _ as *mut _, size, &mut ret) }.ok()?;
    Some(s.Value)
}

fn describe(c: &Cam) -> Value {
    let mut controls = serde_json::Map::new();
    let cam: Option<IAMCameraControl> = c.filter.cast().ok();
    let amp: Option<IAMVideoProcAmp> = c.filter.cast().ok();
    let read = |r: &dyn Fn(i32, &mut [i32; 5]) -> bool, g: &dyn Fn(i32, &mut i32, &mut i32) -> bool, prop: i32| -> Option<Value> {
        let mut x = [0i32; 5]; // min, max, pas, défaut, capacités
        if !r(prop, &mut x) || (x[0] >= x[1] && (x[4] & FLAG_AUTO) == 0) {
            return None;
        }
        let (mut v, mut f) = (0, 0);
        let ok = g(prop, &mut v, &mut f);
        Some(json!({
            "min": x[0], "max": x[1], "step": x[2].max(1), "default": x[3],
            "can_auto": x[4] & FLAG_AUTO != 0, "can_manual": x[4] & FLAG_MANUAL != 0,
            "value": if ok { Some(v) } else { None }, "auto": ok && f & FLAG_AUTO != 0,
        }))
    };
    if let Some(cam) = &cam {
        for &(name, prop) in CAMERA {
            let r = |p: i32, x: &mut [i32; 5]| unsafe { cam.GetRange(p, &mut x[0], &mut x[1], &mut x[2], &mut x[3], &mut x[4]) }.is_ok();
            let g = |p: i32, v: &mut i32, f: &mut i32| unsafe { cam.Get(p, v, f) }.is_ok();
            if let Some(v) = read(&r, &g, prop) {
                controls.insert(name.into(), v);
            }
        }
    }
    if let Some(amp) = &amp {
        for &(name, prop) in VIDEO {
            let r = |p: i32, x: &mut [i32; 5]| unsafe { amp.GetRange(p, &mut x[0], &mut x[1], &mut x[2], &mut x[3], &mut x[4]) }.is_ok();
            let g = |p: i32, v: &mut i32, f: &mut i32| unsafe { amp.Get(p, v, f) }.is_ok();
            if let Some(v) = read(&r, &g, prop) {
                controls.insert(name.into(), v);
            }
        }
    }
    if let Some(v) = ks_powerline(&c.filter, None) {
        controls.insert("powerline".into(), json!({ "value": v }));
    }
    let (vid, pid) = ids(&c.path);
    json!({ "name": c.name, "path": c.path, "vid": vid, "pid": pid, "controls": controls })
}

pub fn list() -> Result<Value, String> {
    let _com = Com::init();
    Ok(Value::Array(cameras()?.iter().map(describe).collect()))
}

/// Règle `control` (nom de CAMERA / VIDEO, ou "powerline") ; `auto` : réglage automatique de la caméra.
/// La valeur doit être dans les bornes que la caméra annonce, sinon rien n'est envoyé.
pub fn set(path: &str, control: &str, value: i32, auto: bool) -> Result<(), String> {
    let _com = Com::init();
    let list = cameras()?;
    let c = list.iter().find(|c| c.path == path).ok_or("caméra introuvable (débranchée ?)")?;
    if control == "powerline" {
        if !(0..=3).contains(&value) {
            return Err("valeur hors limites".into());
        }
        return ks_powerline(&c.filter, Some(value)).map(|_| ()).ok_or_else(|| "réglage refusé par la caméra".into());
    }
    let check = |x: [i32; 5]| -> Result<i32, String> {
        if auto {
            return if x[4] & FLAG_AUTO != 0 { Ok(FLAG_AUTO) } else { Err("pas de mode automatique pour ce réglage".into()) };
        }
        if value < x[0] || value > x[1] {
            return Err("valeur hors limites".into());
        }
        Ok(FLAG_MANUAL)
    };
    unsafe {
        if let Some(&(_, prop)) = CAMERA.iter().find(|(n, _)| *n == control) {
            let cam: IAMCameraControl = c.filter.cast().map_err(err)?;
            let mut x = [0i32; 5];
            cam.GetRange(prop, &mut x[0], &mut x[1], &mut x[2], &mut x[3], &mut x[4]).map_err(err)?;
            let flags = check(x)?;
            let v = if auto { x[3] } else { value };
            return cam.Set(prop, v, flags).map_err(err);
        }
        if let Some(&(_, prop)) = VIDEO.iter().find(|(n, _)| *n == control) {
            let amp: IAMVideoProcAmp = c.filter.cast().map_err(err)?;
            let mut x = [0i32; 5];
            amp.GetRange(prop, &mut x[0], &mut x[1], &mut x[2], &mut x[3], &mut x[4]).map_err(err)?;
            let flags = check(x)?;
            let v = if auto { x[3] } else { value };
            return amp.Set(prop, v, flags).map_err(err);
        }
    }
    Err("réglage inconnu".into())
}

#[cfg(test)]
mod tests {
    // Lecture seule : cargo test camera -- --nocapture
    #[test]
    fn liste_les_cameras() {
        match super::list() {
            Ok(l) => println!("{l}"),
            Err(e) => println!("DirectShow indisponible : {e}"),
        }
    }
}
