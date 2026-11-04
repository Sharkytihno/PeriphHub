// Avis de Windows : branchement ou débranchement d'un appareil HID, sortie de veille.
//
// L'interface relisait la liste des appareils toutes les 2 s, et seulement fenêtre visible. Windows
// prévient lui-même (CM_Register_Notification, PowerRegisterSuspendResumeNotification) : aucune
// relecture inutile, et les réglages sont réappliqués aussitôt, y compris PeriphHub en arrière-plan.
// Événements envoyés à l'interface : « hid-changed » et « power-resume ».

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};
use windows_sys::Win32::Devices::DeviceAndDriverInstallation::{
    CM_Register_Notification, CM_NOTIFY_ACTION, CM_NOTIFY_ACTION_DEVICEINTERFACEARRIVAL,
    CM_NOTIFY_ACTION_DEVICEINTERFACEREMOVAL, CM_NOTIFY_EVENT_DATA, CM_NOTIFY_FILTER,
    CM_NOTIFY_FILTER_TYPE_DEVICEINTERFACE, CR_SUCCESS, HCMNOTIFICATION,
};
use windows_sys::Win32::Devices::HumanInterfaceDevice::GUID_DEVINTERFACE_HID;
use windows_sys::Win32::System::Power::{PowerRegisterSuspendResumeNotification, DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS};
use windows_sys::Win32::UI::WindowsAndMessaging::{DEVICE_NOTIFY_CALLBACK, PBT_APMRESUMEAUTOMATIC};

static APP: OnceLock<AppHandle> = OnceLock::new();
// Abonnements actifs (pour le diagnostic). Ils durent toute la vie du processus : jamais désinscrits.
static HID_OK: AtomicBool = AtomicBool::new(false);
static POWER_OK: AtomicBool = AtomicBool::new(false);

pub fn status() -> &'static str {
    match (HID_OK.load(Ordering::Relaxed), POWER_OK.load(Ordering::Relaxed)) {
        (true, true) => "branchements et veille",
        (true, false) => "branchements seulement",
        (false, true) => "veille seulement",
        (false, false) => "aucun (relecture périodique)",
    }
}

unsafe extern "system" fn on_hid(
    _h: HCMNOTIFICATION,
    _ctx: *const c_void,
    action: CM_NOTIFY_ACTION,
    _data: *const CM_NOTIFY_EVENT_DATA,
    _size: u32,
) -> u32 {
    // Rien de lourd ici : Windows attend le retour pour prévenir les autres programmes
    if action == CM_NOTIFY_ACTION_DEVICEINTERFACEARRIVAL || action == CM_NOTIFY_ACTION_DEVICEINTERFACEREMOVAL {
        if let Some(app) = APP.get() {
            let _ = app.emit("hid-changed", action == CM_NOTIFY_ACTION_DEVICEINTERFACEARRIVAL);
        }
    }
    0
}

unsafe extern "system" fn on_power(_ctx: *const c_void, kind: u32, _setting: *const c_void) -> u32 {
    if kind == PBT_APMRESUMEAUTOMATIC {
        if let Some(app) = APP.get() {
            let _ = app.emit("power-resume", ());
        }
    }
    0
}

/// Abonnements aux avis de Windows. Un échec n'empêche rien : l'interface relit aussi la liste.
pub fn start(app: &AppHandle) -> Vec<String> {
    let _ = APP.set(app.clone());
    let mut errors = Vec::new();
    unsafe {
        let mut filter: CM_NOTIFY_FILTER = std::mem::zeroed();
        filter.cbSize = std::mem::size_of::<CM_NOTIFY_FILTER>() as u32;
        filter.FilterType = CM_NOTIFY_FILTER_TYPE_DEVICEINTERFACE;
        filter.u.DeviceInterface.ClassGuid = GUID_DEVINTERFACE_HID;
        let mut h: HCMNOTIFICATION = std::ptr::null_mut();
        let r = CM_Register_Notification(&filter, std::ptr::null(), Some(on_hid), &mut h);
        if r == CR_SUCCESS {
            HID_OK.store(true, Ordering::Relaxed);
        } else {
            errors.push(format!("avis de branchement indisponibles (code {r})"));
        }

        let mut p: *mut c_void = std::ptr::null_mut();
        // Windows garde ce pointeur tant que l'abonnement existe, donc toute la vie du processus
        let params: &'static mut DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS =
            Box::leak(Box::new(DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS { Callback: Some(on_power), Context: std::ptr::null_mut() }));
        let r = PowerRegisterSuspendResumeNotification(DEVICE_NOTIFY_CALLBACK, params as *mut _ as _, &mut p);
        if r == 0 {
            POWER_OK.store(true, Ordering::Relaxed);
        } else {
            errors.push(format!("avis de sortie de veille indisponibles (code {r})"));
        }
    }
    errors
}
