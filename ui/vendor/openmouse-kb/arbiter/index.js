/**
 * Arbiter Studio keyboard protocol, implemented from static analysis of the
 * vendor's public web configurator (see docs/arbiter-support.md). No Arbiter
 * keyboard has been exercised through this package: every catalog entry is
 * `verified: false`.
 */
import { ARBITER_LAYOUTS } from "./layouts.js";
export * from "./layouts.js";
export const ARBITER_VENDOR_ID = 0x1a81;
export const ARBITER_VENDOR_ID_ALT = 0x371c;
export const ARBITER_CONFIG_USAGE = 1;
export const ARBITER_REPORT_ID = 0;
export const ARBITER_FRAME_SIZE = 64;
/** Keys carried by one long-packet table read or write (`keyCode, param` or `make, break` pairs). */
export const ARBITER_KEYS_PER_PACKET = 29;
export const ARBITER_LIGHT_DATA_SIZE = 26;
export const ARBITER_LIGHT_COLOR_SLOTS = 7;
export const ARBITER_USER_MODE_SIZE = 6;
/** A reply starting `[0x04, 0xC9]` announces a profile switch on the PRO models. */
export const ARBITER_PROFILE_CHANGED = [0x04, 0xc9];
/**
 * Key codes the vendor's label table gives a name of its own. They collide with
 * .NET `Keys` names (249 is `EraseEof` there), so the layouts' `name` field is
 * not the label to show for these.
 */
export const ARBITER_KEY_CODE = {
    /** "Fn" on the FN layer's Alt positions. */
    fnLayer: 242,
    /** "Fn" on the main layer. */
    fn: 245,
    /** "SuperTap". */
    superTap: 249,
};
export const ARBITER_COMMAND = {
    setTravel: 0,
    getTravel: 1,
    getFirmware: 2,
    getSerial: 13,
    setLightEffect: 24,
    getLightEffect: 25,
    setKeyMapping: 26,
    getKeyMapping: 27,
    setBoardProfile: 38,
    setUserMode: 52,
    getUserMode: 53,
};
/** Packet type bits OR-ed into the command byte. */
export const ARBITER_PACKET = { short: 0x00, long: 0x40 };
export const ARBITER_STATUS = [
    "Success", "Busy", "UnexpectedError", "NoSupport", "DeviceIsOffline", "BadDevice",
    "BadData", "DeviceIsNotExisted", "NoMoreData", "MemeryNoEnough", "FwUpdating",
];
export const ARBITER_LIGHT_EFFECTS = [
    "Spectral_Cycle", "Static", "L_R_Surf", "Breath", "Snake", "Magnetic", "Rotate", "M_Surf",
    "Colorful_Fountain", "Laser", "Cross_Surf", "Traffic", "Rippling", "Dance_Macabre",
    "Rand_Fountatin", "Love",
];
const product = (name, vendorId, productId, usagePage, protocol, travelKeys, bindingKeys, layers, profiles, superTap) => ({
    name, vendorId, productId, usagePage, protocol, travelKeys, bindingKeys, layers, profiles, superTap, verified: false,
});
/**
 * One entry per vendor id, product id and usage page the vendor bundle defines.
 *
 * Table sizes are wire entries, which can differ from the vendor's key matrix:
 * the `s2` board's matrix has a placeholder at index 28 that its decoders skip
 * (69 of 70 entries), and the 75 PRO's matrix ends in a placeholder that the
 * key mapping decoders drop (81 of 82 per layer) while its travel table keeps
 * all 82.
 */
