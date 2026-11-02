/**
 * Razer keyboard control protocol: the 90-byte feature report Razer firmware
 * exchanges on report ID 0.
 *
 * The packet layout and command codes come from OpenRazer's public
 * `razercommon`/`razerchromacommon`/`razerkbd_driver` sources; the keyboard
 * model list comes from its `razerkbd_driver.h` device ids. OpenRazer sends
 * these frames as HID SET_REPORT control transfers on the keyboard's
 * mouse-protocol control interface, which WebHID exposes as the Generic
 * Desktop / Mouse collection.
 *
 * This module is deliberately packet-only. The HID client lives in
 * `../drivers/razer/hid.ts`.
 */
export const RAZER_VENDOR_ID = 0x1532;
export const RAZER_REPORT_ID = 0;
export const RAZER_REPORT_LENGTH = 90;
export const RAZER_MAX_PAYLOAD = 80;
/**
 * Razer answers only when the transaction id matches the firmware generation.
 * A mismatch is silent, so the driver discovers the id by probing the firmware
 * command instead of trusting a per-model table.
 */
export const RAZER_TRANSACTION_IDS = [0x1f, 0x3f, 0x9f, 0xff];
export const RAZER_STATUS = {
    busy: 0x01,
    ok: 0x02,
    failure: 0x03,
    timeout: 0x04,
    unsupported: 0x05,
};
/** Standard (`0x85`/`0x05`) and extended (`0xC0`/`0x40`) polling-rate codes. */
export const RAZER_POLLING_RATE_STANDARD = new Map([
    [1000, 0x01],
    [500, 0x02],
    [125, 0x08],
]);
export const RAZER_POLLING_RATE_EXTENDED = new Map([
    [8000, 0x01],
    [4000, 0x02],
    [2000, 0x04],
    [1000, 0x08],
    [500, 0x10],
    [250, 0x20],
    [125, 0x40],
]);
/** All rates either encoding can express; the firmware still decides. */
export const RAZER_POLLING_RATES = [125, 250, 500, 1000, 2000, 4000, 8000];
/** Read-only commands used by the driver. */
export const RAZER_KEYBOARD_READ = {
    firmware: { commandClass: 0x00, commandId: 0x81, dataSize: 0x02 },
    serial: { commandClass: 0x00, commandId: 0x82, dataSize: 0x16 },
    pollingRate: { commandClass: 0x00, commandId: 0x85, dataSize: 0x01 },
    pollingRateExtended: { commandClass: 0x00, commandId: 0xc0, dataSize: 0x01 },
    brightnessExtended: { commandClass: 0x0f, commandId: 0x84, dataSize: 0x03, args: [0x01, 0x05] },
    brightnessStandard: { commandClass: 0x03, commandId: 0x83, dataSize: 0x03, args: [0x01, 0x05] },
};
/** Writable commands used by the driver. */
export const RAZER_KEYBOARD_WRITE = {
    pollingRate: { commandClass: 0x00, commandId: 0x05, dataSize: 0x01 },
    pollingRateExtended: { commandClass: 0x00, commandId: 0x40, dataSize: 0x02 },
    brightnessExtended: { commandClass: 0x0f, commandId: 0x04, dataSize: 0x03 },
    brightnessStandard: { commandClass: 0x03, commandId: 0x03, dataSize: 0x03 },
    matrixEffectExtended: { commandClass: 0x0f, commandId: 0x02, dataSize: 0x06 },
    matrixEffectStandard: { commandClass: 0x03, commandId: 0x0a, dataSize: 0x01 },
    bindingAnalog: { commandClass: 0x02, commandId: 0x12, dataSize: 0x07 },
    bindingStandard: { commandClass: 0x02, commandId: 0x0d, dataSize: 0x04 },
    bindingAnalogRead: { commandClass: 0x02, commandId: 0x92, dataSize: 0x03 },
    bindingStandardRead: { commandClass: 0x02, commandId: 0x8d, dataSize: 0x02 },
};
export const RAZER_CUSTOM_MATRIX_SUPPORT = new Map([
    [0x0226, { style: "extended", transactionId: 0x3f }], // Huntsman Elite
    [0x0227, { style: "extended", transactionId: 0x3f }], // Huntsman
    [0x0228, { style: "extended", transactionId: 0x1f }], // BlackWidow Elite
    [0x022a, { style: "extended", transactionId: 0x3f }], // Cynosa Chroma
    [0x0237, { style: "standard", transactionId: 0xff }], // BlackWidow Essential
    [0x0241, { style: "extended", transactionId: 0x3f }], // BlackWidow 2019
    [0x0243, { style: "extended", transactionId: 0x3f }], // Huntsman TE
    [0x024e, { style: "extended", transactionId: 0x3f, rowTransactionId: 0x1f }], // BlackWidow V3
    [0x0257, { style: "extended", transactionId: 0x3f }], // Huntsman Mini
    [0x025a, { style: "extended", transactionId: 0x3f, rowTransactionId: 0x1f }], // BlackWidow V3 Pro wired
    [0x025c, { style: "extended", transactionId: 0x9f }], // BlackWidow V3 Pro wireless
    [0x025d, { style: "extended", transactionId: 0x1f }], // Ornata V2
    [0x025e, { style: "extended", transactionId: 0x1f }], // Cynosa V2
    [0x0266, { style: "extended", transactionId: 0x1f }], // Huntsman V2 Analog
    [0x026b, { style: "extended", transactionId: 0x1f }], // Huntsman V2 Tenkeyless
    [0x026c, { style: "extended", transactionId: 0x1f }], // Huntsman V2
    [0x0282, { style: "extended", transactionId: 0x1f }], // Huntsman Mini Analog
    [0x028f, { style: "extended", transactionId: 0x1f }], // Ornata V3 alternate
    [0x0290, { style: "extended", transactionId: 0x9f }], // DeathStalker V2 Pro wireless
    [0x0292, { style: "extended", transactionId: 0x3f }], // DeathStalker V2 Pro wired
    [0x0293, { style: "extended", transactionId: 0x1f }], // BlackWidow V4 X
    [0x0294, { style: "extended", transactionId: 0x1f }], // Ornata V3 X
    [0x0295, { style: "extended", transactionId: 0x3f }], // DeathStalker V2
    [0x0296, { style: "extended", transactionId: 0x9f }], // DeathStalker V2 Pro TKL wireless
    [0x0298, { style: "extended", transactionId: 0x3f }], // DeathStalker V2 Pro TKL wired
    [0x02a1, { style: "extended", transactionId: 0x1f }], // Ornata V3
    [0x02a2, { style: "extended", transactionId: 0x1f }], // Ornata V3 X alternate
    [0x02a3, { style: "extended", transactionId: 0x1f }], // Ornata V3 TKL
    [0x02a6, { style: "extended", transactionId: 0x1f }], // Huntsman V3 Pro
    [0x02a7, { style: "extended", transactionId: 0x1f }], // Huntsman V3 Pro TKL
    [0x02b0, { style: "extended", transactionId: 0x1f }], // Huntsman V3 Pro Mini
    [0x02b9, { style: "extended", transactionId: 0x1f }], // BlackWidow V4 Mini HyperSpeed wired
    [0x02ba, { style: "extended", transactionId: 0x9f }], // BlackWidow V4 Mini HyperSpeed wireless
    [0x02cf, { style: "extended", transactionId: 0x1f }], // Huntsman V3 Pro 8KHz
    [0x02d5, { style: "extended", transactionId: 0x9f }], // BlackWidow V4 TKL HyperSpeed wireless
    [0x02d7, { style: "extended", transactionId: 0x1f }], // BlackWidow V4 TKL HyperSpeed wired
    [0x0a24, { style: "extended", transactionId: 0x3f, rowTransactionId: 0x1f }], // BlackWidow V3 TK
]);
/** GAME_LED (0x08): Huntsman V2 uses NOSTORE; the other listed boards use VARSTORE. */
export const RAZER_GAME_MODE_LED_SUPPORT = new Map([
    [0x0237, { storage: 1, transactionId: 0xff }],
    [0x026b, { storage: 0, transactionId: 0x1f }],
    [0x026c, { storage: 0, transactionId: 0x1f }],
    [0x02a6, { storage: 1, transactionId: 0xff }],
    [0x02a7, { storage: 1, transactionId: 0xff }],
    [0x02b0, { storage: 1, transactionId: 0xff }],
    [0x02cf, { storage: 1, transactionId: 0xff }],
]);
/** Huntsman V3 analog family; `02:1A`/`02:9A` are documented for these boards. */
export const RAZER_FIRMWARE_RAPID_TRIGGER_PRODUCTS = new Set([0x02a6, 0x02a7, 0x02b0, 0x02cf]);
/** V3 firmware stores one tenth millimetre as 1638 big-endian units. */
export function razerRapidTriggerUnits(mm) {
    if (!Number.isFinite(mm) || mm < 0.1 || mm > 1.0)
        throw new RangeError("Rapid-trigger distance must be from 0.1 to 1.0 mm.");
    return Math.round(mm * 16380);
}
/** Firmware key ID that targets every key rather than one. */
export const RAZER_FIRMWARE_ALL_KEYS = 0xff;
export function encodeRazerRapidTrigger(key, enabled, upMm, downMm) {
    if (!Number.isInteger(key) || key < 1 || key >= RAZER_FIRMWARE_ALL_KEYS) {
        throw new RangeError("Razer firmware key ID must be 1–254; 255 targets every key.");
    }
    const up = razerRapidTriggerUnits(upMm);
    const down = razerRapidTriggerUnits(downMm);
    return { commandClass: 0x02, commandId: 0x1a, dataSize: 8,
        args: [0, 0, key, enabled ? 1 : 0, up >> 8, up & 0xff, down >> 8, down & 0xff] };
}
/**
 * Standalone Razer keyboards that speak the 90-byte control protocol. Blade
 * laptops, keypads and pre-90-byte models are intentionally absent: claiming a
 * laptop's internal keyboard or an old direct-USB device would offer commands
 * its firmware does not answer.
 */
