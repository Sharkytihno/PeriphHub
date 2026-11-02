/*
 * The settings-block layout (field index and offset follow the DPI stage
 * count) and the per-zone lighting reply are ported from libratbag's ASUS
 * driver (src/asus.c, src/driver-asus.c):
 *
 * Copyright (C) 2021 Kyoken, kyoken@kyoken.ninja
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice (including the next
 * paragraph) shall be included in all copies or substantial portions of the
 * Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */
export * from "./devices.js";
export * from "./omni.js";
export const ASUS_VENDOR_ID = 0x0b05;
export const ASUS_USAGE_PAGE = 0xff01;
export const ASUS_USAGE = 0x0001;
export const ASUS_REPORT_ID = 0;
export const ASUS_REPORT_SIZE = 64;
/** Wire value is the index. 2000 Hz and up need the polling booster. */
export const ASUS_POLLING_RATES = [125, 250, 500, 1000, 2000, 4000, 8000];
export const ASUS_DEBOUNCE_MS = [12, 16, 20, 24, 28, 32];
/** Rate, debounce and angle snapping follow the DPI stages in the settings block. */
const FIELD_RATE = 0;
const FIELD_DEBOUNCE = 1;
const FIELD_SNAPPING = 2;
/** Wire zone ids by position. A model lists only the zones it has, so its index is not the id. */
const ZONE_IDS = ["Logo", "Scroll wheel", "Underglow"];
function zoneId(model, zone) {
    return ZONE_IDS.indexOf(model.zones[zone]);
}
function settingField(model, field) {
    return model.dpiStages + field;
}
function settingOffset(model, field) {
    return 4 + model.dpiStages * 2 + field * 2;
}
function requirePrefix(data, expected, name, minLength) {
    if (data.length < minLength) {
        throw new Error(`${name} reply is too short.`);
    }
    expected.forEach((byte, i) => {
        if (data[i] !== byte) {
            throw new Error(`${name} reply has unexpected byte ${i}: 0x${data[i].toString(16).padStart(2, "0")}`);
        }
    });
}
function readUint16LE(data, offset) {
    return data[offset] | (data[offset + 1] << 8);
}
function decodeDpi(model, value) {
    return (value + 1) * model.dpiStep;
}
function request(...bytes) {
    const data = new Uint8Array(ASUS_REPORT_SIZE);
    data.set(bytes);
    return data;
}
function requireStage(model, stage) {
    if (!Number.isInteger(stage) || stage < 0 || stage >= model.dpiStages) {
        throw new Error(`${model.name} DPI stage must be 0-${model.dpiStages - 1}.`);
    }
}
/* ---------------------------------
 * READ DECODERS
 * --------------------------------- */
export function asusDecodeSettings(model, data, booster = false) {
    const rateOffset = settingOffset(model, FIELD_RATE);
    requirePrefix(data, [0x12, 0x04, 0x00], "ASUS settings", settingOffset(model, FIELD_SNAPPING) + 1);
    // Newer firmware keeps a polling-booster value in the high nibble. G-Helper reads it only when the booster is on.
    const boosterRaw = booster ? data[rateOffset] >> 4 : 0;
    const pollingRaw = boosterRaw || data[rateOffset] & 0x07;
    const pollingRateHz = ASUS_POLLING_RATES[pollingRaw];
    if (pollingRateHz === undefined) {
        throw new Error(`Unknown ASUS polling value 0x${pollingRaw.toString(16).padStart(2, "0")}.`);
    }
    const debounceRaw = data[settingOffset(model, FIELD_DEBOUNCE)];
    return {
        dpiStages: Array.from({ length: model.dpiStages }, (_, i) => decodeDpi(model, readUint16LE(data, 4 + i * 2))),
        pollingRateHz,
        debounceMs: debounceRaw >= 0x02 && debounceRaw <= 0x07 ? debounceRaw * 4 + 4 : null,
        angleSnapping: data[settingOffset(model, FIELD_SNAPPING)] === 0x01,
    };
}
/** X values from the `12 04 02` block, four bytes (X, Y) per stage. */
export function asusDecodeDpiXY(model, data) {
    requirePrefix(data, [0x12, 0x04, 0x02], "ASUS X/Y DPI", 4 + model.dpiStages * 4);
    return Array.from({ length: model.dpiStages }, (_, i) => decodeDpi(model, readUint16LE(data, 4 + i * 4)));
}
export function asusDecodeDpiColors(model, data) {
    requirePrefix(data, [0x12, 0x04, 0x03], "ASUS DPI colours", 4 + model.dpiStages * 3);
    return Array.from({ length: model.dpiStages }, (_, i) => {
        const offset = 4 + i * 3;
        return [data[offset], data[offset + 1], data[offset + 2]];
    });
}
export function asusDecodeProfile(model, data) {
    requirePrefix(data, [0x12, 0x00, 0x00], "ASUS profile", 12);
    const stageRaw = data[11];
    if (stageRaw < 1 || stageRaw > model.dpiStages) {
        throw new Error(`Invalid ${model.name} DPI stage ${stageRaw}.`);
    }
    return {
        onboardProfile: data[10] + 1,
        activeDpiStage: stageRaw - 1,
    };
}
export function asusDecodeLiftOffDistance(data) {
    requirePrefix(data, [0x12, 0x06], "ASUS lift-off", 8);
    const raw = data[7];
    if (raw === 0)
        return "Low";
    if (raw === 1)
        return "High";
    throw new Error(`Unknown ASUS lift-off value ${raw}.`);
}
export function asusDecodeLighting(model, data, zone) {
    const offset = model.lightingAllZones ? 4 + zoneId(model, zone) * 5 : 4;
    requirePrefix(data, [0x12, 0x03], "ASUS lighting", offset + 5);
    return {
        mode: data[offset],
        brightness: data[offset + 1],
        red: data[offset + 2],
        green: data[offset + 3],
        blue: data[offset + 4],
    };
}
export function asusDecodeBattery(data) {
    requirePrefix(data, [0x12, 0x07], "ASUS battery", 10);
    return {
        percent: data[4],
        charging: data[9] > 0,
    };
}
/* ---------------------------------
 * READ REQUESTS
 * --------------------------------- */
