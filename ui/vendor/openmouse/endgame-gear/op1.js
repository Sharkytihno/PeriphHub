export const EGG_VENDOR_ID = 0x3367;
/** The 2.4 GHz dongle shared by every OP1w/XM2w 4K, v1 and v2. */
export const EGG_4K_DONGLE_PID = 0x1970;
const LOD_V1 = ["0.7 mm", "1 mm", "2 mm"];
const LOD_V2 = [
    "0.7 mm", "0.8 mm", "0.9 mm", "1.0 mm", "1.1 mm", "1.2 mm",
    "1.3 mm", "1.4 mm", "1.5 mm", "1.6 mm", "1.7 mm",
];
const LOD_GLASS = ["1.0 mm", "2.0 mm"];
/** The 4K v1 tool offers only these, stored as wire values 1 and 2 (re/PROTOCOL.md section 12). */
const LOD_4K_V1 = ["1 mm", "2 mm"];
/** OP1w 4K / XM2w 4K, the first generation: PAW3395 limits, no glass mode, no v2 sensor controls. */
const WIRELESS_4K_V1 = {
    configFamily: "v1",
    sensorFamily: "paw3395",
    cpiMin: 50,
    cpiMax: 26_000,
    cpiStepLow: 50,
    cpiStepHigh: 50,
    lodNormal: LOD_4K_V1,
    lodGlass: null,
    motionSyncAt8k: true,
    maxPollingHz: 4000,
    wireless4k: true,
};
const WIRELESS_4K_V2 = {
    configFamily: "v2",
    sensorFamily: "paw3950",
    cpiMin: 10,
    cpiMax: 30_000,
    cpiStepLow: 10,
    cpiStepHigh: 50,
    lodNormal: LOD_V2,
    lodGlass: LOD_GLASS,
    motionSyncAt8k: true,
    maxPollingHz: 4000,
    wireless4k: true,
};
export const EGG_DEVICE_PROFILES = new Map([
    [0x1964, {
            pid: 0x1964,
            name: "Endgame Gear OP1 8K",
            configFamily: "v1",
            sensorFamily: "paw3395",
            cpiMin: 50,
            cpiMax: 26_000,
            cpiStepLow: 50,
            cpiStepHigh: 50,
            lodNormal: LOD_V1,
            lodGlass: null,
            motionSyncAt8k: false,
            maxPollingHz: 8000,
        }],
    [0x1966, {
            pid: 0x1966,
            name: "Endgame Gear XM2 8K",
            configFamily: "v1",
            sensorFamily: "paw3395",
            cpiMin: 50,
            cpiMax: 26_000,
            cpiStepLow: 50,
            cpiStepHigh: 50,
            lodNormal: LOD_V1,
            lodGlass: null,
            motionSyncAt8k: false,
            maxPollingHz: 8000,
        }],
    [0x1976, {
            pid: 0x1976,
            name: "Endgame Gear OP1 8K Purple Frost",
            configFamily: "v1",
            sensorFamily: "paw3950",
            cpiMin: 50,
            cpiMax: 30_000,
            cpiStepLow: 50,
            cpiStepHigh: 50,
            lodNormal: LOD_V1,
            lodGlass: LOD_GLASS,
            motionSyncAt8k: true,
            maxPollingHz: 8000,
        }],
    [0x1978, {
            pid: 0x1978,
            name: "Endgame Gear OP1 8K v2",
            configFamily: "v2",
            sensorFamily: "paw3950",
            cpiMin: 10,
            cpiMax: 30_000,
            cpiStepLow: 10,
            cpiStepHigh: 50,
            lodNormal: LOD_V2,
            lodGlass: LOD_GLASS,
            motionSyncAt8k: true,
            maxPollingHz: 8000,
        }],
    [0x1980, {
            pid: 0x1980,
            name: "Endgame Gear XM2 8K v2",
            configFamily: "v2",
            sensorFamily: "paw3950",
            cpiMin: 10,
            cpiMax: 30_000,
            cpiStepLow: 10,
            cpiStepHigh: 50,
            lodNormal: LOD_V2,
            lodGlass: LOD_GLASS,
            motionSyncAt8k: true,
            maxPollingHz: 8000,
        }],
    // OP1w/XM2w 4K, v1 and v2: the wireless models on the OP1-8K config protocol.
    // Cabled, each mouse has its own PID (OP1w 4K 0x1972, XM2w 4K 0x1968, OP1w
    // 4K v2 0x1984, XM2w 4K v2 0x1982; both XM2w from the vendor binaries only,
    // re/PROTOCOL.md section 10). The 2.4 GHz dongle is 0x1970 for all four,
    // reused from the older, unrelated OP1we (see egg-we-hid.ts, which uses the
    // descriptor to keep the two drivers apart, issue #107), and its USB name is
    // fixed whatever mouse is paired. Its profile stays neutral until the
    // mouse-info command (EGG_OPERATION.mouseInfo) reports which one.
    [0x1972, { pid: 0x1972, name: "Endgame Gear OP1w 4K", ...WIRELESS_4K_V1 }],
    [0x1968, { pid: 0x1968, name: "Endgame Gear XM2w 4K", ...WIRELESS_4K_V1 }],
    [0x1984, { pid: 0x1984, name: "Endgame Gear OP1w 4K v2", ...WIRELESS_4K_V2 }],
    [0x1982, { pid: 0x1982, name: "Endgame Gear XM2w 4K v2", ...WIRELESS_4K_V2 }],
    [EGG_4K_DONGLE_PID, { pid: EGG_4K_DONGLE_PID, name: "Endgame Gear OP1w/XM2w 4K", ...WIRELESS_4K_V2 }],
]);
export const EGG_REPORT = {
    config: 0xa0,
    command: 0xa1,
    event: 0x03,
};
export const EGG_OPERATION = {
    firmware: 0x02,
    store: 0x11,
    load: 0x12,
    factoryReset: 0x13,
    writeSensor: 0x14,
    writePower: 0x15,
    writeButtons: 0x16,
    /** 4K v2: the mouse's own VID/PID and firmware, answered by the mouse even through the dongle. */
    mouseInfo: 0x0e,
};
export const EGG_OFFSET = {
    pollingDivider: 21,
    filterFlags: 22,
    ledLiftOff: 24,
    lod: 25,
    angleSnapping: 26,
    rippleControl: 27,
    motionSync: 28,
    reserved29: 29,
    cpiLevels: 30,
    firstCpiSplit: 51,
    handedButton: 71,
    firstButton: 77,
    glassMode: 127,
    angleTuning: 128,
    forceMaxFps: 129,
};
/** Where the wireless4k firmware keeps fields that differ from EGG_OFFSET. */
export const EGG_4K_OFFSET = {
    angleTuning: 17,
    /** Force max FPS is a filterFlags bit here, not a byte. */
    forceMaxFpsFlag: 0x40,
    /** The polling byte is a vendor enum here; this one is 1000 Hz with wireless power saving. */
    powerSavePolling: 0x80,
};
/** The only rates the 4K v2 vendor tool writes; 125 Hz is its "Office Mode" (0x40). */
export const EGG_4K_POLLING_RATES = [125, 1000, 2000, 4000];
/** The 4K v1 tool writes only 0x08 / 0x04 / 0x02; Office Mode and power saving came with v2. */
export const EGG_4K_V1_POLLING_RATES = [1000, 2000, 4000];
/**
 * The three block writes the OP1w/XM2w 4K vendor tools use instead of the
 * whole-blob store, built from a config buffer. Layout decoded from the vendor
 * tool and USB captures in johanneszab/endgame-op1w (re/PROTOCOL.md section 4);
 * its blob offsets sit 16 bytes into our buffer. The power block declares 10
 * bytes; the v2 tool appends an 11th, glass mode, which the v1 never sends.
 */
