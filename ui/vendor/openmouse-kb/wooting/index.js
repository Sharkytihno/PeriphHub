/**
 * Wooting analog keyboard vendor HID protocol — transport-independent codec.
 *
 * Wire mechanics mirror the official Wooting RGB SDK (`src/wooting-usb.c`,
 * `wooting_usb_send_feature_buff`) and the community references below.
 * Commands are 8-byte HID *feature* reports:
 *
 *   [reportIndex, magic0, magic1, commandId, param3, param2, param1, param0]
 *
 * where `magic0`/`magic1` are `0xD0`/`0xDA` on single-report (Standard)
 * devices and `0xD1`/`0xDA` on multi-report (ARM) devices, and `reportIndex`
 * (0 or 1) matches. Note the SDK writes the four parameters in reverse order
 * (param3 first). The response is read back as an *input* report; its layout is
 * command-specific.
 *
 * References:
 * - Wooting RGB SDK `wooting-usb.c` / `wooting-usb.h` (command framing,
 *   `WOOTING_DEVICE_LAYOUT` enum).
 * - `d0da` project's `d0da_feature.py` (D0DA command table, cross-checked).
 * - wootswitch `docs/hid-protocol.md` (full 0–59 command table, ARM vs
 *   Standard variants, response header + status byte, profile-slot placement,
 *   profile-switch sequence, ARM profile-index quirk). Confirmed against a
 *   60HE+ (ARM, PID `0x1320`, config page `0xFF55`).
 * - PastaJ36 "Wooting USB config protocol" gist (original 8-byte feature /
 *   128-byte report description).
 *
 * Hardware-confirmed on a Wooting 60HE+ (VID `0x31E3`, PID `0x1322`):
 * single-report v2-interface board using magic `0xD0`/`0xDA`... note — the
 * 60HE+ answers with the *multi-report* magic (`0xD1`) and report index 1 on
 * its config interface (usage page `0xFF55`, usage `0x01`), so commands go
 * out in multi-report form. The `0xFF53` collection is the analog/HID data
 * stream and declares no feature report, so a WebHID feature write there
 * fails. wootswitch reports the analog stream as `0xFF54` on PID `0x1320`;
 * both pages are accepted when looking for the stream (see driver).
 *
 * These helpers identify boards, decode read replies, and frame a few
 * hardware-observed write packets. The driver does not yet perform a complete
 * Wootility profile save transaction.
 */
/** Wooting "VID2" — used by every Hall-effect / ARM board (Two HE, 60HE, 60HE+, 80HE…). */
export const WOOTING_VENDOR_ID = 0x31e3;
/** Atmel VID on the original AVR boards (Wooting One / Two). Kept for discovery only. */
export const WOOTING_LEGACY_VENDOR_ID = 0x03eb;
/** Wootility 5.4.2 device catalog base PIDs (dist-electron/main.js).
 * The low nibble can identify a hardware variant: the connected 60HE+ reports
 * 0x1322 although Wootility catalogs that family under 0x1320. Entries are
 * identification only; `verified` remains false until OpenMouse tests each.
 */
export const WOOTING_PRODUCTS = {
    0x1100: { name: "Wooting One", verified: false },
    0x1200: { name: "Wooting Two", verified: false },
    0x1210: { name: "Wooting Two Lekker Edition", verified: false },
    0x1220: { name: "Wooting Two HE (AVR)", verified: false },
    0x1230: { name: "Wooting Two HE (ARM)", verified: false },
    0x1300: { name: "Wooting 60HE (AVR)", verified: false },
    0x1310: { name: "Wooting 60HE (ARM)", verified: false },
    0x1320: { name: "Wooting 60HE+", verified: false },
    0x1322: { name: "Wooting 60HE+", verified: false },
    0x1340: { name: "Wooting 60HE v2", verified: false },
    0x1400: { name: "Wooting 80HE", verified: false },
    0x1410: { name: "Wooting 80HE+", verified: false },
    0x1500: { name: "Wooting UwU", verified: false },
    0x1510: { name: "Wooting UwU RGB", verified: false },
};
export const WOOTING_PRODUCT_IDS = Object.keys(WOOTING_PRODUCTS).map(Number);
/** Match a catalog family when firmware uses its low PID nibble for a variant. */
export function wootingProduct(productId) {
    return WOOTING_PRODUCTS[productId] ?? WOOTING_PRODUCTS[productId & 0xfff0] ?? null;
}
export const WOOTING_MODELS = [
    {
        name: "Wooting One",
        productIds: [0x1100, 0x2402, 0xff01],
        chipType: "AVR", switchTech: "flaretech",
        matrixRowStart: 0, matrixRows: 6, matrixCols: 17, hasRGB: true,
    },
    {
        name: "Wooting Two",
        productIds: [0x1200, 0x2403, 0xff02],
        chipType: "AVR", switchTech: "flaretech",
        matrixRowStart: 0, matrixRows: 6, matrixCols: 21, hasRGB: true,
    },
    {
        name: "Wooting Two Lekker Edition",
        productIds: [0x1210],
        chipType: "AVR", switchTech: "halleffect",
        matrixRowStart: 0, matrixRows: 6, matrixCols: 21, hasRGB: true,
    },
    {
        name: "Wooting Two HE (AVR)",
        productIds: [0x1220],
        chipType: "AVR", switchTech: "halleffect",
        matrixRowStart: 0, matrixRows: 6, matrixCols: 21, hasRGB: true,
    },
    {
        name: "Wooting Two HE (ARM)",
        productIds: [0x1230],
        chipType: "ARM", switchTech: "halleffect",
        matrixRowStart: 0, matrixRows: 6, matrixCols: 21, hasRGB: true,
    },
    {
        name: "Wooting 60HE (AVR)",
        productIds: [0x1300],
        chipType: "AVR", switchTech: "halleffect",
        matrixRowStart: 1, matrixRows: 5, matrixCols: 14, hasRGB: true,
    },
    {
        name: "Wooting 60HE (ARM)",
        productIds: [0x1310],
        chipType: "ARM", switchTech: "halleffect",
        matrixRowStart: 1, matrixRows: 5, matrixCols: 14, hasRGB: true,
    },
    {
        name: "Wooting 60HE+",
        productIds: [0x1320],
        chipType: "ARM", switchTech: "halleffect",
        matrixRowStart: 1, matrixRows: 5, matrixCols: 14, hasRGB: true,
    },
    {
        name: "Wooting 60HE v2",
        productIds: [0x1340],
        chipType: "ARM", switchTech: "halleffect",
        matrixRowStart: 1, matrixRows: 5, matrixCols: 14, hasRGB: true,
    },
    {
        name: "Wooting 80HE",
        productIds: [0x1400],
        chipType: "ARM", switchTech: "halleffect",
        matrixRowStart: 0, matrixRows: 6, matrixCols: 17, hasRGB: true,
    },
    {
        name: "Wooting 80HE+",
        productIds: [0x1410],
        chipType: "ARM", switchTech: "halleffect",
        matrixRowStart: 0, matrixRows: 6, matrixCols: 17, hasRGB: true,
    },
    {
        name: "Wooting UwU",
        productIds: [0x1500],
        chipType: "ARM", switchTech: "halleffect",
        matrixRowStart: 0, matrixRows: 5, matrixCols: 7, hasRGB: false,
    },
    {
        name: "Wooting UwU RGB",
        productIds: [0x1510],
        chipType: "ARM", switchTech: "halleffect",
        matrixRowStart: 0, matrixRows: 5, matrixCols: 7, hasRGB: true,
    },
];
/** Model descriptor for a PID, accepting the low-nibble variant form. */
export function wootingModel(productId) {
    const family = productId & 0xfff0;
    return WOOTING_MODELS.find((model) => model.productIds.includes(productId) || model.productIds.includes(family)) ?? null;
}
/**
 * Compare firmware versions using semver precedence, including prerelease
 * tags. Wootility gates use `includePrerelease`, so `2.10.0-alpha.0` is the
 * first version that satisfies `>=2.10.0-alpha.0`, not `2.9.x`.
 */
export function compareWootingVersions(a, b) {
    const parse = (version) => {
        const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim());
        if (!match)
            throw new RangeError(`Invalid Wooting firmware version: ${version}`);
        return {
            parts: [Number(match[1]), Number(match[2]), Number(match[3])],
            prerelease: match[4]?.split(".") ?? [],
        };
    };
    const left = parse(a);
    const right = parse(b);
    for (let index = 0; index < 3; index += 1) {
        if (left.parts[index] !== right.parts[index])
            return left.parts[index] - right.parts[index];
    }
    if (!left.prerelease.length || !right.prerelease.length) {
        return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length ? -1 : 1;
    }
    for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
        const l = left.prerelease[index];
        const r = right.prerelease[index];
        if (l === undefined)
            return -1;
        if (r === undefined)
            return 1;
        if (l === r)
            continue;
        const ln = /^\d+$/.test(l) ? Number(l) : null;
        const rn = /^\d+$/.test(r) ? Number(r) : null;
        if (ln !== null && rn !== null)
            return ln - rn;
        if (ln !== null)
            return -1;
        if (rn !== null)
            return 1;
        return l < r ? -1 : 1;
    }
    return 0;
}
/** Null firmware counts as satisfying every gate, matching Wootility. */
export function wootingVersionAtLeast(version, minimum) {
    return version === null || compareWootingVersions(version, minimum) >= 0;
}
export function wootingCapabilities(productId, firmwareVersion) {
    const model = wootingModel(productId);
    const isArm = model?.chipType === "ARM";
    const hallEffect = model !== null && model.switchTech !== "flaretech";
    const perKeyRapidTrigger = !isArm || !hallEffect
        ? "none"
        : wootingVersionAtLeast(firmwareVersion, "2.10.0-alpha.0")
            ? "full"
            : wootingVersionAtLeast(firmwareVersion, "2.5.3")
                ? "partial"
                : "none";
    return {
        model,
        firmwareVersion,
        transport: isArm ? "arm" : "standard",
        perKeyRapidTrigger,
        perKeyRapidTriggerMaxKeysPerGroup: 10,
        perKeyRapidTriggerMaxGroups: wootingVersionAtLeast(firmwareVersion, "2.13.0-beta.7") ? 30 : 10,
        perKeyActuation: isArm && hallEffect && wootingVersionAtLeast(firmwareVersion, "2.2.0"),
    };
}
/**
 * Vendor config interface. ARM boards (60HE+ and later) expose commands on
 * usage page `0xFF55`, usage `0x01`. Standard-firmware boards (One / Two /
 * original 60HE) use usage page `0x1337` instead (wootswitch). `0xFF00` is the
 * legacy generic interface on older boards.
 */
export const WOOTING_CONFIG_USAGE_PAGE = 0xff55;
export const WOOTING_CONFIG_USAGE_PAGE_STANDARD = 0x1337;
export const WOOTING_CONFIG_USAGE_PAGE_LEGACY = 0xff00;
/** The analog/HID data stream — not used for commands. */
export const WOOTING_ANALOG_USAGE_PAGE = 0xff53;
/** Second analog-stream page seen on PID 0x1320 (wootswitch); accepted too. */
export const WOOTING_ANALOG_USAGE_PAGE_ALT = 0xff54;
export const WOOTING_CONFIG_USAGE = 0x01;
export const WOOTING_COMMAND_SIZE = 8;
export const WOOTING_MAGIC_SINGLE = 0xd0;
export const WOOTING_MAGIC_MULTI = 0xd1;
export const WOOTING_MAGIC_WORD_1 = 0xda;
/** Reply status byte: the board understood and answered the command. */
export const WOOTING_STATUS_OK = 0x88;
/** Reply status byte: unsupported / error (e.g. GetDigitalProfilesCount on ARM). */
export const WOOTING_STATUS_ERROR = 0x66;
/**
 * D0DA command IDs (wootswitch table, cross-checked with the RGB SDK and the
 * `d0da` project). Write commands below are RAM-only unless marked FLASH:
 * profile-switch (0x21/0x17/0x26) and RGB-direct (0x1D–0x20) never touch
 * flash; every `save*` (0x08/0x2A/0x2F/0x35) plus `resetSettings` (0x2B)
 * overwrites onboard flash and needs an explicit user confirm. Deliberately
 * absent (NEVER encode): `reset_to_bootloader` 0x02 (leaves HID),
 * `keys_off` 0x15 (kills output until 0x16/reset), `do_soft_reset` 0x19
 * (drops RAM state, can re-enumerate).
 */
