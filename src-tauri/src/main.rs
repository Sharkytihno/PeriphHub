// PeriphHub — un seul logiciel léger pour tous vos périphériques.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod background;
mod camera;
mod devices;
mod feedback;
mod headset;
mod hid;
mod input;
mod notify;
mod openrgb;
mod openrgb_service;
mod pads;
mod pnp;
mod procs;
mod scan;
mod sign;
mod slim;
mod startup;
mod system;
mod thx;
mod toast;
mod update;
mod vendors;
mod watchdog;

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

// Casques via HeadsetControl (module vérifié par empreinte, options en liste blanche)
#[tauri::command]
async fn headset_list(app: tauri::AppHandle) -> Result<Value, String> {
    blocking(move || headset::list(&app)).await
}

#[tauri::command]
async fn headset_set(app: tauri::AppHandle, vid: u16, pid: u16, setting: String, value: Value) -> Result<Value, String> {
    blocking(move || headset::set(&app, vid, pid, &setting, &value)).await
}

// Son (micros, cartes son, DAC, sorties) par les API audio de Windows
#[tauri::command]
async fn audio_list() -> Result<Value, String> {
    blocking(audio::list).await
}

#[tauri::command]
async fn audio_set(id: String, what: String, value: Value) -> Result<(), String> {
    blocking(move || audio::set(&id, &what, &value)).await
}

#[tauri::command]
async fn audio_formats(id: String) -> Result<Value, String> {
    blocking(move || audio::formats(&id)).await
}

// Webcams : réglages vidéo standard (UVC) annoncés par chaque caméra
#[tauri::command]
async fn camera_list() -> Result<Value, String> {
    blocking(camera::list).await
}

#[tauri::command]
async fn camera_set(path: String, control: String, value: i32, auto: bool) -> Result<(), String> {
    blocking(move || camera::set(&path, &control, value, auto)).await
}

// Manettes Xbox et compatibles XInput
#[tauri::command]
async fn pads_list() -> Result<Value, String> {
    blocking(|| Ok(pads::list())).await
}

#[tauri::command]
async fn pads_rumble(slot: u32, strength: u8) -> Result<(), String> {
    blocking(move || pads::rumble(slot, strength)).await
}

// Éclairage via OpenRGB (serveur SDK local, s'il est lancé)
#[tauri::command]
async fn openrgb_list() -> Result<Value, String> {
    blocking(openrgb::list).await
}

#[tauri::command]
async fn openrgb_info(app: tauri::AppHandle) -> Result<Value, String> {
    blocking(move || openrgb::info(&app)).await
}

#[tauri::command]
async fn openrgb_launch(app: tauri::AppHandle) -> Result<Value, String> {
    blocking(move || openrgb::launch(&app)).await
}

/// Active (« install ») ou retire (« uninstall ») l'éclairage de la mémoire et de la carte mère :
/// une validation Windows. false : l'utilisateur l'a refusée.
#[tauri::command]
async fn openrgb_admin(action: String) -> Result<bool, String> {
    blocking(move || {
        // L'OpenRGB lancé par PeriphHub occupe le port du serveur : arrêté, le service prend le relais
        openrgb::stop();
        let code = match openrgb_service::elevate(&action)? {
            None => return Ok(false),
            Some(c) => c,
        };
        match code {
            0 => Ok(true),
            1 => Err("OpenRGB livré avec PeriphHub est incomplet ou modifié : réinstallez PeriphHub".into()),
            2 => Err("copie d’OpenRGB dans Program Files impossible".into()),
            3 => Err("installation du pilote PawnIO impossible (antivirus ?)".into()),
            4 => Err("création du service OpenRGB impossible".into()),
            c => Err(format!("échec (code {c})")),
        }
    })
    .await
}

#[tauri::command]
async fn openrgb_color(index: u32, rgb: [u8; 3]) -> Result<(), String> {
    blocking(move || openrgb::set_color(index, rgb)).await
}

#[tauri::command]
async fn openrgb_mode(
    index: u32,
    mode: u32,
    speed: Option<u32>,
    direction: Option<u32>,
    colors: Option<Vec<[u8; 3]>>,
    save: bool,
) -> Result<(), String> {
    blocking(move || openrgb::set_mode(index, mode, speed, direction, colors, save)).await
}

