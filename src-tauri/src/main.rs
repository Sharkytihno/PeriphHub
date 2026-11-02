// PeriphHub — un seul logiciel léger pour tous vos périphériques.
// v0.1 : l'analyseur (lecture seule). Il ne modifie rien sur le PC.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod devices;
mod procs;
mod scan;
mod startup;
mod vendors;

#[tauri::command]
async fn scan() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(scan::run)
        .await
        .map_err(|e| e.to_string())
}

fn main() {
    // `--scan` : affiche l'analyse en JSON dans la console (tests, rapports de bug)
    if std::env::args().any(|a| a == "--scan") {
        // l'exe de version finale n'a pas de console : on se rattache à celle qui l'a lancé
        unsafe { windows_sys::Win32::System::Console::AttachConsole(u32::MAX) };
        println!(
            "{}",
            serde_json::to_string_pretty(&scan::run()).unwrap_or_default()
        );
        return;
    }
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![scan])
        .run(tauri::generate_context!())
        .expect("PeriphHub n'a pas pu démarrer");
}