export const WOOTING_COMMAND = {
    /** get_version — firmware version. */
    getVersion: 0x01,
    /** get_serial — device serial number. */
    getSerial: 0x03,
    /** get_rgb_profile_count — number of RGB profiles. */
    getRgbProfileCount: 0x04,
    /** get_digital_profiles_count — profile count (0x66 on ARM; probe metadata instead). */
    getDigitalProfilesCount: 0x09,
    /** get_analog_profiles_count — analog profile count. */
    getAnalogProfilesCount: 0x0a,
    /** get_current_keyboard_profile_index — which onboard profile is active. */
    getCurrentKeyboardProfileIndex: 0x0b,
    /** get_digital_profile — digital profile blob for a slot. */
    getDigitalProfile: 0x0c,
    /** get_analog_profile_main_part — analog profile main part for a slot. */
    getAnalogProfileMainPart: 0x0d,
    /** get_analog_profile_curve_map_1/2 — actuation curve pages for a slot. */
    getAnalogProfileCurve1: 0x0e,
    getAnalogProfileCurve2: 0x0f,
    /** get_number_of_keys — matrix key count. */
    getNumberOfKeys: 0x10,
    /** get_main_mapping_profile — primary key mapping for a slot. */
    getMainMappingProfile: 0x11,
    /** get_function_mapping_profile — function-layer mapping for a slot. */
    getFunctionMappingProfile: 0x12,
    /** get_device_config — board layout / config block. */
    getDeviceConfig: 0x13,
    /** get_analog_values — one-shot analog snapshot (vs the streaming interface). */
    getAnalogValues: 0x14,
    /** keys_on — restores key/LED output (pair of the NEVER-encoded keys_off 0x15). RAM-only. */
    keysOn: 0x16,
    /** activate_profile — switches the active profile in RAM (slot byte). RAM-only. */
    activateProfile: 0x17,
    /** get_dks_profile — dynamic-keystroke profile for a slot. */
    getDksProfile: 0x18,
    /** refresh_rgb_colors — pushes staged RGB to the board. RAM-only. */
    refreshRgbColors: 0x1d,
    /** woot_dev_single_color — sets one key's RGB (SDK WOOTING_SINGLE_COLOR_COMMAND). RAM-only. */
    wootDevSingleColor: 0x1e,
    /** woot_dev_reset_color — resets one key's RGB (SDK WOOTING_SINGLE_RESET_COMMAND). RAM-only. */
    wootDevResetColor: 0x1f,
    /** woot_dev_reset_all — resets all RGB (SDK WOOTING_RESET_ALL_COMMAND). RAM-only. */
    wootDevResetAll: 0x20,
    /** woot_dev_init — session init, sent on SDK connect and before profile switching. RAM-only. */
    wootDevInit: 0x21,
    /** reload_profile — reloads LED/key config from flash into the active state (slot byte). RAM-only. */
    reloadProfile: 0x26,
    /** save_rgb_profile — persists the RGB profile to flash (slot byte). FLASH. */
    saveRgbProfile: 0x08,
    /** reload_profile_0 — reloads profile slot 0 from flash (no slot byte). RAM-only. */
    reloadProfile0: 0x07,
    /** save_keyboard_profile — persists the keyboard profile to flash (slot byte). FLASH. */
    saveKeyboardProfile: 0x2a,
    /** reset_settings — factory-resets settings. FLASH. */
    resetSettings: 0x2b,
    /** set_raw_scanning — toggles raw scanning mode (0/1). RAM-only. */
    setRawScanning: 0x2c,
    /** start/stop_xinput_detection — toggles gamepad detection. RAM-only. */
    startXinputDetection: 0x2d,
    stopXinputDetection: 0x2e,
    /** save_dks_profile — persists the DKS profile to flash (slot byte). FLASH. */
    saveDksProfile: 0x2f,
    /** save_akc_profile — persists the AKC profile to flash (slot byte). FLASH. */
    saveAkcProfile: 0x35,
    /** get_keyboard_profile — the active profile: actuation (field 1, mm × 20480), rapid trigger, etc. */
    getKeyboardProfile: 0x27,
    /** get_gamepad_mapping / get_gamepad_profile — gamepad layer (slot). */
    getGamepadMapping: 0x28,
    getGamepadProfile: 0x29,
    /** get_mapping_profile — key mapping blob for a slot. */
    getMappingProfile: 0x30,
    /** get_actuation_profile — per-key actuation overrides for a profile. */
    getActuationProfile: 0x31,
    /** get_rgb_profile_core — RGB profile core block. */
    getRgbProfileCore: 0x32,
    /** get_settings — global device settings protobuf. */
    getSettings: 0x33,
    /** get_akc_profile — advanced-keys-combo profile for a slot. */
    getAkcProfile: 0x34,
    /**
     * get_rapid_trigger_profile — Wootility's legacy `KeyPropertyProfile` read
     * (0x36). ARM boards answer an empty body even when per-key rapid trigger is
     * set; use {@link getFullRapidTriggerProfile} (0x3D) on ARM.
     */
    getRapidTriggerProfile: 0x36,
    /**
     * getFullRapidTriggerProfile — ARM per-key rapid-trigger groups (Wootility
     * 5.4.2 `getFullRapidTriggerProfile`, report 0x3D; pair of output 0x1D).
     * Firmware gate in Wootility: ARM and version >= 2.10.0-alpha.0.
     */
    getFullRapidTriggerProfile: 0x3d,
    /** get_profile_metadata — slot metadata protobuf (payload length + name). */
    getProfileMetadata: 0x37,
    /** is_flash_chip_connected — nonzero when the flash chip answers. */
    isFlashChipConnected: 0x38,
    /** get_rgb_layer — RGB layer block. */
    getRgbLayer: 0x39,
    /** get_flash_stats — flash usage stats. */
    getFlashStats: 0x3a,
    /** get_rgb_bins — RGB bin calibration. */
    getRgbBins: 0x3b,
    /** get_rgb_profile_colors_1/2 — RGB profile colour pages. */
    getRgbProfileColors1: 0x23,
    getRgbProfileColors2: 0x24,
};
/** Total key travel of a Wooting Lekker/analog switch, in millimetres (0–255 maps onto this). */
export const WOOTING_TRAVEL_MM = 4.0;
/** Convert a raw 0–255 analog value to millimetres of travel. */
export function wootingAnalogMm(value) {
    return (value / 255) * WOOTING_TRAVEL_MM;
}
function readVarint(data, at) {
    let result = 0;
    let shift = 0;
    let i = at;
    while (i < data.length) {
        const byte = data[i];
        result += (byte & 0x7f) * 2 ** shift;
        i += 1;
        if ((byte & 0x80) === 0)
            break;
        shift += 7;
    }
    return [result, i];
}
/**
 * Decode a protobuf message into its raw fields — no schema needed, because the
 * wire format tags every field with its number and type. Used to read the
 * Wooting profile blob and pick out the actuation / rapid-trigger values by
 * correlating with known settings. Returns [] if the bytes are not valid protobuf.
 */
export function decodeProtobufFields(data) {
    const fields = [];
    let i = 0;
    while (i < data.length) {
        const [tag, afterTag] = readVarint(data, i);
        if (tag === 0)
            break;
        i = afterTag;
        const field = Math.floor(tag / 8);
        const wire = tag & 7;
        if (wire === 0) {
            const [value, next] = readVarint(data, i);
            fields.push({ field, wire, int: value });
            i = next;
        }
        else if (wire === 2) {
            const [len, next] = readVarint(data, i);
            i = next;
            if (i + len > data.length)
                break;
            fields.push({ field, wire, bytes: data.slice(i, i + len) });
            i += len;
        }
        else if (wire === 5) {
            if (i + 4 > data.length)
                break;
            const view = new DataView(data.buffer, data.byteOffset + i, 4);
            fields.push({ field, wire, int: view.getUint32(0, true), float: view.getFloat32(0, true) });
            i += 4;
        }
        else if (wire === 1) {
            if (i + 8 > data.length)
                break;
            const view = new DataView(data.buffer, data.byteOffset + i, 8);
            fields.push({ field, wire, int: Number(view.getBigUint64(0, true)), float: view.getFloat64(0, true) });
            i += 8;
        }
        else {
            break;
        }
    }
    return fields;
}
/** True when `reply` is a usable answer to `commandId`: long enough, echoing the command, status OK. */
function wootingCheckedReply(reply, commandId, minLength) {
    return reply.length >= minLength && reply[2] === commandId && wootingReplyOk(reply);
}
/**
 * Body of a length-prefixed profile-blob reply (u16LE length at payload offset
 * 0, body follows), or null when the reply is unusable. The returned view
 * shares the reply buffer — no copy.
 */
function wootingBlobBody(reply, commandId) {
    if (!wootingCheckedReply(reply, commandId, 6))
        return null;
    const length = reply[4] | (reply[5] << 8);
    if (reply.length < 6 + length)
        return null;
    return reply.subarray(6, 6 + length);
}
/**
 * Body of a length-prefixed profile reply for either framing: ARM multi-report
 * uses a u16 length at offset 4 and body at 6; Standard uses a u8 length at 4
 * and body at 5. Returns a view into `reply`, or null when unusable.
 */
export function decodeWootingReplyBody(reply, commandId, { multiReport = true } = {}) {
    if (multiReport)
        return wootingBlobBody(reply, commandId);
    if (!wootingCheckedReply(reply, commandId, 5))
        return null;
    const length = reply[4];
    if (reply.length < 5 + length)
        return null;
    return reply.subarray(5, 5 + length);
}
/** Nested varint field `n` of a profile blob, or null when it is absent. */
function wootingFieldAt(fields, n) {
    return fields.find((entry) => entry.field === n)?.value ?? null;
}
/** Nested varint field `n` read as a flag (nonzero = true), or null when absent. */
function wootingFlagAt(fields, n) {
    const value = wootingFieldAt(fields, n);
    return value === null ? null : value !== 0;
}
/** Little-endian u16 at `at`, or null when the buffer ends first. */
function wootingU16LE(bytes, at) {
    return bytes.length >= at + 2 ? (bytes[at] | (bytes[at + 1] << 8)) : null;
}
/**
 * Raw payload of a fixed (non-length-prefixed) reply starting at index 4, or
 * null when the reply is unusable. The returned view shares the reply buffer.
 */
function wootingRawPayload(reply, commandId, minLength) {
    if (!wootingCheckedReply(reply, commandId, minLength))
        return null;
    return reply.subarray(4);
}
/**
 * Decode the nested-message fields of a 0x27 profile reply
 * (`magic magic cmd status <len:u16> 0a <len> <nested>`). Returns the nested
 * message's varint fields as {field, value}. Only 0x27 carries this shape on
 * ARM — every other profile blob holds opaque binary rows, so this helper
 * MUST NOT be used for 0x0D/0x18/0x28/0x29/0x30/0x31/0x33/0x34/0x36.
 */
export function decodeWootingProfileFields(reply, options = {}) {
    const body = decodeWootingReplyBody(reply, reply[2] ?? -1, options);
    if (!body)
        return [];
    const nested = decodeProtobufFields(body).find((field) => field.field === 1 && field.bytes);
    if (!nested?.bytes)
        return [];
    return decodeProtobufFields(nested.bytes)
        .filter((field) => field.int !== undefined)
        .map((field) => ({ field: field.field, value: field.int }));
}
/**
 * Millimetres of actuation from the keyboard profile's raw value. Confirmed on a
 * 60HE+ across two settings: 1.00mm → 20480, 0.50mm → 18432, i.e. a line
 * `raw = 16384 + mm * 4096` (raw 0x4000 = 0mm, 0x8000 = 4mm).
 */
export const WOOTING_ACTUATION_ZERO = 16384;
export const WOOTING_ACTUATION_UNITS_PER_MM = 4096;
export function wootingActuationMm(raw) {
    return (raw - WOOTING_ACTUATION_ZERO) / WOOTING_ACTUATION_UNITS_PER_MM;
}
/**
 * Decode the live `get_keyboard_profile` (0x27) reply. Field numbers are the
 * live 60HE+ capture (`0a1408b3860110011801209a83012800300238004800`):
 * f1 = actuation raw, f2 = digital output, f3 = RT enable, f4 = RT sensitivity,
 * f5 = Tachyon enable, f6 = tick rate, f7 = strict actuation range, f9 = Tachyon mode.
 * Returns null on error status, command mismatch, or a truncated header.
 */
export function decodeWootingKeyboardProfile(reply, options = {}) {
    if (!decodeWootingReplyBody(reply, WOOTING_COMMAND.getKeyboardProfile, options))
        return null;
    const fields = decodeWootingProfileFields(reply, options);
    const actuationRaw = wootingFieldAt(fields, 1);
    return {
        actuationRaw,
        actuationMm: actuationRaw === null ? null : wootingActuationMm(actuationRaw),
        digitalOutputEnabled: wootingFlagAt(fields, 2),
        rapidTriggerEnabled: wootingFlagAt(fields, 3),
        pressSensitivityRaw: wootingFieldAt(fields, 4),
        releaseSensitivityRaw: wootingFieldAt(fields, 4),
        rapidTriggerSensitivityRaw: wootingFieldAt(fields, 4),
        releaseThresholdRaw: wootingFieldAt(fields, 5),
        tachyonEnabled: wootingFlagAt(fields, 5),
        curvePreset: wootingFieldAt(fields, 6),
        tickRate: wootingFieldAt(fields, 6),
        continuousRapidTrigger: wootingFlagAt(fields, 7),
        rapidTriggerStrictActuationRange: wootingFlagAt(fields, 7),
        tachyonMode: wootingFieldAt(fields, 9),
        fields,
    };
}
export function decodeWootingAnalogProfileMainPart(reply) {
    if (!wootingCheckedReply(reply, WOOTING_COMMAND.getAnalogProfileMainPart, 6))
        return null;
    const fields = decodeWootingProfileFields(reply);
    const actuationRaw = wootingFieldAt(fields, 1);
    return {
        actuationRaw,
        actuationMm: actuationRaw === null ? null : wootingActuationMm(actuationRaw),
        rapidTriggerEnabled: wootingFlagAt(fields, 2),
        pressSensitivityRaw: wootingFieldAt(fields, 3),
        releaseSensitivityRaw: wootingFieldAt(fields, 4),
        continuousRapidTrigger: wootingFlagAt(fields, 5),
        fields,
    };
}
export function decodeWootingRapidTriggerProfile(reply) {
    if (!wootingCheckedReply(reply, WOOTING_COMMAND.getRapidTriggerProfile, 6))
        return null;
    const fields = decodeWootingProfileFields(reply);
    return {
        enabled: wootingFlagAt(fields, 1),
        pressSensitivityRaw: wootingFieldAt(fields, 2),
        releaseSensitivityRaw: wootingFieldAt(fields, 3),
        continuous: wootingFlagAt(fields, 4),
        fields,
    };
}
/** Read every varint in a packed repeated numeric field. */
function wootingPackedVarints(bytes) {
    const values = [];
    let at = 0;
    while (at < bytes.length) {
        const [value, end] = readVarint(bytes, at);
        if (end <= at || (bytes[end - 1] & 0x80))
            throw new Error("Truncated Wooting packed varint.");
        values.push(value);
        at = end;
    }
    return values;
}
function decodeWootingRapidTriggerConfig(bytes) {
    const fields = decodeProtobufFields(bytes);
    const primary = fields.find((entry) => entry.field === 1)?.int ?? null;
    const secondary = fields.find((entry) => entry.field === 2)?.int ?? null;
    const continuous = fields.find((entry) => entry.field === 3)?.int;
    return {
        primarySensitivityRaw: primary,
        primarySensitivityMm: primary === null ? null : wootingActuationMm(primary),
        secondarySensitivityRaw: secondary,
        secondarySensitivityMm: secondary === null ? null : wootingActuationMm(secondary),
        continuousMode: continuous === undefined ? null : continuous !== 0,
    };
}
/** Decode a `RapidTriggerProfile` protobuf body (no reply header). */
export function decodeWootingRapidTriggerProfileBody(body) {
    const groups = [];
    for (const outer of decodeProtobufFields(body)) {
        if (outer.field !== 1 || !outer.bytes)
            continue;
        const keys = [];
        let enabled = null;
        let config = null;
        for (const field of decodeProtobufFields(outer.bytes)) {
            if (field.field === 1) {
                if (field.int !== undefined)
                    keys.push(field.int);
                if (field.bytes)
                    keys.push(...wootingPackedVarints(field.bytes));
            }
            else if (field.field === 2 && field.bytes) {
                config = decodeWootingRapidTriggerConfig(field.bytes);
            }
            else if (field.field === 3 && field.int !== undefined) {
                enabled = field.int !== 0;
            }
        }
        groups.push({ keys, enabled, config });
    }
    return groups;
}
export function decodeWootingFullRapidTriggerProfile(reply) {
    const body = wootingBlobBody(reply, WOOTING_COMMAND.getFullRapidTriggerProfile);
    if (!body)
        return null;
    try {
        return { mode: "full", groups: decodeWootingRapidTriggerProfileBody(body), raw: body };
    }
    catch {
        return null;
    }
}
function wootingKeyPropertyValue(value) {
    if (value !== 0 && value !== 1 && value !== 2)
        throw new Error(`Unknown Wooting key-property value ${value}.`);
    return value;
}
/** Decode a `KeyPropertyProfile` protobuf body (no reply header). */
export function decodeWootingKeyPropertyProfileBody(body) {
    const entries = [];
    let form = "partial";
    let rows = 0;
    let columns = 0;
    for (const field of decodeProtobufFields(body)) {
        if (field.field === 1 && field.bytes) {
            form = "full";
            const matrixRows = decodeProtobufFields(field.bytes).filter((row) => row.field === 1 && row.bytes);
            rows = matrixRows.length;
            for (const [rowIndex, row] of matrixRows.entries()) {
                const values = decodeProtobufFields(row.bytes).find((entry) => entry.field === 1 && entry.bytes)?.bytes;
                if (!values)
                    continue;
                columns = Math.max(columns, values.length);
                for (let col = 0; col < values.length; col += 1) {
                    const key = (rowIndex << 5) | col;
                    if (decodeWootingKeyIndex(key) === null)
                        continue;
                    entries.push({ key, value: wootingKeyPropertyValue(values[col]) });
                }
            }
        }
        else if (field.field === 2 && field.bytes) {
            form = "partial";
            for (const entry of decodeProtobufFields(field.bytes)) {
                if (entry.field !== 1)
                    continue;
                if (entry.int !== undefined) {
                    const key = entry.int & 0xff;
                    if (decodeWootingKeyIndex(key) !== null)
                        entries.push({ key, value: wootingKeyPropertyValue((entry.int >> 8) & 0xff) });
                }
                if (entry.bytes)
                    for (const packed of wootingPackedVarints(entry.bytes)) {
                        const key = packed & 0xff;
                        if (decodeWootingKeyIndex(key) !== null)
                            entries.push({ key, value: wootingKeyPropertyValue((packed >> 8) & 0xff) });
                    }
            }
        }
    }
    return { form, entries, rows, columns, raw: body };
}
export function decodeWootingKeyPropertyProfile(reply, options = {}) {
    const body = decodeWootingReplyBody(reply, WOOTING_COMMAND.getRapidTriggerProfile, options);
    if (!body)
        return null;
    try {
        return decodeWootingKeyPropertyProfileBody(body);
    }
    catch {
        return null;
    }
}
/**
 * Normalize a legacy KeyPropertyProfile into the same per-key group shape as
 * the full ARM profile. Values 1/2 become explicit off/on groups; value 0
 * (follow base) is omitted.
 */