export const ARBITER_PRODUCTS = [
    product("Arbiter Polar 65", ARBITER_VENDOR_ID, 0x2072, 0xff01, "yl", 68, 68, 1, 1, false),
    product("Arbiter Polar 65", ARBITER_VENDOR_ID, 0x2072, 0xff02, "yl", 68, 68, 1, 1, true),
    product("Polar 65", ARBITER_VENDOR_ID, 0x208e, 0xff02, "yl", 68, 68, 1, 1, true),
    product("Nimbus 65", ARBITER_VENDOR_ID, 0x2077, 0xff01, "yl", 68, 68, 1, 1, false),
    product("Polar 65", ARBITER_VENDOR_ID_ALT, 0xa005, 0xff02, "yl", 68, 68, 1, 1, true),
    product("Arbiter Polar 65", ARBITER_VENDOR_ID_ALT, 0xa006, 0xff01, "s2", 69, 69, 1, 1, true),
    product("Polar 65 PRO", ARBITER_VENDOR_ID_ALT, 0xa003, 0xff02, "i2", 68, 68, 2, 3, true),
    // 0xA009 ("Polar 65+") is not in the vendor bundle analysed 2026-10-30,
    // but the current vendor app (app2.arbiterstudio.com) pairs product
    // 40969 strictly with usagePage 65282 (0xFF02) and only claims devices
    // whose collections expose that page. The board also exposes an 0xFF01
    // collection, but driving it gets no reply (see #9); the live
    // configuration interface is the 0xFF02 one, on USB interface 3
    // (all vendor-app traffic flows over endpoints 0x04/0x84, interface 2
    // is silent). Wire sizes come from a USB capture of the vendor app:
    // travel writes total 3 (29+29+10 = 68), key-mapping writes total 5
    // (29x4+20 = 136 = 2 layers x 68), SetBoardProfile values 0-2, and
    // Get/SetUserMode traffic, matching the i2 (65 PRO) class.
    product("Polar 65+", ARBITER_VENDOR_ID_ALT, 0xa009, 0xff02, "i2", 68, 68, 2, 3, true),
    product("Polar 75 PRO", ARBITER_VENDOR_ID_ALT, 0xa001, 0xff02, "u2", 82, 81, 2, 3, true),
];
/** The catalog entry for an exact vendor id, product id and usage page. */
export function arbiterProduct(vendorId, productId, usagePage) {
    return ARBITER_PRODUCTS.find((entry) => entry.vendorId === vendorId && entry.productId === productId && entry.usagePage === usagePage);
}
export function arbiterIsPro(entry) {
    return entry.protocol === "i2" || entry.protocol === "u2";
}
/** The vendor's key matrix and factory layers for this model. */
export function arbiterLayout(entry) {
    return ARBITER_LAYOUTS[entry.protocol];
}
function arbiterTableSize(entry, table) {
    return table === "travel" ? entry.travelKeys : entry.bindingKeys;
}
/** Matrix index of the `s2` board's placeholder, which its wire tables skip. */
const S2_PLACEHOLDER = 28;
/**
 * The matrix position a wire table entry belongs to, or `null` when the index
 * is outside the table. Entries are in wire order: the `s2` board's tables skip
 * matrix index 28, and the 75 PRO's key mapping omits its final placeholder
 * (its travel table keeps it). Every other model is the identity.
 */
export function arbiterWireToMatrix(entry, table, wireIndex) {
    if (!Number.isInteger(wireIndex) || wireIndex < 0 || wireIndex >= arbiterTableSize(entry, table))
        return null;
    return entry.protocol === "s2" && wireIndex >= S2_PLACEHOLDER ? wireIndex + 1 : wireIndex;
}
/** The wire entry for a matrix position, or `null` for a placeholder that is not on the wire. */
export function arbiterMatrixToWire(entry, table, matrixIndex) {
    if (!Number.isInteger(matrixIndex) || matrixIndex < 0 || matrixIndex >= arbiterLayout(entry).matrix.length)
        return null;
    if (entry.protocol === "s2") {
        if (matrixIndex === S2_PLACEHOLDER)
            return null;
        return matrixIndex > S2_PLACEHOLDER ? matrixIndex - 1 : matrixIndex;
    }
    return matrixIndex < arbiterTableSize(entry, table) ? matrixIndex : null;
}
/** Packets in a travel table: one `make, break` pair per key. */
export function arbiterTravelPackets(entry) {
    return Math.ceil(entry.travelKeys / ARBITER_KEYS_PER_PACKET);
}
/**
 * Packets in the key mapping table. The table is flat: every key of layer 0,
 * then every key of layer 1. The vendor app sends 3 packets on the 65s, 5 on the
 * 65 PRO (2 x 68 keys) and 6 on the 75 PRO (2 x 81 keys).
 */
