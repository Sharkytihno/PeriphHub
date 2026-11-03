// Son Windows : micros USB (QuadCast, Yeti, Rode, Shure, Wave, Seiren, Fifine…), cartes son, DAC,
// casques et sorties audio, par les API audio de Windows (Core Audio). Aucune marque à connaître :
// tout périphérique audio reconnu par Windows est réglable.
//
// Réglages : volume, coupure, balance gauche/droite, périphérique par défaut (général et
// communications), format (fréquence d'échantillonnage, profondeur). Le périphérique par défaut
// et le format passent par l'interface IPolicyConfig de Windows : non documentée, mais stable
// depuis Windows 7 et utilisée par EarTrumpet, SoundSwitch ou SoundVolumeView.
use serde_json::{json, Value};
use windows::core::{Interface, GUID, PCWSTR, PWSTR};
use windows::Win32::Devices::FunctionDiscovery::{PKEY_DeviceInterface_FriendlyName, PKEY_Device_DeviceDesc, PKEY_Device_FriendlyName};
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    eCapture, eCommunications, eConsole, eMultimedia, eRender, EDataFlow, ERole, IAudioClient, IDeviceTopology, IMMDevice,
    IMMDeviceEnumerator, IMMEndpoint, MMDeviceEnumerator, AUDCLNT_SHAREMODE_EXCLUSIVE, DEVICE_STATE_ACTIVE, WAVEFORMATEX,
    WAVEFORMATEXTENSIBLE, WAVEFORMATEXTENSIBLE_0,
};
use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PropVariantToStringAlloc, PropVariantToUInt32, PROPVARIANT};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ};

/// COM initialisé pour le fil courant (les commandes tournent sur des fils de travail)
pub struct Com(bool);
impl Com {
    pub fn init() -> Com {
        Com(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok())
    }
}
impl Drop for Com {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() };
        }
    }
}

const PKEY_FORM_FACTOR: PROPERTYKEY = PROPERTYKEY { fmtid: GUID::from_u128(0x1da5d803_d492_4edd_8c23_e0c0ffee7f0e), pid: 0 };
const PKEY_DEVICE_FORMAT: PROPERTYKEY = PROPERTYKEY { fmtid: GUID::from_u128(0xf19f064d_082c_4e27_bc73_6882a1bb8e4c), pid: 0 };
const SUBTYPE_PCM: GUID = GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);
const SUBTYPE_FLOAT: GUID = GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);
const CLSID_POLICY_CONFIG: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);
const IID_POLICY_CONFIG: GUID = GUID::from_u128(0xf8679f50_850a_41cf_9c72_430f290290c8);

fn err(e: windows::core::Error) -> String {
    format!("Windows a refusé ({:#010x})", e.code().0)
}

fn enumerator() -> Result<IMMDeviceEnumerator, String> {
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.map_err(err)
}

fn pwstr_take(p: PWSTR) -> String {
    let s = unsafe { p.to_string() }.unwrap_or_default();
    unsafe { CoTaskMemFree(Some(p.0 as _)) };
    s
}

struct Props(windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore);
impl Props {
    fn raw(&self, key: &PROPERTYKEY) -> Option<PROPVARIANT> {
        unsafe { self.0.GetValue(key) }.ok()
    }
    fn text(&self, key: &PROPERTYKEY) -> String {
        let Some(mut v) = self.raw(key) else { return String::new() };
        let s = unsafe { PropVariantToStringAlloc(&v) }.map(pwstr_take).unwrap_or_default();
        unsafe { let _ = PropVariantClear(&mut v); }
        s
    }
    fn u32(&self, key: &PROPERTYKEY) -> Option<u32> {
        let mut v = self.raw(key)?;
        let r = unsafe { PropVariantToUInt32(&v) }.ok();
        unsafe { let _ = PropVariantClear(&mut v); }
        r
    }
    /// Format du périphérique (blob WAVEFORMATEX) : fréquence, bits utiles, canaux
    fn format(&self) -> Option<(u32, u16, u16)> {
        let mut v = self.raw(&PKEY_DEVICE_FORMAT)?;
        let out = unsafe {
            let inner = &v.Anonymous.Anonymous;
            if inner.vt.0 != 65 {
                None // VT_BLOB attendu
            } else {
                let blob = inner.Anonymous.blob;
                (blob.cbSize as usize >= std::mem::size_of::<WAVEFORMATEX>()).then(|| wave_info(blob.pBlobData as *const WAVEFORMATEX, blob.cbSize as usize))
            }
        };
        unsafe { let _ = PropVariantClear(&mut v); }
        out
    }
}