export function wootingKeyPropertyGroups(profile) {
    const groups = [];
    for (const { key, value } of profile.entries) {
        if (value === 0)
            continue;
        const group = groups.find((candidate) => candidate.enabled === (value === 2));
        if (group)
            group.keys.push(key);
        else
            groups.push({ keys: [key], enabled: value === 2, config: null });
    }
    return groups;
}
export function decodeWootingPartialRapidTriggerProfile(reply, options = {}) {
    const profile = decodeWootingKeyPropertyProfile(reply, options);
    if (!profile)
        return null;
    return { mode: "partial", groups: wootingKeyPropertyGroups(profile), raw: profile.raw };
}
export function decodeWootingActuationProfile(reply, options = {}) {
    const body = decodeWootingReplyBody(reply, WOOTING_COMMAND.getActuationProfile, options);
    if (!body)
        return null;
    const armProperties = decodeProtobufFields(body).filter((field) => field.field === 4 && field.bytes);
    if (!armProperties.length && body.length) {
        return {
            overrides: decodeWootingProfileFields(reply, options).map(({ field, value }) => ({
                key: field - 1,
                actuationRaw: value,
                actuationMm: wootingActuationMm(value),
            })),
            raw: body,
        };
    }
    const values = [];
    for (const outer of armProperties) {
        for (const inner of decodeProtobufFields(outer.bytes)) {
            if (inner.field !== 1)
                continue;
            if (inner.int !== undefined)
                values.push(inner.int);
            if (inner.bytes) {
                for (let at = 0; at < inner.bytes.length;) {
                    const [value, end] = readVarint(inner.bytes, at);
                    if (end <= at || end > inner.bytes.length || (inner.bytes[end - 1] & 0x80))
                        return null;
                    values.push(value);
                    at = end;
                }
            }
        }
    }
    return {
        overrides: values.map((value) => ({
            key: value % 65536,
            actuationRaw: Math.floor(value / 65536),
            actuationMm: wootingActuationMm(Math.floor(value / 65536)),
        })),
        raw: body,
    };
}
export function decodeWootingMappingProfile(reply, commandId = WOOTING_COMMAND.getMappingProfile) {
    if (commandId !== WOOTING_COMMAND.getMappingProfile
        && commandId !== WOOTING_COMMAND.getMainMappingProfile
        && commandId !== WOOTING_COMMAND.getFunctionMappingProfile)
        return null;
    const body = wootingBlobBody(reply, commandId);
    if (!body)
        return null;
    const groups = [];
    for (const outer of decodeProtobufFields(body)) {
        const inner = outer.field === 1 && outer.bytes
            ? decodeProtobufFields(outer.bytes).find((field) => field.field === 1 && field.bytes)?.bytes
            : undefined;
        if (inner)
            groups.push(inner);
    }
    return { groups, raw: body };
}
/** `get_main_mapping_profile` (0x11): the primary-layer map rows. */
export function decodeWootingMainMappingProfile(reply) {
    return decodeWootingMappingProfile(reply, WOOTING_COMMAND.getMainMappingProfile);
}
/** `get_function_mapping_profile` (0x12): the function-layer map rows. */
export function decodeWootingFunctionMappingProfile(reply) {
    return decodeWootingMappingProfile(reply, WOOTING_COMMAND.getFunctionMappingProfile);
}
export function decodeWootingDksProfile(reply) {
    if (!wootingCheckedReply(reply, WOOTING_COMMAND.getDksProfile, 6))
        return null;
    const length = reply[4] | (reply[5] << 8);
    const body = reply.subarray(6, 6 + length);
    return { cellCount: length, raw: body };
}
/** Decode a Wootility matrix key index, or null when it is the empty slot. */
export function decodeWootingKeyIndex(index) {
    const col = index & 0x1f;
    const row = (index >> 5) & 0x7;
    if (col === 31 && row === 7)
        return null;
    return { row, col };
}
/**
 * Firmware matrix → UI key id for the 60% layout (from the RGB SDK's
 * `keyboard-matrix-rows-columns.png`: matrix row 1 = number row, matrix
 * row 2 = Q row, matrix row 3 = A row, matrix row 4 = Z row, matrix row 5
 * = bottom row; columns count the Esc column as 0). Only positions present
 * on a 60% board are listed — function-row, nav-cluster, and numpad
 */
const WOOTING_60_MATRIX_TO_KEY = {
    "1:0": "esc",
    "1:1": "1", "1:2": "2", "1:3": "3", "1:4": "4", "1:5": "5",
    "1:6": "6", "1:7": "7", "1:8": "8", "1:9": "9", "1:10": "0",
    "1:11": "minus", "1:12": "equal", "1:13": "backspace",
    "2:0": "tab",
    "2:1": "q", "2:2": "w", "2:3": "e", "2:4": "r", "2:5": "t",
    "2:6": "y", "2:7": "u", "2:8": "i", "2:9": "o", "2:10": "p",
    "2:11": "lbracket", "2:12": "rbracket", "2:13": "backslash",
    "3:0": "caps",
    "3:1": "a", "3:2": "s", "3:3": "d", "3:4": "f", "3:5": "g",
    "3:6": "h", "3:7": "j", "3:8": "k", "3:9": "l",
    "3:10": "semicolon", "3:11": "quote", "3:13": "enter",
    "4:0": "lshift",
    "4:2": "z", "4:3": "x", "4:4": "c", "4:5": "v", "4:6": "b",
    "4:7": "n", "4:8": "m", "4:9": "comma", "4:10": "period",
    "4:11": "slash", "4:13": "rshift",
    "5:0": "lctrl", "5:1": "lwin", "5:2": "lalt", "5:6": "space",
    "5:10": "ralt", "5:11": "rctrl", "5:12": "menu", "5:13": "rctrl",
    "5:14": "fn1",
};
/**
 * UI key id for a firmware matrix position, or null when no 60% key lives
 * there (function-row/nav/numpad columns, ISO extras, gaps). Never guesses:
 * an unmapped position is null, and the caller renders the raw (row,col).
 */