export function eggBlockWrites(config, hasGlassMode = true) {
    const at = (offset) => config[16 + offset];
    const sensor = new Uint8Array(28);
    sensor.set([at(0x07), at(0x08), at(0x09), at(0x0a), at(0x0b), at(0x01), at(0x0e), at(0x0d)]);
    sensor.set(config.subarray(16 + 0x23, 16 + 0x37), 8);
    const filters = [0, 1, 2, 3, 4].map((button) => at(0x3d + button * 7));
    const power = Uint8Array.of(at(0x0c), at(0x05), at(0x06), at(0x04), ...filters, at(0x03), ...(hasGlassMode ? [at(0x6f)] : []));
    const buttons = config.slice(16 + 0x37, 16 + 0x6f);
    return [
        { command: EGG_OPERATION.writeSensor, declaredLength: 28, chunk: 0, payload: sensor },
        { command: EGG_OPERATION.writePower, declaredLength: 10, chunk: 0, payload: power },
        { command: EGG_OPERATION.writeButtons, declaredLength: 28, chunk: 1, payload: buttons.subarray(0, 28) },
        { command: EGG_OPERATION.writeButtons, declaredLength: 28, chunk: 2, payload: buttons.subarray(28) },
    ];
}
export const EGG_CONFIG_SIZE = 1041;
export const EGG_COMMAND_SIZE = 64;
export const EGG_POLLING_RATES = [125, 250, 500, 1000, 2000, 4000, 8000];
export function eggNormalizeFeatureReport(raw, reportId, expectedTotal, payloadLength) {
    // Some OP1 8K descriptors expose both feature reports at the full 1040-byte
    // config size. On Windows, command replies then retain their A0/A1 wire
    // header as the first payload byte. Treat that byte as framing instead of
    // prepending a duplicate report ID and shifting the status/version fields.
    // Status byte values observed on the wire (issue #107): 0x01 OK, 0x03 busy,
    // 0x07 rejected, 0x08 mouse unreachable (RF sleep). All four are valid
    // framing markers, not just OK/busy — treating only 0x01/0x03 as framing
    // left rejected and RF-sleep replies on the OP1w 4K v2 falling through to
    // the byte-shifting path below, corrupting the payload length calculation.
    const hasWireHeader = raw.length === payloadLength
        && raw.length >= 2
        && (raw[0] === 0 || raw[0] === EGG_REPORT.config || raw[0] === EGG_REPORT.command)
        && (raw[1] === 0x01 || raw[1] === 0x03 || raw[1] === 0x07 || raw[1] === 0x08);
    if (hasWireHeader) {
        const result = new Uint8Array(Math.max(expectedTotal, raw.length));
        result.set(raw);
        result[0] = reportId;
        return result;
    }
    let includesId;
    if (payloadLength > 0 && raw.length === payloadLength)
        includesId = false;
    else if (payloadLength > 0 && raw.length === payloadLength + 1 && raw[0] === reportId)
        includesId = true;
    else
        includesId = raw.length > 0 && raw[0] === reportId;
    const result = new Uint8Array(Math.max(expectedTotal, raw.length + (includesId ? 0 : 1)));
    if (includesId)
        result.set(raw);
    else {
        result[0] = reportId;
        result.set(raw, 1);
    }
    return result;
}
export function eggProfileForPid(pid) {
    const profile = EGG_DEVICE_PROFILES.get(pid);
    if (!profile)
        throw new Error(`Unsupported Endgame Gear product 0x${pid.toString(16)}.`);
    return profile;
}
/**
 * Every setting the EggOp1HidClient exposes for one device. Mirrors the
 * driver's setter surface: v2-only sensor controls, glass mode, and the
 * motion-jitter filter (absent on 4K v2) are the only per-device branches.
 * Notably absent: LED zone control, on-board profile management, wireless
 * pairing/battery — the vendor tools have them, this driver does not.
 */
