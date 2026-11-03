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
    Value::Array(out)
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