unsafe fn wave_info(p: *const WAVEFORMATEX, len: usize) -> (u32, u16, u16) {
    let w = unsafe { std::ptr::read_unaligned(p) };
    let mut bits = w.wBitsPerSample;
    if w.wFormatTag == 0xFFFE && len >= std::mem::size_of::<WAVEFORMATEXTENSIBLE>() {
        let x = unsafe { std::ptr::read_unaligned(p as *const WAVEFORMATEXTENSIBLE) };
        let valid = unsafe { x.Samples.wValidBitsPerSample };
        if valid != 0 {
            bits = valid;
        }
    }
    (w.nSamplesPerSec, bits, w.nChannels)
}

/// VID/PID USB de l'appareil qui porte ce point de terminaison (topologie : connecteur → adaptateur)
fn usb_ids(dev: &IMMDevice) -> (Option<u16>, Option<u16>, String) {
    let adapter = (|| unsafe {
        let topo: IDeviceTopology = dev.Activate(CLSCTX_ALL, None).ok()?;
        let conn = topo.GetConnector(0).ok()?;
        conn.GetDeviceIdConnectedTo().ok().map(pwstr_take)
    })()
    .unwrap_or_default();
    let low = adapter.to_lowercase();
    let hex_after = |tag: &str| low.find(tag).and_then(|i| low.get(i + tag.len()..i + tag.len() + 4)).and_then(|h| u16::from_str_radix(h, 16).ok());
    let bus = if low.contains("usb#") { "usb" } else if low.contains("bth") { "bluetooth" } else if low.contains("hdaudio") { "carte mère" } else { "" };
    (hex_after("vid_"), hex_after("pid_"), bus.to_string())
}

fn endpoint(dev: &IMMDevice, defaults: &[(String, &str)]) -> Option<Value> {
    unsafe {
        let id = pwstr_take(dev.GetId().ok()?);
        let flow = dev.cast::<IMMEndpoint>().ok()?.GetDataFlow().ok()?;
        let props = Props(dev.OpenPropertyStore(STGM_READ).ok()?);
        let (vid, pid, bus) = usb_ids(dev);
        let vol: Option<IAudioEndpointVolume> = dev.Activate(CLSCTX_ALL, None).ok();
        let (volume, mute, channels, balance) = match &vol {
            Some(v) => {
                let level = v.GetMasterVolumeLevelScalar().unwrap_or(0.0);
                let ch = v.GetChannelCount().unwrap_or(0);
                // Balance : écart entre les canaux gauche et droit (-100 tout à gauche, +100 tout à droite)
                let bal = if ch == 2 {
                    let (l, r) = (v.GetChannelVolumeLevelScalar(0).unwrap_or(0.0), v.GetChannelVolumeLevelScalar(1).unwrap_or(0.0));
                    let m = l.max(r);
                    if m > 0.0 { Some(((r - l) / m * 100.0).round() as i32) } else { Some(0) }
                } else {
                    None
                };
                (Some((level * 100.0).round() as i32), v.GetMute().map(|b| b.as_bool()).ok(), ch, bal)
            }
            None => (None, None, 0, None),
        };
        let fmt = props.format();
        let roles: Vec<&str> = defaults.iter().filter(|(d, _)| *d == id).map(|(_, r)| *r).collect();
        Some(json!({
            "id": id,
            "flow": if flow == eCapture { "capture" } else { "render" },
            "name": props.text(&PKEY_Device_FriendlyName),
            "desc": props.text(&PKEY_Device_DeviceDesc),
            "adapter": props.text(&PKEY_DeviceInterface_FriendlyName),
            "form": props.u32(&PKEY_FORM_FACTOR),
            "vid": vid, "pid": pid, "bus": bus,
            "volume": volume, "mute": mute, "channels": channels, "balance": balance,
            "format": fmt.map(|(rate, bits, ch)| json!({ "rate": rate, "bits": bits, "channels": ch })),
            "default": roles,
        }))
    }
}

