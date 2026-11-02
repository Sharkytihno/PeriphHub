// PeriphHub — un seul logiciel léger pour tous vos périphériques.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod devices;
mod hid;
mod procs;
mod scan;
mod sign;
mod slim;
mod startup;
mod thx;
mod vendors;

use serde_json::Value;
use tauri::State;
use thx::ThxWorker;

#[tauri::command]
async fn scan() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(scan::run)
        .await
        .map_err(|e| e.to_string())
}

// Allègement : plan, application, annulation, ouverture et fermeture à la demande
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn slim_plan(vendor: String) -> Result<Value, String> {
    blocking(move || slim::plan(&vendor)).await
}

#[tauri::command]
async fn slim_apply(vendor: String, ids: Vec<String>, close: bool) -> Result<Value, String> {
    blocking(move || slim::apply(&vendor, &ids, close)).await
}

#[tauri::command]
async fn slim_undo(vendor: String) -> Result<Value, String> {
    blocking(move || slim::undo(&vendor)).await
}

#[tauri::command]
async fn slim_open(vendor: String) -> Result<Value, String> {
    blocking(move || slim::open(&vendor)).await
}

#[tauri::command]
async fn slim_close(vendor: String) -> Result<Value, String> {
    blocking(move || slim::close(&vendor)).await
}

#[tauri::command]
fn slim_journal() -> Vec<slim::VendorLog> {
    slim::journal()
}

// Effets THX des casques Razer (DLL Razer signée, facultative)
#[tauri::command]
async fn thx_state(w: State<'_, ThxWorker>) -> Result<Value, String> {
    w.run(|t| {
        t.state().or_else(|_| {
            t.reset();
            t.state()
        })
    })?
}

#[tauri::command]
async fn thx_set(w: State<'_, ThxWorker>, func: String, value: Value) -> Result<bool, String> {
    w.run(move |t| t.set(&func, &value))?
}

// Catalogue des appareils pris en charge (noms commerciaux, statut)
#[tauri::command]
fn catalog() -> Value {
    serde_json::from_str(include_str!("../../data/devices.json")).unwrap_or_default()
}

// Messages de la console de l'interface recopiés dans la sortie du processus (diagnostic)
#[tauri::command]
fn ui_log(level: String, text: String) {
    eprintln!("[ui:{level}] {text}");
}

// Barre de titre assortie au thème choisi dans l'interface (None : comme Windows)
#[tauri::command]
fn ui_theme(window: tauri::WebviewWindow, theme: Option<String>) {
    let t = match theme.as_deref() {
        Some("light") => Some(tauri::Theme::Light),
        Some("dark") => Some(tauri::Theme::Dark),
        _ => None,
    };
    let _ = window.set_theme(t);
}

fn main() {
    // Instance administrateur lancée par l'allègement (fenêtre de validation Windows)
    let args: Vec<String> = std::env::args().collect();
    if args.len() == 3 && args[1] == "--elevated" {
        std::process::exit(slim::elevated_main(&args[2]));
    }
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
        .manage(hid::Hid::default())
        .manage(ThxWorker::new())
        .invoke_handler(tauri::generate_handler![
            scan,
            hid::hid_devices,
            hid::hid_open,
            hid::hid_close,
            hid::hid_send,
            hid::hid_send_feature,
            hid::hid_get_feature,
            thx_state,
            thx_set,
            ui_theme,
            catalog,
            slim_plan,
            slim_apply,
            slim_undo,
            slim_open,
            slim_close,
            slim_journal,
            ui_log
        ])
        .run(tauri::generate_context!())
        .expect("PeriphHub n'a pas pu démarrer");
}