export function wootingMatrixKeyId(row, col) {
    return WOOTING_60_MATRIX_TO_KEY[`${row}:${col}`] ?? null;
}
/** Human label for a SOCD mode. Modes 0–2 have no UI string; shown as-is. */
export function wootingSocdModeLabel(mode) {
    switch (mode) {
        case 0: return "Both";
        case 1: return "Neither";
        case 2: return "Primary Priority";
        case 3: return "Secondary Priority";
        case 4: return "Last Input Priority";
        default: return `Mode ${mode}`;
    }
}
export function wootingJitActivationLabel(value) {
    switch (value) {
        case 0: return "Hold Modifiers";
        case 1: return "Never";
        case 2: return "Hold Always";
        case 3: return "Tap Always";
        default: return `Mode ${value}`;
    }
}
/** Map an entry oneof field number to its kind (dks = 1 … socd = 5). */
function wootingAkcKind(field) {
    switch (field) {
        case 1: return "dks";
        case 2: return "modTap";
        case 3: return "toggleKey";
        case 4: return "rappySnappy";
        case 5: return "socd";
        default: return null;
    }
}
export function decodeWootingAkcProfile(reply) {
    const body = wootingBlobBody(reply, WOOTING_COMMAND.getAkcProfile);
    if (!body)
        return null;
    const combos = [];
    const fields = [];
    for (const outer of decodeProtobufFields(body)) {
        if (!outer.bytes)
            continue;
        fields.push({ field: outer.field, raw: outer.bytes });
        if (outer.field !== 1)
            continue;
        const entry = decodeProtobufFields(outer.bytes);
        const keyField = entry.find((field) => field.field === 8 && field.int !== undefined);
        const layerField = entry.find((field) => field.field === 9 && field.int !== undefined);
        const payloadField = entry.find((field) => field.bytes && wootingAkcKind(field.field) !== null);
        const kind = payloadField ? wootingAkcKind(payloadField.field) : "unknown";
        let secondaryKeyIndex = null;
        let socdMode = null;
        let inputBothWhenBottomedOut = null;
        if (payloadField?.bytes && (kind === "rappySnappy" || kind === "socd")) {
            for (const sub of decodeProtobufFields(payloadField.bytes)) {
                if (sub.field === 1 && sub.int !== undefined)
                    secondaryKeyIndex = sub.int;
                else if (sub.field === 2 && sub.int !== undefined)
                    socdMode = sub.int;
                else if (sub.field === 3 && sub.int !== undefined)
                    inputBothWhenBottomedOut = sub.int !== 0;
            }
        }
        combos.push({
            keyIndex: keyField?.int ?? -1,
            key: keyField?.int === undefined ? null : decodeWootingKeyIndex(keyField.int),
            layer: layerField?.int ?? 0,
            kind,
            secondaryKeyIndex,
            secondaryKey: secondaryKeyIndex === null ? null : decodeWootingKeyIndex(secondaryKeyIndex),
            socdMode,
            inputBothWhenBottomedOut,
            payload: payloadField?.bytes ?? null,
            raw: outer.bytes,
        });
    }
    if (combos.length === 0)
        return null;
    const outerFields = decodeProtobufFields(body);
    return {
        combos,
        startPoint: outerFields.find((field) => field.field === 2)?.int ?? 0,
        totalItems: outerFields.find((field) => field.field === 3)?.int ?? combos.length,
        fields,
        raw: body,
    };
}
export function decodeWootingGamepadProfile(reply) {
    const body = wootingBlobBody(reply, WOOTING_COMMAND.getGamepadProfile);
    if (!body)
        return null;
    const groups = [];
    const fields = [];
    let mode = null;
    for (const outer of decodeProtobufFields(body)) {
        if (!outer.bytes)
            continue;
        fields.push({ field: outer.field, raw: outer.bytes });
        if (outer.field === 1)
            groups.push(outer.bytes);
        else if (outer.field === 2) {
            mode = decodeProtobufFields(outer.bytes).find((inner) => inner.field === 3)?.int ?? null;
        }
    }
    if (groups.length === 0)
        return null;
    return { groups, mode, fields, raw: body };
}
export function decodeWootingGamepadMapping(reply) {
    if (!wootingCheckedReply(reply, WOOTING_COMMAND.getGamepadMapping, 6))
        return null;
    const length = reply[4] | (reply[5] << 8);
    const body = reply.subarray(6, 6 + length);
    return { bindingCount: length, raw: body };
}
function decodeWootingRgbBlock(reply, commandId) {
    const body = wootingBlobBody(reply, commandId);
    if (!body)
        return null;
    const groups = [];
    let trailer = null;
    for (const outer of decodeProtobufFields(body)) {
        if (!outer.bytes)
            continue;
        if (outer.field === 1)
            groups.push(outer.bytes);
        else if (!trailer)
            trailer = outer.bytes;
    }
    if (groups.length === 0)
        return null;
    return { commandId, groups, trailer, raw: body };
}
/** `get_rgb_profile_core` (0x32): the RGB profile core block. */
export function decodeWootingRgbProfileCore(reply) {
    return decodeWootingRgbBlock(reply, WOOTING_COMMAND.getRgbProfileCore);
}
export function wootingRgb565ToColor(value) {
    const red = (value & 0xf800) >> 8;
    const green = (value & 0x07e0) >> 3;
    const blue = (value & 0x001f) << 3;
    return {
        red: red === 0 ? 0 : red + 7,
        green: green === 0 ? 0 : green + 3,
        blue: blue === 0 ? 0 : blue + 7,
    };
}
export function wootingColorToRgb565({ red, green, blue }) {
    return ((red & 0xf8) << 8) | ((green & 0xfc) << 3) | (blue >> 3);
}
function wootingZigZagDecode(value) {
    return (value >>> 1) ^ -(value & 1);
}
function wootingZigZagEncode(value) {
    return (value << 1) ^ (value >> 31);
}
const WOOTING_RGB_EFFECT_FIELDS = {
    wave: 1, scan: 2, breath: 3, cycle: 4, keyRipple: 5, keyTrail: 6,
    analogTouch: 7, analogJelly: 8, analogBomb: 9, analogMixing: 10,
    rapidTrigger: 11, snake: 12, heatmap: 13, noise: 14, spiral: 15,
};
function decodeWootingRgbEffect(field, bytes) {
    const fields = decodeProtobufFields(bytes);
    const at = (number) => fields.find((entry) => entry.field === number)?.int ?? 0;
    const optional = (number) => fields.find((entry) => entry.field === number)?.int ?? null;
    switch (field) {
        case 1: return { kind: "wave", color: at(1), speed: at(2), direction: at(3) };
        case 2: return { kind: "scan", size: at(1), speed: at(2), baseBrightness: at(3), direction: at(4) };
        case 3: return { kind: "breath", speed: at(1), secondaryBrightness: at(3) };
        case 4: return { kind: "cycle", color: at(1), speed: at(2) };
        case 5: return { kind: "keyRipple", flags: at(1), rippleSpeed: at(2), fadeSpeed: at(3), baseBrightness: at(4) };
        case 6: return { kind: "keyTrail", baseBrightness: at(1), speed: at(2), flags: at(3), color: optional(4) };
        case 7: return { kind: "analogTouch", baseBrightness: at(1), useAnalogCurve: at(2) !== 0, mode: at(3), leftKey: at(4), rightKey: at(5) };
        case 8: return { kind: "analogJelly", baseBrightness: at(1), useAnalogCurve: at(2) !== 0 };
        case 9: return { kind: "analogBomb", baseBrightness: at(1), useAnalogCurve: at(2) !== 0 };
        case 10: return { kind: "analogMixing", useAnalogCurve: at(1) !== 0 };
        case 11: return { kind: "rapidTrigger", baseBrightness: at(1) };
        case 12: return { kind: "snake", size: at(1), baseBrightness: at(2), direction: at(3), mode: at(4), passiveSpeed: at(5), accelerationCurve: at(6), decaySpeed: at(7) };
        case 13: return { kind: "heatmap" };
        case 14: return { kind: "noise", primaryColour: at(1), secondaryColour: at(2), speed: at(3), scale: at(4) };
        case 15: return { kind: "spiral", primaryColour: at(1), secondaryColour: at(2), speed: wootingZigZagDecode(at(3)), spiral: wootingZigZagDecode(at(4)) };
        default: return null;
    }
}
/** Decode a complete `RgbProfileCore` reply into base, legacy effect, and layers. */
export function decodeWootingRgbCore(reply, options = {}) {
    const body = decodeWootingReplyBody(reply, WOOTING_COMMAND.getRgbProfileCore, options);
    if (!body)
        return null;
    let base = null;
    let legacy = null;
    let layers = null;
    for (const outer of decodeProtobufFields(body)) {
        if (outer.field === 1 && outer.bytes) {
            const fields = decodeProtobufFields(outer.bytes);
            const at = (number) => fields.find((entry) => entry.field === number)?.int ?? 0;
            base = {
                brightness: at(1),
                capsLockActiveColor: at(2),
                fnLockActiveColor: at(3),
                scrollLockActiveColor: fields.find((entry) => entry.field === 4)?.int ?? null,
                numLockActiveColor: fields.find((entry) => entry.field === 5)?.int ?? null,
            };
        }
        else if (outer.field === 3 && outer.bytes) {
            const fields = decodeProtobufFields(outer.bytes);
            const at = (number) => fields.find((entry) => entry.field === number)?.int ?? 0;
            legacy = {
                effect: at(1),
                speed: at(3),
                colorChoice: at(4),
                size: at(5),
                special: at(6),
                idleBrightness: fields.find((entry) => entry.field === 7)?.int ?? null,
            };
        }
        else if (outer.field === 4 && outer.bytes) {
            layers = [];
            for (const layer of decodeProtobufFields(outer.bytes)) {
                if (layer.field !== 1 || !layer.bytes)
                    continue;
                for (const effect of decodeProtobufFields(layer.bytes)) {
                    if (!effect.bytes)
                        continue;
                    const decoded = decodeWootingRgbEffect(effect.field, effect.bytes);
                    if (decoded)
                        layers.push(decoded);
                }
            }
        }
    }
    return { base, legacy, layers, raw: body };
}
function encodeWootingRgbEffect(effect) {
    const bytes = [];
    const add = (field, value) => {
        bytes.push(field * 8, ...wootingVarintBytes(value));
    };
    switch (effect.kind) {
        case "wave":
            add(1, effect.color);
            add(2, effect.speed);
            add(3, effect.direction);
            break;
        case "scan":
            add(1, effect.size);
            add(2, effect.speed);
            add(3, effect.baseBrightness);
            add(4, effect.direction);
            break;
        case "breath":
            add(1, effect.speed);
            add(3, effect.secondaryBrightness);
            break;
        case "cycle":
            add(1, effect.color);
            add(2, effect.speed);
            break;
        case "keyRipple":
            add(1, effect.flags);
            add(2, effect.rippleSpeed);
            add(3, effect.fadeSpeed);
            add(4, effect.baseBrightness);
            break;
        case "keyTrail":
            add(1, effect.baseBrightness);
            add(2, effect.speed);
            add(3, effect.flags);
            if (effect.color !== null)
                add(4, effect.color);
            break;
        case "analogTouch":
            add(1, effect.baseBrightness);
            add(2, Number(effect.useAnalogCurve));
            add(3, effect.mode);
            add(4, effect.leftKey);
            add(5, effect.rightKey);
            break;
        case "analogJelly":
            add(1, effect.baseBrightness);
            add(2, Number(effect.useAnalogCurve));
            break;
        case "analogBomb":
            add(1, effect.baseBrightness);
            add(2, Number(effect.useAnalogCurve));
            break;
        case "analogMixing":
            add(1, Number(effect.useAnalogCurve));
            break;
        case "rapidTrigger":
            add(1, effect.baseBrightness);
            break;
        case "snake":
            add(1, effect.size);
            add(2, effect.baseBrightness);
            add(3, effect.direction);
            add(4, effect.mode);
            add(5, effect.passiveSpeed);
            add(6, effect.accelerationCurve);
            add(7, effect.decaySpeed);
            break;
        case "heatmap": break;
        case "noise":
            add(1, effect.primaryColour);
            add(2, effect.secondaryColour);
            add(3, effect.speed);
            add(4, effect.scale);
            break;
        case "spiral":
            add(1, effect.primaryColour);
            add(2, effect.secondaryColour);
            add(3, wootingZigZagEncode(effect.speed));
            add(4, wootingZigZagEncode(effect.spiral));
            break;
    }
    return Uint8Array.from(bytes);
}
/** Encode a complete `RgbProfileCore` message (core fields only). */
export function encodeWootingRgbCore(core) {
    if (core.legacy && core.layers)
        throw new Error("Wooting RGB core cannot carry both legacy and V2 effects.");
    const bytes = [];
    if (core.base) {
        const base = [0x08, ...wootingVarintBytes(core.base.brightness),
            0x10, ...wootingVarintBytes(core.base.capsLockActiveColor),
            0x18, ...wootingVarintBytes(core.base.fnLockActiveColor)];
        if (core.base.scrollLockActiveColor !== null)
            base.push(0x20, ...wootingVarintBytes(core.base.scrollLockActiveColor));
        if (core.base.numLockActiveColor !== null)
            base.push(0x28, ...wootingVarintBytes(core.base.numLockActiveColor));
        bytes.push(0x0a, ...wootingVarintBytes(base.length), ...base);
    }
    if (core.legacy) {
        const legacy = [0x08, ...wootingVarintBytes(core.legacy.effect),
            0x18, ...wootingVarintBytes(core.legacy.speed),
            0x20, ...wootingVarintBytes(core.legacy.colorChoice),
            0x28, ...wootingVarintBytes(core.legacy.size),
            0x30, ...wootingVarintBytes(core.legacy.special)];
        if (core.legacy.idleBrightness !== null)
            legacy.push(0x38, ...wootingVarintBytes(core.legacy.idleBrightness));
        bytes.push(0x1a, ...wootingVarintBytes(legacy.length), ...legacy);
    }
    if (core.layers) {
        const effects = [];
        for (const effect of core.layers) {
            const payload = encodeWootingRgbEffect(effect);
            const layer = [WOOTING_RGB_EFFECT_FIELDS[effect.kind] * 8 + 2, ...wootingVarintBytes(payload.length), ...payload];
            effects.push(0x0a, ...wootingVarintBytes(layer.length), ...layer);
        }
        bytes.push(0x22, ...wootingVarintBytes(effects.length), ...effects);
    }
    return Uint8Array.from(bytes);
}
export function decodeWootingRgbProfileColors(reply) {
    const echoed = reply[2] ?? -1;
    if (echoed !== WOOTING_COMMAND.getRgbProfileColors1 && echoed !== WOOTING_COMMAND.getRgbProfileColors2)
        return null;
    const block = decodeWootingRgbBlock(reply, echoed);
    if (!block)
        return null;
    return { ...block, part: echoed === WOOTING_COMMAND.getRgbProfileColors1 ? 1 : 2 };
}
export function decodeWootingRgbColors(reply, options = {}) {
    const echoed = reply[2] ?? -1;
    const part = echoed === WOOTING_COMMAND.getRgbProfileColors1
        ? 1
        : echoed === WOOTING_COMMAND.getRgbProfileColors2
            ? 2
            : null;
    if (part === null)
        return null;
    const body = decodeWootingReplyBody(reply, echoed, options);
    if (!body)
        return null;
    const rows = [];
    for (const outer of decodeProtobufFields(body)) {
        if (outer.field !== 1 || !outer.bytes)
            continue;
        const values = [];
        for (const field of decodeProtobufFields(outer.bytes)) {
            if (field.field !== 1)
                continue;
            if (field.int !== undefined)
                values.push(field.int);
            if (field.bytes)
                values.push(...wootingPackedVarints(field.bytes));
        }
        rows.push(values);
    }
    return { part, rows, raw: body };
}
/** Encode a `ColorsProfile` / `PartialColors` message from RGB565 rows. */
export function encodeWootingRgbColors(rows) {
    const bytes = [];
    for (const row of rows) {
        const values = [];
        for (const value of row) {
            if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
                throw new RangeError("Wooting RGB color must be a uint16 RGB565 value.");
            }
            values.push(...wootingVarintBytes(value));
        }
        const rowMessage = [0x0a, ...wootingVarintBytes(values.length), ...values];
        bytes.push(0x0a, ...wootingVarintBytes(rowMessage.length), ...rowMessage);
    }
    return Uint8Array.from(bytes);
}
/** Frame a color page as output 0x0E (part 1) or 0x0F (part 2). */
export function encodeWootingRgbColorsReport(part, rows, options = {}) {
    return encodeWootingProfileReport(part === 1 ? WOOTING_COMMAND.getAnalogProfileCurve1 : WOOTING_COMMAND.getAnalogProfileCurve2, encodeWootingRgbColors(rows), options);
}
/** Maximum usable RGB effect layers for a model (Wootility descriptor). */
const WOOTING_RGB_LAYER_LIMITS = {
    "Wooting One": 1,
    "Wooting Two": 1,
    "Wooting Two Lekker Edition": 1,
    "Wooting Two HE (AVR)": 1,
    "Wooting Two HE (ARM)": 4,
    "Wooting 60HE (AVR)": 2,
    "Wooting 60HE (ARM)": 4,
    "Wooting 60HE+": 4,
    "Wooting 60HE v2": 4,
    "Wooting 80HE": 4,
    "Wooting 80HE+": 4,
    "Wooting UwU": 0,
    "Wooting UwU RGB": 3,
};
export function wootingRgbLayerLimit(productId) {
    const model = wootingModel(productId);
    return model?.hasRGB ? WOOTING_RGB_LAYER_LIMITS[model.name] ?? 0 : 0;
}
const WOOTING_RGB_COLOR_THEMES = {
    0: "Rainbow", 1: "Navy", 2: "Fire", 3: "Summer", 4: "Hot", 5: "Blue Spectrum",
};
const WOOTING_RGB_DIRECTIONS = {
    0: "Left", 1: "Right", 2: "Up", 3: "Down",
};
const WOOTING_RGB_TOUCH_MODES = {
    0: "Bottom to top", 1: "To sides",
};
const WOOTING_RGB_TOUCH_KEYS = {
    0: "First", 1: "Second",
};
const WOOTING_RGB_SNAKE_MODES = {
    0: "APM", 1: "Press/move",
};
const WOOTING_RGB_SNAKE_CURVES = {
    0: "Logarithmic", 1: "Exponential", 2: "Linear",
};
const WOOTING_RGB_EFFECT_FIELD_SPECS = {
    wave: [
        { key: "color", label: "Color theme", kind: "enum", options: WOOTING_RGB_COLOR_THEMES },
        { key: "speed", label: "Speed", kind: "number" },
        { key: "direction", label: "Direction", kind: "enum", options: WOOTING_RGB_DIRECTIONS },
    ],
    scan: [
        { key: "size", label: "Size", kind: "number" },
        { key: "speed", label: "Speed", kind: "number" },
        { key: "baseBrightness", label: "Base brightness", kind: "number" },
        { key: "direction", label: "Direction", kind: "enum", options: WOOTING_RGB_DIRECTIONS },
    ],
    breath: [
        { key: "speed", label: "Speed", kind: "number" },
        { key: "secondaryBrightness", label: "Secondary brightness", kind: "number" },
    ],
    cycle: [
        { key: "color", label: "Color theme", kind: "enum", options: WOOTING_RGB_COLOR_THEMES },
        { key: "speed", label: "Speed", kind: "number" },
    ],
    keyRipple: [
        { key: "flags", label: "Flags", kind: "number" },
        { key: "rippleSpeed", label: "Ripple speed", kind: "number" },
        { key: "fadeSpeed", label: "Fade speed", kind: "number" },
        { key: "baseBrightness", label: "Base brightness", kind: "number" },
    ],
    keyTrail: [
        { key: "baseBrightness", label: "Base brightness", kind: "number" },
        { key: "speed", label: "Speed", kind: "number" },
        { key: "flags", label: "Flags", kind: "number" },
        { key: "color", label: "Color", kind: "color" },
    ],
    analogTouch: [
        { key: "baseBrightness", label: "Base brightness", kind: "number" },
        { key: "useAnalogCurve", label: "Use analog curve", kind: "boolean" },
        { key: "mode", label: "Mode", kind: "enum", options: WOOTING_RGB_TOUCH_MODES },
        { key: "leftKey", label: "Left key", kind: "enum", options: WOOTING_RGB_TOUCH_KEYS },
        { key: "rightKey", label: "Right key", kind: "enum", options: WOOTING_RGB_TOUCH_KEYS },
    ],
    analogJelly: [
        { key: "baseBrightness", label: "Base brightness", kind: "number" },
        { key: "useAnalogCurve", label: "Use analog curve", kind: "boolean" },
    ],
    analogBomb: [
        { key: "baseBrightness", label: "Base brightness", kind: "number" },
        { key: "useAnalogCurve", label: "Use analog curve", kind: "boolean" },
    ],
    analogMixing: [{ key: "useAnalogCurve", label: "Use analog curve", kind: "boolean" }],
    rapidTrigger: [{ key: "baseBrightness", label: "Base brightness", kind: "number" }],
    snake: [
        { key: "size", label: "Size", kind: "number" },
        { key: "baseBrightness", label: "Base brightness", kind: "number" },
        { key: "direction", label: "Direction", kind: "enum", options: WOOTING_RGB_DIRECTIONS },
        { key: "mode", label: "Mode", kind: "enum", options: WOOTING_RGB_SNAKE_MODES },
        { key: "passiveSpeed", label: "Passive speed", kind: "number" },
        { key: "accelerationCurve", label: "Acceleration curve", kind: "enum", options: WOOTING_RGB_SNAKE_CURVES },
        { key: "decaySpeed", label: "Decay speed", kind: "number" },
    ],
    heatmap: [],
    noise: [
        { key: "primaryColour", label: "Primary color", kind: "color" },
        { key: "secondaryColour", label: "Secondary color", kind: "color" },
        { key: "speed", label: "Speed", kind: "number" },
        { key: "scale", label: "Scale", kind: "number" },
    ],
    spiral: [
        { key: "primaryColour", label: "Primary color", kind: "color" },
        { key: "secondaryColour", label: "Secondary color", kind: "color" },
        { key: "speed", label: "Speed", kind: "number" },
        { key: "spiral", label: "Spiral", kind: "number" },
    ],
};
/** Field descriptors for building an effect parameter editor. */
export function wootingRgbEffectFields(kind) {
    return WOOTING_RGB_EFFECT_FIELD_SPECS[kind];
}
/**
 * Wootility's default parameters for a newly added effect layer. Values come
 * from the renderer's `newEffect` defaults; color themes are enum values, while
 * Noise/Spiral use RGB565. UI slider ranges are not encoded in the protobuf.
 */