fn default_ids(e: &IMMDeviceEnumerator) -> Vec<(String, &'static str)> {
    let mut out = Vec::new();
    for (flow, fname) in [(eRender, "render"), (eCapture, "capture")] {
        for (role, rname) in [(eConsole, "console"), (eCommunications, "comms")] {
            if let Ok(d) = unsafe { e.GetDefaultAudioEndpoint(flow, role) } {
                if let Ok(id) = unsafe { d.GetId() } {
                    let tag: &'static str = match (fname, rname) {
                        ("render", "console") => "render",
                        ("render", _) => "render-comms",
                        (_, "console") => "capture",
                        _ => "capture-comms",
                    };
                    out.push((pwstr_take(id), tag));
                }
            }
        }
    }
    out
}

/// Points de terminaison audio actifs (sorties et entrées)
pub fn list() -> Result<Value, String> {
    let _com = Com::init();
    let e = enumerator()?;
    let defaults = default_ids(&e);
    let mut out = Vec::new();
    unsafe {
        let all = e.EnumAudioEndpoints(EDataFlow(2), DEVICE_STATE_ACTIVE).map_err(err)?;
        for i in 0..all.GetCount().map_err(err)? {
            if let Some(v) = all.Item(i).ok().and_then(|d| endpoint(&d, &defaults)) {
                out.push(v);
            }
        }
    }
    Ok(Value::Array(out))
}

fn device(e: &IMMDeviceEnumerator, id: &str) -> Result<IMMDevice, String> {
    let w: Vec<u16> = id.encode_utf16().chain(Some(0)).collect();
    unsafe { e.GetDevice(PCWSTR(w.as_ptr())) }.map_err(|_| "périphérique audio introuvable (débranché ?)".to_string())
}

/// Appel d'une méthode de IPolicyConfig par son rang dans la table virtuelle
unsafe fn policy_call<F: FnOnce(*mut core::ffi::c_void, *const *const core::ffi::c_void) -> windows::core::HRESULT>(f: F) -> Result<(), String> {
    let unk: windows::core::IUnknown = unsafe { CoCreateInstance(&CLSID_POLICY_CONFIG, None, CLSCTX_ALL) }.map_err(err)?;
    let mut p: *mut core::ffi::c_void = std::ptr::null_mut();
    unsafe { unk.query(&IID_POLICY_CONFIG, &mut p) }.ok().map_err(err)?;
    let vtbl = unsafe { *(p as *const *const *const core::ffi::c_void) };
    let r = f(p, vtbl);
    // Release (rang 2 de IUnknown)
    let release: unsafe extern "system" fn(*mut core::ffi::c_void) -> u32 = unsafe { std::mem::transmute(*vtbl.add(2)) };
    unsafe { release(p) };
    r.ok().map_err(err)
}

fn set_default(id: &str, roles: &[ERole]) -> Result<(), String> {
    let w: Vec<u16> = id.encode_utf16().chain(Some(0)).collect();
    for &role in roles {
        unsafe {
            policy_call(|p, vtbl| {
                // SetDefaultEndpoint(PCWSTR, ERole) : rang 13
                let f: unsafe extern "system" fn(*mut core::ffi::c_void, PCWSTR, ERole) -> windows::core::HRESULT = std::mem::transmute(*vtbl.add(13));
                f(p, PCWSTR(w.as_ptr()), role)
            })?;
        }
    }
    Ok(())
}

