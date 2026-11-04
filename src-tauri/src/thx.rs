// Effets THX (spatial, bass boost, normalisation, clarté vocale, micro…) via la DLL
// ThxV3Native de Razer, qui parle au moteur THX (APO Windows). Signatures relevées
// dans le module Synapse AudioEffectsTHXV3.js. Premier argument = ContainerId du casque
// au format exact renvoyé par la DLL ({MAJUSCULES} avec accolades).
// Le moteur ne répond que si le casque est la sortie audio active.
use libloading::{Library, Symbol};
use serde_json::{json, Value};
use std::ffi::{c_char, CStr, CString};
use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;

type Job = Box<dyn FnOnce(&Thx) + Send>;

pub struct Thx {
    lib: Library,
    container: Mutex<Option<String>>,
}

// Un seul thread possède la DLL : tous les appels y sont sérialisés
pub struct ThxWorker(Mutex<Option<Sender<Job>>>);

impl ThxWorker {
    pub fn new() -> Self {
        ThxWorker(Mutex::new(None))
    }

    fn sender(&self) -> Result<Sender<Job>, String> {
        let mut guard = self.0.lock().unwrap();
        if let Some(tx) = guard.as_ref() {
            return Ok(tx.clone());
        }
        let path = find_dll().ok_or("DLL THX introuvable (ThxV3Native_*.dll)")?;
        // Elle vient d'un dossier modifiable sans droits administrateur : on ne charge qu'une DLL
        // signée par Razer, et le fichier reste verrouillé (ni écriture, ni renommage, ni
        // suppression) de la vérification jusqu'au chargement, pour qu'on ne puisse pas
        // l'échanger entre les deux.
        let lock = {
            use std::os::windows::fs::OpenOptionsExt;
            const FILE_SHARE_READ: u32 = 1;
            std::fs::OpenOptions::new()
                .read(true)
                .share_mode(FILE_SHARE_READ)
                .open(&path)
                .map_err(|e| format!("DLL THX inaccessible : {e}"))?
        };
        crate::sign::check_signature(&path, "razer").map_err(|e| format!("DLL THX refusée : {e}"))?;
        let (tx, rx) = channel::<Job>();
        let (ready_tx, ready_rx) = channel::<Result<(), String>>();
        std::thread::spawn(move || {
            let lib = unsafe { Library::new(&path) };
            drop(lock); // une fois chargée, Windows protège lui-même l'image en mémoire
            let lib = match lib {
                Ok(l) => l,
                Err(e) => return ready_tx.send(Err(e.to_string())).unwrap_or(()),
            };
            let _ = ready_tx.send(Ok(()));
            let thx = Thx { lib, container: Mutex::new(None) };
            for job in rx {
                job(&thx);
            }
        });
        ready_rx.recv().map_err(|e| e.to_string())??;
        *guard = Some(tx.clone());
        Ok(tx)
    }

    pub fn run<T: Send + 'static>(&self, f: impl FnOnce(&Thx) -> T + Send + 'static) -> Result<T, String> {
        let (tx, rx) = channel();
        self.sender()?
            .send(Box::new(move |t| {
                let _ = tx.send(f(t));
            }))
            .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())
    }
}

// Version la plus récente installée par Synapse ; sinon la copie embarquée à côté de l'exe
fn find_dll() -> Option<PathBuf> {
    let mut dirs = vec![];
    if let Ok(la) = std::env::var("LOCALAPPDATA") {
        dirs.push(PathBuf::from(la).join(r"Razer\RazerAppEngine\User Data\Apps\Common\thxv3common"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(d) = exe.parent() {
            dirs.push(d.join("thx"));
        }
    }
    for d in dirs {
        let Ok(entries) = std::fs::read_dir(&d) else { continue };
        let mut found: Vec<PathBuf> = entries
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                let n = p.file_name().unwrap_or_default().to_string_lossy().to_string();
                n.starts_with("ThxV3Native") && n.ends_with(".dll")
            })
            .collect();
        found.sort();
        if let Some(p) = found.pop() {
            return Some(p);
        }
    }
    None
}

