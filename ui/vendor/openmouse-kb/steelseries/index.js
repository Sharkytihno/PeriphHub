/**
 * SteelSeries Apex Pro keyboard codec.
 *
 * Frames, profile offsets and the actuation scale are the wired Apex Pro TKL
 * (PID `0x1628`, 2023) family. The command bytes come from SteelSeries GG's
 * shipped device descriptions (`apex_pro_tkl_2022` + `base_apex_2022_wired`),
 * cross-checked against a public USBPcap capture of GG on firmware 1.19.7.
 * See `docs/steelseries-support.md` for the evidence and open questions.
 *
 * The driver lives in `../drivers/steelseries/hid.ts`.
 */
export const STEELSERIES_VENDOR_ID = 0x1038;
export const STEELSERIES_CONFIG_USAGE_PAGE = 0xffc0;
export const STEELSERIES_CONFIG_USAGE = 0x0001;
export const STEELSERIES_FEATURE_DATA_LENGTH = 644;
/** Wireless packet `0x61` is 643 bytes on the wire including the report ID (OpenRGB). */
export const STEELSERIES_WIRELESS_LIGHTING_DATA_LENGTH = 642;
/** Data bytes of the `0x4B` wireless initialization feature report (64 plus the report ID). */
export const STEELSERIES_INIT_DATA_LENGTH = 64;
export const STEELSERIES_OUTPUT_DATA_LENGTH = 64;
export const STEELSERIES_KEYBOARD_PRODUCTS = new Map([
    [0x1628, { name: "Apex Pro TKL (2023)", profileSlots: 5, verified: false }],
    [0x1642, { name: "Apex Pro TKL Gen 3", profileSlots: 5, verified: false }],
    [0x1630, { name: "Apex Pro TKL Wireless (2023)", profileSlots: 0, verified: false }],
    [0x1632, { name: "Apex Pro TKL Wireless (2023, USB)", profileSlots: 0, verified: false }],
]);
export const STEELSERIES_KEYBOARD_PRODUCT_IDS = [...STEELSERIES_KEYBOARD_PRODUCTS.keys()];
export const STEELSERIES_PROFILE_LENGTH = 12_500;
export const STEELSERIES_PROFILE_CHUNK_LENGTH = 500;
export const STEELSERIES_PROFILE_CHECKSUM_OFFSET = 12_320;
export const STEELSERIES_FIRST_PROFILE_FS = 0x80;
/** Offsets inside the reassembled wired-2023 schema-8 profile blob. */
export const STEELSERIES_PROFILE_OFFSET = {
    deviceSchema: 1080,
    actuation: 1084,
    reset: 1154,
    secondActuation: 1306,
    secondReset: 1376,
    releaseMode: 1446,
    rapidTriggerSensitivity: 1516,
    oled: 2010,
    rapidTapPairs: 2650,
    rapidTapEnabled: 2700,
};
/** Slot -> HID usage for the 68 analog keys, GG's table order. */
export const STEELSERIES_APEX_PRO_2023_SLOTS = [
    // ` 1 2 3 4 5 6 7 8 9 0 - = Yen
    0x35, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x2d, 0x2e, 0x89,
    // Tab Q W E R T Y U I O P [ ] \
    0x2b, 0x14, 0x1a, 0x08, 0x15, 0x17, 0x1c, 0x18, 0x0c, 0x12, 0x13, 0x2f, 0x30, 0x31,
    // Caps A S D F G H J K L ; ' ISO-# Enter
    0x39, 0x04, 0x16, 0x07, 0x09, 0x0a, 0x0b, 0x0d, 0x0e, 0x0f, 0x33, 0x34, 0x32, 0x28,
    // LShift ISO-\ Z X C V B N M , . / Ro RShift
    0xe1, 0x64, 0x1d, 0x1b, 0x06, 0x19, 0x05, 0x11, 0x10, 0x36, 0x37, 0x38, 0x87, 0xe5,
    // LCtrl LGui LAlt Muhenkan Space Henkan Kana RAlt RGui Fn RCtrl Backspace
    0xe0, 0xe3, 0xe2, 0x8b, 0x2c, 0x8a, 0x88, 0xe6, 0xe7, 0xf0, 0xe4, 0x2a,
];
/** GG's `(actuation, reset)` raw pair for 0.1-4.0 mm, index = tenths - 1. */
export const STEELSERIES_ACTUATION_POINTS = [
    [5, 5], [5, 4], [6, 5], [8, 6], [10, 8], [12, 10], [14, 12], [16, 14], [18, 16], [21, 18],
    [24, 21], [27, 24], [30, 27], [33, 29], [36, 33], [39, 36], [43, 40], [47, 42], [52, 47], [57, 52],
    [62, 57], [68, 62], [74, 68], [81, 74], [88, 81], [95, 87], [104, 95], [114, 104], [124, 114], [134, 123],
    [147, 134], [161, 147], [175, 161], [189, 174], [197, 189], [206, 197], [215, 206], [224, 215], [224, 217], [224, 219],
];
export const STEELSERIES_RELEASE_MODES = [0x00, 0x02, 0x03, 0x04];
/** The GG TKL-2022 command definition is specific to USB PID 0x1628. */
export const STEELSERIES_APEX_PRO_2023_PRODUCT_ID = 0x1628;
export const STEELSERIES_OLED_BITMAP_LENGTH = 640;
export const STEELSERIES_OLED_WIDTH = 128;
export const STEELSERIES_OLED_HEIGHT = 40;
/** Pack 128×40 live OLED pixels, row-major with the leftmost pixel in bit 7. */
export function packSteelseriesOledPixels(pixels) {
    if (pixels.length !== STEELSERIES_OLED_WIDTH * STEELSERIES_OLED_HEIGHT) {
        throw new RangeError("Apex Pro TKL OLED requires exactly 128×40 pixels.");
    }
    const bitmap = new Uint8Array(STEELSERIES_OLED_BITMAP_LENGTH);
    for (let index = 0; index < pixels.length; index++) {
        if (pixels[index])
            bitmap[index >> 3] = (bitmap[index >> 3] ?? 0) | (0x80 >> (index & 7));
    }
    return bitmap;
}
export const STEELSERIES_RAPID_TAP_PAIR_COUNT = 10;
/** STM32 hardware CRC-32: poly 0x04C11DB7, init 0xFFFFFFFF, no reflection, no final XOR, LE words MSB-first. */
export function steelseriesCrc32(data) {
    if (data.length % 4 !== 0)
        throw new RangeError("SteelSeries CRC input must be whole 32-bit words.");
    let crc = 0xffffffff;
    for (let word = 0; word < data.length; word += 4) {
        for (let byte = word + 3; byte >= word; byte -= 1) {
            crc = (crc ^ ((data[byte] ?? 0) << 24)) >>> 0;
            for (let bit = 0; bit < 8; bit += 1) {
                crc = (crc & 0x80000000) !== 0 ? ((crc << 1) ^ 0x04c11db7) >>> 0 : (crc << 1) >>> 0;
            }
        }
    }
    return crc >>> 0;
}
/** Whether the little-endian checksum at 12320 matches the blob. */
export function steelseriesProfileChecksumValid(blob) {
    if (blob.length < STEELSERIES_PROFILE_LENGTH)
        return false;
    const stored = (blob[STEELSERIES_PROFILE_CHECKSUM_OFFSET] ?? 0)
        | ((blob[STEELSERIES_PROFILE_CHECKSUM_OFFSET + 1] ?? 0) << 8)
        | ((blob[STEELSERIES_PROFILE_CHECKSUM_OFFSET + 2] ?? 0) << 16)
        | ((blob[STEELSERIES_PROFILE_CHECKSUM_OFFSET + 3] ?? 0) << 24);
    return (stored >>> 0) === steelseriesCrc32(blob.slice(0, STEELSERIES_PROFILE_CHECKSUM_OFFSET));
}
/** Raw `(actuation, reset)` pair for a whole tenth of a millimetre, 1..40. */
export function steelseriesActuationRaw(tenthsMm) {
    return STEELSERIES_ACTUATION_POINTS[tenthsMm - 1] ?? null;
}
/** Whole tenths of a millimetre for a raw pair, or `null` when it is not one of GG's points. */
export function steelseriesActuationTenths(actuation, reset) {
    const index = STEELSERIES_ACTUATION_POINTS.findIndex(([h, l]) => h === actuation && l === reset);
    return index < 0 ? null : index + 1;
}
/** Decode one 12,500-byte on-board profile blob. */
export function decodeSteelseriesProfile(blob, slot = 0) {
    if (blob.length < STEELSERIES_PROFILE_LENGTH)
        return null;
    const checksumValid = steelseriesProfileChecksumValid(blob);
    const keys = STEELSERIES_APEX_PRO_2023_SLOTS.map((usage, index) => {
        const actuation = blob[STEELSERIES_PROFILE_OFFSET.actuation + index] ?? 0;
        const reset = blob[STEELSERIES_PROFILE_OFFSET.reset + index] ?? 0;
        return {
            usage,
            actuation,
            reset,
            tenthsMm: steelseriesActuationTenths(actuation, reset),
            releaseMode: blob[STEELSERIES_PROFILE_OFFSET.releaseMode + index] ?? 0,
            rapidTriggerSensitivity: blob[STEELSERIES_PROFILE_OFFSET.rapidTriggerSensitivity + index] ?? 0,
        };
    });
    const deviceSchema = blob[STEELSERIES_PROFILE_OFFSET.deviceSchema] ?? 0;
    const rapidTap = blob[STEELSERIES_PROFILE_OFFSET.rapidTapEnabled];
    const secondActuation = deviceSchema >= 4 && deviceSchema <= 8
        ? STEELSERIES_APEX_PRO_2023_SLOTS.map((_, index) => [
            blob[STEELSERIES_PROFILE_OFFSET.secondActuation + index] ?? 0,
            blob[STEELSERIES_PROFILE_OFFSET.secondReset + index] ?? 0,
        ])
        : null;
    const rapidTapPairs = deviceSchema === 8
        ? Array.from({ length: STEELSERIES_RAPID_TAP_PAIR_COUNT }, (_, index) => {
            const offset = STEELSERIES_PROFILE_OFFSET.rapidTapPairs + index * 5;
            const flags = blob[offset + 2] ?? 0;
            return {
                hid1: blob[offset] ?? 0, hid2: blob[offset + 1] ?? 0,
                mode: (flags & 0x7f),
                reportBothKeys: (flags & 0x80) !== 0,
            };
        })
        : null;
    const oledOffset = deviceSchema === 4 || deviceSchema === 5 ? 1866 : STEELSERIES_PROFILE_OFFSET.oled;
    const oled = deviceSchema >= 4 && deviceSchema <= 8
        ? blob.slice(oledOffset, oledOffset + STEELSERIES_OLED_BITMAP_LENGTH)
        : null;
    return { slot, checksumValid, live: false, keys, secondActuation, rapidTapPairs,
        rapidTapEnabled: deviceSchema === 8 && (rapidTap === 0 || rapidTap === 1) ? rapidTap === 1 : null,
        oled, deviceSchema };
}
function featureFrame(body, dataLength = STEELSERIES_FEATURE_DATA_LENGTH) {
    if (body.length > dataLength)
        throw new RangeError("SteelSeries feature frame is too large.");
    const frame = new Uint8Array(dataLength);
    frame.set(body);
    return frame;
}
function outputFrame(body) {
    if (body.length > STEELSERIES_OUTPUT_DATA_LENGTH)
        throw new RangeError("SteelSeries output frame is too large.");
    const frame = new Uint8Array(STEELSERIES_OUTPUT_DATA_LENGTH);
    frame.set(body);
    return frame;
}
/** `00 38 61 count layer {hid,h,l}*count` feature report. */
export function encodeSteelseriesHallThresholds(layer, keys) {
    if (keys.length === 0 || keys.length > 0x47)
        throw new RangeError("A hall-threshold frame needs 1-71 keys.");
    return featureFrame([0x38, 0x61, keys.length, layer, ...keys.flat()]);
}
/** `00 38 62 count {hid,mode}*count` feature report. */
export function encodeSteelseriesReleaseMode(keys) {
    if (keys.length === 0 || keys.length > 0x47)
        throw new RangeError("A release-mode frame needs 1-71 keys.");
    for (const [, mode] of keys) {
        if (!STEELSERIES_RELEASE_MODES.includes(mode))
            throw new RangeError(`Unsupported release mode ${mode}.`);
    }
    return featureFrame([0x38, 0x62, keys.length, ...keys.flat()]);
}
/** `00 38 65 count {hid,sensitivity}*count` feature report. */
export function encodeSteelseriesRapidTriggerSensitivity(keys) {
    if (keys.length === 0 || keys.length > 0x47)
        throw new RangeError("A rapid-trigger frame needs 1-71 keys.");
    return featureFrame([0x38, 0x65, keys.length, ...keys.flat()]);
}
/** `00 38 66 enabled` output report. */
export function encodeSteelseriesRapidTap(enabled) {
    return outputFrame([0x38, 0x66, enabled ? 1 : 0]);
}
/** `00 38 67 count {index,hid1,hid2,mode|0x80 if reportBoth,0,0}*count` output report.
 * GG always supplies ten indexed slots, including empty slots.
 */