export const RAZER_KEYBOARD_PRODUCTS = new Map([
    [0x0226, { name: "Huntsman Elite", wireless: false, verified: false }],
    [0x0227, { name: "Huntsman", wireless: false, verified: false }],
    [0x0228, { name: "BlackWidow Elite", wireless: false, verified: false }],
    [0x022a, { name: "Cynosa Chroma", wireless: false, verified: false }],
    [0x0235, { name: "BlackWidow Lite", wireless: false, verified: false }],
    [0x0237, { name: "BlackWidow Essential", wireless: false, verified: false }],
    [0x023f, { name: "Cynosa Lite", wireless: false, verified: false }],
    [0x0241, { name: "BlackWidow 2019", wireless: false, verified: false }],
    [0x0243, { name: "Huntsman Tournament Edition", wireless: false, verified: false }],
    [0x024e, { name: "BlackWidow V3", wireless: false, verified: false }],
    [0x0257, { name: "Huntsman Mini", wireless: false, verified: false }],
    [0x025a, { name: "BlackWidow V3 Pro (wired)", wireless: false, verified: false }],
    [0x025c, { name: "BlackWidow V3 Pro (wireless)", wireless: true, verified: false }],
    [0x025d, { name: "Ornata V2", wireless: false, verified: false }],
    [0x025e, { name: "Cynosa V2", wireless: false, verified: false }],
    [0x0266, { name: "Huntsman V2 Analog", wireless: false, verified: false }],
    [0x026b, { name: "Huntsman V2 Tenkeyless", wireless: false, verified: false }],
    [0x026c, { name: "Huntsman V2", wireless: false, verified: false }],
    [0x0282, { name: "Huntsman Mini Analog", wireless: false, verified: false }],
    [0x0287, { name: "BlackWidow V4", wireless: false, verified: false }],
    [0x028d, { name: "BlackWidow V4 Pro", wireless: false, verified: false }],
    [0x028f, { name: "Ornata V3 (alt)", wireless: false, verified: false }],
    [0x0290, { name: "DeathStalker V2 Pro (wireless)", wireless: true, verified: false }],
    [0x0292, { name: "DeathStalker V2 Pro (wired)", wireless: false, verified: false }],
    [0x0293, { name: "BlackWidow V4 X", wireless: false, verified: false }],
    [0x0294, { name: "Ornata V3 X", wireless: false, verified: false }],
    [0x0295, { name: "DeathStalker V2", wireless: false, verified: false }],
    [0x0296, { name: "DeathStalker V2 Pro TKL (wireless)", wireless: true, verified: false }],
    [0x0298, { name: "DeathStalker V2 Pro TKL (wired)", wireless: false, verified: false }],
    [0x02a1, { name: "Ornata V3", wireless: false, verified: false }],
    [0x02a2, { name: "Ornata V3 X (alt)", wireless: false, verified: false }],
    [0x02a3, { name: "Ornata V3 Tenkeyless", wireless: false, verified: false }],
    [0x02a5, { name: "BlackWidow V4 75%", wireless: false, verified: false }],
    [0x02a6, { name: "Huntsman V3 Pro", wireless: false, verified: false }],
    [0x02a7, { name: "Huntsman V3 Pro Tenkeyless", wireless: false, verified: false }],
    [0x02b0, { name: "Huntsman V3 Pro Mini", wireless: false, verified: false }],
    [0x02b9, { name: "BlackWidow V4 Mini HyperSpeed (wired)", wireless: false, verified: false }],
    [0x02ba, { name: "BlackWidow V4 Mini HyperSpeed (wireless)", wireless: true, verified: false }],
    [0x02cf, { name: "Huntsman V3 Pro 8KHz", wireless: false, verified: false }],
    [0x02d5, { name: "BlackWidow V4 TKL HyperSpeed (wireless)", wireless: true, verified: false }],
    [0x02d7, { name: "BlackWidow V4 TKL HyperSpeed (wired)", wireless: false, verified: false }],
    [0x0a24, { name: "BlackWidow V3 TK", wireless: false, verified: false }],
]);
export const RAZER_KEYBOARD_PRODUCT_IDS = [...RAZER_KEYBOARD_PRODUCTS.keys()];
/** Razer's XOR checksum over bytes 2..87, stored in byte 88. */
export function razerChecksum(frame) {
    let crc = 0;
    for (let index = 2; index < 88; index += 1)
        crc ^= frame[index] ?? 0;
    return crc;
}
/**
 * Build one 90-byte request. `args` is zero-padded to `dataSize`; a payload
 * larger than the declared size is rejected so a caller cannot silently send
 * bytes the firmware will not read.
 */