// Réglages Windows de la souris et du clavier (toutes marques), batterie des appareils Bluetooth
#[tauri::command]
async fn input_get() -> Result<Value, String> {
    blocking(|| Ok(input::get())).await
}

#[tauri::command]
async fn input_set(what: String, value: Value) -> Result<(), String> {
    blocking(move || input::set(&what, &value)).await
}

// Notification Windows (batterie faible) : textes courts, jamais plus de 5 s
#[tauri::command]
async fn notify_show(title: String, body: String) -> Result<(), String> {
    let title: String = title.chars().take(64).collect();
    let body: String = body.chars().take(200).collect();
    blocking(move || {
        watchdog::timed(std::time::Duration::from_secs(5), move || toast::show(&title, &body))
            .unwrap_or_else(|| Err("Windows ne répond pas".into()))
    })
    .await
}

#[tauri::command]
async fn notify_state() -> Result<String, String> {
    blocking(|| {
        Ok(watchdog::timed(std::time::Duration::from_secs(5), || toast::state().to_string())
            .unwrap_or_else(|| "unknown".into()))
    })
    .await
}

#[tauri::command]
async fn bt_batteries() -> Result<Value, String> {
    blocking(|| {
        let list = pnp::bluetooth_batteries();
        Ok(serde_json::json!(list
            .iter()
            .map(|b| serde_json::json!({ "name": b.name, "address": b.address, "level": b.level }))
            .collect::<Vec<_>>()))
    })
    .await
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

// Ouvre le formulaire de ticket GitHub prérempli (adresse fixe, voir feedback.rs)
#[tauri::command]
fn report_device(model: String, version: String, report: String) -> Result<(), String> {
    feedback::open_issue(&model, &version, &report)
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
    // Instance administrateur : service OpenRGB pour la mémoire et la carte mère (openrgb_service.rs)
    if args.len() == 3 && args[1] == "--openrgb-service" {
        std::process::exit(openrgb_service::elevated_main(&args[2]));
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
    // Erreurs internes notées dans %LOCALAPPDATA%\PeriphHub\erreurs.log (jointes au diagnostic)
    system::install_crash_log();
    std::thread::spawn(update::cleanup_old);
    let hidden = background::launched_hidden();
    tauri::Builder::default()
        // En premier : une 2e instance (raccourci, clé Run) ne fait que ramener la fenêtre existante
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| background::show(app)))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(hid::Hid::default())
        .manage(ThxWorker::new())
        .setup(move |app| {
            let h = app.handle();
            if let Err(e) = background::tray(h) {
                eprintln!("[PeriphHub] zone de notification indisponible : {e}");
            }
            for e in notify::start(h) {
                eprintln!("[PeriphHub] {e}");
            }
            background::refresh_run_path();
            // La fenêtre est créée cachée (tauri.conf.json) : affichée sauf au démarrage de Windows
            if let Some(w) = background::main_window(h) {
                background::set_shown(&w, !hidden);
            }
            Ok(())
        })
        .on_window_event(|w, e| {
            // Fermer = cacher (si l'icône de notification existe pour la rouvrir) : les réglages restent appliqués
            if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                if background::on_close(w) {
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            scan,
            hid::hid_devices,
            hid::hid_probe,
            hid::hid_open,
            hid::hid_close,
            hid::hid_send,
            hid::hid_send_feature,
            hid::hid_get_feature,
            headset_list,
            headset_set,
            openrgb_list,
            openrgb_info,
            openrgb_launch,
            openrgb_admin,
            audio_list,
            audio_set,
            audio_formats,
            camera_list,
            camera_set,
            pads_list,
            pads_rumble,
            openrgb_color,
            openrgb_mode,
            input_get,
            input_set,
            bt_batteries,
            notify_show,
            notify_state,
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
            ui_log,
            report_device,
            system::sys_info,
            background::bg_set,
            background::bg_hide,
            background::bg_quit,
            background::bg_state,
            background::autostart_set,
            update::update_check,
            update::update_install
        ])
        .build(tauri::generate_context!())
        .expect("PeriphHub n'a pas pu démarrer")
        .run(|_, e| {
            // OpenRGB lancé par PeriphHub : arrêté avec lui (le job Windows le ferait aussi, plus tard)
            if let tauri::RunEvent::Exit = e {
                openrgb::stop();
            }
        });
}