export function arbiterKeyMappingPackets(entry) {
    return Math.ceil((entry.bindingKeys * entry.layers) / ARBITER_KEYS_PER_PACKET);
}
/** `(85 - sum(bytes 0..62)) & 0xFF`, stored in the final byte. */
export function arbiterChecksum(frame) {
    let sum = 0;
    for (let index = 0; index < ARBITER_FRAME_SIZE - 1; index += 1)
        sum += frame[index] ?? 0;
    return (85 - sum) & 0xff;
}
/** Longest data field a frame can carry: bytes 4..62. */
const MAX_DATA = ARBITER_FRAME_SIZE - 5;
/** Build one 64-byte request. `data` is zero-padded; an oversize payload is rejected. */
export function encodeArbiterRequest(command, packetType, data = []) {
    if (!Object.values(ARBITER_COMMAND).includes(command))
        throw new RangeError("Unsupported Arbiter command.");
    if (data.length > MAX_DATA)
        throw new RangeError("Arbiter payload exceeds 59 bytes.");
    for (const byte of data) {
        if (!Number.isInteger(byte) || byte < 0 || byte > 0xff)
            throw new RangeError("Arbiter payload byte is invalid.");
    }
    const frame = new Uint8Array(ARBITER_FRAME_SIZE);
    frame[0] = 0;
    frame[1] = command | packetType;
    frame[2] = 0;
    frame[3] = data.length;
    frame.set(data, 4);
    frame[ARBITER_FRAME_SIZE - 1] = arbiterChecksum(frame);
    return frame;
}
/** Decode one reply. `null` means the length, checksum or declared size is unusable. */
export function decodeArbiterReply(frame) {
    if (frame.length !== ARBITER_FRAME_SIZE || frame[ARBITER_FRAME_SIZE - 1] !== arbiterChecksum(frame))
        return null;
    const size = frame[3] === 0xff ? 0 : (frame[3] ?? 0);
    if (size > MAX_DATA)
        return null;
    return { command: (frame[1] ?? 0) & 0x3f, status: frame[2] ?? 0, data: frame.slice(4, 4 + size) };
}
/** True for the unsolicited profile-switch report the PRO models send. */
export function isArbiterProfileChanged(frame) {
    return frame[0] === ARBITER_PROFILE_CHANGED[0] && frame[1] === ARBITER_PROFILE_CHANGED[1];
}
export function arbiterStatusName(status) {
    return ARBITER_STATUS[status] ?? `Status ${status}`;
}
/** Short request with no payload: firmware, serial, light effect and user-mode reads. */
export function encodeArbiterShortRead(command) {
    return encodeArbiterRequest(command, ARBITER_PACKET.short);
}
/** Packet header byte: low nibble index, high nibble total packet count. */
export function arbiterPacketHeader(index, total) {
    if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || total > 15 || index < 0 || index >= total) {
        throw new RangeError("Arbiter packet index must be below a total of 1-15.");
    }
    return index | (total << 4);
}
/** Long read of one table packet (travel or key mapping). */
export function encodeArbiterTableRead(command, index, total) {
    return encodeArbiterRequest(command, ARBITER_PACKET.long, [arbiterPacketHeader(index, total)]);
}
/** Split a table reply's data into its packet header and key pairs. */
export function decodeArbiterTablePacket(reply) {
    const header = reply.data[0];
    if (header === undefined || reply.data.length % 2 !== 1)
        return null;
    const index = header & 0x0f;
    const total = header >> 4;
    if (total < 1 || index >= total)
        return null;
    return { index, total, entries: reply.data.slice(1) };
}
/**
 * Travel values are tenths of a millimetre. The vendor app labels its sliders
 * with `value / 10` mm, and limits actuation to 1-38 (0.1-3.8 mm) and rapid
 * trigger to 1-24 (0.1-2.4 mm) on every model. The firmware's own limits have
 * not been tested on hardware, so writes are held to the vendor app's ranges.
 */
