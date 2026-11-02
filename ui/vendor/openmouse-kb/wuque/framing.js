/**
 * Wuque Studio (BABAO / ZOOM) vendor HID protocol — shared framing.
 *
 * Reverse-engineered from the vendor web configurator served at
 * `https://drives-hid.wuquestudio.cn/` (deployed bundle `/hub/js/index-Qbh_Aa6s.js`,
 * sha256 `794cfe7f…c048b`) and confirmed against a physical BABAO60 HE
 * (`0x1CA6:0x1B10`, firmware protocol 1.2.1.0).
 *
 * Wire format
 * -----------
 * Request: HID **output report id 0**, exactly {@link WUQUE_COMMAND_SIZE} bytes,
 * zero-padded, `[group, subCommand, ...params]` with little-endian params.
 * Reply: HID **input report**, `[group, subCommand, ...payload]` — the request's
 * group and subCommand are echoed, payload starts at byte 2. The vendor app never
 * correlates a reply with its request; a correct client MUST match on group/sub.
 *
 * A handful of streaming commands (voice, haptics, displayer flash) carry a status
 * byte at payload offset 0; the settings/keys/lighting/macro groups do not.
 */
/** Wooting-style vendor id of every Wuque Studio board seen in the configurator. */
export const WUQUE_VENDOR_ID = 0x1ca6;
/** Second vendor id used by the 80 HE (`0x36B5:0x75D4`). */
export const WUQUE_VENDOR_ID_ALT = 0x36b5;
/**
 * Known product ids. `0x1B10`/`0x1B0A` and `0x75D4`/`0x75D2` are the retail and
 * test ids the configurator filters on — the 80 HE ids live under the second
 * vendor id; `0x1B09` is the ZOOM TIGA HE seen in the vendor's live `test.json`
 * config dump.
 */
export const WUQUE_PRODUCTS = {
    0x1b10: { name: "BABAO60 HE", vendorId: WUQUE_VENDOR_ID, verified: true },
    0x1b0a: { name: "BABAO60 HE (test)", vendorId: WUQUE_VENDOR_ID, verified: false },
    0x75d4: { name: "BABAO80 HE", vendorId: WUQUE_VENDOR_ID_ALT, verified: false },
    0x75d2: { name: "BABAO80 HE (test)", vendorId: WUQUE_VENDOR_ID_ALT, verified: false },
    0x1b09: { name: "ZOOM TIGA HE", vendorId: WUQUE_VENDOR_ID, verified: false },
};
export const WUQUE_PRODUCT_IDS = Object.keys(WUQUE_PRODUCTS).map(Number);
/** Vendor config interface: usage page 0xFFB0, usage 1. */
export const WUQUE_CONFIG_USAGE_PAGE = 0xffb0;
/** Second vendor page the deployed app requests; replies are not 4-byte-stripped on either. */
export const WUQUE_CONFIG_USAGE_PAGE_ALT = 0xff80;
export const WUQUE_CONFIG_USAGE = 0x01;
export const WUQUE_COMMAND_SIZE = 64;
/** Reply byte value the board returns in the sub-command slot for an unsupported command. */
export const WUQUE_UNSUPPORTED = 0xff;
/**
 * Top-level command groups (`byte0` of every frame). Ids and names are taken
 * verbatim from the vendor bundle's `Vo` enum.
 */
