// Réglages Windows de la souris et du clavier (ceux du Panneau de configuration) : valables pour
// toutes les marques, y compris les appareils sans pilote PeriphHub, et gardés par Windows lui-même
// (rien ne tourne en fond pour eux). Lus et écrits par SystemParametersInfo.
use serde_json::{json, Value};
use std::time::Duration;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SystemParametersInfoW, SM_SWAPBUTTON, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE, SPI_GETKEYBOARDDELAY,
    SPI_GETKEYBOARDSPEED, SPI_GETMOUSE, SPI_GETMOUSESPEED, SPI_GETWHEELSCROLLCHARS, SPI_GETWHEELSCROLLLINES,
    SPI_SETDOUBLECLICKTIME, SPI_SETKEYBOARDDELAY, SPI_SETKEYBOARDSPEED, SPI_SETMOUSE, SPI_SETMOUSEBUTTONSWAP,
    SPI_SETMOUSESPEED, SPI_SETWHEELSCROLLCHARS, SPI_SETWHEELSCROLLLINES,
};

/// Molette : « un écran à la fois » au lieu d'un nombre de lignes
const WHEEL_PAGE: u32 = u32::MAX;

fn get_u32(action: u32) -> Option<u32> {
    let mut v: u32 = 0;
    (unsafe { SystemParametersInfoW(action, 0, (&mut v as *mut u32).cast(), 0) } != 0).then_some(v)
}

/// Délai du double-clic (ms), tel que Windows l'a enregistré
fn double_click_ms() -> Option<u32> {
    let k = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .open_subkey(r"Control Panel\Mouse")
        .ok()?;
    k.get_value::<String, _>("DoubleClickSpeed").ok()?.trim().parse().ok()
}

pub fn get() -> Value {
    let mut accel = [0i32; 3];
    let precision = unsafe { SystemParametersInfoW(SPI_GETMOUSE, 0, accel.as_mut_ptr().cast(), 0) } != 0 && accel[2] != 0;
    json!({
        "speed": get_u32(SPI_GETMOUSESPEED),
        "precision": precision,
        "lines": get_u32(SPI_GETWHEELSCROLLLINES),
        "chars": get_u32(SPI_GETWHEELSCROLLCHARS),
        "swap": unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0,
        "dblclick": double_click_ms(),
        "kbdelay": get_u32(SPI_GETKEYBOARDDELAY),
        "kbspeed": get_u32(SPI_GETKEYBOARDSPEED),
    })
}

/// Modifie un réglage, enregistré dans le profil de l'utilisateur et annoncé aux applications
/// ouvertes (comme le fait le Panneau de configuration). Valeurs bornées comme dans Windows.
pub fn set(what: &str, value: &Value) -> Result<(), String> {
    let n = || value.as_u64().map(|v| v.min(u32::MAX as u64) as u32).ok_or("valeur invalide");
    let on = || value.as_bool().ok_or("valeur invalide");
    let (action, param, accel): (u32, u32, Option<[i32; 3]>) = match what {
        "speed" => (SPI_SETMOUSESPEED, n()?.clamp(1, 20), None),
        // « Améliorer la précision du pointeur » = accélération de Windows (seuils 6 et 10)
        "precision" => (SPI_SETMOUSE, 0, Some(if on()? { [6, 10, 1] } else { [0, 0, 0] })),
        "lines" => (SPI_SETWHEELSCROLLLINES, match n()? { WHEEL_PAGE => WHEEL_PAGE, v => v.clamp(1, 100) }, None),
        "chars" => (SPI_SETWHEELSCROLLCHARS, n()?.clamp(1, 100), None),
        "swap" => (SPI_SETMOUSEBUTTONSWAP, on()? as u32, None),
        "dblclick" => (SPI_SETDOUBLECLICKTIME, n()?.clamp(200, 900), None),
        "kbdelay" => (SPI_SETKEYBOARDDELAY, n()?.min(3), None),
        "kbspeed" => (SPI_SETKEYBOARDSPEED, n()?.min(31), None),
        _ => return Err(format!("réglage inconnu : {what}")),
    };
    let speed = what == "speed";
    // L'annonce aux fenêtres ouvertes peut attendre une application figée : délai
    let ok = crate::watchdog::timed(Duration::from_secs(5), move || {
        let mut accel = accel;
        let (param, p): (u32, *mut core::ffi::c_void) = match accel.as_mut() {
            Some(a) => (0, a.as_mut_ptr().cast()),
            // La vitesse du pointeur se passe dans le pointeur lui-même (particularité de cette commande)
            None if speed => (0, param as usize as *mut core::ffi::c_void),
            None => (param, std::ptr::null_mut()),
        };
        unsafe { SystemParametersInfoW(action, param, p, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE) != 0 }
    });
    match ok {
        Some(true) => Ok(()),
        Some(false) => Err(format!("Windows a refusé le réglage {what}")),
        // Le réglage est déjà en place : seule l'annonce aux autres fenêtres traîne
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn lecture_des_reglages_windows() {
        let v = super::get();
        let speed = v["speed"].as_u64().expect("vitesse du pointeur");
        assert!((1..=20).contains(&speed));
        assert!(v["kbdelay"].as_u64().unwrap() <= 3);
        assert!(v["kbspeed"].as_u64().unwrap() <= 31);
        assert!(v["precision"].is_boolean() && v["swap"].is_boolean());
    }

    #[test]
    fn reglage_inconnu_ou_valeur_invalide_refuses() {
        assert!(super::set("inconnu", &serde_json::json!(1)).is_err());
        assert!(super::set("speed", &serde_json::json!("vite")).is_err());
        assert!(super::set("swap", &serde_json::json!(3)).is_err());
    }
}