export function wootingRgbEffectDefaults(kind) {
    switch (kind) {
        case "wave": return { kind, color: 0, speed: 16, direction: 0 };
        case "scan": return { kind, size: 1, speed: 15, baseBrightness: 30, direction: 0 };
        case "breath": return { kind, speed: 15, secondaryBrightness: 0 };
        case "cycle": return { kind, color: 0, speed: 48 };
        case "keyRipple": return { kind, flags: 0, rippleSpeed: 20, fadeSpeed: 30, baseBrightness: 30 };
        case "keyTrail": return { kind, baseBrightness: 30, speed: 4, flags: 0, color: 0xffff };
        case "analogTouch": return { kind, baseBrightness: 30, useAnalogCurve: false, mode: 0, leftKey: 0, rightKey: 1 };
        case "analogJelly": return { kind, baseBrightness: 30, useAnalogCurve: false };
        case "analogBomb": return { kind, baseBrightness: 30, useAnalogCurve: false };
        case "analogMixing": return { kind, useAnalogCurve: false };
        case "rapidTrigger": return { kind, baseBrightness: 140 };
        case "snake": return { kind, size: 3, baseBrightness: 30, direction: 0, mode: 0, passiveSpeed: 190, accelerationCurve: 0, decaySpeed: 150 };
        case "heatmap": return { kind };
        case "noise": return {
            kind,
            primaryColour: wootingColorToRgb565({ red: 30, green: 0, blue: 255 }),
            secondaryColour: wootingColorToRgb565({ red: 0, green: 255, blue: 10 }),
            speed: 50,
            scale: 25,
        };
        case "spiral": return {
            kind,
            primaryColour: wootingColorToRgb565({ red: 255, green: 0, blue: 255 }),
            secondaryColour: wootingColorToRgb565({ red: 0, green: 255, blue: 255 }),
            speed: 50,
            spiral: 50,
        };
    }
}
/**
 * Wootility's ARM "Static" RGB core: full brightness plus one analog-bomb
 * layer at 127. The actual static per-key color is stored in the color pages
 * (0x0E/0x0F writes, 0x23/0x24 reads), not in this core message.
 */
export function createWootingRgbStaticCore(base = {}) {
    return encodeWootingRgbCore({
        base: {
            brightness: base.brightness ?? 255,
            capsLockActiveColor: base.capsLockActiveColor ?? 0xffff,
            fnLockActiveColor: base.fnLockActiveColor ?? 0xffff,
            scrollLockActiveColor: base.scrollLockActiveColor ?? 0xffff,
            numLockActiveColor: base.numLockActiveColor ?? 0xffff,
        },
        layers: [{ kind: "analogBomb", baseBrightness: 127, useAnalogCurve: false }],
    });
}
/** `get_rgb_layer` (0x39): one RGB layer block. */
export function decodeWootingRgbLayer(reply) {
    return decodeWootingRgbBlock(reply, WOOTING_COMMAND.getRgbLayer);
}
/** `get_rgb_bins` (0x3B): the RGB bin-calibration block. */
export function decodeWootingRgbBins(reply) {
    return decodeWootingRgbBlock(reply, WOOTING_COMMAND.getRgbBins);
}
export function decodeWootingGlobalSettings(reply) {
    const body = wootingBlobBody(reply, WOOTING_COMMAND.getSettings);
    if (!body)
        return null;
    const fields = [];
    let config = null;
    const decoded = decodeProtobufFields(body);
    for (const outer of decoded) {
        if (outer.bytes)
            fields.push({ field: outer.field, raw: outer.bytes });
        if (outer.field === 1 && outer.bytes && !config)
            config = outer.bytes;
    }
    if (!decoded.length)
        return null;
    const sleepFields = config ? decodeProtobufFields(config) : [];
    const numeric = (entries, field) => entries.find((entry) => entry.field === field && entry.int !== undefined)?.int ?? null;
    const flag = (entries, field) => {
        const value = numeric(entries, field);
        return value === null ? null : value !== 0;
    };
    const name = decoded.find((entry) => entry.field === 4 && entry.bytes)?.bytes;
    return {
        config,
        rgbSleep: config ? {
            dimMinutes: numeric(sleepFields, 1),
            offMinutes: numeric(sleepFields, 2),
            turnOff: flag(sleepFields, 3),
        } : null,
        invertNumLock: flag(decoded, 2),
        debounceFilter: flag(decoded, 3),
        deviceName: name ? new TextDecoder().decode(name) : null,
        fields,
        raw: body,
    };
}
/**
 * Named scalar diagnostics. All three share the single-byte payload shape, so
 * each delegates to {@link decodeWootingCount} — the names exist so the
 * driver and UI layers can import one decoder per command id.
 */
/** `get_number_of_keys` (0x10): matrix key count (61 on the 60HE+). */
export function decodeWootingNumberOfKeys(reply) {
    return decodeWootingCount(reply, WOOTING_COMMAND.getNumberOfKeys);
}
/** `get_analog_profiles_count` (0x0A): analog profile count. */
export function decodeWootingAnalogProfilesCount(reply) {
    return decodeWootingCount(reply, WOOTING_COMMAND.getAnalogProfilesCount);
}
/** `get_rgb_profile_count` (0x04): RGB profile count. */
export function decodeWootingRgbProfileCount(reply) {
    return decodeWootingCount(reply, WOOTING_COMMAND.getRgbProfileCount);
}
/**
 * `is_flash_chip_connected` (0x38): nonzero payload byte means the flash chip
 * answers. Null on error status or a truncated header — never a guessed false.
 */
export function decodeWootingFlashChipConnected(reply) {
    const payload = wootingRawPayload(reply, WOOTING_COMMAND.isFlashChipConnected, 5);
    if (!payload)
        return null;
    return payload[0] !== 0;
}
export function decodeWootingFlashStats(reply) {
    const payload = wootingRawPayload(reply, WOOTING_COMMAND.getFlashStats, 8);
    if (!payload)
        return null;
    return { usedPages: wootingU16LE(payload, 0), totalPages: wootingU16LE(payload, 2), raw: payload };
}
export function decodeWootingAnalogSnapshot(reply) {
    const body = wootingBlobBody(reply, WOOTING_COMMAND.getAnalogValues);
    if (!body)
        return null;
    const groups = [];
    for (const outer of decodeProtobufFields(body)) {
        const inner = outer.field === 1 && outer.bytes
            ? decodeProtobufFields(outer.bytes).find((field) => field.field === 1 && field.bytes)?.bytes
            : undefined;
        if (inner)
            groups.push(inner);
    }
    return { groups, raw: body };
}
/**
 * Build the full 8-byte command buffer exactly as the SDK lays it out, with the
 * hidapi report-index byte first. Transports that take the report id separately
 * (WebHID) should send `buffer[0]` as the report id and `buffer.subarray(1)` as
 * the data — see {@link wootingFeatureReport}.
 */
export function encodeWootingCommand(commandId, param0 = 0, param1 = 0, param2 = 0, param3 = 0, { multiReport = false } = {}) {
    const buffer = new Uint8Array(WOOTING_COMMAND_SIZE);
    buffer[0] = multiReport ? 1 : 0;
    buffer[1] = multiReport ? WOOTING_MAGIC_MULTI : WOOTING_MAGIC_SINGLE;
    buffer[2] = WOOTING_MAGIC_WORD_1;
    buffer[3] = commandId & 0xff;
    buffer[4] = param3 & 0xff;
    buffer[5] = param2 & 0xff;
    buffer[6] = param1 & 0xff;
    buffer[7] = param0 & 0xff;
    return buffer;
}
/**
 * Encode a profile-slot argument for a slot-taking command (get_digital_profile,
 * get_mapping_profile, get_profile_metadata, …). The slot sits at a different
 * byte per firmware variant: byte 4 (param3) on ARM, byte 7 (param0) on
 * Standard (wootswitch). Returns a full 8-byte command buffer.
 */
export function encodeWootingProfileCommand(commandId, slot, { multiReport = true } = {}) {
    return multiReport
        ? encodeWootingCommand(commandId, 0, 0, 0, slot, { multiReport })
        : encodeWootingCommand(commandId, slot, 0, 0, 0, { multiReport });
}
/**
 * 16-bit ARM profile selector `(namespace << 8) | index`; null selects the
 * active/default profile (`0xFFFF`).
 */
export function wootingProfileSelector(profile) {
    if (profile === null)
        return 0xffff;
    if (!Number.isInteger(profile.index) || profile.index < 0 || profile.index > 0x1f) {
        throw new RangeError("Wooting profile index must be 0–31.");
    }
    if (profile.namespace !== "onboard" && profile.namespace !== "linked") {
        throw new RangeError("Wooting profile namespace must be onboard or linked.");
    }
    return ((profile.namespace === "linked" ? 1 : 0) << 8) | profile.index;
}
/**
 * ARM feature command with a 16-bit profile selector in the first two
 * parameter bytes. Standard/AVR folds the slot into the payload instead.
 */
export function encodeWootingProfileSelectorCommand(commandId, profile) {
    const selector = wootingProfileSelector(profile);
    return encodeWootingCommand(commandId, 0, 0, selector >>> 8, selector & 0xff, { multiReport: true });
}
/**
 * Split an encoded command into the `{ reportId, data }` pair a WebHID
 * `sendFeatureReport(reportId, data)` call expects: the leading hidapi index
 * byte becomes the report id, and the remaining seven bytes are the data.
 */
export function wootingFeatureReport(buffer) {
    return { reportId: buffer[0] ?? 0, data: buffer.slice(1) };
}
/**
 * Settle delay between profile-switch steps. The wootswitch sequence needs
 * 100ms after ActivateProfile before ReloadProfile, and 100ms after reload
 * before the change is visible — confirmed live (switching without the
 * settle leaves the 0x0b index stale).
 */
export const WOOTING_PROFILE_SWITCH_SETTLE_MS = 100;
/**
 * Encode the three-step RAM-only profile-switch sequence (wootswitch):
 * WootDevInit (0x21, no args) → ActivateProfile (0x17, slot) → ReloadProfile
 * (0x26, slot). Returns the three 8-byte buffers in send order; the driver
 * waits {@link WOOTING_PROFILE_SWITCH_SETTLE_MS} between sends and verifies
 * with get_current_keyboard_profile_index (0x0b). NEVER persists to flash —
 * the board reverts on power loss unless a save* follows with user confirm.
 */
export function encodeWootingProfileSwitch(slot, { multiReport = true } = {}) {
    return [
        encodeWootingCommand(WOOTING_COMMAND.wootDevInit, 0, 0, 0, 0, { multiReport }),
        encodeWootingProfileCommand(WOOTING_COMMAND.activateProfile, slot, { multiReport }),
        encodeWootingProfileCommand(WOOTING_COMMAND.reloadProfile, slot, { multiReport }),
    ];
}
/**
 * Encode a FLASH-persisting save command (save_rgb_profile 0x08,
 * save_keyboard_profile 0x2A, save_dks_profile 0x2F, save_akc_profile 0x35).
 * The `confirmed` flag is a call-site gate: without it the encoder throws
 * instead of building a flash-overwriting buffer, so no UI drag or slider can
 * persist by accident — only an explicit Save button passing confirmed: true.
 */
export function encodeWootingSaveCommand(commandId, slot, { multiReport = true, confirmed = false } = {}) {
    if (commandId !== WOOTING_COMMAND.saveRgbProfile
        && commandId !== WOOTING_COMMAND.saveKeyboardProfile
        && commandId !== WOOTING_COMMAND.saveDksProfile
        && commandId !== WOOTING_COMMAND.saveAkcProfile)
        throw new Error(`Refusing to encode non-save command 0x${commandId.toString(16)} as a flash write.`);
    if (!confirmed)
        throw new Error("Refusing to encode a flash write without confirmed: true.");
    return encodeWootingProfileCommand(commandId, slot, { multiReport });
}
/**
 * Encode a single-key RGB set (woot_dev_single_color 0x1E, SDK
 * WOOTING_SINGLE_COLOR_COMMAND): key index + R/G/B. RAM-only — visible until
 * the profile reloads; persists only via save_rgb_profile with confirm.
 * Live 60HE+: `0x1E` answers 0x88 (accepted); `0x1F`/`0x20` answer 0x88;
 * `0x1D` answers 0x66 (no staged RGB to push on this firmware).
 */
export function encodeWootingSingleColor(keyIndex, red, green, blue, { multiReport = true } = {}) {
    return encodeWootingCommand(WOOTING_COMMAND.wootDevSingleColor, blue, green, red, keyIndex, { multiReport });
}
/**
 * Encode the full-board RGB buffer (SDK wooting_usb_send_buffer_v3 path):
 * report index 5, magic D1 DA, report id 11, then the 6×21×u16 BGR matrix
 * (252 bytes). The 60HE+ meta uses small packets (SDK uses_small_packets)
 * but the v3 single-write shape is what the ARM firmware accepts on the
 * config interface — confirmed by the SDK's v3 branch, NOT yet by a live
 * Wootility capture, so the driver sends it only from an explicit RGB Apply.
 * Live note: refresh_rgb_colors (0x1D) answers 0x66 on this firmware, so a
 * buffer push that the board will not display must surface "not applied"
 * rather than success (see driver setRgbBuffer).
 */
export const WOOTING_RGB_ROWS = 6;
export const WOOTING_RGB_COLS = 21;
export const WOOTING_RGB_REPORT_ID = 11;
export function encodeWootingRgbBuffer(colors) {
    if (colors.length !== WOOTING_RGB_ROWS * WOOTING_RGB_COLS * 2) {
        throw new Error(`RGB buffer must be ${WOOTING_RGB_ROWS * WOOTING_RGB_COLS * 2} bytes, got ${colors.length}.`);
    }
    const buffer = new Uint8Array(4 + colors.length);
    buffer[0] = 5;
    buffer[1] = WOOTING_MAGIC_MULTI;
    buffer[2] = WOOTING_MAGIC_WORD_1;
    buffer[3] = WOOTING_RGB_REPORT_ID;
    buffer.set(colors, 4);
    return buffer;
}
/**
 * Wootility 5.4.2 output-report command 0x15, distinct from FEATURE command
 * 0x15 (`keys_off`). Captured on a 60HE+ while saving two 0.30 mm overrides:
 * report ID 1, 32 data bytes, `[D1 DA 15 slot len:u16 payload padding]`.
 * The payload is a KeyMMPropertyProfile `partialEncoded` (field 4) whose
 * entries (field 1) pack `actuationRaw << 16 | matrixKeyIndex` as varints.
 * Only the observed 32-byte single-packet shape is encoded here.
 */