export function eggExposedFeatures(profile) {
    const features = [
        "dpi-stages",
        "polling-rate",
        "lift-off-distance",
        "motion-sync",
        "angle-snapping",
        "ripple-control",
        "slamclick-filter",
        "spdt-mode",
        "cpi-levels",
        "multiclick-filter",
        "button-mapping",
        "left-handed-mode",
        "factory-reset",
        "firmware-version",
    ];
    if (profile.lodGlass !== null)
        features.push("glass-mode");
    if (profile.configFamily === "v2") {
        features.push("sensor-angle-tuning", "force-max-fps", "led-lift-off");
    }
    if (!(profile.wireless4k === true && profile.configFamily === "v2")) {
        features.push("motion-jitter-filter");
    }
    return features;
}
export function eggCpiStep(profile, cpi) {
    return profile.configFamily === "v2" && cpi <= 10_000
        ? profile.cpiStepLow
        : profile.cpiStepHigh;
}
export function eggClampCpi(profile, value) {
    const clamped = Math.max(profile.cpiMin, Math.min(profile.cpiMax, Math.round(value)));
    const step = eggCpiStep(profile, clamped);
    const rounded = Math.floor((clamped + step / 2) / step) * step;
    return Math.max(profile.cpiMin, Math.min(profile.cpiMax, rounded));
}
export function eggIsValidCpi(profile, value) {
    return Number.isInteger(value) && value === eggClampCpi(profile, value);
}
export function eggDpiOptions(profile) {
    const values = [];
    for (let cpi = profile.cpiMin; cpi <= profile.cpiMax;) {
        values.push(cpi);
        cpi += eggCpiStep(profile, cpi + 1);
    }
    return values;
}
export function eggLodOptions(profile, glassMode) {
    return glassMode && profile.lodGlass ? profile.lodGlass : profile.lodNormal;
}
function decodeBcdByte(value) {
    const high = value >> 4;
    const low = value & 0x0f;
    return high <= 9 && low <= 9 ? high * 10 + low : null;
}
/** Firmware stores BCD patch/major bytes, e.g. 37 01 => V1.37. */
export function eggFormatFirmwareVersion(bytes) {
    for (const offset of [17, 16, 18, 2, 4, 6]) {
        const patch = decodeBcdByte(bytes[offset] ?? 0xff);
        const major = decodeBcdByte(bytes[offset + 1] ?? 0xff);
        if (patch !== null && major !== null && major > 0) {
            return `V${major}.${String(patch).padStart(2, "0")}`;
        }
    }
    return null;
}
export function eggReadUint16LE(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
}
export function eggWriteUint16LE(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = value >> 8;
}
/**
 * The wired 8K configuration does not expose the CPI stage currently selected
 * by the mouse. Apply a generic CPI change to every enabled stage so it takes
 * effect regardless of the runtime stage selection.
 */
