// Manettes Xbox (One, Series, Elite) et compatibles XInput (8BitDo, PowerA, Nacon, Thrustmaster…)
// par XInput, l'interface standard de Windows : branchement, sans fil ou non, niveau de batterie
// (quatre paliers : c'est tout ce que Windows en dit) et test des vibrations.
// Les manettes PlayStation passent par leur propre pilote HID (ui/js/drivers/playstation.js).
use serde_json::{json, Value};
use windows::Win32::UI::Input::XboxController::{
    XInputGetBatteryInformation, XInputGetCapabilities, XInputSetState, BATTERY_DEVTYPE_GAMEPAD, XINPUT_BATTERY_INFORMATION,
    XINPUT_CAPABILITIES, XINPUT_FLAG_GAMEPAD, XINPUT_VIBRATION,
};

const CAPS_WIRELESS: u16 = 0x0002;

pub fn list() -> Value {
    let mut out = Vec::new();
    for slot in 0..4u32 {
        let mut caps = XINPUT_CAPABILITIES::default();
        if unsafe { XInputGetCapabilities(slot, XINPUT_FLAG_GAMEPAD, &mut caps) } != 0 {
            continue;
        }
        let mut b = XINPUT_BATTERY_INFORMATION::default();
        let battery = (unsafe { XInputGetBatteryInformation(slot, BATTERY_DEVTYPE_GAMEPAD, &mut b) } == 0).then(|| {
            // Type : 0 déconnectée, 1 filaire (pas de batterie), 2 piles alcalines, 3 accu NiMH, 0xFF inconnu
            json!({ "type": b.BatteryType.0, "level": b.BatteryLevel.0 })
        });
        out.push(json!({
            "slot": slot,
            "subtype": caps.SubType.0,
            "wireless": caps.Flags.0 & CAPS_WIRELESS != 0,
            "battery": battery,
        }));
    }
    // Vrai pourcentage par Windows.Gaming.Input. Pas de lien fiable entre un emplacement XInput et
    // une manette WGI : rattaché seulement s'il n'y en a qu'une de chaque côté.
    let real = wgi();
    if out.len() == 1 && real.len() == 1 {
        if let (Some(o), Some(r)) = (out[0].as_object_mut(), real.into_iter().next()) {
            o.insert("real".into(), r);
        }
    }
    Value::Array(out)
}

/// Manettes Xbox (et GameSir en mode Xbox) qui donnent leur batterie à Windows.Gaming.Input :
/// capacité restante / capacité pleine (mWh), état de charge, nom affiché par Windows.
/// Méthode reprise de WirelessBattery (GPL-3.0, src/drivers/xinput.cpp).
fn wgi() -> Vec<Value> {
    use std::sync::atomic::{AtomicBool, Ordering};
    use windows::Gaming::Input::RawGameController;
    use windows::System::Power::BatteryStatus;
    static PRIMED: AtomicBool = AtomicBool::new(false);
    // La liste se remplit en arrière-plan après le premier appel
    if !PRIMED.swap(true, Ordering::Relaxed) {
        let _ = RawGameController::RawGameControllers();
        std::thread::sleep(std::time::Duration::from_millis(300));
    }
    let Ok(list) = RawGameController::RawGameControllers() else { return Vec::new() };
    let mut out = Vec::new();
    for raw in list {
        let vid = raw.HardwareVendorId().unwrap_or(0);
        if vid != 0x045E && vid != 0x3537 {
            continue;
        }
        let Ok(rep) = raw.TryGetBatteryReport() else { continue };
        let rem = rep.RemainingCapacityInMilliwattHours().and_then(|v| v.Value()).unwrap_or(0);
        let full = rep.FullChargeCapacityInMilliwattHours().and_then(|v| v.Value()).unwrap_or(0);
        let status = rep.Status().unwrap_or(BatteryStatus::NotPresent);
        if full <= 0 || status == BatteryStatus::NotPresent {
            continue;
        }
        let name = if vid == 0x3537 { "Manette GameSir".to_string() } else { raw.DisplayName().map(|s| s.to_string()).unwrap_or_default() };
        out.push(json!({
            "level": (rem.max(0) as i64 * 100 / full as i64).clamp(0, 100),
            "charging": status == BatteryStatus::Charging,
            "name": name,
        }));
    }
    out
}

/// Vibration brève (moteurs gauche et droit, 0-100 %) pour vérifier la manette
pub fn rumble(slot: u32, strength: u8) -> Result<(), String> {
    if slot > 3 || strength > 100 {
        return Err("valeur hors limites".into());
    }
    let v = (strength as u32 * 65535 / 100) as u16;
    let on = XINPUT_VIBRATION { wLeftMotorSpeed: v, wRightMotorSpeed: v };
    if unsafe { XInputSetState(slot, &on) } != 0 {
        return Err("manette introuvable".into());
    }
    std::thread::sleep(std::time::Duration::from_millis(400));
    let off = XINPUT_VIBRATION::default();
    unsafe { XInputSetState(slot, &off) };
    Ok(())
}