export function encodeSteelseriesRapidTapPairs(pairs) {
    if (pairs.length !== STEELSERIES_RAPID_TAP_PAIR_COUNT)
        throw new RangeError("Rapid Tap requires exactly 10 indexed slots.");
    const frame = new Uint8Array(STEELSERIES_OUTPUT_DATA_LENGTH);
    frame.set([0x38, 0x67, STEELSERIES_RAPID_TAP_PAIR_COUNT]);
    pairs.forEach((pair, index) => {
        if (!Number.isInteger(pair.hid1) || pair.hid1 < 0 || pair.hid1 > 255
            || !Number.isInteger(pair.hid2) || pair.hid2 < 0 || pair.hid2 > 255) {
            throw new RangeError("Rapid Tap HID usages must be bytes.");
        }
        if (!Number.isInteger(pair.mode) || pair.mode < 0 || pair.mode > 3)
            throw new RangeError("Rapid Tap mode must be 0-3.");
        const empty = pair.hid1 === 0 && pair.hid2 === 0 && pair.mode === 0 && !pair.reportBothKeys;
        if (!empty && (pair.hid1 === pair.hid2 || !STEELSERIES_APEX_PRO_2023_SLOTS.includes(pair.hid1)
            || !STEELSERIES_APEX_PRO_2023_SLOTS.includes(pair.hid2))) {
            throw new RangeError("Rapid Tap pairs must contain two distinct analog HID usages.");
        }
        const offset = 3 + index * 6;
        frame.set([index, pair.hid1, pair.hid2, pair.mode | (pair.reportBothKeys ? 0x80 : 0), 0, 0], offset);
    });
    return frame;
}
/** `00 38 83 00 <640 bitmap bytes>` feature report; change the profile OLED image. */
export function encodeSteelseriesOledDisplay(bitmap) {
    if (bitmap.length !== STEELSERIES_OLED_BITMAP_LENGTH)
        throw new RangeError("Apex Pro TKL OLED requires exactly 640 bitmap bytes.");
    const frame = new Uint8Array(STEELSERIES_FEATURE_DATA_LENGTH);
    frame.set([0x38, 0x83, 0x00]);
    frame.set(bitmap, 3);
    return frame;
}
/** `00 1f 81 <640 bitmap bytes>` feature report; temporary GameSense OLED image. */
export function encodeSteelseriesOledDirect(bitmap) {
    if (bitmap.length !== STEELSERIES_OLED_BITMAP_LENGTH)
        throw new RangeError("Apex Pro TKL OLED requires exactly 640 bitmap bytes.");
    const frame = new Uint8Array(STEELSERIES_FEATURE_DATA_LENGTH);
    frame.set([0x1f, 0x81]);
    frame.set(bitmap, 2);
    return frame;
}
/** `00 1f 82` output report; release GameSense OLED override. */
export function encodeSteelseriesOledResetDirect() {
    return outputFrame([0x1f, 0x82]);
}
/** `00 83 01 fs sizeLE u32 offsetLE` feature report; the reply data starts at byte 3. */
export function encodeSteelseriesProfileRead(fsId, size, offset) {
    if (fsId < STEELSERIES_FIRST_PROFILE_FS || fsId >= STEELSERIES_FIRST_PROFILE_FS + 5) {
        throw new RangeError("SteelSeries profile file id must be 0x80-0x84.");
    }
    if (!Number.isInteger(size) || size < 1 || size > STEELSERIES_FEATURE_DATA_LENGTH - 4) {
        throw new RangeError("SteelSeries profile read size is invalid.");
    }
    if (!Number.isInteger(offset) || offset < 0 || offset > 0xffffffff) {
        throw new RangeError("SteelSeries profile read offset is invalid.");
    }
    return featureFrame([
        0x83, 0x01, fsId,
        size & 0xff, (size >> 8) & 0xff,
        offset & 0xff, (offset >>> 8) & 0xff, (offset >>> 16) & 0xff, (offset >>> 24) & 0xff,
    ]);
}
/** `00 90 source` output report; 0 = keyboard firmware, 1 = LED firmware. */
export function encodeSteelseriesFirmwarePoll(source) {
    return outputFrame([0x90, source]);
}
/** Recompute and store the little-endian CRC at offset 12320. */
export function steelseriesSealProfile(blob) {
    if (blob.length < STEELSERIES_PROFILE_LENGTH)
        throw new RangeError("SteelSeries profile is too short to seal.");
    const crc = steelseriesCrc32(blob.slice(0, STEELSERIES_PROFILE_CHECKSUM_OFFSET));
    blob[STEELSERIES_PROFILE_CHECKSUM_OFFSET] = crc & 0xff;
    blob[STEELSERIES_PROFILE_CHECKSUM_OFFSET + 1] = (crc >>> 8) & 0xff;
    blob[STEELSERIES_PROFILE_CHECKSUM_OFFSET + 2] = (crc >>> 16) & 0xff;
    blob[STEELSERIES_PROFILE_CHECKSUM_OFFSET + 3] = (crc >>> 24) & 0xff;
}
/** `00 02 01 fs` output report: open the profile file for writing/erasing. */
export function encodeSteelseriesFileOpen(fsId) {
    if (fsId < STEELSERIES_FIRST_PROFILE_FS || fsId >= STEELSERIES_FIRST_PROFILE_FS + 5) {
        throw new RangeError("SteelSeries profile file id must be 0x80-0x84.");
    }
    return outputFrame([0x02, 0x01, fsId]);
}
/** `00 03 01 fs sizeLE u32 offsetLE data` feature report: one 500-byte profile chunk. */
export function encodeSteelseriesProfileWrite(fsId, offset, data) {
    if (fsId < STEELSERIES_FIRST_PROFILE_FS || fsId >= STEELSERIES_FIRST_PROFILE_FS + 5) {
        throw new RangeError("SteelSeries profile file id must be 0x80-0x84.");
    }
    if (!Number.isInteger(offset) || offset < 0 || offset > 0xffffffff)
        throw new RangeError("SteelSeries profile write offset is invalid.");
    if (data.length < 1 || data.length > STEELSERIES_PROFILE_CHUNK_LENGTH) {
        throw new RangeError(`SteelSeries profile chunk must be 1-${STEELSERIES_PROFILE_CHUNK_LENGTH} bytes.`);
    }
    return featureFrame([
        0x03, 0x01, fsId,
        data.length & 0xff, (data.length >> 8) & 0xff,
        offset & 0xff, (offset >>> 8) & 0xff, (offset >>> 16) & 0xff, (offset >>> 24) & 0xff,
        ...data,
    ]);
}
/** `00 B1 slot` output report: run on-board profile validation. */
export function encodeSteelseriesValidateProfile(slot) {
    if (!Number.isInteger(slot) || slot < 0 || slot > 4)
        throw new RangeError("SteelSeries profile slot must be 0-4.");
    return outputFrame([0xb1, slot]);
}
/** HID usages GG addresses in its 2023 Apex Pro TKL direct-lighting frame. */
export const STEELSERIES_APEX_PRO_2023_LIGHTING_KEYS = [
    0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15,
    0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27,
    0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f, 0x30,
    0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x3f, 0x40, 0x41, 0x42, 0x43, 0x44, 0x45,
    0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e, 0x4f, 0x50, 0x51, 0x52, 0x64,
    0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe7, 0xf0, 0x28, 0x31, 0xe6,
];
/** `00 40 count {hid,r,g,b}*count` feature report: direct per-key lighting. */
export function encodeSteelseriesLighting(colors, packetId = 0x40) {
    const entries = [];
    for (const usage of STEELSERIES_APEX_PRO_2023_LIGHTING_KEYS) {
        const color = colors.get(usage) ?? [0, 0, 0];
        for (const channel of color) {
            if (!Number.isInteger(channel) || channel < 0 || channel > 255)
                throw new RangeError("SteelSeries RGB channels are 0-255.");
        }
        entries.push(usage, color[0], color[1], color[2]);
    }
    return featureFrame([packetId, STEELSERIES_APEX_PRO_2023_LIGHTING_KEYS.length, ...entries], packetId === 0x61 ? STEELSERIES_WIRELESS_LIGHTING_DATA_LENGTH : STEELSERIES_FEATURE_DATA_LENGTH);
}
/** `00 4B` feature report OpenRGB sends once before wireless `0x61` direct-lighting frames. */
export function encodeSteelseriesInit() {
    return featureFrame([0x4b], STEELSERIES_INIT_DATA_LENGTH);
}
/** `00 41` output report: hand lighting back to the on-board profile. */
export function encodeSteelseriesClearDirectLighting() {
    return outputFrame([0x41]);
}
/** Firmware reply: `90 00 <ASCII version>` (report id stripped). */
export function decodeSteelseriesFirmware(data) {
    if ((data[0] ?? 0) !== 0x90 || (data[1] ?? 0) !== 0x00)
        return null;
    const end = data.indexOf(0, 2);
    const text = new TextDecoder().decode(data.slice(2, end < 0 ? undefined : end)).trim();
    return text.length ? text : null;
}