export function asusReadSettingsRequest() {
    return request(0x12, 0x04, 0x00);
}
export function asusReadDpiXYRequest() {
    return request(0x12, 0x04, 0x02);
}
export function asusReadDpiColorsRequest() {
    return request(0x12, 0x04, 0x03);
}
export function asusReadProfileRequest() {
    return request(0x12, 0x00);
}
export function asusReadLiftOffRequest() {
    return request(0x12, 0x06);
}
export function asusReadLightingRequest(model, zone) {
    return request(0x12, 0x03, model.lightingAllZones ? 0x00 : zoneId(model, zone));
}
export function asusReadBatteryRequest() {
    return request(0x12, 0x07);
}
/* ---------------------------------
 * WRITES
 * --------------------------------- */
export function asusSetDpiRequest(model, stage, dpi, color) {
    requireStage(model, stage);
    if (!Number.isInteger(dpi) || dpi < model.minDpi || dpi > model.maxDpi || dpi % model.dpiStep !== 0) {
        throw new Error(`${model.name} DPI must be ${model.minDpi}-${model.maxDpi} in ${model.dpiStep}-DPI steps.`);
    }
    const encoded = dpi / model.dpiStep - 1;
    return request(0x51, 0x31, stage, 0x00, encoded & 0xff, (encoded >> 8) & 0xff, ...(color ?? []));
}
export function asusSetActiveDpiStageRequest(model, stage) {
    requireStage(model, stage);
    return request(0x51, 0x31, 0x09, 0x00, stage + 1);
}
export function asusSetPollingRateRequest(model, pollingRateHz) {
    const rateIndex = ASUS_POLLING_RATES.findIndex((rate) => rate === pollingRateHz);
    if (rateIndex === -1) {
        throw new Error(`Unsupported ${model.name} polling rate: ${pollingRateHz} Hz.`);
    }
    return request(0x51, 0x31, settingField(model, FIELD_RATE), 0x00, rateIndex);
}
export function asusSetProfileRequest(model, profile) {
    if (!Number.isInteger(profile) || profile < 1 || profile > model.profiles) {
        throw new Error(`${model.name} profile must be 1-${model.profiles}.`);
    }
    return request(0x50, 0x02, profile - 1);
}
export function asusSetAngleSnappingRequest(model, enabled) {
    return request(0x51, 0x31, settingField(model, FIELD_SNAPPING), 0x00, enabled ? 0x01 : 0x00);
}
export function asusSetDebounceRequest(model, milliseconds) {
    if (!ASUS_DEBOUNCE_MS.some((value) => value === milliseconds)) {
        throw new Error(`${model.name} debounce must be one of: ${ASUS_DEBOUNCE_MS.join(", ")} ms.`);
    }
    return request(0x51, 0x31, settingField(model, FIELD_DEBOUNCE), 0x00, milliseconds / 4 - 1);
}
/** Also resets the surface calibration; ASUS has no separate lift-off command. */
export function asusSetLiftOffRequest(value) {
    return request(0x51, 0x35, 0xff, 0x00, 0xff, value === "High" ? 1 : 0);
}
export function asusSetLightingRequest(model, zone, mode, brightness, red, green, blue, speed = 0) {
    if (!Number.isInteger(zone) || zone < 0 || zone >= model.zones.length) {
        throw new Error(`${model.name} RGB zone must be 0-${model.zones.length - 1}.`);
    }
    if (brightness < 0 || brightness > model.brightnessMax) {
        throw new Error(`${model.name} RGB brightness must be 0-${model.brightnessMax}.`);
    }
    // Bytes 9 and 10 are the animation direction and random-colour flag, unused here.
    return request(0x51, 0x28, zoneId(model, zone), 0x00, mode, brightness, red, green, blue, 0x00, 0x00, speed);
}
export function asusSaveRequest() {
    return request(0x50, 0x03);
}