fn wave(rate: u32, bits: u16, container: u16, channels: u16, mask: u32, float: bool) -> WAVEFORMATEXTENSIBLE {
    let align = channels * container / 8;
    WAVEFORMATEXTENSIBLE {
        Format: WAVEFORMATEX {
            wFormatTag: 0xFFFE,
            nChannels: channels,
            nSamplesPerSec: rate,
            nAvgBytesPerSec: rate * align as u32,
            nBlockAlign: align,
            wBitsPerSample: container,
            cbSize: 22,
        },
        Samples: WAVEFORMATEXTENSIBLE_0 { wValidBitsPerSample: bits },
        dwChannelMask: mask,
        SubFormat: if float { SUBTYPE_FLOAT } else { SUBTYPE_PCM },
    }
}

const RATES: &[u32] = &[44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000];
// (bits utiles, conteneur) : comme la liste « Format par défaut » du panneau Son de Windows
const DEPTHS: &[(u16, u16)] = &[(16, 16), (24, 24), (24, 32), (32, 32)];

fn mix_mask(dev: &IMMDevice) -> (u16, u32) {
    unsafe {
        let client: Option<IAudioClient> = dev.Activate(CLSCTX_ALL, None).ok();
        if let Some(fmt) = client.and_then(|c| c.GetMixFormat().ok()) {
            let w = std::ptr::read_unaligned(fmt);
            let mask = if w.wFormatTag == 0xFFFE { std::ptr::read_unaligned(fmt as *const WAVEFORMATEXTENSIBLE).dwChannelMask } else { 0 };
            CoTaskMemFree(Some(fmt as _));
            return (w.nChannels, mask);
        }
    }
    (2, 3)
}

/// Formats que le périphérique accepte réellement (test en mode exclusif, sans rien ouvrir ni jouer)
pub fn formats(id: &str) -> Result<Value, String> {
    let _com = Com::init();
    let dev = device(&enumerator()?, id)?;
    let (ch, mask) = mix_mask(&dev);
    let client: IAudioClient = unsafe { dev.Activate(CLSCTX_ALL, None) }.map_err(err)?;
    let mut out = Vec::new();
    for &rate in RATES {
        for &(bits, container) in DEPTHS {
            let w = wave(rate, bits, container, ch, mask, false);
            let ok = unsafe { client.IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, &w.Format, None) } == windows::core::HRESULT(0);
            if ok {
                out.push(json!({ "rate": rate, "bits": bits, "container": container }));
            }
        }
    }
    Ok(Value::Array(out))
}

fn set_format(id: &str, rate: u32, bits: u16, container: u16) -> Result<(), String> {
    if !RATES.contains(&rate) || !DEPTHS.contains(&(bits, container)) {
        return Err("format inconnu".into());
    }
    let dev = device(&enumerator()?, id)?;
    let (ch, mask) = mix_mask(&dev);
    let client: IAudioClient = unsafe { dev.Activate(CLSCTX_ALL, None) }.map_err(err)?;
    let fmt = wave(rate, bits, container, ch, mask, false);
    // Jamais un format que le périphérique n'annonce pas
    if unsafe { client.IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, &fmt.Format, None) } != windows::core::HRESULT(0) {
        return Err("format refusé par le périphérique".into());
    }
    let mix = wave(rate, 32, 32, ch, mask, true);
    let w: Vec<u16> = id.encode_utf16().chain(Some(0)).collect();
    unsafe {
        policy_call(|p, vtbl| {
            // SetDeviceFormat(PCWSTR, WAVEFORMATEX* périphérique, WAVEFORMATEX* mixage) : rang 6
            let f: unsafe extern "system" fn(*mut core::ffi::c_void, PCWSTR, *const WAVEFORMATEX, *const WAVEFORMATEX) -> windows::core::HRESULT =
                std::mem::transmute(*vtbl.add(6));
            f(p, PCWSTR(w.as_ptr()), &fmt.Format, &mix.Format)
        })
    }
}