type FnS = unsafe extern "C" fn(*const c_char) -> bool;
type FnSB = unsafe extern "C" fn(*const c_char, bool) -> bool;
type FnSI = unsafe extern "C" fn(*const c_char, i32) -> bool;
type FnSF = unsafe extern "C" fn(*const c_char, f32) -> bool;
type FnSS = unsafe extern "C" fn(*const c_char, *const c_char) -> bool;
type FnGI = unsafe extern "C" fn(*const c_char) -> i32;
type FnGF = unsafe extern "C" fn(*const c_char) -> f32;
type FnGP = unsafe extern "C" fn(*const c_char) -> *mut c_char;
type FnI = unsafe extern "C" fn(i32) -> *mut c_char;
type FnFree = unsafe extern "C" fn(*mut c_char);

impl Thx {
    fn sym<T>(&self, name: &str) -> Result<Symbol<'_, T>, String> {
        unsafe { self.lib.get(name.as_bytes()) }.map_err(|_| format!("{name} absent de la DLL"))
    }

    fn take_json(&self, p: *mut c_char) -> Value {
        if p.is_null() {
            return Value::Null;
        }
        let s = unsafe { CStr::from_ptr(p) }.to_string_lossy().to_string();
        if let Ok(free) = self.sym::<FnFree>("FreeMalloc") {
            unsafe { free(p) };
        }
        serde_json::from_str(&s).unwrap_or(Value::String(s))
    }

    // Repère le casque Razer dans la liste de la DLL puis initialise le moteur THX
    pub fn init(&self) -> Result<String, String> {
        if let Some(c) = self.container.lock().unwrap().clone() {
            return Ok(c);
        }
        let list: Symbol<FnI> = self.sym("GetAudioDeviceListBySystem")?;
        let devices = self.take_json(unsafe { list(0) });
        let c = devices["devices"]
            .as_array()
            .and_then(|a| a.iter().find(|d| d["name"].as_str().unwrap_or("").contains("Razer")))
            .and_then(|d| d["deviceContainerId"].as_str())
            .ok_or("casque Razer absent de la liste audio")?
            .to_string();
        let cs = CString::new(c.clone()).unwrap();
        let init: Symbol<FnS> = self.sym("DeviceInitialize")?;
        if !unsafe { init(cs.as_ptr()) } {
            return Err("THX inactif : le casque doit être la sortie audio par défaut".into());
        }
        *self.container.lock().unwrap() = Some(c.clone());
        Ok(c)
    }

    pub fn reset(&self) {
        if let Some(c) = self.container.lock().unwrap().take() {
            let cs = CString::new(c).unwrap();
            if let Ok(f) = self.sym::<FnS>("DeviceTerminate") {
                unsafe { f(cs.as_ptr()) };
            }
        }
    }

    fn b(&self, name: &str, c: &CString) -> Value {
        self.sym::<FnS>(name).map(|f| json!(unsafe { f(c.as_ptr()) })).unwrap_or(Value::Null)
    }
    fn i(&self, name: &str, c: &CString) -> Value {
        self.sym::<FnGI>(name).map(|f| json!(unsafe { f(c.as_ptr()) })).unwrap_or(Value::Null)
    }
    fn f(&self, name: &str, c: &CString) -> Value {
        self.sym::<FnGF>(name).map(|f| json!(unsafe { f(c.as_ptr()) })).unwrap_or(Value::Null)
    }
    fn p(&self, name: &str, c: &CString) -> Value {
        self.sym::<FnGP>(name).map(|f| self.take_json(unsafe { f(c.as_ptr()) })).unwrap_or(Value::Null)
    }

    pub fn state(&self) -> Result<Value, String> {
        let c = CString::new(self.init()?).unwrap();
        Ok(json!({
            "spatial": self.b("GetRenderSpatialProcessing", &c),
            "preset": self.p("GetRenderPreset", &c),
            "presets": self.p("GetRenderPresetList", &c),
            "eq": self.p("GetRenderEQGains", &c),
            "bassBoost": self.b("GetRenderBassBoost", &c),
            "bassBoostLevel": self.i("GetRenderBassBoostLevel", &c),
            "normalization": self.b("GetRenderNormalization", &c),
            "normalizationLevel": self.i("GetRenderNormalizationLevel", &c),
            "vocalClarity": self.b("GetRenderVocalClarity", &c),
            "vocalClarityLevel": self.i("GetRenderVocalClarityLevel", &c),
            "micNoiseReduction": self.b("GetCaptureNoiseReduction", &c),
            "micNoiseReductionLevel": self.i("GetCaptureNoiseReductionLevel", &c),
            "micVocalClarity": self.b("GetCaptureVocalClarity", &c),
            "micVocalClarityLevel": self.i("GetCaptureVocalClarityLevel", &c),
            "micNormalization": self.b("GetCaptureNormalization", &c),
            "micNormalizationLevel": self.i("GetCaptureNormalizationLevel", &c),
            "micVoiceGate": self.b("GetCaptureVoiceGate", &c),
            "micVoiceGateLevel": self.f("GetCaptureVoiceGateLevel", &c),
            "micEq": self.b("GetCaptureEQ", &c),
            "micEqGains": self.p("GetCaptureEQGains", &c),
            "micHighpass": self.b("GetCaptureHighpass", &c),
            "micHighpassLevel": self.f("GetCaptureHighpassLevel", &c),
        }))
    }

    // Écriture d'un réglage : nom de la fonction Set* de la DLL + valeur JSON
    pub fn set(&self, func: &str, value: &Value) -> Result<bool, String> {
        const BOOL: &[&str] = &["SetRenderSpatialProcessing", "SetRenderBassBoost", "SetRenderNormalization",
            "SetRenderVocalClarity", "SetCaptureNoiseReduction", "SetCaptureVocalClarity",
            "SetCaptureNormalization", "SetCaptureVoiceGate", "SetCaptureEQ", "SetCaptureHighpass"];
        const INT: &[&str] = &["SetRenderBassBoostLevel", "SetRenderNormalizationLevel", "SetRenderVocalClarityLevel",
            "SetCaptureNoiseReductionLevel", "SetCaptureVocalClarityLevel", "SetCaptureNormalizationLevel"];
        const FLOAT: &[&str] = &["SetCaptureVoiceGateLevel", "SetCaptureHighpassLevel"];
        const STR: &[&str] = &["SetRenderPreset", "ResetRenderPreset", "SetRenderEQGains", "SetCaptureEQGains"];
        let c = CString::new(self.init()?).unwrap();
        let ok = if BOOL.contains(&func) {
            let v = value.as_bool().ok_or("booléen attendu")?;
            unsafe { self.sym::<FnSB>(func)?(c.as_ptr(), v) }
        } else if INT.contains(&func) {
            let v = value.as_i64().ok_or("entier attendu")?.clamp(0, 100) as i32;
            unsafe { self.sym::<FnSI>(func)?(c.as_ptr(), v) }
        } else if FLOAT.contains(&func) {
            // Plages de Synapse : porte de bruit −70..−20 dB, passe-haut 75..400 Hz
            let (lo, hi) = if func == "SetCaptureVoiceGateLevel" { (-70.0, -20.0) } else { (75.0, 400.0) };
            let v = value.as_f64().ok_or("nombre attendu")?.clamp(lo, hi) as f32;
            unsafe { self.sym::<FnSF>(func)?(c.as_ptr(), v) }
        } else if STR.contains(&func) {
            let s = if func.ends_with("EQGains") {
                // 10 bandes en dB, bornées à ±12 (tableau JSON brut, comme Synapse)
                let bands: Vec<i64> = value.as_array().filter(|a| a.len() == 10).ok_or("10 bandes attendues")?
                    .iter().map(|v| v.as_f64().unwrap_or(0.0).clamp(-12.0, 12.0).round() as i64).collect();
                serde_json::to_string(&bands).unwrap()
            } else {
                value.as_str().ok_or("texte attendu")?.to_string()
            };
            let v = CString::new(s).map_err(|e| e.to_string())?;
            unsafe { self.sym::<FnSS>(func)?(c.as_ptr(), v.as_ptr()) }
        } else {
            return Err(format!("{func} non autorisé"));
        };
        Ok(ok)
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn dll_thx_installee_reconnue_comme_razer() {
        // Seulement sur un PC où Razer Synapse a installé le module THX
        let Some(p) = super::find_dll() else {
            return;
        };
        let signer = crate::sign::check_signature(&p, "razer").expect("signature Razer");
        eprintln!("{} : signée par {signer}", p.display());
    }
}
