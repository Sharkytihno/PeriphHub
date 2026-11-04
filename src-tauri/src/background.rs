// Vie en arrière-plan : PeriphHub garde les réglages des appareils sans logiciel constructeur.
//
// - Une seule instance : relancer PeriphHub ramène la fenêtre déjà ouverte.
// - Fermer la fenêtre la cache (option, activée par défaut) : l'icône de la zone de notification
//   la rouvre ou quitte PeriphHub.
// - Démarrage avec Windows (option, désactivée par défaut) : PeriphHub démarre caché et réapplique
//   les réglages que certains appareils oublient (casques sans mémoire, appareils qui se rebranchent).
//   Installeur : valeur « PeriphHub » de la clé Run de l'utilisateur, avec « --background ».
//   Microsoft Store : tâche de démarrage du paquet (StartupTask), seule méthode qui y fonctionne.
// Fenêtre cachée, la WebView passe en invisible et réduit sa mémoire (WebView2).

use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, Wry};
use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};
use winreg::RegKey;

/// Fermer la fenêtre la cache au lieu de quitter (réglé par l'interface)
pub static KEEP: AtomicBool = AtomicBool::new(true);
/// Prochaine fermeture : l'interface demande d'abord « garder en arrière-plan ou quitter ? »
/// (tant que l'utilisateur n'a pas choisi ; réglé par l'interface)
static ASK: AtomicBool = AtomicBool::new(false);

const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_NAME: &str = "PeriphHub";
const STARTUP_TASK: &str = "PeriphHubStartup";
pub const BACKGROUND_ARG: &str = "--background";

pub struct TrayItems {
    open: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

/// Lancé au démarrage de Windows (clé Run ou tâche de démarrage du Store) : fenêtre cachée
pub fn launched_hidden() -> bool {
    std::env::args().any(|a| a == BACKGROUND_ARG) || (crate::update::from_store() && startup_task_launch())
}

fn startup_task_launch() -> bool {
    use windows::ApplicationModel::Activation::ActivationKind;
    use windows::ApplicationModel::AppInstance;
    AppInstance::GetActivatedEventArgs().and_then(|a| a.Kind()).is_ok_and(|k| k == ActivationKind::StartupTask)
}

pub fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

/// Affiche ou cache la fenêtre ; cachée, la WebView le sait (document.hidden) et libère de la mémoire
pub fn set_shown(w: &WebviewWindow, shown: bool) {
    if shown {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    } else {
        let _ = w.hide();
    }
    let _ = w.with_webview(move |pv| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows::core::Interface;
        let c = pv.controller();
        let _ = c.SetIsVisible(shown);
        // WebView2 récent seulement (runtime 114+) : sans, la mémoire reste simplement la même
        if let Ok(w19) = c.CoreWebView2().and_then(|core| core.cast::<ICoreWebView2_19>()) {
            let level = if shown { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW };
            let _ = w19.SetMemoryUsageTargetLevel(level);
        }
    });
}

pub fn show(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        set_shown(&w, true);
    }
}

/// Icône de la zone de notification : clic = ouvrir, menu = Ouvrir / Quitter
pub fn tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Ouvrir PeriphHub", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut b = TrayIconBuilder::with_id("main")
        .tooltip("PeriphHub")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => show(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|t, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show(t.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        b = b.icon(icon.clone());
    }
    b.build(app)?;
    app.manage(TrayItems { open, quit });
    Ok(())
}

/// Croix de la fenêtre principale. Vrai : la fenêtre reste (cachée, ou question posée par l'interface).
pub fn on_close(w: &tauri::Window) -> bool {
    let app = w.app_handle();
    if w.label() != "main" || !KEEP.load(Ordering::Relaxed) || app.tray_by_id("main").is_none() {
        return false;
    }
    // Question posée une seule fois par lancement : un second clic sur la croix cache la fenêtre,
    // même si l'interface ne répond plus
    if ASK.swap(false, Ordering::Relaxed) && app.emit("close-ask", ()).is_ok() {
        return true;
    }
    if let Some(m) = main_window(app) {
        set_shown(&m, false);
    }
    true
}

/// Réponse « Garder en arrière-plan » à la question de fermeture
#[tauri::command]
pub fn bg_hide(app: AppHandle) {
    if let Some(w) = main_window(&app) {
        set_shown(&w, false);
    }
}