/// Réglage : "volume" 0-100, "mute" bool, "balance" -100..100, "default" "all" | "comms", "format" {rate, bits, container}
pub fn set(id: &str, what: &str, value: &Value) -> Result<(), String> {
    let _com = Com::init();
    let e = enumerator()?;
    let dev = device(&e, id)?;
    let vol = || -> Result<IAudioEndpointVolume, String> { unsafe { dev.Activate(CLSCTX_ALL, None) }.map_err(err) };
    unsafe {
        match what {
            "volume" => {
                let v = value.as_f64().filter(|v| (0.0..=100.0).contains(v)).ok_or("volume entre 0 et 100")?;
                vol()?.SetMasterVolumeLevelScalar((v / 100.0) as f32, std::ptr::null()).map_err(err)
            }
            "mute" => vol()?.SetMute(value.as_bool().ok_or("oui ou non attendu")?, std::ptr::null()).map_err(err),
            "balance" => {
                let b = value.as_f64().filter(|v| (-100.0..=100.0).contains(v)).ok_or("balance entre -100 et 100")?;
                let v = vol()?;
                if v.GetChannelCount().map_err(err)? != 2 {
                    return Err("balance réservée aux sorties stéréo".into());
                }
                let level = v.GetMasterVolumeLevelScalar().map_err(err)?;
                let (l, r) = if b >= 0.0 { (1.0 - b / 100.0, 1.0) } else { (1.0, 1.0 + b / 100.0) };
                v.SetChannelVolumeLevelScalar(0, (l as f32 * level).clamp(0.0, 1.0), std::ptr::null()).map_err(err)?;
                v.SetChannelVolumeLevelScalar(1, (r as f32 * level).clamp(0.0, 1.0), std::ptr::null()).map_err(err)
            }
            "default" => match value.as_str() {
                Some("all") => set_default(id, &[eConsole, eMultimedia, eCommunications]),
                Some("comms") => set_default(id, &[eCommunications]),
                Some("main") => set_default(id, &[eConsole, eMultimedia]),
                _ => Err("rôle inconnu".into()),
            },
            "format" => {
                let n = |k: &str| value[k].as_u64().ok_or("format incomplet");
                set_format(id, n("rate")? as u32, n("bits")? as u16, n("container")? as u16)
            }
            _ => Err("réglage inconnu".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    // Lecture seule, sur la machine qui lance les tests : cargo test audio -- --nocapture
    // Écritures sans effet (valeurs identiques à l'état actuel) : vérifie les appels d'écriture,
    // dont IPolicyConfig, sans rien changer. cargo test reecrit -- --ignored --nocapture
    #[test]
    #[ignore]
    fn reecrit_les_valeurs_actuelles() {
        let l = super::list().unwrap();
        for e in l.as_array().unwrap() {
            let id = e["id"].as_str().unwrap();
            if let Some(v) = e["volume"].as_i64() {
                super::set(id, "volume", &serde_json::json!(v)).unwrap();
            }
            if let Some(m) = e["mute"].as_bool() {
                super::set(id, "mute", &serde_json::json!(m)).unwrap();
            }
            let d: Vec<&str> = e["default"].as_array().unwrap().iter().filter_map(|x| x.as_str()).collect();
            if d.contains(&"render-comms") || d.contains(&"capture-comms") {
                super::set(id, "default", &serde_json::json!("comms")).unwrap();
                println!("défaut communications réaffirmé : {}", e["name"]);
            }
            let f = &e["format"];
            let formats = super::formats(id).unwrap();
            if let Some(m) = formats.as_array().unwrap().iter().find(|x| x["rate"] == f["rate"] && x["bits"] == f["bits"]) {
                super::set(id, "format", m).unwrap();
                println!("format réaffirmé : {} {}", e["name"], m);
            }
        }
        let after = super::list().unwrap();
        assert_eq!(l, after, "l'état audio a changé");
    }

    #[test]
    fn liste_les_peripheriques_audio() {
        // Sans service audio (serveur de CI), la liste est vide ou indisponible : ce n'est pas un échec
        let l = match super::list() {
            Ok(l) => l,
            Err(e) => return println!("Core Audio indisponible : {e}"),
        };
        for e in l.as_array().unwrap() {
            println!("{}", e);
            if let Some(id) = e["id"].as_str() {
                println!("  formats : {}", super::formats(id).unwrap_or_default());
            }
        }
    }
}
