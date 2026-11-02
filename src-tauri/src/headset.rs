// Casques SteelSeries, Corsair, HyperX, Logitech, Audeze, Sony… via HeadsetControl
// (https://github.com/Sapd/HeadsetControl, GPL-3.0), livré à côté de PeriphHub.
//
// Sécurité : l'exécutable n'est lancé que si son empreinte SHA-256 est exactement celle de la
// version publiée attendue, et seules les options listées ci-dessous (bornes comprises) peuvent
// lui être passées. Pas de mode développeur (--dev), pas d'envoi de données brutes.
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

const NO_WINDOW: u32 = 0x0800_0000;
// Version 4.2.0 (à changer avec scripts/fetch-headsetcontrol.ps1)
const SHA256: &str = "81acae4c083aaa40a2e9c1bce7b3dd9625e74b9d9ee96384bb43b2dff7ff0fa5";
const EXE: &str = "headsetcontrol.exe";

fn locate(app: &AppHandle) -> Option<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(r) = app.path().resource_dir() {
        dirs.push(r.join("resources"));
        dirs.push(r);
    }
    if let Some(d) = std::env::current_exe().ok().and_then(|p| p.parent().map(PathBuf::from)) {
        dirs.push(d.join("resources"));
        dirs.push(d.clone());
        // compilation de développement : src-tauri/target/release → src-tauri/resources
        dirs.push(d.join("..").join("..").join("resources"));
    }
    dirs.into_iter().map(|d| d.join(EXE)).find(|p| p.is_file())
}

/// Chemin de l'exécutable vérifié (calculé une fois)
fn exe(app: &AppHandle) -> Result<PathBuf, String> {
    static CHECKED: OnceLock<Result<PathBuf, String>> = OnceLock::new();
    CHECKED
        .get_or_init(|| {
            let p = locate(app).ok_or("module casques (HeadsetControl) absent")?;
            let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
            let hash: String = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
            if hash != SHA256 {
                return Err("module casques (HeadsetControl) modifié : empreinte inattendue, il ne sera pas lancé".into());
            }
            Ok(p)
        })
        .clone()
}

fn run(app: &AppHandle, args: &[String]) -> Result<Value, String> {
    let mut cmd = Command::new(exe(app)?);
    cmd.args(args).creation_flags(NO_WINDOW);
    // HeadsetControl interroge l'USB lui aussi : un casque qui ne répond pas ne doit pas le figer
    let stdout = crate::watchdog::output(cmd, std::time::Duration::from_secs(15))
        .ok_or("HeadsetControl ne répond pas (casque ou périphérique USB bloqué)")?;
    // Le JSON est écrit même quand une demande échoue (code de sortie non nul)
    let text = String::from_utf8_lossy(&stdout);
    let start = text.find('{').ok_or("réponse vide de HeadsetControl")?;
    serde_json::from_str(&text[start..]).map_err(|e| e.to_string())
}

/// Casques branchés, avec batterie et chatmix
pub fn list(app: &AppHandle) -> Result<Value, String> {
    run(app, &["-b".into(), "-m".into(), "-o".into(), "json".into()])
}

/// Réglages autorisés : nom → (option, minimum, maximum)
const SETTINGS: &[(&str, &str, i64, i64)] = &[
    ("sidetone", "-s", 0, 128),
    ("lights", "-l", 0, 1),
    ("inactive_time", "-i", 0, 90),
    ("voice_prompts", "-v", 0, 1),
    ("rotate_to_mute", "-r", 0, 1),
    ("equalizer_preset", "-p", 0, 15),
    ("microphone_volume", "--microphone-volume", 0, 128),
    ("volume_limiter", "--volume-limiter", 0, 1),
    ("noise_filter", "--noise-filter", 0, 2),
    ("anc", "--anc", 0, 2),
];

pub fn set(app: &AppHandle, vid: u16, pid: u16, setting: &str, value: &Value) -> Result<Value, String> {
    let mut args = vec!["-d".to_string(), format!("{vid:04x}:{pid:04x}")];
    if setting == "equalizer" {
        // Courbe : 1 à 32 bandes, valeurs bornées
        let bands: Vec<f64> = value
            .as_array()
            .ok_or("courbe attendue")?
            .iter()
            .map(|v| v.as_f64().ok_or("valeur non numérique"))
            .collect::<Result<_, _>>()?;
        if bands.is_empty() || bands.len() > 32 || bands.iter().any(|b| !(-30.0..=30.0).contains(b)) {
            return Err("courbe d'égaliseur invalide".into());
        }
        args.push("-e".into());
        args.push(bands.iter().map(|b| b.to_string()).collect::<Vec<_>>().join(","));
    } else {
        let (_, flag, min, max) = SETTINGS.iter().find(|s| s.0 == setting).ok_or("réglage inconnu")?;
        let v = value.as_i64().or_else(|| value.as_bool().map(i64::from)).ok_or("valeur attendue")?;
        if v < *min || v > *max {
            return Err("valeur hors limites".into());
        }
        args.push(flag.to_string());
        args.push(v.to_string());
    }
    args.extend(["-o".into(), "json".into()]);
    let out = run(app, &args)?;
    // Résultat de l'action : "actions": [{ "status": "success" | "failure" | …, "error_message" }]
    if let Some(a) = out["actions"].as_array().and_then(|a| a.first()) {
        if a["status"].as_str().is_some_and(|s| !s.eq_ignore_ascii_case("success")) {
            return Err(a["error_message"].as_str().unwrap_or("le casque a refusé le réglage").to_string());
        }
    }
    Ok(out)
}