export const WOOTING_OUTPUT_SET_KEY_MM = 0x15;
/** Encode a nonnegative protobuf varint without signed 32-bit coercion. */
function wootingVarintBytes(value) {
    const bytes = [];
    let rest = value;
    do {
        const digit = rest % 128;
        rest = Math.floor(rest / 128);
        bytes.push(digit | (rest > 0 ? 0x80 : 0));
    } while (rest > 0);
    return bytes;
}
/** Pack a captured variable-length output command into report ID 1. */
function wootingSmallOutputReport(commandId, slot, payload) {
    if (!Number.isInteger(slot) || slot < 0 || slot > 255)
        throw new RangeError("Wooting slot must be a byte.");
    if (payload.length > 26)
        throw new RangeError("Wooting output payload exceeds the captured 32-byte report.");
    const data = new Uint8Array(32);
    data.set([WOOTING_MAGIC_MULTI, WOOTING_MAGIC_WORD_1, commandId, slot, payload.length, 0, ...payload]);
    return { reportId: 1, data };
}
export function encodeWootingActuationOverrides(slot, overrides) {
    const inner = [];
    for (const { key, actuationMm } of overrides) {
        if (!Number.isInteger(key) || key < 0 || key > 0xffff)
            throw new RangeError("Wooting matrix key index must be a uint16.");
        if (!Number.isFinite(actuationMm) || actuationMm < 0 || actuationMm > WOOTING_TRAVEL_MM) {
            throw new RangeError("Wooting actuation must be between 0 and 4 mm.");
        }
        const raw = Math.round(WOOTING_ACTUATION_ZERO + actuationMm * WOOTING_ACTUATION_UNITS_PER_MM);
        inner.push(0x08, ...wootingVarintBytes(raw * 0x10000 + key));
    }
    const payload = inner.length ? [0x22, inner.length, ...inner] : [];
    return wootingSmallOutputReport(WOOTING_OUTPUT_SET_KEY_MM, slot, payload);
}
function wootingProfileFlags({ save = false, profileIndex = 0, namespace = "onboard" }) {
    if (!Number.isInteger(profileIndex) || profileIndex < 0 || profileIndex > 0x1f) {
        throw new RangeError("Wooting profile index must be 0–31.");
    }
    if (namespace !== "onboard" && namespace !== "linked")
        throw new RangeError("Wooting profile namespace must be onboard or linked.");
    return (save ? 1 : 0) | (profileIndex << 1) | ((namespace === "linked" ? 1 : 0) << 6);
}
function wootingProfileOutputReport(commandId, flags, completeMessage) {
    if (!Number.isInteger(flags) || flags < 0 || flags > 0xff)
        throw new RangeError("Wooting output flags must be a byte.");
    const message = Uint8Array.from(completeMessage);
    const sizes = [[1, 32], [2, 62], [3, 254], [4, 510], [5, 1022], [6, 2046]];
    const selected = sizes.find(([, size]) => message.length <= size - 6);
    if (!selected)
        throw new RangeError("Wooting profile exceeds a 2046-byte output report.");
    const [reportId, size] = selected;
    const data = new Uint8Array(size);
    data.set([WOOTING_MAGIC_MULTI, WOOTING_MAGIC_WORD_1, commandId, flags,
        message.length & 0xff, message.length >>> 8]);
    data.set(message, 6);
    return { reportId, data };
}
/** Standard/AVR framing: magic D0, one-byte length, report ID 0. */
function wootingStandardOutputReport(commandId, flags, completeMessage) {
    if (!Number.isInteger(flags) || flags < 0 || flags > 0xff)
        throw new RangeError("Wooting output flags must be a byte.");
    const message = Uint8Array.from(completeMessage);
    if (message.length > 0xff)
        throw new RangeError("Wooting Standard profile length exceeds one byte.");
    const data = new Uint8Array(5 + message.length);
    data.set([WOOTING_MAGIC_SINGLE, WOOTING_MAGIC_WORD_1, commandId, flags, message.length]);
    data.set(message, 5);
    return { reportId: 0, data };
}
function encodeWootingProfileReport(commandId, completeMessage, options) {
    const flags = wootingProfileFlags(options);
    return options.multiReport === false
        ? wootingStandardOutputReport(commandId, flags, completeMessage)
        : wootingProfileOutputReport(commandId, flags, completeMessage);
}
/** Frame a complete ARM actuation block, choosing the smallest captured output report size. */
export function encodeWootingActuationProfileReport(completeMessage, options = { save: true }) {
    return encodeWootingProfileReport(WOOTING_OUTPUT_SET_KEY_MM, completeMessage, options);
}
/** Replace one matrix key while retaining every other per-key actuation value. */
export function patchWootingActuationProfile(completeMessage, key, actuationMm) {
    if (!Number.isInteger(key) || key < 0 || key > 0xffff)
        throw new RangeError("Wooting matrix key index must be a uint16.");
    if (actuationMm !== null && (!Number.isFinite(actuationMm) || actuationMm < 0 || actuationMm > WOOTING_TRAVEL_MM)) {
        throw new RangeError("Wooting actuation must be between 0 and 4 mm.");
    }
    const outer = decodeProtobufFields(completeMessage);
    const property = outer.filter((field) => field.field === 4);
    if (property.length > 1 || property.some((field) => !field.bytes))
        throw new Error("Unsupported Wooting actuation block shape.");
    const inner = property[0]?.bytes ?? new Uint8Array();
    const values = [];
    for (const field of decodeProtobufFields(inner)) {
        if (field.field !== 1)
            continue;
        if (field.int !== undefined)
            values.push(field.int);
        if (field.bytes)
            for (let at = 0; at < field.bytes.length;) {
                const [value, end] = readVarint(field.bytes, at);
                if (end <= at || (field.bytes[end - 1] & 0x80))
                    throw new Error("Truncated Wooting actuation override.");
                values.push(value);
                at = end;
            }
    }
    const keys = values.map((value) => value % 65536);
    if (new Set(keys).size !== keys.length)
        throw new Error("Duplicate Wooting actuation key index.");
    const next = values.filter((value) => value % 65536 !== key);
    if (actuationMm !== null) {
        const raw = Math.round(WOOTING_ACTUATION_ZERO + actuationMm * WOOTING_ACTUATION_UNITS_PER_MM);
        next.push(raw * 65536 + key);
    }
    const otherOuter = wootingProtoSpans(completeMessage).filter((field) => field.field !== 4).flatMap((field) => [...field.raw]);
    if (!next.length)
        return Uint8Array.from(otherOuter);
    const otherInner = wootingProtoSpans(inner).filter((field) => field.field !== 1).flatMap((field) => [...field.raw]);
    const editedInner = Uint8Array.from([...otherInner, ...next.flatMap((value) => [0x08, ...wootingVarintBytes(value)])]);
    return Uint8Array.from([...otherOuter, 0x22, ...wootingVarintBytes(editedInner.length), ...editedInner]);
}
/**
 * Output command 0x1D (not FEATURE command 0x1D, which refreshes RGB). This is
 * Wootility's `setFullRapidTriggerProfile`, the ARM per-key rapid-trigger
 * write paired with read command 0x3D. The payload is a complete
 * `profiles.RapidTriggerProfile` (`repeated groups = 1`); byte 3 carries the
 * save flag and profile selector.
 */
export const WOOTING_OUTPUT_SET_RAPID_TRIGGER = 0x1d;
function wootingSensitivityRaw(mm, label) {
    if (!Number.isFinite(mm) || mm < 0 || mm > WOOTING_TRAVEL_MM) {
        throw new RangeError(`${label} must be between 0 and 4 mm.`);
    }
    return Math.round(WOOTING_ACTUATION_ZERO + mm * WOOTING_ACTUATION_UNITS_PER_MM);
}
function encodeWootingRapidTriggerConfigBytes(config) {
    const bytes = [0x08, ...wootingVarintBytes(wootingSensitivityRaw(config.sensitivityMm, "Wooting rapid trigger sensitivity"))];
    if (config.secondarySensitivityMm !== undefined && config.secondarySensitivityMm !== null) {
        bytes.push(0x10, ...wootingVarintBytes(wootingSensitivityRaw(config.secondarySensitivityMm, "Wooting secondary rapid trigger sensitivity")));
    }
    if (config.continuous !== undefined)
        bytes.push(0x18, config.continuous ? 1 : 0);
    return bytes;
}
function encodeWootingRapidTriggerGroupBytes(keys, value) {
    const bytes = [];
    for (const key of keys) {
        if (!Number.isInteger(key) || key < 0 || key > 0xffff)
            throw new RangeError("Wooting matrix key index must be a uint16.");
        bytes.push(0x08, ...wootingVarintBytes(key));
    }
    if ("config" in value)
        bytes.push(0x12, ...wootingVarintBytes(value.config.length), ...value.config);
    else
        bytes.push(0x18, value.enabled ? 1 : 0);
    return bytes;
}
/** Encode a complete ARM `profiles.RapidTriggerProfile` message (10 keys per group max). */
export function encodeWootingRapidTriggerProfileGroups(groups) {
    const seen = new Set();
    const message = [];
    let groupCount = 0;
    for (const group of groups) {
        if (group.keys.length === 0)
            throw new RangeError("Wooting rapid-trigger group must contain at least one key.");
        const hasConfig = group.config !== undefined;
        const hasEnabled = group.enabled !== undefined;
        if (hasConfig === hasEnabled)
            throw new Error("Wooting rapid-trigger group needs exactly one of config or enabled.");
        const value = hasConfig
            ? { config: encodeWootingRapidTriggerConfigBytes(group.config) }
            : { enabled: group.enabled };
        for (const key of group.keys) {
            if (!Number.isInteger(key) || key < 0 || key > 0xffff)
                throw new RangeError("Wooting matrix key index must be a uint16.");
            if (seen.has(key))
                throw new RangeError(`Duplicate Wooting rapid-trigger key ${key}.`);
            seen.add(key);
        }
        for (let at = 0; at < group.keys.length; at += 10) {
            const inner = encodeWootingRapidTriggerGroupBytes(group.keys.slice(at, at + 10), value);
            message.push(0x0a, ...wootingVarintBytes(inner.length), ...inner);
            groupCount += 1;
        }
    }
    if (groupCount > 30)
        throw new RangeError("Wooting per-key rapid-trigger profile exceeds 30 groups.");
    return Uint8Array.from(message);
}
/**
 * Frame a complete `RapidTriggerProfile` message as Wootility output 0x1D.
 * The caller must supply every group it wants to keep; this is not a partial
 * write. `save` persists to flash and requires explicit user confirmation in
 * the driver.
 */
export function encodeWootingRapidTriggerProfileReport(completeMessage, options = {}) {
    return encodeWootingProfileReport(WOOTING_OUTPUT_SET_RAPID_TRIGGER, completeMessage, options);
}
/**
 * Encode one group of keys with the same sensitivity. Retained for the
 * captured two-key packet; splits more than 10 keys into multiple groups.
 * The first argument is the raw output flags byte (bit 0 = save).
 */
export function encodeWootingRapidTriggerOverrides(flags, keys, primarySensitivityMm, continuous) {
    wootingSensitivityRaw(primarySensitivityMm, "Wooting rapid trigger sensitivity");
    const groups = [];
    for (let at = 0; at < keys.length; at += 10) {
        groups.push({ keys: keys.slice(at, at + 10), config: { sensitivityMm: primarySensitivityMm, continuous } });
    }
    return wootingProfileOutputReport(WOOTING_OUTPUT_SET_RAPID_TRIGGER, flags, encodeWootingRapidTriggerProfileGroups(groups));
}
function parseWootingRapidTriggerGroup(raw, partIndex) {
    const [outer] = decodeProtobufFields(raw);
    if (!outer?.bytes)
        throw new Error("Malformed Wooting rapid-trigger group.");
    const keys = [];
    let enabled = null;
    let config = null;
    for (const field of decodeProtobufFields(outer.bytes)) {
        if (field.field === 1) {
            if (field.int !== undefined)
                keys.push(field.int);
            if (field.bytes)
                keys.push(...wootingPackedVarints(field.bytes));
        }
        else if (field.field === 2 && field.bytes) {
            config = decodeWootingRapidTriggerConfig(field.bytes);
        }
        else if (field.field === 3 && field.int !== undefined) {
            enabled = field.int !== 0;
        }
    }
    if (config && enabled !== null)
        throw new Error("Wooting rapid-trigger group has both config and enabled.");
    const other = wootingProtoSpans(outer.bytes).filter((span) => span.field !== 1).flatMap((span) => [...span.raw]);
    return { raw, partIndex, keys, other, enabled, config, dirty: false };
}
function wootingRapidTriggerGroupMatches(group, target) {
    if ("enabled" in target)
        return group.config === null && group.enabled === target.enabled;
    return group.enabled === null && group.config !== null
        && group.config.primarySensitivityRaw === target.config.primary
        && group.config.secondarySensitivityRaw === target.config.secondary
        && group.config.continuousMode === target.config.continuous;
}
/**
 * Replace one or more matrix keys in a full per-key rapid-trigger message
 * while preserving every other group and unknown field. `target` null removes
 * the keys' overrides (they fall back to the profile base); otherwise the keys
 * are merged into an existing matching group or a new one. Groups are split at
 * the firmware's 10-key limit.
 */