export const WUQUE_GROUP = {
    device: 1,
    global: 2,
    layoutAndKey: 3,
    performance: 4,
    lighting: 5,
    higherKey: 6,
    macro: 7,
    firmwareUpgrade: 8,
    customCommand: 10,
    displayer: 12,
    threeMode: 13,
    voice: 14,
    touch: 15,
    handle: 16,
    threeD: 17,
    /** USB mode / high polling rate ("Ultra Frame"); absent on 60 HE firmware 1.2.x. */
    usbMode: 18,
};
/** Sub-commands of the Device group. */
export const WUQUE_DEVICE_COMMAND = {
    protocol: 1,
    deviceInfo: 2,
    deviceFeature: 3,
};
/** Read/Write selector used by the Global and HigherKey groups. */
export const WUQUE_ACCESS = {
    read: 1,
    write: 2,
};
/** `ReadList`/`Read`/`Write` selector used by the report-rate and system-type queries. */
export const WUQUE_LIST_ACCESS = {
    readList: 0,
    read: 1,
    write: 2,
};
/** Sub-commands of the Global group. */
export const WUQUE_GLOBAL_COMMAND = {
    resetFactory: 1,
    saveParam: 2,
    configSwitch: 3,
    systemSetting: 4,
    reportRateSetting: 5,
    calibrationSetting: 6,
    axisLibraryQuery: 7,
    effectAreaQuery: 8,
    modifyDefaultAxis: 9,
    doubleLightingQuery: 10,
    specialLightingQuery: 11,
    rtPrecisionQuery: 12,
    sleepTimeQuery: 13,
    macroSpaceInfoQuery: 14,
    shakeOptimizationSwitch: 16,
    usbModeSetting: 18,
};
/** `SaveParam`/`GFSRestore` scope selector. */
export const WUQUE_SAVE_SCOPE = {
    all: 0,
    calibration: 1,
    performance: 2,
    lighting: 3,
    layout: 4,
    higherKey: 5,
    macro: 6,
    axis: 7,
    highPollingRateReset: 15,
};
/** Sub-commands of the LayoutAndKey group. */
export const WUQUE_KEY_COMMAND = {
    getKeyLayout: 1,
    setKeyLayout: 2,
    getKeyCode: 3,
    setKeyCode: 4,
    getKeyLayoutStyle: 5,
    getKeyLayoutDefault: 6,
};
/** Sub-commands of the Performance group. */
export const WUQUE_PERFORMANCE_COMMAND = {
    getPerformance: 1,
    setPerformance: 2,
    axisData: 3,
};
/** `axisData` multiplexer. */
export const WUQUE_AXIS_COMMAND = {
    adc: 0,
    route: 1,
    calibrate: 2,
    keyStatus: 3,
};
/** Sub-commands of the Lighting group. */
export const WUQUE_LIGHTING_COMMAND = {
    getBase: 1,
    setBase: 2,
    getCustom: 3,
    setCustom: 4,
    directDrive: 5,
    caps: 6,
};
/** Lighting area selector. */
export const WUQUE_LIGHTING_AREA = {
    keyboard: 0,
    decorate1: 1,
    decorate2: 2,
    decorate3: 3,
    decorate4: 4,
    decorate5: 5,
};
/** Lighting block selector (`config` byte of the base read/write). */
export const WUQUE_LIGHTING_BLOCK = {
    base: 0,
    palette: 1,
    colorCorrection: 2,
};
/** Sub-commands of the HigherKey (advanced key) group. */
export const WUQUE_HIGHER_KEY_COMMAND = {
    read: 1,
    write: 2,
};
/** Advanced-key mode selector. */
export const WUQUE_HIGHER_KEY_MODE = {
    none: 0,
    dks: 1,
    mpt: 2,
    mt: 3,
    tgl: 4,
    end: 5,
    socd: 6,
    rs: 7,
};
/** Sub-commands of the Macro group. */
export const WUQUE_MACRO_COMMAND = {
    getMacroMode: 1,
    setMacroMode: 2,
    getMacro: 3,
    setMacro: 4,
};
/** Sub-commands of the CustomCommand group used by the 60 HE. */
export const WUQUE_CUSTOM_COMMAND = {
    blackout: 1,
};
/** Sub-commands of the Handle group. */
export const WUQUE_HANDLE_COMMAND = {
    getKeyboardMode: 1,
    setKeyboardMode: 2,
};
/** Sub-commands of the ThreeMode group. */
export const WUQUE_THREE_MODE_COMMAND = {
    getBasicInfo: 1,
    setSleepTime: 2,
    getSleepTime: 3,
};
/** Sub-commands of the USB-mode group (absent on 60 HE firmware 1.2.x). */
export const WUQUE_USB_MODE_COMMAND = {
    getStatus: 1,
    getStoredMode: 2,
    setMode: 3,
};
/** USB mode selector for {@link WUQUE_USB_MODE_COMMAND}.setMode. */
export const WUQUE_USB_MODE = {
    usb2_0: 0,
    usb3_0_8k: 1,
    usb3_0_16k: 2,
    usb3_0_32k: 3,
};
/** Polling rate selector. */
export const WUQUE_REPORT_RATE = {
    r8khz: 0,
    r4khz: 1,
    r2khz: 2,
    r1khz: 3,
    r500hz: 4,
    r250hz: 5,
    r125hz: 6,
};
/** Host OS selector for the layout/system queries. */
export const WUQUE_SYSTEM = {
    win: 0,
    mac: 1,
};
/** Blackout open/close selector. */
export const WUQUE_BLACKOUT = {
    close: 0,
    open: 1,
};
/** Number of rows in the 60% firmware matrix; every row carries 21 key slots. */
export const WUQUE_MATRIX_ROWS = 6;
/** Key slots per matrix row. */
export const WUQUE_MATRIX_COLS = 21;
/** Keycode layers addressable by the LayoutAndKey group. */
export const WUQUE_KEY_LAYERS = 4;
/** Macro slots on the 60 HE (from `macroSpaceInfo`: 16 macros / 960 actions). */
export const WUQUE_MACRO_SLOTS = 16;
/** Packed macro events per `setMacro` frame. */
export const WUQUE_MACRO_EVENTS_PER_FRAME = 15;
/** LEDs per `setCustom`/`directDrive` frame. */
export const WUQUE_LEDS_PER_FRAME = 15;
/** Custom-lighting pages the vendor app reads back (15 LEDs each). */
export const WUQUE_CUSTOM_LIGHT_PAGES = 9;
/** Fixed-point scale of travel/actuation fields: millimetres × 1000. */
export const WUQUE_TRAVEL_SCALE = 1000;
/** Convert a raw travel/actuation field to millimetres. */
export function wuqueTravelMm(raw) {
    return raw / WUQUE_TRAVEL_SCALE;
}
/** Convert millimetres to the raw travel/actuation field. */
export function wuqueTravelRaw(mm) {
    return Math.round(mm * WUQUE_TRAVEL_SCALE);
}
/** Split a number into little-endian u16 bytes. */
export function wuqueU16Bytes(value) {
    return [value & 0xff, (value >> 8) & 0xff];
}
/** Read a little-endian u16 from `bytes[at]`; null when the buffer ends first. */
export function wuqueU16(bytes, at) {
    return bytes.length >= at + 2 ? (bytes[at] | (bytes[at + 1] << 8)) : null;
}
/** Split a number into little-endian u32 bytes. */
export function wuqueU32Bytes(value) {
    return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
}
/** Read a little-endian u32 from `bytes[at]`; null when the buffer ends first. */
export function wuqueU32(bytes, at) {
    const u16a = wuqueU16(bytes, at);
    const u16b = wuqueU16(bytes, at + 2);
    return u16a === null || u16b === null ? null : (u16a | (u16b << 16)) >>> 0;
}
/**
 * Build a 64-byte request frame exactly as the vendor SDK lays it out: bytes are
 * copied in order, the remainder is zero-filled. `group` and `subCommand` are
 * written first, so callers pass only the trailing parameters.
 */