export function encodeRazerRequest(command, transactionId) {
    const args = command.args ?? [];
    if (args.length > RAZER_MAX_PAYLOAD)
        throw new RangeError("Razer payload exceeds 80 bytes.");
    if (!Number.isInteger(command.dataSize) || command.dataSize < 0 || command.dataSize > RAZER_MAX_PAYLOAD) {
        throw new RangeError("Razer data size is invalid.");
    }
    if (args.length > command.dataSize)
        throw new RangeError("Razer payload exceeds the declared data size.");
    for (const byte of args) {
        if (!Number.isInteger(byte) || byte < 0 || byte > 0xff)
            throw new RangeError("Razer payload byte is invalid.");
    }
    const frame = new Uint8Array(RAZER_REPORT_LENGTH);
    frame[0] = 0x00;
    frame[1] = transactionId;
    frame[5] = command.dataSize;
    frame[6] = command.commandClass;
    frame[7] = command.commandId;
    frame.set(args, 8);
    frame[88] = razerChecksum(frame);
    return frame;
}
/** Decode a 90-byte reply. `null` means the frame is structurally unusable. */
export function decodeRazerResponse(frame) {
    if (frame.length < RAZER_REPORT_LENGTH)
        return null;
    const dataSize = frame[5] ?? 0;
    if (dataSize > RAZER_MAX_PAYLOAD)
        return null;
    return {
        status: frame[0] ?? 0,
        transactionId: frame[1] ?? 0,
        remainingPackets: ((frame[2] ?? 0) << 8) | (frame[3] ?? 0),
        protocolType: frame[4] ?? 0,
        dataSize,
        commandClass: frame[6] ?? 0,
        commandId: frame[7] ?? 0,
        args: frame.slice(8, 8 + dataSize),
    };
}
/** Decode the two-byte firmware reply into `major.minor`. */
export function decodeRazerFirmware(args) {
    if (args.length < 2)
        return null;
    return `${args[0] ?? 0}.${args[1] ?? 0}`;
}
/** Decode the 22-byte serial reply, trimming at the first NUL. */
export function decodeRazerSerial(args) {
    const end = args.indexOf(0);
    const bytes = end < 0 ? args : args.slice(0, end);
    const text = new TextDecoder().decode(bytes).trim();
    return text.length ? text : null;
}
/** Map a standard/extended polling code back to Hz; `null` for an unknown code. */
export function decodeRazerPollingCode(code, extended) {
    const table = extended ? RAZER_POLLING_RATE_EXTENDED : RAZER_POLLING_RATE_STANDARD;
    for (const [hz, value] of table)
        if (value === code)
            return hz;
    return null;
}
/** Encode a rate for one of Razer's two polling commands; `null` when unexpressible. */
export function encodeRazerPollingCode(hz, extended) {
    return (extended ? RAZER_POLLING_RATE_EXTENDED : RAZER_POLLING_RATE_STANDARD).get(hz) ?? null;
}
/** Brightness replies carry the level in the third argument byte. */
export function decodeRazerBrightness(args) {
    const value = args[2];
    return value === undefined ? null : value;
}
/** Extended-matrix effect command (class 0x0F / id 0x02), backlight LED 0x05, varstore 0x01. */
export function encodeRazerMatrixEffect(effect) {
    const base = [0x01, 0x05];
    switch (effect.kind) {
        case "off":
            return { ...RAZER_KEYBOARD_WRITE.matrixEffectExtended, args: [...base, 0x00, 0x00, 0x00, 0x00] };
        case "static":
            return {
                ...RAZER_KEYBOARD_WRITE.matrixEffectExtended,
                dataSize: 0x09,
                args: [...base, 0x01, 0x00, 0x00, 0x01, effect.red, effect.green, effect.blue],
            };
        case "spectrum":
            return { ...RAZER_KEYBOARD_WRITE.matrixEffectExtended, args: [...base, 0x03, 0x00, 0x00, 0x00] };
        case "wave":
            return { ...RAZER_KEYBOARD_WRITE.matrixEffectExtended, args: [...base, 0x04, effect.direction, 0x28, 0x00] };
        case "breathing":
            if (effect.red === undefined || effect.green === undefined || effect.blue === undefined) {
                return { ...RAZER_KEYBOARD_WRITE.matrixEffectExtended, args: [...base, 0x02, 0x00, 0x00, 0x00] };
            }
            return {
                ...RAZER_KEYBOARD_WRITE.matrixEffectExtended,
                dataSize: 0x09,
                args: [...base, 0x02, 0x01, 0x00, 0x01, effect.red, effect.green, effect.blue],
            };
        case "reactive":
            return {
                ...RAZER_KEYBOARD_WRITE.matrixEffectExtended,
                dataSize: 0x09,
                args: [...base, 0x05, 0x00, effect.speed, 0x01, effect.red, effect.green, effect.blue],
            };
    }
}
/** Standard-matrix fallback (class 0x03 / id 0x0A) for older keyboards. */
export function encodeRazerStandardMatrixEffect(effect) {
    const base = RAZER_KEYBOARD_WRITE.matrixEffectStandard;
    switch (effect.kind) {
        case "off":
            return { ...base, dataSize: 0x01, args: [0x00] };
        case "static":
            return { ...base, dataSize: 0x04, args: [0x06, effect.red, effect.green, effect.blue] };
        case "spectrum":
            return { ...base, dataSize: 0x01, args: [0x04] };
        case "wave":
            return { ...base, dataSize: 0x02, args: [0x01, Math.min(Math.max(effect.direction, 1), 2)] };
        case "breathing":
            if (effect.red === undefined || effect.green === undefined || effect.blue === undefined) {
                return { ...base, dataSize: 0x08, args: [0x03, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00] };
            }
            return { ...base, dataSize: 0x08, args: [0x03, 0x01, effect.red, effect.green, effect.blue, 0x00, 0x00, 0x00] };
        case "reactive":
            return { ...base, dataSize: 0x05, args: [0x02, Math.min(Math.max(effect.speed, 1), 4), effect.red, effect.green, effect.blue] };
    }
}
/** Select the custom matrix effect after writing row data (OpenRazer matrix_effect_custom). */
export function encodeRazerCustomMatrixEffect(style) {
    return style === "extended"
        ? { commandClass: 0x0f, commandId: 0x02, dataSize: 0x0c, args: [0x00, 0x00, 0x08] }
        : { commandClass: 0x03, commandId: 0x0a, dataSize: 0x02, args: [0x05, 0x00] };
}
/**
 * One physical matrix row segment, inclusive columns and RGB triplets.
 * OpenRazer fixes dataSize at 0x47 (extended) or 0x46 (standard); both fit
 * at most 22 RGB triplets inside that declared size.
 */