export function patchWootingRapidTriggerProfile(completeMessage, keys, target) {
    const targets = typeof keys === "number" ? [keys] : [...keys];
    if (!targets.length)
        throw new RangeError("Wooting rapid-trigger edit needs at least one key.");
    const targetSet = new Set();
    for (const key of targets) {
        if (!Number.isInteger(key) || key < 0 || key > 0xffff)
            throw new RangeError("Wooting matrix key index must be a uint16.");
        if (targetSet.has(key))
            throw new RangeError(`Duplicate Wooting rapid-trigger key ${key}.`);
        targetSet.add(key);
    }
    const parts = [];
    const groups = [];
    for (const span of wootingProtoSpans(completeMessage)) {
        const partIndex = parts.length;
        parts.push({ field: span.field, raw: span.raw });
        if (span.field === 1)
            groups.push(parseWootingRapidTriggerGroup(span.raw, partIndex));
    }
    let changed = false;
    const kept = [];
    for (const group of groups) {
        const remaining = group.keys.filter((key) => !targetSet.has(key));
        if (remaining.length !== group.keys.length) {
            group.keys = remaining;
            group.dirty = true;
            changed = true;
        }
        if (group.keys.length)
            kept.push(group);
        else
            changed = true;
    }
    const seen = new Set();
    for (const group of kept) {
        for (const key of group.keys) {
            if (seen.has(key))
                throw new Error(`Duplicate Wooting rapid-trigger key ${key}.`);
            seen.add(key);
        }
    }
    if (target !== null) {
        const normalized = "enabled" in target
            ? { enabled: target.enabled }
            : {
                config: {
                    primary: wootingSensitivityRaw(target.sensitivityMm, "Wooting rapid trigger sensitivity"),
                    secondary: target.secondarySensitivityMm === undefined || target.secondarySensitivityMm === null
                        ? null
                        : wootingSensitivityRaw(target.secondarySensitivityMm, "Wooting secondary rapid trigger sensitivity"),
                    continuous: target.continuous ?? null,
                },
            };
        const match = kept.find((group) => wootingRapidTriggerGroupMatches(group, normalized));
        if (match) {
            match.keys.push(...targets);
            match.dirty = true;
        }
        else {
            const other = "enabled" in target
                ? [0x18, target.enabled ? 1 : 0]
                : encodeWootingRapidTriggerConfigBytes({ ...target, continuous: target.continuous });
            kept.push({
                raw: new Uint8Array(),
                partIndex: -1,
                keys: [...targets],
                other: "enabled" in target ? other : [0x12, ...wootingVarintBytes(other.length), ...other],
                enabled: "enabled" in target ? target.enabled : null,
                config: "enabled" in target ? null : decodeWootingRapidTriggerConfig(Uint8Array.from(other)),
                dirty: true,
            });
        }
        changed = true;
    }
    if (!changed)
        return completeMessage.slice();
    const chunksByPart = new Map();
    const appended = [];
    let groupCount = 0;
    for (const group of kept) {
        const chunks = [];
        for (let at = 0; at < group.keys.length; at += 10) {
            const chunkKeys = group.keys.slice(at, at + 10);
            const whole = chunkKeys.length === group.keys.length && !group.dirty && group.partIndex >= 0;
            if (whole) {
                chunks.push(group.raw);
                continue;
            }
            const inner = [...chunkKeys.flatMap((key) => [0x08, ...wootingVarintBytes(key)]), ...group.other];
            chunks.push(Uint8Array.from([0x0a, ...wootingVarintBytes(inner.length), ...inner]));
        }
        groupCount += chunks.length;
        if (group.partIndex >= 0)
            chunksByPart.set(group.partIndex, chunks);
        else
            appended.push(...chunks);
    }
    if (groupCount > 30)
        throw new RangeError("Wooting per-key rapid-trigger profile exceeds 30 groups.");
    const output = [];
    for (let index = 0; index < parts.length; index += 1) {
        const chunks = chunksByPart.get(index);
        if (chunks)
            for (const chunk of chunks)
                output.push(...chunk);
        else if (parts[index].field !== 1)
            output.push(...parts[index].raw);
    }
    for (const chunk of appended)
        output.push(...chunk);
    return Uint8Array.from(output);
}
/** Output command 0x19 writes Wootility's legacy `KeyPropertyProfile`. */
export const WOOTING_OUTPUT_SET_KEY_PROPERTY = 0x19;
/**
 * Encode a complete `KeyPropertyProfile`. Partial form uses the sparse
 * `(value << 8) | matrixIndex` entries; full form writes one byte per matrix
 * cell. Value 0 (follow base) is omitted from the sparse form.
 */
export function encodeWootingKeyPropertyProfile(profile) {
    const seen = new Set();
    for (const { key, value } of profile.entries) {
        if (!Number.isInteger(key) || key < 0 || key > 0xff || decodeWootingKeyIndex(key) === null) {
            throw new RangeError("Wooting matrix key index must be a valid 0–255 position.");
        }
        if (value !== 0 && value !== 1 && value !== 2)
            throw new RangeError("Wooting key-property value must be 0, 1, or 2.");
        if (seen.has(key))
            throw new RangeError(`Duplicate Wooting key-property key ${key}.`);
        seen.add(key);
    }
    if (profile.form === "partial") {
        const inner = [];
        for (const { key, value } of profile.entries) {
            if (value === 0)
                continue;
            inner.push(0x08, ...wootingVarintBytes((value << 8) | key));
        }
        return Uint8Array.from(inner.length ? [0x12, ...wootingVarintBytes(inner.length), ...inner] : []);
    }
    const highest = profile.entries.reduce((max, entry) => Math.max(max, entry.key), 0);
    const rows = profile.rows ?? ((highest >> 5) + 1);
    const columns = profile.columns ?? ((highest & 0x1f) + 1);
    if (!Number.isInteger(rows) || rows < 1 || rows > 8)
        throw new RangeError("Wooting key-property rows must be 1–8.");
    if (!Number.isInteger(columns) || columns < 1 || columns > 32)
        throw new RangeError("Wooting key-property columns must be 1–32.");
    const matrix = Array.from({ length: rows }, () => new Array(columns).fill(0));
    for (const { key, value } of profile.entries) {
        const row = key >> 5;
        const col = key & 0x1f;
        if (row >= rows || col >= columns)
            throw new RangeError(`Wooting key ${key} is outside the ${rows}×${columns} matrix.`);
        matrix[row][col] = value;
    }
    const matrixBytes = [];
    for (const row of matrix) {
        const rowMessage = [0x0a, ...wootingVarintBytes(row.length), ...row];
        matrixBytes.push(0x0a, ...wootingVarintBytes(rowMessage.length), ...rowMessage);
    }
    return Uint8Array.from([0x0a, ...wootingVarintBytes(matrixBytes.length), ...matrixBytes]);
}
/**
 * Replace one or more keys in a decoded KeyPropertyProfile, preserving the
 * profile's full/sparse form and every other cell.
 */
export function patchWootingKeyPropertyProfile(profile, keys, value) {
    const targets = typeof keys === "number" ? [keys] : [...keys];
    if (!targets.length)
        throw new RangeError("Wooting key-property edit needs at least one key.");
    if (value !== 0 && value !== 1 && value !== 2)
        throw new RangeError("Wooting key-property value must be 0, 1, or 2.");
    const entries = new Map(profile.entries.map((entry) => [entry.key, entry.value]));
    let rows = profile.rows;
    let columns = profile.columns;
    for (const key of targets) {
        if (!Number.isInteger(key) || key < 0 || key > 0xff || decodeWootingKeyIndex(key) === null) {
            throw new RangeError("Wooting matrix key index must be a valid 0–255 position.");
        }
        if (profile.form === "partial" && value === 0)
            entries.delete(key);
        else
            entries.set(key, value);
        if (profile.form === "full") {
            rows = Math.max(rows, (key >> 5) + 1);
            columns = Math.max(columns, (key & 0x1f) + 1);
        }
    }
    return encodeWootingKeyPropertyProfile({
        form: profile.form,
        entries: [...entries.entries()].map(([key, entryValue]) => ({ key, value: entryValue })),
        rows,
        columns,
    });
}
/** Frame a complete KeyPropertyProfile as output 0x19 (Standard or ARM). */
export function encodeWootingKeyPropertyProfileReport(completeMessage, options = {}) {
    return encodeWootingProfileReport(WOOTING_OUTPUT_SET_KEY_PROPERTY, completeMessage, options);
}
/**
 * Wootility output command 0x17 writes a complete GlobalSettings protobuf.
 * The caller must supply the entire message, including fields it does not
 * intend to change, because a partial write can clear other device settings.
 * This is packet framing only; the driver does not expose a settings write.
 */
export const WOOTING_OUTPUT_SET_GLOBAL_SETTINGS = 0x17;
export function encodeWootingGlobalSettingsReport(scope, completeMessage) {
    return wootingSmallOutputReport(WOOTING_OUTPUT_SET_GLOBAL_SETTINGS, scope, completeMessage);
}
/** The ARM keyboard base profile is output command 0x11; byte 3 is its save flag. */
export function encodeWootingKeyboardBaseReport(completeMessage, options = { save: true }) {
    return encodeWootingProfileReport(0x11, completeMessage, options);
}
/** Preserve all other base-profile protobuf fields while editing analog defaults. */
export function patchWootingKeyboardBase(completeMessage, changes) {
    const outer = wootingProtoSpans(completeMessage);
    const base = decodeProtobufFields(completeMessage).find((field) => field.field === 1 && field.bytes)?.bytes;
    if (!base || outer.filter((field) => field.field === 1).length !== 1)
        throw new Error("Incomplete Wooting keyboard base profile.");
    let edited = new Uint8Array(base);
    if (changes.actuationMm !== undefined) {
        if (!Number.isFinite(changes.actuationMm) || changes.actuationMm < 0 || changes.actuationMm > WOOTING_TRAVEL_MM)
            throw new RangeError("Wooting actuation must be between 0 and 4 mm.");
        edited = replaceWootingProtoField(edited, 1, 0, Math.round(WOOTING_ACTUATION_ZERO + changes.actuationMm * WOOTING_ACTUATION_UNITS_PER_MM));
    }
    if (changes.rapidTriggerEnabled !== undefined)
        edited = replaceWootingProtoField(edited, 3, 0, changes.rapidTriggerEnabled ? 1 : 0);
    if (changes.rapidTriggerSensitivityMm !== undefined) {
        if (!Number.isFinite(changes.rapidTriggerSensitivityMm) || changes.rapidTriggerSensitivityMm < 0 || changes.rapidTriggerSensitivityMm > WOOTING_TRAVEL_MM)
            throw new RangeError("Wooting rapid trigger sensitivity must be between 0 and 4 mm.");
        edited = replaceWootingProtoField(edited, 4, 0, Math.round(WOOTING_ACTUATION_ZERO + changes.rapidTriggerSensitivityMm * WOOTING_ACTUATION_UNITS_PER_MM));
    }
    return replaceWootingProtoField(completeMessage, 1, 2, edited);
}
/** Byte spans for protobuf fields; used to keep unknown fields verbatim. */
function wootingProtoSpans(message) {
    const spans = [];
    let at = 0;
    while (at < message.length) {
        const start = at;
        const [tag, afterTag] = readVarint(message, at);
        if (!Number.isSafeInteger(tag) || tag < 8 || afterTag <= at)
            throw new Error("Invalid Wooting protobuf tag.");
        at = afterTag;
        const kind = tag % 8;
        if (kind === 0) {
            const [, end] = readVarint(message, at);
            if (end <= at || message[end - 1] & 0x80)
                throw new Error("Truncated Wooting protobuf varint.");
            at = end;
        }
        else if (kind === 1)
            at += 8;
        else if (kind === 2) {
            const [length, end] = readVarint(message, at);
            at = end + length;
        }
        else if (kind === 5)
            at += 4;
        else
            throw new Error("Unsupported Wooting protobuf wire type.");
        if (at > message.length)
            throw new Error("Truncated Wooting protobuf field.");
        spans.push({ field: Math.floor(tag / 8), raw: message.subarray(start, at) });
    }
    return spans;
}
/** Replace one protobuf field while retaining every other field byte-for-byte. */
function replaceWootingProtoField(message, field, wire, value) {
    const chunks = wootingProtoSpans(message).filter((part) => part.field !== field).map((part) => [...part.raw]);
    const bytes = wire === 0
        ? wootingVarintBytes(value)
        : [...wootingVarintBytes(value.length), ...value];
    chunks.push([...wootingVarintBytes(field * 8 + wire), ...bytes]);
    return Uint8Array.from(chunks.flat());
}
/** Complete GlobalSettings message with selected fields changed. Unknown fields survive. */
export function patchWootingGlobalSettings(completeMessage, changes) {
    let result = completeMessage.slice();
    if (changes.rgbDimMinutes !== undefined || changes.rgbOffMinutes !== undefined || changes.rgbTurnOff !== undefined) {
        const sleep = decodeProtobufFields(result).find((entry) => entry.field === 1 && entry.bytes)?.bytes ?? new Uint8Array();
        let next = sleep;
        for (const [field, value] of [[1, changes.rgbDimMinutes], [2, changes.rgbOffMinutes], [3, changes.rgbTurnOff === undefined ? undefined : Number(changes.rgbTurnOff)]]) {
            if (value === undefined)
                continue;
            if (!Number.isSafeInteger(value) || value < 0)
                throw new RangeError("Wooting RGB timeout must be a nonnegative integer.");
            next = replaceWootingProtoField(next, field, 0, value);
        }
        result = replaceWootingProtoField(result, 1, 2, next);
    }
    if (changes.invertNumLock !== undefined)
        result = replaceWootingProtoField(result, 2, 0, Number(changes.invertNumLock));
    if (changes.debounceFilter !== undefined)
        result = replaceWootingProtoField(result, 3, 0, Number(changes.debounceFilter));
    if (changes.deviceName !== undefined)
        result = replaceWootingProtoField(result, 4, 2, new TextEncoder().encode(changes.deviceName));
    if (result.length > 26)
        throw new RangeError("Global settings exceed the observed single-report Wooting format.");
    return result;
}
/**
 * Wootility output command 0x16 (distinct from feature `keys_on`) writes the
 * RGB profile core. A Static -> Wave -> Static round trip on a 60HE+ sent one
 * report ID 2 packet per save: `[D1 DA 16 slot length:u16 protobuf padding]`.
 * The caller supplies the complete core message so unknown effect fields and
 * color settings survive. Framing this packet alone does not persist it.
 */
export const WOOTING_OUTPUT_SET_RGB_PROFILE_CORE = 0x16;
export function encodeWootingRgbProfileCoreReport(slot, completeMessage) {
    if (!Number.isInteger(slot) || slot < 0 || slot > 255)
        throw new RangeError("Wooting slot must be a byte.");
    if (completeMessage.length > 56)
        throw new RangeError("Wooting RGB core exceeds the captured 62-byte report.");
    const data = new Uint8Array(62);
    data.set([WOOTING_MAGIC_MULTI, WOOTING_MAGIC_WORD_1, WOOTING_OUTPUT_SET_RGB_PROFILE_CORE,
        slot, completeMessage.length & 0xff, completeMessage.length >> 8]);
    data.set(completeMessage, 6);
    return { reportId: 2, data };
}
/**
 * Wootility output command 0x18 stages the complete AKC profile. A captured
 * 18-byte profile used report ID 1 (32 bytes); adding one Toggle Key made it
 * 29 bytes and selected report ID 2 (62 bytes). The caller must preserve the
 * other AKC entries and trailer fields in the complete protobuf message.
 */
export const WOOTING_OUTPUT_SET_AKC_PROFILE = 0x18;
function wootingUint32(value, name) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)
        throw new RangeError(`${name} must be a uint32.`);
    return wootingVarintBytes(value);
}
function wootingBytesField(field, value) {
    return [field * 8 + 2, ...wootingVarintBytes(value.length), ...value];
}
export function wootingDksChangeLabel(change) {
    switch (change) {
        case 0: return "Hold";
        case 1: return "Down";
        case 2: return "Up";
        case 3: return "Single";
        default: return `Change ${change}`;
    }
}
/**
 * Encode Wootility's `AKC_DKSItem` from four bindings. `keys` is one keybind
 * per binding; `bitmappedActions[point]` packs the four bindings' 2-bit
 * behaviors (`action0 | action1 << 2 | action2 << 4 | action3 << 6`).
 */
