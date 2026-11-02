export const RAWM_VENDOR_ID = 0x1915;
export const RAWM_USAGE_PAGE = 0xff00;
export const RAWM_USAGE = 0x01;
export const RAWM_REPORT_ID = 0;
export const RAWM_PACKET_SIZE = 64;
/** Product IDs published by RAWM HUB's WebHID client. */
export const RAWM_DEVICES = new Map([
    [0x2328, { name: "Blade 1", receiver: false, verified: true }],
    [0x2329, { name: "ML01", receiver: false, verified: true }],
    [0x232a, { name: "RAWM receiver", receiver: true, verified: true }],
    [0x232b, { name: "RAWM 8K receiver", receiver: true, verified: true }],
    [0x232c, { name: "MH01", receiver: false, verified: true }],
    [0x232d, { name: "SL01", receiver: false, verified: true }],
    [0x232e, { name: "SH01", receiver: false, verified: true }],
    [0x232f, { name: "SH01", receiver: false, verified: true }],
    [0x2330, { name: "SH01 Pro", receiver: false, verified: true }],
    [0x2331, { name: "MH01 Pro", receiver: false, verified: true }],
    [0x2332, { name: "SH01 Pro", receiver: false, verified: true }],
    [0x2333, { name: "ES21", receiver: false, verified: true }],
    [0x2334, { name: "ES21 Pro", receiver: false, verified: true }],
    [0x2335, { name: "RAWM 8K receiver", receiver: true, verified: true }],
    [0x2336, { name: "DH8 receiver", receiver: true, verified: true }],
    [0x2337, { name: "ES21M", receiver: false, verified: true }],
    [0x2338, { name: "ER21 Pro", receiver: false, verified: true }],
    [0x2339, { name: "ER21M", receiver: false, verified: true }],
]);
export const RAWM_PRODUCT_IDS = new Set(RAWM_DEVICES.keys());
const numberValue = (value) => typeof value === "number" ? value : undefined;
const boolValue = (value) => typeof value === "number" ? value !== 0 : undefined;
const signedByteValue = (value) => {
    if (typeof value !== "number")
        return undefined;
    const byte = value & 0xff;
    return byte >= 0x80 ? byte - 0x100 : byte;
};
export function parseRawmIdentity(json) {
    const value = JSON.parse(json);
    const glass = value.gm;
    return {
        revision: typeof (value.revision ?? value.r) === "string" ? String(value.revision ?? value.r) : undefined,
        battery: numberValue(value.battery),
        charging: boolValue(value.chr),
        dpi: numberValue(value.cpi),
        pollingRate: numberValue(value.polling),
        dpiLevels: Array.isArray(value.cpi_l) ? value.cpi_l.filter((item) => typeof item === "number") : undefined,
        powerMode: numberValue(value.pm),
        deviceName: typeof value.dn === "string" ? value.dn : undefined,
        productId: numberValue(value.pi),
        lod: numberValue(value.lod),
        keyDelay: Array.isArray(value.kd) ? value.kd.filter((item) => typeof item === "number") : undefined,
        motionSync: boolValue(value.ms),
        angleTuning: signedByteValue(value.at),
        angleSnapping: boolValue(value.as),
        rippleControl: boolValue(value.rctrl),
        sleepTime: numberValue(value.st),
        wired: boolValue(value.wired),
        sensor: typeof value.sst === "string" ? value.sst : undefined,
        glassMode: Array.isArray(glass) ? numberValue(glass[0]) : numberValue(glass),
        glassModeEnabled: Array.isArray(glass) ? numberValue(glass[1]) : glass === undefined ? undefined : 1,
        light: numberValue(value.light),
        cpiLevelColors: Array.isArray(value.cpi_l_c) ? value.cpi_l_c.filter((item) => typeof item === "number") : undefined,
        onboard: numberValue(value.ob),
        txOutputPower: numberValue(value.top),
        batteryLevels: Array.isArray(value.bl) ? value.bl.filter((item) => typeof item === "number") : undefined,
        autoTxPower: numberValue(value.atp),
        onboardStatus: Array.isArray(value.ocs) ? value.ocs.filter((item) => typeof item === "number") : undefined,
        crcSupported: boolValue(value.crc),
    };
}
function requireNumber(value, name) {
    if (value === undefined)
        throw new Error(`RAWM did not report ${name}; refusing a partial configuration write.`);
    return value;
}
function requireArray(value, name) {
    if (!value)
        throw new Error(`RAWM did not report ${name}; refusing a partial configuration write.`);
    return value;
}
function requireBoolean(value, name) {
    if (value === undefined)
        throw new Error(`RAWM did not report ${name}; refusing a partial configuration write.`);
    return value;
}
export function rawmCrc16(bytes) {
    let crc = 0xffff;
    for (const byte of bytes) {
        crc = ((crc >> 8) | (crc << 8)) & 0xffff;
        crc ^= byte;
        crc ^= (crc & 0xff) >> 4;
        crc ^= (crc << 12) & 0xffff;
        crc ^= ((crc & 0xff) << 5) & 0xffff;
    }
    return crc & 0xffff;
}
function finishRawmCommand(command, crcSupported) {
    const base = Uint8Array.from(command);
    const length = base.length;
    base[0] = ((length >> 4) & 0xf0) | (base[0] & 0x0f);
    base[1] = length & 0xff;
    if (!crcSupported)
        return base;
    const crc = rawmCrc16(base);
    const wrapped = new Uint8Array(length + 5);
    wrapped[0] = ((wrapped.length >> 4) & 0xf0) | 0x03;
    wrapped[1] = wrapped.length & 0xff;
    wrapped[2] = 0x24;
    wrapped[3] = crc & 0xff;
    wrapped[4] = crc >> 8;
    wrapped.set(base, 5);
    return wrapped;
}
/** Exact CONFIG_TYPE_MOUSE_PARAM record emitted by RAWM HUB. */
export function buildRawmMouseParams(identity) {
    const dpi = requireNumber(identity.dpi, "current DPI");
    const polling = requireNumber(identity.pollingRate, "polling rate");
    const light = identity.light ?? 0x30;
    const levels = requireArray(identity.dpiLevels, "DPI stages");
    const colors = requireArray(identity.cpiLevelColors, "DPI stage colors");
    const keyDelay = requireArray(identity.keyDelay, "button debounce values");
    const batteryLevels = identity.batteryLevels ?? [0x1004, 0x0fa0, 0x0f6e, 0x0f3c, 0x0f0a, 0x0ed8, 0x0ea6, 0x0e74, 0x0dac, 0x0ce4, 0x0c1c];
    const onboardStatus = identity.onboardStatus ?? [0x84, 0x82, 0x83, 0x81];
    const bytes = [0x03, 0, 0x15];
    const wideDpi = (dpi & 0xffff0000) !== 0;
    bytes.push(wideDpi ? 0 : dpi & 0xff, wideDpi ? 0 : dpi >> 8 & 0xff);
    bytes.push(polling & 0xff, polling >> 8 & 0xff, light);
    const wideLevels = levels.some((value) => (value & 0xffff0000) !== 0);
    bytes.push(wideLevels ? 0 : levels.length);
    if (!wideLevels)
        for (const value of levels)
            bytes.push(value & 0xff, value >> 8 & 0xff);
    bytes.push(identity.onboard ?? 0, identity.powerMode ?? 2);
    bytes.push(wideDpi ? dpi & 0xff : 0, wideDpi ? dpi >> 8 & 0xff : 0, wideDpi ? dpi >> 16 & 0xff : 0, wideDpi ? dpi >> 24 & 0xff : 0);
    bytes.push(wideLevels ? levels.length : 0);
    if (wideLevels)
        for (const value of levels)
            bytes.push(value & 0xff, value >> 8 & 0xff, value >> 16 & 0xff, value >> 24 & 0xff);
    bytes.push(requireNumber(identity.lod, "lift-off distance"), keyDelay.length, ...keyDelay);
    bytes.push(Number(requireBoolean(identity.motionSync, "Motion Sync")), requireNumber(identity.angleTuning, "angle tuning") & 0xff, Number(requireBoolean(identity.angleSnapping, "angle snapping")), Number(requireBoolean(identity.rippleControl, "ripple control")));
    bytes.push(colors.length, ...colors.map((color) => color & 7));
    bytes.push(identity.txOutputPower ?? 0xff, batteryLevels.length);
    for (const value of batteryLevels)
        bytes.push(value & 0xff, value >> 8 & 0xff);
    bytes.push(identity.autoTxPower ?? 1, onboardStatus.length, ...onboardStatus);
    bytes.push(identity.glassModeEnabled ?? 0);
    return finishRawmCommand(bytes, identity.crcSupported === true);
}
export function buildRawmSleepCommand(seconds, crcSupported = false) {
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 0xffff)
        throw new RangeError("RAWM sleep timeout must fit in 16 bits.");
    return finishRawmCommand([0x03, 0, 0x21, seconds & 0xff, seconds >> 8], crcSupported);
}
export function frameRawmEvents(payload, channel) {
    const maximum = channel === undefined ? 63 : 62;
    const frames = [];
    for (let offset = 0; offset < payload.length; offset += maximum) {
        frames.push(frameRawmEvent(payload.slice(offset, offset + maximum), channel));
    }
    return frames;
}
/** Builds the query packet used by RAWM HUB, before 64-byte HID framing. */
export function buildRawmQuery(timestampSeconds = Math.floor(Date.now() / 1000)) {
    const packet = new Uint8Array(13);
    packet[0] = 0x01;
    packet[1] = packet.length;
    packet[2] = 0x03;
    for (let index = 0; index < 8; index += 1) {
        packet[5 + index] = Math.floor(timestampSeconds / (2 ** (index * 8))) & 0xff;
    }
    return packet;
}
export function frameRawmEvent(payload, channel) {
    if (payload.length > (channel === undefined ? 63 : 62))
        throw new RangeError("RAWM event payload exceeds one HID report.");
    const packet = new Uint8Array(RAWM_PACKET_SIZE);
    if (channel === undefined) {
        packet[0] = 0x80 | payload.length;
        packet.set(payload, 1);
    }
    else {
        packet[0] = 0xc0 | (channel & 0x3f);
        packet[1] = 0x80 | payload.length;
        packet.set(payload, 2);
    }
    return packet;
}
export function rawmEventPayload(report, channel) {
    let offset = 0;
    if ((report[0] & 0xc0) === 0xc0) {
        if (channel !== undefined && (report[0] & 0x3f) !== channel)
            return null;
        offset = 1;
    }
    if ((report[offset] & 0xc0) !== 0x80)
        return null;
    const length = report[offset] & 0x3f;
    return report.slice(offset + 1, offset + 1 + length);
}
export function parseRawmQueryResult(stream) {
    const sync = [0xff, 0xff, 0xff, 0xff];
    for (let index = 0; index <= stream.length - sync.length; index += 1) {
        if (!sync.every((byte, offset) => stream[index + offset] === byte))
            continue;
        const start = index + sync.length;
        if (stream.length < start + 2)
            continue;
        // Receiver telemetry also contains runs of 0xff. Only a marker followed by
        // CMD_RESULT (2) begins the JSON identity response.
        if ((stream[start] & 0x0f) !== 0x02)
            continue;
        const length = ((stream[start] & 0xf0) << 4) | stream[start + 1];
        // A telemetry record can accidentally look like a CMD_RESULT header with
        // an impossible length. Do not let it shadow a later complete response.
        if (length < 2 || stream.length < start + length)
            continue;
        let body = stream.slice(start + 2, start + length);
        if (body.at(-1) === 0)
            body = body.slice(0, -1);
        try {
            return parseRawmIdentity(new TextDecoder().decode(body));
        }
        catch {
            // A complete telemetry record can also collide with the result command
            // nibble. Keep looking for the genuine JSON response after it.
        }
    }
    return null;
}