export function encodeRazerCustomMatrixRow(style, row, startColumn, colors) {
    if (!Number.isInteger(row) || row < 0 || row > 255 || !Number.isInteger(startColumn) || startColumn < 0 || startColumn > 255) {
        throw new RangeError("Matrix row and start column must be bytes.");
    }
    if (colors.length < 1 || colors.length > 22 || startColumn + colors.length > 256) {
        throw new RangeError("Matrix segment must contain 1–22 columns within the byte coordinate range.");
    }
    const rgb = [];
    for (const color of colors) {
        if (color.length !== 3 || color.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) {
            throw new RangeError("Matrix RGB channels must be bytes.");
        }
        rgb.push(...color);
    }
    const endColumn = startColumn + colors.length - 1;
    return style === "extended"
        ? { commandClass: 0x0f, commandId: 0x03, dataSize: 0x47, args: [0, 0, row, startColumn, endColumn, ...rgb] }
        : { commandClass: 0x03, commandId: 0x0b, dataSize: 0x46, args: [0xff, row, startColumn, endColumn, ...rgb] };
}
/** OpenRazer's standard LED state commands, GAME_LED=0x08. */
export function encodeRazerGameModeLed(storage, enabled) {
    return enabled === undefined
        ? { commandClass: 0x03, commandId: 0x80, dataSize: 0x03, args: [storage, 0x08] }
        : { commandClass: 0x03, commandId: 0x00, dataSize: 0x03, args: [storage, 0x08, enabled ? 1 : 0] };
}
const RAZER_BINDING_TYPE = {
    disable: 0x00,
    mouse: 0x01,
    keyboard: 0x02,
    macro: 0x03,
    multimedia: 0x0a,
    fn: 0x0c,
    keyboardTurbo: 0x0d,
};
function razerBindingPayload(binding) {
    switch (binding.kind) {
        case "disable":
            return { type: RAZER_BINDING_TYPE.disable, params: [] };
        case "fn":
            return { type: RAZER_BINDING_TYPE.fn, params: [0x01] };
        case "keyboard":
            return { type: RAZER_BINDING_TYPE.keyboard, params: [0x02, binding.modifiers, binding.usage] };
        case "mouse":
            return { type: RAZER_BINDING_TYPE.mouse, params: [binding.button] };
        case "multimedia":
            return { type: RAZER_BINDING_TYPE.multimedia, params: [binding.usage] };
        case "macro":
            return { type: RAZER_BINDING_TYPE.macro, params: [binding.index] };
    }
}
/**
 * Class 0x02 / id 0x0d keyboard binding. `key` is Razer's layout scancode, not
 * a USB HID usage.
 */