export function wootingDksPayload(actions, secondaryActuationRaw) {
    const keys = actions.map((action) => {
        if (action.keybind === null)
            return 255;
        if (!Number.isInteger(action.keybind) || action.keybind < 0 || action.keybind > 255) {
            throw new RangeError("Wooting DKS keybind must be a byte.");
        }
        return action.keybind;
    });
    const points = [0, 1, 2, 3].map((point) => actions.reduce((byte, action, index) => {
        const change = action.transitions[point];
        if (change !== 0 && change !== 1 && change !== 2 && change !== 3) {
            throw new RangeError("Wooting DKS transition must be Hold, Down, Up, or Single.");
        }
        return byte | (change << (index * 2));
    }, 0));
    return {
        kind: "dks",
        keys: Uint8Array.from(keys),
        bitmappedActions: Uint8Array.from(points),
        secondaryActuationRaw,
    };
}
export function encodeWootingDksPayload(actions, secondaryActuationRaw) {
    return encodeWootingAkcPayload(wootingDksPayload(actions, secondaryActuationRaw));
}
/** Encode any of Wootility's five advanced-key subtype messages. */
export function encodeWootingAkcPayload(value) {
    switch (value.kind) {
        case "dks": return Uint8Array.from([
            ...wootingBytesField(1, value.keys), ...wootingBytesField(2, value.bitmappedActions),
            ...(value.secondaryActuationRaw === undefined ? [] : [0x18, ...wootingUint32(value.secondaryActuationRaw, "Secondary actuation")]),
        ]);
        case "modTap": return Uint8Array.from([
            0x08, ...wootingUint32(value.tapKey, "Tap key"), 0x10, ...wootingUint32(value.holdKey, "Hold key"),
            ...(value.holdDurationRaw === undefined ? [] : [0x18, ...wootingUint32(value.holdDurationRaw, "Hold duration")]),
            ...(value.jitActivation === undefined ? [] : [0x20, ...wootingUint32(value.jitActivation, "JIT activation")]),
        ]);
        case "toggleKey": return Uint8Array.from([0x08, ...wootingUint32(value.keybind, "Toggle keybind")]);
        case "rappySnappy": return Uint8Array.from([
            0x08, ...wootingUint32(value.secondaryKey, "Secondary key"),
            0x10, ...wootingUint32(value.socdMode, "SOCD mode"),
        ]);
        case "socd": return Uint8Array.from([
            0x08, ...wootingUint32(value.secondaryKey, "Secondary key"),
            0x10, ...wootingUint32(value.socdMode, "SOCD mode"),
            0x18, Number(value.inputBothOnBottomOut),
        ]);
    }
}
/** Build a complete `AKCProfile` from individual `AKCItem` entry bytes. */
export function encodeWootingAkcProfileFromItems(items) {
    const bytes = [];
    for (const item of items)
        bytes.push(0x0a, ...wootingVarintBytes(item.length), ...item);
    bytes.push(0x18, ...wootingVarintBytes(items.length));
    return Uint8Array.from(bytes);
}
/**
 * Split a complete `AKCProfile` into `PartialAKCProfile` chunks of at most
 * `maxItems` (Wootility uses 10). Non-item outer fields are dropped; the
 * known field-3 count trailer is replaced by `totalItems`.
 */
export function encodeWootingAkcChunks(completeMessage, maxItems = 10) {
    if (!Number.isInteger(maxItems) || maxItems < 1)
        throw new RangeError("Wooting AKC chunk size must be positive.");
    const items = wootingProtoSpans(completeMessage)
        .filter((span) => span.field === 1)
        .map((span) => [...span.raw]);
    if (!items.length)
        return [{ message: new Uint8Array(), startPoint: 0, totalItems: 0 }];
    const chunks = [];
    for (let at = 0; at < items.length; at += maxItems) {
        const body = items.slice(at, at + maxItems).flat();
        body.push(0x10, ...wootingVarintBytes(at));
        body.push(0x18, ...wootingVarintBytes(items.length));
        chunks.push({ message: Uint8Array.from(body), startPoint: at, totalItems: items.length });
    }
    return chunks;
}
/** Frame one `PartialAKCProfile` chunk as output 0x18. */
export function encodeWootingAkcChunkReport(chunk, options = {}) {
    return encodeWootingProfileReport(WOOTING_OUTPUT_SET_AKC_PROFILE, chunk.message, options);
}
export function encodeWootingAkcProfileReport(scope, completeMessage) {
    if (!Number.isInteger(scope) || scope < 0 || scope > 255)
        throw new RangeError("Wooting AKC scope must be a byte.");
    if (completeMessage.length <= 26)
        return wootingSmallOutputReport(WOOTING_OUTPUT_SET_AKC_PROFILE, scope, completeMessage);
    if (completeMessage.length > 56)
        throw new RangeError("AKC profile exceeds the observed 62-byte report format.");
    const data = new Uint8Array(62);
    data.set([WOOTING_MAGIC_MULTI, WOOTING_MAGIC_WORD_1, WOOTING_OUTPUT_SET_AKC_PROFILE,
        scope, completeMessage.length & 0xff, completeMessage.length >> 8]);
    data.set(completeMessage, 6);
    return { reportId: 2, data };
}
/** One AKC item with a verbatim subtype payload (DKS, Mod Tap, Toggle, Rappy, SOCD). */
export function encodeWootingAkcItem(item) {
    if (!Number.isInteger(item.keyIndex) || item.keyIndex < 0 || item.keyIndex > 0xff) {
        throw new RangeError("Wooting AKC key index must be a byte.");
    }
    if (!Number.isInteger(item.layer) || item.layer < 0 || item.layer > 0xff) {
        throw new RangeError("Wooting AKC layer must be a byte.");
    }
    const kindField = { dks: 1, modTap: 2, toggleKey: 3, rappySnappy: 4, socd: 5 }[item.kind];
    if (item.payload.length > 255)
        throw new RangeError("Wooting AKC item payload is too long.");
    return Uint8Array.from([
        kindField * 8 + 2, ...wootingVarintBytes(item.payload.length), ...item.payload,
        0x40, ...wootingVarintBytes(item.keyIndex), 0x48, ...wootingVarintBytes(item.layer),
    ]);
}
/**
 * Replace an AKC binding for one key/layer, preserving all other entries and
 * unknown top-level fields. Pass `null` to remove the binding. The observed
 * profile count field 3 is updated to the new entry count.
 */
export function patchWootingAkcProfile(completeMessage, keyIndex, layer, replacement) {
    if (!Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex > 0xff ||
        !Number.isInteger(layer) || layer < 0 || layer > 0xff) {
        throw new RangeError("Wooting AKC key and layer must be bytes.");
    }
    const entries = [];
    const trailers = [];
    for (const part of wootingProtoSpans(completeMessage)) {
        if (part.field !== 1) {
            if (part.field !== 3)
                trailers.push([...part.raw]);
            continue;
        }
        const outer = decodeProtobufFields(part.raw)[0];
        if (!outer?.bytes)
            throw new Error("Malformed Wooting AKC entry.");
        const decoded = decodeProtobufFields(outer.bytes);
        const key = decoded.find((field) => field.field === 8)?.int;
        const entryLayer = decoded.find((field) => field.field === 9)?.int ?? 0;
        if (key === keyIndex && entryLayer === layer)
            continue;
        entries.push([...part.raw]);
    }
    if (replacement) {
        const fields = decodeProtobufFields(replacement);
        if (fields.find((field) => field.field === 8)?.int !== keyIndex ||
            (fields.find((field) => field.field === 9)?.int ?? 0) !== layer) {
            throw new Error("Wooting AKC replacement key/layer does not match target.");
        }
        entries.push([0x0a, ...wootingVarintBytes(replacement.length), ...replacement]);
    }
    return Uint8Array.from([...entries.flat(), ...trailers.flat(), 0x18, ...wootingVarintBytes(entries.length)]);
}
/** SDK `WOOTING_DEVICE_LAYOUT` values → display names. */
const WOOTING_LAYOUTS = {
    0: "ANSI",
    1: "ISO",
    2: "JIS",
    3: "ANSI Split",
    4: "ISO Split",
};
/**
 * Offset of the layout byte inside the device-config response as WebHID delivers
 * it. The Wooting SDK reads index 10, but its buffer includes the leading
 * report-id byte that a WebHID `inputreport` event strips, so the same field
 * sits at index 9 here — confirmed against a 60HE+ reply
 * (`d1 da 13 88 07 00 00 00 00 00 …`, byte 9 = 0x00 = ANSI).
 */
export const WOOTING_DEVICE_CONFIG_LAYOUT_OFFSET = 9;
/**
 * Decode the layout out of a device-config response. `response` is the raw input
 * report payload (no report-id prefix, matching the WebHID `inputreport` event).
 * Returns `null` when the buffer is too short to trust.
 */
export function decodeWootingDeviceConfig(response, offset = WOOTING_DEVICE_CONFIG_LAYOUT_OFFSET) {
    if (response.length <= offset)
        return null;
    const layoutId = response[offset];
    return { layout: WOOTING_LAYOUTS[layoutId] ?? "Unknown", layoutId };
}
/**
 * True when a buffer looks like a genuine Wooting command reply: it starts with
 * the magic word (`0xD0` or `0xD1`, then `0xDA`) and is long enough to carry a
 * command byte. Used to reject stub responses — e.g. a feature GET that echoes
 * only the report id — so the driver waits for the real input-report reply.
 * A `0x66`-status (unsupported) reply still passes: it IS a genuine reply, the
 * caller decides it carries no payload (see {@link wootingReplyOk}).
 */
export function isWootingReply(bytes) {
    return bytes.length >= 4
        && (bytes[0] === WOOTING_MAGIC_SINGLE || bytes[0] === WOOTING_MAGIC_MULTI)
        && bytes[1] === WOOTING_MAGIC_WORD_1;
}
/**
 * True when the reply's status byte (index 3) is OK (`0x88`). A `0x66` reply
 * means the board understood the framing but does not implement the command —
 * GetDigitalProfilesCount answers exactly this on ARM firmware — so the caller
 * must treat it as "no data", never as payload.
 */
export function wootingReplyOk(reply) {
    return isWootingReply(reply) && reply[3] === WOOTING_STATUS_OK;
}
/** Offset of the `major` byte in a get_version reply (minor/patch follow). */
export const WOOTING_VERSION_OFFSET = 6;
/**
 * Decode the firmware version out of a `get_version` reply.
 *
 * Confirmed against a real 60HE+ answer `d1 da 01 88 03 00 02 0d 00 …` whose
 * Wootility-reported version is v2.13.0: after the 4-byte header
 * (`magic0 magic1 command status`, status 0x88 = OK) and a two-byte leading
 * field, the version is `major minor patch` at offset 6 — here 2, 13, 0 → "2.13.0".
 * Returns null when the reply is not a version answer, carries no version, or
 * has an error status.
 */
export function decodeWootingVersion(reply) {
    const o = WOOTING_VERSION_OFFSET;
    if (!wootingReplyOk(reply) || reply.length < o + 3)
        return null;
    const [major, minor, patch] = [reply[o], reply[o + 1], reply[o + 2]];
    if (major === 0 && minor === 0 && patch === 0)
        return null;
    return `${major}.${minor}.${patch}`;
}
/**
 * Decode a `get_current_keyboard_profile_index` reply. ARM and Standard differ
 * (wootswitch, confirmed on 60HE+): the payload's first byte is the
 * flash-stored default, the third byte is the runtime-active slot — software
 * profile switches only move the latter, so reading byte 0 shows a stale
 * value. This reply carries NO length prefix (unlike the profile-blob
 * family), so payload starts at index 4 in WebHID framing.
 *
 * Returns nulls (not a guess) when the reply is too short or has error status.
 */
export function decodeWootingProfileIndex(reply) {
    if (!wootingReplyOk(reply))
        return null;
    if (reply.length < 5)
        return null;
    const flashDefault = reply[4];
    const active = reply.length > 6 ? reply[6] : flashDefault;
    return { flashDefault, active };
}
/**
 * Decode a `get_profile_metadata` reply for one slot (wootswitch layout):
 * payload byte 0 is the protobuf length — 0 means no profile exists at this
 * slot — byte 1 is padding, bytes 2.. are a protobuf encoding a single
 * field-1 string: the profile name. Like the profile-index reply, there is no
 * outer length prefix; payload starts at index 4 in WebHID framing.
 *
 * Returns `{ exists: false }` for an empty slot, `{ exists: true, name }` for
 * a populated one (`name` is null when the protobuf does not carry one), and
 * null when the reply itself is unusable.
 */
export function decodeWootingProfileMetadata(reply) {
    if (!wootingReplyOk(reply) || reply.length < 6)
        return null;
    if (reply[4] === 0)
        return { exists: false, name: null };
    const fields = decodeProtobufFields(reply.subarray(6));
    const raw = fields.find((field) => field.field === 1 && field.bytes)?.bytes;
    if (!raw)
        return { exists: true, name: null };
    try {
        return { exists: true, name: new TextDecoder().decode(raw) };
    }
    catch {
        return { exists: true, name: null };
    }
}
/**
 * Decode a scalar count reply (`get_digital_profiles_count`,
 * `get_analog_profiles_count`, `get_number_of_keys`, `get_rgb_profile_count`):
 * payload byte 0 at index 4. Returns null on error status — notably
 * GetDigitalProfilesCount answers `0x66` on ARM, where the count must be
 * probed via GetProfileMetadata slots instead (wootswitch).
 */
export function decodeWootingCount(reply, commandId) {
    if (reply.length < 5 || reply[2] !== commandId)
        return null;
    if (!wootingReplyOk(reply))
        return null;
    return reply[4];
}
/**
 * Decode one analog input report from the Wooting analog stream (the 0xFF53 /
 * 0xFF54 interface). The report is a run of 3-byte entries `[usageHigh, usage,
 * value]`; a full snapshot of the currently-pressed keys arrives on every event
 * (a key at value 0 / usage 0 is absent). Layout matches the community WebHID
 * readers (colecrouter/wooting-js). Returns the pressed keys in a stable order
 * (by usage id) so a live UI can keep each key's row in place instead of
 * reordering as values fluctuate.
 */
export function decodeWootingAnalogReport(data) {
    const keys = [];
    for (let i = 0; i + 2 < data.length; i += 3) {
        const usage = data[i + 1];
        const value = data[i + 2];
        if (usage !== 0 && value !== 0)
            keys.push({ usage, value });
    }
    return keys.sort((a, b) => a.usage - b.usage);
}
/** Human name for a product id, falling back to a generic Wooting label. */
export function wootingProductName(productId) {
    return wootingProduct(productId)?.name ?? "Wooting keyboard";
}
