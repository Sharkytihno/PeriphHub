use sha2::{Digest, Sha256};
use std::fmt::Write;

fn main() {
    sensor_files();
    tauri_build::build()
}

// Module capteurs (scripts/fetch-sensors.ps1) : empreinte de chaque fichier relevée à la compilation.
// Le programme du service est compilé sur place (son empreinte change à chaque compilation) : c'est
// cette liste, intégrée à periphhub.exe, que l'installation du service exige (src/sensors.rs).
// Dossier absent : liste vide, la page Températures indique que le module manque.
fn sensor_files() {
    println!("cargo:rerun-if-changed=resources/sensors");
    let mut files: Vec<(String, String)> = std::fs::read_dir("resources/sensors")
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let ext = name.rsplit('.').next()?.to_ascii_lowercase();
            if ext != "dll" && ext != "exe" {
                return None;
            }
            println!("cargo:rerun-if-changed=resources/sensors/{name}");
            let hash = Sha256::digest(std::fs::read(e.path()).ok()?);
            Some((name, hash.iter().fold(String::new(), |mut s, b| {
                let _ = write!(s, "{b:02x}");
                s
            })))
        })
        .collect();
    files.sort();
    let body: String = files.iter().map(|(n, h)| format!("    ({n:?}, {h:?}),\n")).collect();
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("sensor_files.rs");
    std::fs::write(out, format!("pub(crate) const SENSOR_FILES: &[(&str, &str)] = &[\n{body}];\n")).unwrap();
}