export function encodeRazerStandardBinding(key, binding) {
    const { type, params } = razerBindingPayload(binding);
    return {
        ...RAZER_KEYBOARD_WRITE.bindingStandard,
        dataSize: 0x0a,
        args: [0x01, key, 0x00, type, ...params],
    };
}
/**
 * Class 0x02 / id 0x12 analog-key binding. The actuation and release bytes are
 * the firmware's raw thresholds; this package does not convert millimetres to
 * them because no capture establishes the scale.
 */
export function encodeRazerAnalogBinding(slot, key, fnLayer, actuation, release, binding) {
    if (!Number.isInteger(slot) || slot < 1 || slot > 255)
        throw new RangeError("Razer onboard slot is invalid.");
    const { type, params } = razerBindingPayload(binding);
    return {
        ...RAZER_KEYBOARD_WRITE.bindingAnalog,
        dataSize: Math.max(0x0c, 0x07 + params.length),
        args: [slot, key, fnLayer ? 1 : 0, actuation, release, type, params.length, ...params],
    };
}
/** Decode the argument layout shared by analog binding reads and writes. */
export function decodeRazerAnalogBinding(args) {
    if (args.length < 7)
        return null;
    const paramLength = args[6] ?? 0;
    if (args.length < 7 + paramLength)
        return null;
    return {
        key: args[1] ?? 0,
        fnLayer: (args[2] ?? 0) !== 0,
        actuation: args[3] ?? 0,
        release: args[4] ?? 0,
        type: args[5] ?? 0,
        params: args.slice(7, 7 + paramLength),
    };
}
/** Decode the standard binding reply: `[0x01, key, 0, type, params…]`. */
export function decodeRazerStandardBinding(args) {
    if (args.length < 4)
        return null;
    return {
        key: args[1] ?? 0,
        fnLayer: false,
        actuation: 0,
        release: 0,
        type: args[3] ?? 0,
        params: args.slice(4),
    };
}