export function encodeWuqueCommand(group, subCommand, params = []) {
    const frame = new Uint8Array(WUQUE_COMMAND_SIZE);
    frame[0] = group & 0xff;
    frame[1] = subCommand & 0xff;
    params.forEach((value, index) => {
        const at = index + 2;
        if (at < frame.length)
            frame[at] = value & 0xff;
    });
    return frame;
}
/**
 * Build a request frame from an already-ordered byte list (the vendor's `Ye([...])`
 * shape). Bytes beyond {@link WUQUE_COMMAND_SIZE} are ignored.
 */
export function encodeWuqueFrame(bytes) {
    const frame = new Uint8Array(WUQUE_COMMAND_SIZE);
    bytes.forEach((value, index) => {
        if (index < frame.length)
            frame[index] = value & 0xff;
    });
    return frame;
}
/** True when `bytes` looks like a Wuque reply for `group`/`subCommand`. */
export function isWuqueReply(bytes, group, subCommand) {
    if (!bytes || bytes.length < 2)
        return false;
    if (group !== undefined && bytes[0] !== group)
        return false;
    if (subCommand !== undefined && bytes[1] !== subCommand)
        return false;
    return true;
}
/** True when the board answered the command as unsupported (`subCommand` echoed as 0xFF). */
export function isWuqueUnsupported(bytes) {
    return !!bytes && bytes.length >= 2 && bytes[1] === WUQUE_UNSUPPORTED;
}
/**
 * Payload of a reply (everything after the echoed group/subCommand), or null when
 * the reply is absent, too short, or does not answer `group`/`subCommand`. The
 * returned view shares the reply buffer — no copy.
 */
export function wuqueReplyPayload(reply, group, subCommand) {
    if (!reply || reply.length < 3)
        return null;
    if (reply[0] !== group || reply[1] !== subCommand)
        return null;
    return reply.subarray(2);
}
/** Human name for a product id, falling back to a generic Wuque label. */
export function wuqueProductName(productId) {
    return WUQUE_PRODUCTS[productId]?.name ?? "Wuque keyboard";
}
