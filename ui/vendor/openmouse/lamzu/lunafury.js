const BUTTON_ID = { left: 1, right: 2, middle: 3 };
const request = (page, command, length, args) => {
    whole(args[0], 1, 255, "Profile ID");
    return { target: 0x02, page, command, length, args };
};
export const LUNAFURY_READ = {
    angle: (profile) => request(0x01, 0x94, 2, [profile]),
    lightning: (profile) => request(0x00, 0x98, 4, [profile]),
    buttonDebounce: (profile, button) => request(0x00, 0x92, 19, [profile, 0, BUTTON_ID[button]]),
    wheelGuard: (profile) => request(0x00, 0x99, 4, [profile]),
};
function whole(value, min, max, label) {
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new Error(`${label} must be a whole number between ${min} and ${max}.`);
    }
}
export const LUNAFURY_WRITE = {
    angle(profile, degrees) {
        whole(degrees, -30, 30, "Sensor angle");
        return request(0x01, 0x14, 2, [profile, degrees & 0xff]);
    },
    lightning(profile, mode) {
        whole(mode, 0, 2, "Lightning Trigger mode");
        return request(0x00, 0x18, 4, [profile, mode]);
    },
    buttonDebounce(profile, button, milliseconds) {
        if (!Object.hasOwn(BUTTON_ID, button))
            throw new Error("Unknown LunaFury button.");
        whole(milliseconds, button === "middle" ? 1 : 0, button === "middle" ? 30 : 15, "Button latency");
        // The vendor writes the same latency into both timing fields, with the
        // remaining timing fields fixed at 0/20. Preserve the full 19-byte layout.
        return request(0x00, 0x12, 19, [
            profile, 0, BUTTON_ID[button], 0, milliseconds, 0, 0,
            0, milliseconds, 0, 0, 0, 20, 0, 0, 0, 20, 0, 0,
        ]);
    },
    wheelGuard(profile, guard) {
        if (typeof guard.enabled !== "boolean")
            throw new Error("Wheel guard needs an on/off value.");
        // Firmware can report a disabled zero window. It must be writable too
        // so applying and restoring a game profile preserves the original value.
        if (!guard.enabled && guard.windowMs === 0)
            return request(0x00, 0x19, 4, [profile, 0, 0, 0]);
        whole(guard.windowMs, 20, 200, "Wheel guard window");
        if (guard.windowMs % 20 !== 0)
            throw new Error("Wheel guard window must use 20 ms steps.");
        return request(0x00, 0x19, 4, [profile, guard.enabled ? 1 : 0, 0, guard.windowMs]);
    },
};
export function lunafuryDecodeAngle(payload) {
    if (!payload || payload.length < 2)
        return null;
    const angle = payload[1] > 127 ? payload[1] - 256 : payload[1];
    return angle >= -30 && angle <= 30 ? angle : null;
}
export function lunafuryDecodeLightning(payload) {
    return payload && payload.length >= 2 && payload[1] <= 2
        ? payload[1] : undefined;
}
export function lunafuryDecodeButtonDebounce(payload, button) {
    if (!payload || payload.length < 5 || payload[2] !== BUTTON_ID[button])
        return undefined;
    const value = (payload[3] << 8) | payload[4];
    return value >= (button === "middle" ? 1 : 0) && value <= (button === "middle" ? 30 : 15)
        ? value : undefined;
}
export function lunafuryDecodeWheelGuard(payload) {
    if (!payload || payload.length < 4 || payload[1] > 1)
        return undefined;
    const windowMs = (payload[2] << 8) | payload[3];
    const enabled = payload[1] === 1;
    if (!(windowMs >= 20 && windowMs <= 200 && windowMs % 20 === 0) && !(!enabled && windowMs === 0))
        return undefined;
    return { enabled, windowMs };
}
