export * from "./controls.js";
/**
 * Logitech HID++ 2.0 keyboard codec.
 *
 * Frame layout, feature ids and the feature functions below come from
 * Logitech's public HID++ 2.0 documentation and the OpenLogi reference pages
 * for `0x0000`, `0x0003`, `0x1004`, `0x8040`, `0x8060` and `0x8061`. The
 * keyboard product ids are the keyboard rows in G HUB's shipped device catalog.
 *
 * The driver lives in `../drivers/logitech/hid.ts`; this module does not touch
 * WebHID.
 */
export const LOGITECH_VENDOR_ID = 0x046d;
export const LOGITECH_HIDPP_USAGE_PAGE = 0xff00;
export const LOGITECH_HIDPP_BLUETOOTH_USAGE_PAGE = 0xff43;
export const LOGITECH_SHORT_REPORT_ID = 0x10;
export const LOGITECH_LONG_REPORT_ID = 0x11;
export const LOGITECH_SHORT_DATA_LENGTH = 6;
export const LOGITECH_LONG_DATA_LENGTH = 19;
export const LOGITECH_SOFTWARE_ID = 0x05;
export const LOGITECH_DIRECT_DEVICE_INDEX = 0xff;
export const LOGITECH_FEATURE = {
    root: 0x0000,
    featureSet: 0x0001,
    deviceInformation: 0x0003,
    deviceName: 0x0005,
    unifiedBattery: 0x1004,
    reprogControls: 0x1b04,
    analogKeys: 0x1b08,
    brightnessControl: 0x8040,
    colorLedEffects: 0x8070,
    rgbEffects: 0x8071,
    perKeyLightingV2: 0x8081,
    reportRate: 0x8060,
    extendedReportRate: 0x8061,
};
export const LOGITECH_HIDPP_ERRORS = {
    0x01: "unknown request",
    0x02: "invalid argument",
    0x03: "value out of range",
    0x04: "hardware error",
    0x05: "Logitech internal error",
    0x06: "invalid feature index",
    0x07: "invalid function",
    0x08: "device busy",
    0x09: "unsupported",
};
/**
 * Keyboard product ids from G HUB's device catalog, plus the separately
 * identified RAPID PIDs. Bluetooth (`b3xx`) and regional (`40xx`) SKUs share
 * the name with their wired (`c3xx`) sibling.
 */
export const LOGITECH_KEYBOARD_PRODUCTS = new Map([
    [0xc351, { name: "PRO X 60", wireless: true, verified: false }],
    [0xb37b, { name: "PRO X 60", wireless: true, verified: false }],
    [0x40af, { name: "PRO X 60", wireless: true, verified: false }],
    [0xc352, { name: "PRO X TKL", wireless: true, verified: false }],
    [0xb382, { name: "PRO X TKL", wireless: true, verified: false }],
    [0x40b0, { name: "PRO X TKL", wireless: true, verified: false }],
    [0xc35b, { name: "PRO X TKL RAPID", wireless: false, verified: false }],
    [0xc366, { name: "G316", wireless: false, verified: false }],
    [0xc361, { name: "G316 X", wireless: false, verified: false }],
    [0xc355, { name: "G515 LIGHTSPEED TKL", wireless: true, verified: false }],
    [0xb389, { name: "G515 LIGHTSPEED TKL", wireless: true, verified: false }],
    [0x40b4, { name: "G515 LIGHTSPEED TKL", wireless: true, verified: false }],
    [0xc358, { name: "G515 TKL", wireless: false, verified: false }],
    [0xc363, { name: "G515 RAPID TKL", wireless: false, verified: false }],
    [0xc35a, { name: "G517 LIGHTSPEED TKL", wireless: true, verified: false }],
    [0xb390, { name: "G517 LIGHTSPEED TKL", wireless: true, verified: false }],
    [0x40b9, { name: "G517 LIGHTSPEED TKL", wireless: true, verified: false }],
    [0xc348, { name: "G713", wireless: false, verified: false }],
    [0xc347, { name: "G715", wireless: true, verified: false }],
    [0xb368, { name: "G715", wireless: true, verified: false }],
    [0x40a2, { name: "G715", wireless: true, verified: false }],
    [0xc359, { name: "G915 X", wireless: true, verified: false }],
    [0xc356, { name: "G915 X LIGHTSPEED", wireless: true, verified: false }],
    [0xb38a, { name: "G915 X LIGHTSPEED", wireless: true, verified: false }],
    [0x40b5, { name: "G915 X LIGHTSPEED", wireless: true, verified: false }],
    [0xc357, { name: "G915 X LIGHTSPEED TKL", wireless: true, verified: false }],
    [0xb38b, { name: "G915 X LIGHTSPEED TKL", wireless: true, verified: false }],
    [0x40b6, { name: "G915 X LIGHTSPEED TKL", wireless: true, verified: false }],
]);
export const LOGITECH_KEYBOARD_PRODUCT_IDS = [...LOGITECH_KEYBOARD_PRODUCTS.keys()];
/**
 * Logitech receivers that forward HID++ to a paired keyboard. A receiver has
 * no keyboard product id of its own; the driver probes its pairing slots and
 * matches the reported model ids against `LOGITECH_KEYBOARD_PRODUCTS`.
 */