export function eggWriteEnabledCpiStages(bytes, x, y) {
    const levels = Math.min(Math.max(bytes[EGG_OFFSET.cpiLevels], 1), 4);
    for (let level = 0; level < levels; level += 1) {
        const offset = EGG_OFFSET.firstCpiSplit + level * 5;
        bytes[offset] = x === y ? 0 : 1;
        eggWriteUint16LE(bytes, offset + 1, x);
        eggWriteUint16LE(bytes, offset + 3, y);
    }
}
export const EGG_BUTTON_ACTION_OPTIONS = [
    { group: "Mouse", key: "mouse-left", label: "Left Click" },
    { group: "Mouse", key: "mouse-right", label: "Right Click" },
    { group: "Mouse", key: "mouse-middle", label: "Middle Click" },
    { group: "Mouse", key: "mouse-back", label: "Back" },
    { group: "Mouse", key: "mouse-forward", label: "Forward" },
    { group: "Scroll", key: "scroll-up", label: "Wheel Up" },
    { group: "Scroll", key: "scroll-down", label: "Wheel Down" },
    { group: "Keyboard", key: "keyboard", label: "Keyboard shortcut" },
    { group: "CPI", key: "cpi-loop", label: "CPI Loop" },
    { group: "CPI", key: "fixed-cpi", label: "Fixed CPI" },
    { group: "Media", key: "media-play", label: "Play / Pause" },
    { group: "Media", key: "media-next", label: "Next Track" },
    { group: "Media", key: "media-previous", label: "Previous Track" },
    { group: "Media", key: "media-mute", label: "Mute" },
    { group: "Media", key: "media-volume-up", label: "Volume Up" },
    { group: "Media", key: "media-volume-down", label: "Volume Down" },
    { group: "System", key: "browser-home", label: "Browser Home" },
    { group: "System", key: "file-explorer", label: "File Explorer" },
    { group: "Other", key: "disabled", label: "Disabled" },
];
export function eggDecodeButtonAction(type, params) {
    const p = (index) => params[index] ?? 0;
    if (type === 0x00) {
        const key = {
            0x01: "mouse-left",
            0x02: "mouse-right",
            0x04: "mouse-middle",
            0x08: "mouse-back",
            0x10: "mouse-forward",
        }[p(0)];
        if (key)
            return { key };
    }
    if (type === 0x01 && p(0) === 0x01)
        return { key: "scroll-up" };
    if (type === 0x01 && p(0) === 0xff)
        return { key: "scroll-down" };
    if (type === 0x02)
        return { key: "keyboard", modifiers: p(0) & 0x0f, usage: p(1) };
    if (type === 0x09)
        return { key: "cpi-loop" };
    if (type === 0x0c) {
        return { key: "fixed-cpi", x: p(1) | (p(2) << 8), y: p(3) | (p(4) << 8) };
    }
    if (type === 0x18 && p(0) === 0x96)
        return { key: "browser-home" };
    if (type === 0x18 && p(0) === 0x94)
        return { key: "file-explorer" };
    const media = {
        0xcd: "media-play",
        0xb5: "media-next",
        0xb6: "media-previous",
        0xe2: "media-mute",
        0xe9: "media-volume-up",
        0xea: "media-volume-down",
    }[p(0)];
    if (type === 0x20 && media)
        return { key: media };
    if (type === 0xff)
        return { key: "disabled" };
    return { key: "raw", rawType: type, rawParams: Array.from({ length: 5 }, (_, index) => p(index)) };
}
export function eggEncodeButtonAction(action) {
    const params = (...values) => {
        const result = [0, 0, 0, 0, 0];
        values.slice(0, 5).forEach((value, index) => { result[index] = value & 0xff; });
        return result;
    };
    switch (action.key) {
        case "mouse-left": return { type: 0x00, params: params(0x01) };
        case "mouse-right": return { type: 0x00, params: params(0x02) };
        case "mouse-middle": return { type: 0x00, params: params(0x04) };
        case "mouse-back": return { type: 0x00, params: params(0x08) };
        case "mouse-forward": return { type: 0x00, params: params(0x10) };
        case "scroll-up": return { type: 0x01, params: params(0x01) };
        case "scroll-down": return { type: 0x01, params: params(0xff) };
        case "keyboard": return { type: 0x02, params: params(action.modifiers ?? 0, action.usage ?? 0) };
        case "cpi-loop": return { type: 0x09, params: params(0xf1) };
        case "fixed-cpi": {
            const x = action.x ?? 1600;
            const y = action.y ?? x;
            return { type: 0x0c, params: params(0, x, x >> 8, y, y >> 8) };
        }
        case "browser-home": return { type: 0x18, params: params(0x96) };
        case "file-explorer": return { type: 0x18, params: params(0x94) };
        case "media-play": return { type: 0x20, params: params(0xcd) };
        case "media-next": return { type: 0x20, params: params(0xb5) };
        case "media-previous": return { type: 0x20, params: params(0xb6) };
        case "media-mute": return { type: 0x20, params: params(0xe2) };
        case "media-volume-up": return { type: 0x20, params: params(0xe9) };
        case "media-volume-down": return { type: 0x20, params: params(0xea) };
        case "disabled": return { type: 0xff, params: params() };
        case "raw": return null;
    }
}
export function eggButtonActionLabel(action) {
    if (action.key === "raw")
        return "Custom (preserved)";
    if (action.key === "keyboard") {
        const modifiers = [
            [0x01, "Ctrl"], [0x02, "Shift"], [0x04, "Alt"], [0x08, "Win"],
        ];
        const parts = modifiers.filter(([mask]) => (action.modifiers ?? 0) & mask).map(([, label]) => label);
        parts.push(action.usage ? `HID 0x${action.usage.toString(16).padStart(2, "0")}` : "Unassigned");
        return parts.join(" + ");
    }
    if (action.key === "fixed-cpi") {
        return action.x === action.y ? `CPI ${action.x}` : `X ${action.x} / Y ${action.y}`;
    }
    return EGG_BUTTON_ACTION_OPTIONS.find((option) => option.key === action.key)?.label ?? action.key;
}
export function eggIsPlainLeftAction(bytes) {
    return bytes[0] === 0x00 && bytes[1] === 0x01 && !bytes.slice(2, 6).some(Boolean);
}
const BUTTON_CONTROL_INDEX = [0, 1, 2, 3, 4, null, null];
const BUTTON_MAPPING_INDEX = [null, 0, 1, 2, 3, 5, 6];
export function eggButtonControlOffset(button) {
    const index = BUTTON_CONTROL_INDEX[button];
    return index === null || index === undefined ? null : EGG_OFFSET.firstButton + index * 7;
}
export function eggButtonMappingOffset(button, leftHanded) {
    if (button === 0)
        return leftHanded ? EGG_OFFSET.handedButton : null;
    if (button === 1 && leftHanded)
        return null;
    const index = BUTTON_MAPPING_INDEX[button];
    return index === null || index === undefined ? null : EGG_OFFSET.firstButton + index * 7 + 1;
}