/// Réponse « Quitter complètement »
#[tauri::command]
pub fn bg_quit(app: AppHandle) {
    app.exit(0);
}

/// Réglages venus de l'interface : garder en arrière-plan à la fermeture, question à poser,
/// textes du menu (langue), infobulle de l'icône (mise à jour disponible…)
#[tauri::command]
pub fn bg_set(app: AppHandle, keep: bool, ask: bool, open: String, quit: String, tooltip: String) {
    KEEP.store(keep, Ordering::Relaxed);
    ASK.store(ask, Ordering::Relaxed);
    if let Some(t) = app.try_state::<TrayItems>() {
        let _ = t.open.set_text(open.chars().take(60).collect::<String>());
        let _ = t.quit.set_text(quit.chars().take(60).collect::<String>());
    }
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(tooltip.chars().take(120).collect::<String>()));
    }
}

#[tauri::command]
pub async fn bg_state() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        json!({
            "hidden_start": launched_hidden(),
            "autostart": autostart_get(),
            "store": crate::update::from_store(),
        })
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn autostart_set(on: bool) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if crate::update::from_store() {
            store_task_set(on)?;
        } else {
            run_set(on)?;
        }
        Ok(autostart_get())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// "on" | "off" | "bloqué" (désactivé par l'utilisateur dans le Gestionnaire des tâches ou une stratégie)
fn autostart_get() -> Value {
    if crate::update::from_store() {
        return json!(store_task_state().unwrap_or("off"));
    }
    let present = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(RUN, KEY_READ)
        .and_then(|k| k.get_value::<String, _>(RUN_NAME))
        .is_ok();
    json!(if !present {
        "off"
    } else if crate::startup::approved_disabled("run", "HKCU", RUN_NAME) {
        "bloqué"
    } else {
        "on"
    })
}

fn run_command() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(format!("\"{}\" {BACKGROUND_ARG}", exe.display()))
}

fn run_set(on: bool) -> Result<(), String> {
    let (k, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey_with_flags(RUN, KEY_SET_VALUE).map_err(|e| e.to_string())?;
    if on {
        k.set_value(RUN_NAME, &run_command()?).map_err(|e| e.to_string())?;
        // Réactivé ici : l'interrupteur du Gestionnaire des tâches suit
        if crate::startup::approved_disabled("run", "HKCU", RUN_NAME) {
            crate::startup::set_approved("run", "HKCU", RUN_NAME, true)?;
        }
        Ok(())
    } else {
        match k.delete_value(RUN_NAME) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        }
    }
}

/// Au lancement : si PeriphHub a changé de dossier, la clé Run suit (sinon elle lancerait l'ancien)
pub fn refresh_run_path() {
    if crate::update::from_store() {
        return;
    }
    let Ok(k) = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(RUN, KEY_READ | KEY_SET_VALUE) else { return };
    let (Ok(cur), Ok(want)) = (k.get_value::<String, _>(RUN_NAME), run_command()) else { return };
    if !cur.eq_ignore_ascii_case(&want) {
        let _ = k.set_value(RUN_NAME, &want);
    }
}

fn store_task() -> Result<windows::ApplicationModel::StartupTask, String> {
    use windows::ApplicationModel::StartupTask;
    StartupTask::GetAsync(&windows::core::HSTRING::from(STARTUP_TASK))
        .and_then(|op| op.join())
        .map_err(|e| format!("tâche de démarrage introuvable : {e}"))
}

fn store_task_state() -> Option<&'static str> {
    use windows::ApplicationModel::StartupTaskState as S;
    let s = store_task().ok()?.State().ok()?;
    Some(if s == S::Enabled || s == S::EnabledByPolicy {
        "on"
    } else if s == S::DisabledByUser || s == S::DisabledByPolicy {
        "bloqué"
    } else {
        "off"
    })
}

fn store_task_set(on: bool) -> Result<(), String> {
    let t = store_task()?;
    if on {
        // Ne peut pas forcer une tâche coupée par l'utilisateur (Paramètres > Applications > Démarrage)
        t.RequestEnableAsync().and_then(|op| op.join()).map(|_| ()).map_err(|e| e.to_string())
    } else {
        t.Disable().map_err(|e| e.to_string())
    }
}