export const ARBITER_TRAVEL_UNIT_MM = 0.1;
export const ARBITER_ACTUATION_RANGE = { min: 1, max: 38 };
export const ARBITER_RAPID_TRIGGER_RANGE = { min: 1, max: 24 };
/** Millimetres for a raw travel value. */
export function arbiterTravelToMm(value) {
    return Math.round(value) / 10;
}
/** The raw travel value for a distance in millimetres, rounded to the nearest 0.1 mm. */
export function arbiterMmToTravel(mm) {
    if (!Number.isFinite(mm))
        throw new RangeError("Distance must be a number of millimetres.");
    return Math.round(mm * 10);
}
/** Throws unless `value` is a whole number inside the vendor app's range for that setting. */
export function assertArbiterTravelInRange(kind, value) {
    const range = kind === "actuation" ? ARBITER_ACTUATION_RANGE : ARBITER_RAPID_TRIGGER_RANGE;
    if (!Number.isInteger(value) || value < range.min || value > range.max) {
        throw new RangeError(`Arbiter ${kind === "actuation" ? "actuation" : "rapid trigger"} must be ${range.min}-${range.max} `
            + `(${arbiterTravelToMm(range.min)}-${arbiterTravelToMm(range.max)} mm).`);
    }
}
export function decodeArbiterTravelPacket(reply) {
    if (reply.command !== ARBITER_COMMAND.getTravel)
        return null;
    const packet = decodeArbiterTablePacket(reply);
    if (!packet)
        return null;
    const keys = [];
    for (let offset = 0; offset < packet.entries.length; offset += 2) {
        keys.push({ make: packet.entries[offset], break: packet.entries[offset + 1] });
    }
    return { index: packet.index, total: packet.total, keys };
}
function encodeTablePacket(command, index, total, pairs) {
    if (pairs.length < 1 || pairs.length > ARBITER_KEYS_PER_PACKET) {
        throw new RangeError("An Arbiter table packet carries 1-29 keys.");
    }
    return encodeArbiterRequest(command, ARBITER_PACKET.long, [
        arbiterPacketHeader(index, total),
        ...pairs.flatMap(([first, second]) => [first, second]),
    ]);
}
/** Write one packet of `make, break` pairs. */
export function encodeArbiterTravelWrite(index, total, keys) {
    for (const key of keys) {
        for (const value of [key.make, key.break]) {
            if (!Number.isInteger(value) || value < 0 || value > 0xff)
                throw new RangeError("Arbiter travel values are whole numbers from 0 to 255.");
        }
    }
    return encodeTablePacket(ARBITER_COMMAND.setTravel, index, total, keys.map((key) => [key.make, key.break]));
}
export function decodeArbiterKeyMappingPacket(reply) {
    if (reply.command !== ARBITER_COMMAND.getKeyMapping)
        return null;
    const packet = decodeArbiterTablePacket(reply);
    if (!packet)
        return null;
    const bindings = [];
    for (let offset = 0; offset < packet.entries.length; offset += 2) {
        bindings.push({ keyCode: packet.entries[offset], param: packet.entries[offset + 1] });
    }
    return { index: packet.index, total: packet.total, bindings };
}
/** Write one packet of `keyCode, param` pairs. */
export function encodeArbiterKeyMappingWrite(index, total, bindings) {
    for (const binding of bindings) {
        for (const value of [binding.keyCode, binding.param]) {
            if (!Number.isInteger(value) || value < 0 || value > 0xff)
                throw new RangeError("Arbiter key bindings are whole numbers from 0 to 255.");
        }
    }
    return encodeTablePacket(ARBITER_COMMAND.setKeyMapping, index, total, bindings.map((b) => [b.keyCode, b.param]));
}
/** Decode the 26-byte light effect payload. */
export function decodeArbiterLightEffect(reply) {
    if (reply.command !== ARBITER_COMMAND.getLightEffect || reply.data.length !== ARBITER_LIGHT_DATA_SIZE)
        return null;
    const data = reply.data;
    const colors = [];
    for (let slot = 0; slot < ARBITER_LIGHT_COLOR_SLOTS; slot += 1) {
        const base = 5 + slot * 3;
        colors.push({ red: data[base], green: data[base + 1], blue: data[base + 2] });
    }
    return { on: data[0] > 0, effect: data[1], brightness: data[2], speed: data[3], colorIndex: data[4], colors };
}
/** Encode a light effect write; every field is validated, and all 7 colours are required. */
export function encodeArbiterLightEffectWrite(light) {
    if (!Number.isInteger(light.effect) || light.effect < 0 || light.effect >= ARBITER_LIGHT_EFFECTS.length) {
        throw new RangeError("Arbiter light effect is not one of the 16 known effects.");
    }
    if (light.colors.length !== ARBITER_LIGHT_COLOR_SLOTS)
        throw new RangeError("Arbiter light effects carry exactly 7 colours.");
    const scalars = [light.brightness, light.speed, light.colorIndex];
    const channels = light.colors.flatMap((color) => [color.red, color.green, color.blue]);
    for (const value of [...scalars, ...channels]) {
        if (!Number.isInteger(value) || value < 0 || value > 0xff)
            throw new RangeError("Arbiter light values are whole numbers from 0 to 255.");
    }
    return encodeArbiterRequest(ARBITER_COMMAND.setLightEffect, ARBITER_PACKET.short, [
        light.on ? 1 : 0, light.effect, light.brightness, light.speed, light.colorIndex, ...channels,
    ]);
}
/** Select an on-board profile (0-based). */
export function encodeArbiterBoardProfile(profile, profileCount) {
    if (!Number.isInteger(profile) || profile < 0 || profile >= profileCount) {
        throw new RangeError(`Arbiter profile must be 0-${profileCount - 1} for this model.`);
    }
    return encodeArbiterRequest(ARBITER_COMMAND.setBoardProfile, ARBITER_PACKET.short, [profile]);
}
export function decodeArbiterUserMode(reply) {
    if (reply.command !== ARBITER_COMMAND.getUserMode || reply.data.length !== ARBITER_USER_MODE_SIZE)
        return null;
    const data = reply.data;
    return {
        layoutIndex: data[0], mode: data[1], checkFlag: data[2],
        flag: data[3] & 0x7f, alternative: data[3] >> 7, keyIndex: [data[4], data[5]],
    };
}
export function encodeArbiterUserModeWrite(mode) {
    const bytes = [mode.layoutIndex, mode.mode, mode.checkFlag, mode.keyIndex[0], mode.keyIndex[1]];
    for (const value of bytes) {
        if (!Number.isInteger(value) || value < 0 || value > 0xff)
            throw new RangeError("Arbiter user-mode values are whole numbers from 0 to 255.");
    }
    if (!Number.isInteger(mode.flag) || mode.flag < 0 || mode.flag > 0x7f)
        throw new RangeError("Arbiter user-mode flag is 0-127.");
    if (mode.alternative !== 0 && mode.alternative !== 1)
        throw new RangeError("Arbiter user-mode alternative is 0 or 1.");
    return encodeArbiterRequest(ARBITER_COMMAND.setUserMode, ARBITER_PACKET.short, [
        mode.layoutIndex, mode.mode, mode.checkFlag, mode.flag | (mode.alternative << 7), mode.keyIndex[0], mode.keyIndex[1],
    ]);
}
/** Firmware reply: byte 0 is the low and byte 7 the high version byte, shown as `V{high}{low}`. */
export function decodeArbiterFirmware(reply) {
    if (reply.command !== ARBITER_COMMAND.getFirmware || reply.data.length < 8)
        return null;
    const hex = (value) => value.toString(16).padStart(2, "0");
    return `V${hex(reply.data[7])}${hex(reply.data[0])}`;
}
/** Serial reply: the vendor app concatenates each byte as unpadded hex. */
export function decodeArbiterSerial(reply) {
    if (reply.command !== ARBITER_COMMAND.getSerial || reply.data.length === 0)
        return null;
    return [...reply.data].map((byte) => byte.toString(16)).join("");
}
/**
 * A write acknowledgement echoes the command and carries a four-byte
 * little-endian "data change flag". The vendor app reads the flag without
 * checking the length, so missing bytes count as zero. `null` means the reply
 * answers a different command.
 */
export function decodeArbiterWriteAck(reply, command) {
    if (reply.command !== command)
        return null;
    const byte = (index) => reply.data[index] ?? 0;
    return (byte(0) | (byte(1) << 8) | (byte(2) << 16) | (byte(3) << 24)) >>> 0;
}