export const LOGITECH_RECEIVER_PRODUCTS = new Map([
    [0xc52b, "Unifying receiver"],
    [0xc532, "Unifying receiver"],
    [0xc539, "LIGHTSPEED receiver"],
    [0xc53a, "LIGHTSPEED receiver"],
    [0xc53d, "LIGHTSPEED receiver"],
    [0xc53f, "LIGHTSPEED receiver"],
    [0xc541, "LIGHTSPEED receiver"],
    [0xc543, "LIGHTSPEED receiver"],
    [0xc545, "LIGHTSPEED receiver"],
    [0xc547, "LIGHTSPEED receiver"],
    [0xc548, "Logi Bolt receiver"],
    [0xc54d, "LIGHTSPEED receiver"],
]);
export const LOGITECH_RECEIVER_PRODUCT_IDS = [...LOGITECH_RECEIVER_PRODUCTS.keys()];
/** HID++ 2.0 parameters are at most 16 bytes in a long report. */
export const LOGITECH_MAX_PARAMS = 16;
/** Build the report body (without the WebHID report id) for one request. */
export function encodeLogitechRequest(deviceIndex, featureIndex, functionId, params, long) {
    const length = long ? LOGITECH_LONG_DATA_LENGTH : LOGITECH_SHORT_DATA_LENGTH;
    const maxParams = long ? LOGITECH_MAX_PARAMS : 3;
    if (!Number.isInteger(functionId) || functionId < 0 || functionId > 0x0f)
        throw new RangeError("HID++ function id is a nibble from 0 to 15.");
    if (params.length > maxParams)
        throw new RangeError(`HID++ ${long ? "long" : "short"} request carries at most ${maxParams} parameters.`);
    const data = new Uint8Array(length);
    data[0] = deviceIndex;
    data[1] = featureIndex;
    data[2] = (functionId << 4) | LOGITECH_SOFTWARE_ID;
    data.set(params, 3);
    return { reportId: long ? LOGITECH_LONG_REPORT_ID : LOGITECH_SHORT_REPORT_ID, data };
}
/** Decode an input report body. Returns `null` for an unrelated report id. */
export function decodeLogitechResponse(reportId, data) {
    if (reportId !== LOGITECH_SHORT_REPORT_ID && reportId !== LOGITECH_LONG_REPORT_ID)
        return null;
    if (data.length < LOGITECH_SHORT_DATA_LENGTH)
        return null;
    const featureIndex = data[1] ?? 0;
    const functionId = ((data[2] ?? 0) >> 4) & 0x0f;
    const softwareId = (data[2] ?? 0) & 0x0f;
    if (featureIndex === 0xff) {
        // HID++ 2.0 error frame: [devIx, 0xff, reqFeatIx, reqFn|swId, errCode, ...].
        return {
            deviceIndex: data[0] ?? 0,
            featureIndex,
            functionId,
            softwareId,
            params: data.slice(3),
            errorCode: data[4] ?? 0,
            requestFeatureIndex: data[2] ?? 0,
            requestFunctionByte: data[3] ?? 0,
        };
    }
    return { deviceIndex: data[0] ?? 0, featureIndex, functionId, softwareId, params: data.slice(3), errorCode: null };
}
/** Root `getFeature` reply: `[index, type, version]`. */
export function decodeLogitechFeatureInfo(params) {
    const index = params[0] ?? 0;
    if (index === 0)
        return null;
    return { index, type: params[1] ?? 0, version: params[2] ?? 0 };
}
/** DeviceInformation `getDeviceInfo` reply. */
export function decodeLogitechDeviceInformation(params) {
    if (params.length < 15)
        return null;
    const unitId = [...params.slice(1, 5)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const transportBits = params[6] ?? 0;
    const transport = [
        transportBits & 0x08 ? "USB" : null,
        transportBits & 0x04 ? "eQuad" : null,
        transportBits & 0x02 ? "BTLE" : null,
        transportBits & 0x01 ? "Bluetooth" : null,
    ].filter((entry) => entry !== null);
    const modelIds = [];
    for (let offset = 7; offset <= 11; offset += 2) {
        const id = ((params[offset] ?? 0) << 8) | (params[offset + 1] ?? 0);
        if (id !== 0)
            modelIds.push(id);
    }
    return {
        entityCount: params[0] ?? 0,
        unitId,
        transport,
        modelIds,
        extendedModelId: params[13] ?? 0,
        serialNumber: ((params[14] ?? 0) & 0x01) !== 0,
    };
}
/** Decode the packed four-digit version/build fields from `getFwInfo`. */
function decodeBcd(value) {
    const hex = value.toString(16).padStart(4, "0");
    if (!/^\d{4}$/.test(hex))
        return Math.min(value, 9999);
    return Number(hex);
}
/** DeviceInformation `getFwInfo` reply. */
export function decodeLogitechFirmwareInfo(params) {
    if (params.length < 9)
        return null;
    const version = decodeBcd(((params[4] ?? 0) << 8) | (params[5] ?? 0));
    const build = decodeBcd(((params[6] ?? 0) << 8) | (params[7] ?? 0));
    const prefixBytes = params.slice(1, 4);
    const end = prefixBytes.indexOf(0);
    return {
        entityType: params[0] ?? 0,
        prefix: new TextDecoder().decode(end < 0 ? prefixBytes : prefixBytes.slice(0, end)),
        version: `${Math.floor(version / 100)}.${(version % 100).toString().padStart(2, "0")}`,
        build,
        active: ((params[8] ?? 0) & 0x01) !== 0,
    };
}
const BATTERY_LEVELS = {
    1: "critical",
    2: "low",
    4: "good",
    8: "full",
};
const BATTERY_STATUSES = {
    0: "discharging",
    1: "charging",
    2: "charging-nearly-full",
    3: "full",
    4: "charging-slow",
    5: "invalid",
    6: "thermal-error",
    7: "charging-error",
};
/** UnifiedBattery `getBatteryInfo` reply, plus whether a percentage gauge exists. */
export function decodeLogitechBattery(params, hasGauge) {
    return {
        percent: hasGauge ? params[0] ?? null : null,
        level: BATTERY_LEVELS[params[1] ?? 0] ?? null,
        status: BATTERY_STATUSES[params[2] ?? 0] ?? null,
    };
}
/** Extended report-rate bit mask in reply byte 1, bits 0..6. */
export function decodeLogitechReportRates(params) {
    const mask = params[1] ?? 0;
    const rates = [125, 250, 500, 1000, 2000, 4000, 8000];
    return rates.filter((_, index) => (mask & (1 << index)) !== 0);
}
/** Extended report-rate discriminant (0 = 125 Hz .. 6 = 8000 Hz). */
export function decodeLogitechReportRate(params) {
    const code = params[0] ?? 0xff;
    return code < 7 ? 125 * 2 ** code : null;
}
/** Inverse of `decodeLogitechReportRate`; `null` for an unrepresentable rate. */
export function encodeLogitechReportRate(hz) {
    const code = Math.log2(hz / 125);
    return Number.isInteger(code) && code >= 0 && code <= 6 ? code : null;
}
/** G HUB exposes two actuation tag families with this row layout. */
export const LOGITECH_ANALOG_ACTUATION_TAG_ID = 0x0123;
export const LOGITECH_ANALOG_RAPID_TRIGGER_TAG_ID = 0x0124;
export const LOGITECH_ANALOG_KEYS_TAG_ID = 0x1b08;
/** G HUB's 0x8102 function-6 request prefix. */
export function encodeLogitechTagStartRead(profile, tagId, args = []) {
    if (!Number.isInteger(profile) || profile < 0 || profile > 255 ||
        !Number.isInteger(tagId) || tagId < 0 || tagId > 65535 ||
        args.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
        throw new RangeError("Invalid Logitech tag read fields.");
    }
    return Uint8Array.from([profile, tagId >> 8, tagId & 0xff, ...args]);
}
/** G HUB's 0x8102 function-9 request prefix. */
export function encodeLogitechTagStartWrite(tagId, length, args = []) {
    if (!Number.isInteger(tagId) || tagId < 0 || tagId > 65535 ||
        !Number.isInteger(length) || length < 0 || length > 65535 ||
        args.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
        throw new RangeError("Invalid Logitech tag write fields.");
    }
    return Uint8Array.from([tagId >> 8, tagId & 0xff, length >> 8, length & 0xff, ...args]);
}
/** G HUB's 0x8102 function-10 frame: fragment number plus up to 15 bytes. */
export function encodeLogitechTagWriteFragment(index, data) {
    if (!Number.isInteger(index) || index < 0 || index > 255 || data.length > 15) {
        throw new RangeError("Invalid Logitech tag fragment.");
    }
    const frame = new Uint8Array(16);
    frame[0] = index;
    frame.set(data, 1);
    return frame;
}
/** Encode a 0x0123/0x0124/0x1B08 tag body; the session envelope is separate. */
export function encodeLogitechAnalogKeyTagRows(rows) {
    const result = new Uint8Array(rows.length * 3);
    rows.forEach(({ controlIndex, value }, index) => {
        if (!Number.isInteger(controlIndex) || controlIndex < 0 || controlIndex > 255 ||
            !Number.isInteger(value) || value < 0 || value > 65535) {
            throw new RangeError("Analog tag rows require an 8-bit control index and a 16-bit value.");
        }
        result[index * 3] = controlIndex;
        result[index * 3 + 1] = value >> 8;
        result[index * 3 + 2] = value & 0xff;
    });
    return result;
}
export function decodeLogitechAnalogKeyTagRows(bytes) {
    if (bytes.length % 3 !== 0)
        return null;
    const rows = [];
    for (let offset = 0; offset < bytes.length; offset += 3) {
        rows.push({ controlIndex: bytes[offset] ?? 0, value: ((bytes[offset + 1] ?? 0) << 8) | (bytes[offset + 2] ?? 0) });
    }
    return rows;
}
/** Change one raw actuation row while retaining every other decoded row. */
export function patchLogitechAnalogKeyTagRow(bytes, controlIndex, value) {
    const rows = decodeLogitechAnalogKeyTagRows(bytes);
    if (!rows)
        throw new Error("Invalid Logitech analog key tag body.");
    if (!Number.isInteger(controlIndex) || controlIndex < 0 || controlIndex > 255 ||
        !Number.isInteger(value) || value < 0 || value > 65535) {
        throw new RangeError("Analog tag rows require an 8-bit control index and a 16-bit value.");
    }
    if (new Set(rows.map((row) => row.controlIndex)).size !== rows.length) {
        throw new Error("Duplicate Logitech analog key tag rows cannot be edited safely.");
    }
    const row = rows.find((entry) => entry.controlIndex === controlIndex);
    if (row)
        row.value = value;
    else
        rows.push({ controlIndex, value });
    return encodeLogitechAnalogKeyTagRows(rows);
}
/** BrightnessControl `getInfo` + `getBrightness` replies. */
export function decodeLogitechBrightnessInfo(params) {
    if (params.length < 7)
        return null;
    const max = ((params[0] ?? 0) << 8) | (params[1] ?? 0);
    const steps = ((params[6] ?? 0) << 8) | (params[2] ?? 0);
    const capabilities = params[3] ?? 0;
    const min = ((params[4] ?? 0) << 8) | (params[5] ?? 0);
    return { min, max, steps, illumination: (capabilities & 0x04) !== 0 };
}
/** BrightnessControl `getBrightness` reply. */
export function decodeLogitechBrightness(params) {
    if (params.length < 2)
        return null;
    return ((params[0] ?? 0) << 8) | (params[1] ?? 0);
}
/** Decode one 0x8081 presence page (14 bytes after the two prefix bytes). */
export function decodeLogitechZonePresence(params, page) {
    const zones = [];
    for (let byte = 0; byte < 14; byte += 1) {
        const value = params[2 + byte] ?? 0;
        for (let bit = 0; bit < 8; bit += 1) {
            if ((value & (1 << bit)) === 0)
                continue;
            const zone = page * 112 + byte * 8 + bit;
            if (zone <= 0xff)
                zones.push(zone);
        }
    }
    return zones;
}
/** HID++ 0x8070 info: one zone count, BE capability masks. */
export function decodeLogitechLegacyLightingInfo(params) {
    if (params.length < 5)
        return null;
    return { zoneCount: params[0], canReadEffect: (((params[3] << 8) | params[4]) & 1) !== 0 };
}
/** 0x8070 getZoneInfo (fn 1) response; reject a mismatched zone echo. */
export function decodeLogitechLegacyZoneInfo(params, zoneIndex) {
    if (params.length < 5 || params[0] !== zoneIndex)
        return null;
    return { location: (params[1] << 8) | params[2], effectCount: params[3] };
}
/** 0x8070 getZoneEffectInfo (fn 2) response. */
export function decodeLogitechLegacyEffectInfo(params, zoneIndex, ordinal) {
    if (params.length < 8 || params[0] !== zoneIndex || params[1] !== ordinal)
        return null;
    return { index: ordinal, id: (params[2] << 8) | params[3], period: (params[6] << 8) | params[7] };
}
const LOGITECH_RGB_EFFECT_IDS = {
    0x00: "Off",
    0x01: "Static",
    0x03: "Cycling",
    0x04: "Wave",
    0x0a: "Breathing single",
    0x15: "Cycling",
    0x16: "Wave",
};
export function logitechRgbMode(effectId) {
    return LOGITECH_RGB_EFFECT_IDS[effectId] ?? null;
}
