/**
 * Wuque Studio (BABAO / ZOOM) vendor HID protocol — Device (group 1) and Global
 * (group 2) command sets, plus Handle (16), ThreeMode (13) and USB mode (18).
 *
 * Reverse-engineered from the vendor web configurator served at
 * `https://drives-hid.wuquestudio.cn/` (deployed bundle `/hub/js/index-Qbh_Aa6s.js`,
 * `hub/current.pretty.js`, and the legacy `app.pretty.js`) and reconciled with the
 * hardware-verified reply bytes of a physical BABAO60 HE (`0x1CA6:0x1B10`, firmware
 * protocol 1.2.1.0). See `./framing.ts` for the shared 64-byte wire contract.
 *
 * Encoding/decoding rules used throughout:
 * - A reply decodes through {@link wuqueReplyPayload}, so a reply whose echoed
 *   group/subCommand does not match — or a short reply — yields `null`.
 * - A command the board does not implement echoes `subCommand = 0xFF`
 *   ({@link isWuqueUnsupported}); every decoder here returns `null` for it.
 * - None of the commands in this module carry a payload status byte; byte `[2]`
 *   of the reply is either a length/count/mode prefix or data.
 */
import { WUQUE_DEVICE_COMMAND, WUQUE_GLOBAL_COMMAND, WUQUE_GROUP, WUQUE_HANDLE_COMMAND, WUQUE_LIST_ACCESS, WUQUE_REPORT_RATE, WUQUE_SAVE_SCOPE, WUQUE_SYSTEM, WUQUE_THREE_MODE_COMMAND, WUQUE_USB_MODE, WUQUE_USB_MODE_COMMAND, encodeWuqueCommand, isWuqueUnsupported, wuqueReplyPayload, wuqueU16, wuqueU16Bytes, wuqueU32, wuqueU32Bytes, } from "./framing.js";
// ---------------------------------------------------------------------------
// Shared local helpers
// ---------------------------------------------------------------------------
/**
 * Config slots accepted by the ConfigSwitch write (`Xd` in `app.pretty.js:50467`).
 * The framing module has no equivalent enum, so it is kept local.
 */
const CONFIG_SLOTS = { config1: 0, config2: 1, config3: 2, config4: 3 };
/** Resolve a `ReadList`/`Read`/`Write` selector, tolerating enum key or numeric input. */
function selector(access, table) {
    return typeof access === "number" ? access : (table[access] ?? 0);
}
/** Reverse-lookup a value in an enum-like table; `null` when nothing matches. */
function nameOf(table, value) {
    for (const [name, code] of Object.entries(table))
        if (code === value)
            return name;
    return null;
}
/** Payload of a matching, supported reply, else `null` (unsupported → short → mismatch). */
function decode(reply, group, subCommand) {
    if (isWuqueUnsupported(reply))
        return null;
    return wuqueReplyPayload(reply, group, subCommand);
}
/** Shared `{ key, value }` decoder for the `t[3]`-keyed Global setting replies. */
function decodeKeyedValue(reply, subCommand, table) {
    const payload = decode(reply, WUQUE_GROUP.global, subCommand);
    if (payload === null || payload.length < 2)
        return null;
    const value = payload[1];
    return { key: nameOf(table, value), value };
}
/** `[1,1]` — Device.Protocol handshake (`app.pretty.js:52028`). */
export function encodeWuqueDeviceProtocol() {
    return encodeWuqueCommand(WUQUE_GROUP.device, WUQUE_DEVICE_COMMAND.protocol);
}
/** `[1,2]` — Device.DeviceInfo (`app.pretty.js:52039`). */
export function encodeWuqueDeviceInfo() {
    return encodeWuqueCommand(WUQUE_GROUP.device, WUQUE_DEVICE_COMMAND.deviceInfo);
}
/** `[1,3]` — Device.DeviceFeature (`app.pretty.js:52059`). */
export function encodeWuqueDeviceFeature() {
    return encodeWuqueCommand(WUQUE_GROUP.device, WUQUE_DEVICE_COMMAND.deviceFeature);
}
/**
 * Decode the `[1,1]` reply. Hardware `[1,1]` → `01 01 01 02 01 00 …`, i.e.
 * main 1 / sub 2 / hardware 1 / software 0.
 */
export function decodeWuqueProtocolVersion(reply) {
    const payload = decode(reply, WUQUE_GROUP.device, WUQUE_DEVICE_COMMAND.protocol);
    if (payload === null || payload.length < 4)
        return null;
    return {
        mainVersion: payload[0],
        subVersion: payload[1],
        hardwareVersion: payload[2],
        softwareVersion: payload[3],
    };
}
/**
 * Decode the `[1,2]` reply (`app.pretty.js:52043-52058`). Hardware `[1,2]` →
 * `01 02 01 00 00 1b 00 10 02 01 01 00 01 00 00 00 00 36 …`; the payload is that
 * frame from byte 2, so boardId = big-endian payload[2..6] = 0x001b0010.
 */
export function decodeWuqueDeviceInfo(reply) {
    const payload = decode(reply, WUQUE_GROUP.device, WUQUE_DEVICE_COMMAND.deviceInfo);
    if (payload === null || payload.length < 39)
        return null;
    return {
        boardId: ((payload[2] << 24) | (payload[3] << 16) | (payload[4] << 8) | payload[5]) >>> 0,
        appVersion: [payload[6], payload[7], payload[8], payload[9]].join("."),
        pcbVersion: [payload[10], payload[11], payload[12], payload[13]].join("-"),
        runModeVersion: payload[14],
        sn: payload.slice(15, 27).join(""),
        timestamp: new TextDecoder().decode(payload.slice(27, 39).filter((byte) => byte !== 0)),
    };
}
/**
 * Decode the `[1,3]` reply (`app.pretty.js:52063-52088`). Hardware `[1,3]` →
 * `01 03 02 01 01 00 …` ⇒ axisType magnetic, connectionMode usb, basic rgbLighting.
 */
export function decodeWuqueDeviceFeature(reply) {
    const payload = decode(reply, WUQUE_GROUP.device, WUQUE_DEVICE_COMMAND.deviceFeature);
    if (payload === null || payload.length < 4)
        return null;
    const axis = payload[0];
    const connection = payload[1];
    const basic = payload[2];
    const extended = payload[3];
    return {
        axisType: {
            mechanical: !!(axis & 1),
            magnetic: !!(axis & 2),
            optical: !!(axis & 4),
            inductive: !!(axis & 8),
            magnetic3D: !!(axis & 16),
        },
        connectionMode: {
            usb: !!(connection & 1),
            mode2_4G: !!(connection & 2),
            ble: !!(connection & 4),
            usb3: !!(connection & 8),
        },
        basicFunctions: {
            rgbLighting: !!(basic & 1),
            knob: !!(basic & 2),
        },
        extendedFunctions: {
            smallScreen: !!(extended & 1),
            fullScreen: !!(extended & 2),
            hapticFeedback: !!(extended & 4),
            voicePlayback: !!(extended & 8),
            voiceRecognition: !!(extended & 16),
            gamepad: !!(extended & 32),
            dotMatrix: !!(extended & 64),
        },
    };
}
// ---------------------------------------------------------------------------
// Global (group 2) — save / reset / switch / settings
// ---------------------------------------------------------------------------
/**
 * `[2,1,scope]` — GFSRestore / factory reset (`app.pretty.js:52542`). Scope is
 * `Xf` (`WUQUE_SAVE_SCOPE`); the app always sends the numeric value.
 */
export function encodeWuqueGfsRestore(scope) {
    return encodeWuqueCommand(WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.resetFactory, [selector(scope, WUQUE_SAVE_SCOPE)]);
}
/** `[2,2,scope]` — GFSParamSave / persist a scope (`app.pretty.js:52556`). */
export function encodeWuqueGfsParamSave(scope) {
    return encodeWuqueCommand(WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.saveParam, [selector(scope, WUQUE_SAVE_SCOPE)]);
}
/**
 * `[2,15,1]` — GFSHighPollingRateReset (`hub/current.pretty.js:4407-4420`), the
 * Ultra-Frame high-polling-rate switch. The vendor frame is `[Global, 15, 1]`:
 * the scope value 15 occupies the subCommand slot.
 */
export function encodeWuqueHighPollingRateReset() {
    return encodeWuqueCommand(WUQUE_GROUP.global, WUQUE_SAVE_SCOPE.highPollingRateReset, [1]);
}
/**
 * `[2,3,selector]` (+ config on write) — GFSConfigSwitch (`app.pretty.js:52630`/
 * `52673`). `ReadList` → `[2,3,0]`, `Read` → `[2,3,1]`, `Write` → `[2,3,2,config]`.
 */
export function encodeWuqueConfigSwitch(access, config) {
    const mode = selector(access, WUQUE_LIST_ACCESS);
    const params = mode === WUQUE_LIST_ACCESS.write ? [mode, config ?? 0] : [mode];
    return encodeWuqueCommand(WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.configSwitch, params);
}
/**
 * `[2,4,selector]` (+ system on write) — GFSSystemSetting (`app.pretty.js:52570`/
 * `52585`). `Read` → `[2,4,1]`, `Write` → `[2,4,2,WIN|MAC]`.
 */
export function encodeWuqueSystemSetting(access, system) {
    const mode = selector(access, WUQUE_LIST_ACCESS);
    const params = mode === WUQUE_LIST_ACCESS.write
        ? [mode, system === undefined ? WUQUE_SYSTEM.win : selector(system, WUQUE_SYSTEM)]
        : [mode];
    return encodeWuqueCommand(WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.systemSetting, params);
}
/**
 * `[2,5,selector]` (+ rate on write) — GFSRateOfReturn (`app.pretty.js:52596`/
 * `52614`). `ReadList` → `[2,5,0]`, `Read` → `[2,5,1]`, `Write` → `[2,5,2,rate]`.
 */
export function encodeWuqueReportRateSetting(access, rate) {
    const mode = selector(access, WUQUE_LIST_ACCESS);
    const params = mode === WUQUE_LIST_ACCESS.write
        ? [mode, rate === undefined ? WUQUE_REPORT_RATE.r8khz : selector(rate, WUQUE_REPORT_RATE)]
        : [mode];
    return encodeWuqueCommand(WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.reportRateSetting, params);
}
/** `[2,13,1]` — GFSLightingSleepTimeGet (`app.pretty.js:52758`). */
export function encodeWuqueSleepTimeGet() {
    return encodeWuqueCommand(WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.sleepTimeQuery, [1]);
}
/** `[2,13,0,lo,hi]` — GFSLightingSleepTimeSet (`app.pretty.js:52759`), u16 LE seconds. */
export function encodeWuqueSleepTimeSet(seconds) {
    return encodeWuqueCommand(WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.sleepTimeQuery, [
        0,
        ...wuqueU16Bytes(seconds),
    ]);
}
/** `[2,16,1]` — GFSShakeOptimizationSwitchGet (`app.pretty.js:52779`). */
export function encodeWuqueShakeOptimizationGet() {
    return encodeWuqueCommand(WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.shakeOptimizationSwitch, [1]);
}
/** `[2,16,0,1|0]` — GFSShakeOptimizationSwitchSet (`app.pretty.js:52777`, runtime log). */
export function encodeWuqueShakeOptimizationSet(enabled) {
    return encodeWuqueCommand(WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.shakeOptimizationSwitch, [
        0,
        enabled ? 1 : 0,
    ]);
}
/** `[2,14,0]` — GFSMacroSpaceInfoGet (`app.pretty.js:52668`). */
export function encodeWuqueMacroSpaceInfo() {
    return encodeWuqueCommand(WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.macroSpaceInfoQuery, [0]);
}
/** `[2,8,0]` — GFSLightingAreaQuery (`app.pretty.js:52725`). */
export function encodeWuqueEffectAreaQuery() {
    return encodeWuqueCommand(WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.effectAreaQuery, [0]);
}
/** `[2,10,0]` — GFSDoubleLightingQuery (`app.pretty.js:52750`). */
export function encodeWuqueDoubleLightingQuery() {
    return encodeWuqueCommand(WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.doubleLightingQuery, [0]);
}
/** `[2,11,0]` — GFSSpecialLightingQuery (`app.pretty.js:52754`). */
export function encodeWuqueSpecialLightingQuery() {
    return encodeWuqueCommand(WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.specialLightingQuery, [0]);
}
/** `[2,12,0]` — GFSRtPrecisionGet (`app.pretty.js:52635`). */
export function encodeWuqueRtPrecisionQuery() {
    return encodeWuqueCommand(WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.rtPrecisionQuery, [0]);
}
/** `[2,7,0]` — GFSAxisLibQuery(All) (`app.pretty.js:52702`). */
export function encodeWuqueAxisLibraryQuery() {
    return encodeWuqueCommand(WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.axisLibraryQuery, [0]);
}
/**
 * `[2,6,open]` — GFSCalibration (`app.pretty.js:52687`). `Zf.Open = 0`,
 * `Zf.Close = 1`, so `true` starts calibration and `false` stops it.
 */
export function encodeWuqueCalibrationSetting(open) {
    return encodeWuqueCommand(WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.calibrationSetting, [
        open ? 0 : 1,
    ]);
}
/**
 * Decode the `[2,1]` GFSRestore reply (`app.pretty.js:52549`): scope name at
 * payload[1] (`t[3]`), echoed back.
 */
export function decodeWuqueGfsRestoreResult(reply) {
    return decodeKeyedValue(reply, WUQUE_GLOBAL_COMMAND.resetFactory, WUQUE_SAVE_SCOPE);
}
/** Decode the `[2,2]` GFSParamSave reply (`app.pretty.js:52563`): scope at payload[1]. */
export function decodeWuqueSaveResult(reply) {
    return decodeKeyedValue(reply, WUQUE_GLOBAL_COMMAND.saveParam, WUQUE_SAVE_SCOPE);
}
/**
 * Decode the `[2,3]` ConfigSwitch read/write reply (`app.pretty.js:52677`):
 * config name at payload[1] (`t[3]`).
 */
export function decodeWuqueConfigSwitch(reply) {
    return decodeKeyedValue(reply, WUQUE_GLOBAL_COMMAND.configSwitch, CONFIG_SLOTS);
}
/**
 * Decode the `[2,4]` SystemSetting read/write reply (`app.pretty.js:52589`):
 * `WIN`/`MAC` at payload[1] (`t[3]`). Hardware `[2,4,1]` → `02 04 01 00` ⇒ WIN.
 */
export function decodeWuqueSystemSetting(reply) {
    return decodeKeyedValue(reply, WUQUE_GLOBAL_COMMAND.systemSetting, WUQUE_SYSTEM);
}
/**
 * Decode the `[2,5]` ReportRateSetting reply for the `Read` selector: the rate
 * index the board is running now at payload[1] (`t[3]`). Hardware `[2,5,1]` →
 * `02 05 01 00` ⇒ `r8khz`.
 */
export function decodeWuqueReportRate(reply) {
    return decodeKeyedValue(reply, WUQUE_GLOBAL_COMMAND.reportRateSetting, WUQUE_REPORT_RATE);
}
/**
 * Decode the `[2,5,0]` ReportRate list reply (`app.pretty.js:52603`):
 * `total = t[3]`, names from `t.slice(4, 4+total)`. Hardware `[2,5,0]` →
 * `02 05 00 06 00 01 02 03 04 05` ⇒ 6 rates, r8khz..r250hz.
 */
export function decodeWuqueReportRateList(reply) {
    const payload = decode(reply, WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.reportRateSetting);
    if (payload === null || payload.length < 2)
        return null;
    const total = payload[1];
    if (payload.length < 2 + total)
        return null;
    const list = [];
    for (let at = 2; at < 2 + total; at++)
        list.push(nameOf(WUQUE_REPORT_RATE, payload[at]));
    return { total, list };
}
/** Decode the `[2,12]` RtPrecision reply (`app.pretty.js:52665`): `t[3] / 1000`. */
export function decodeWuqueRtPrecision(reply) {
    const payload = decode(reply, WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.rtPrecisionQuery);
    if (payload === null || payload.length < 2)
        return null;
    return { min: payload[1] / 1000 };
}
/**
 * Decode the `[2,13,1]` SleepTime reply (`app.pretty.js:52766`): u16 LE at
 * payload[1..3] (`t[3]`,`t[4]`).
 */
export function decodeWuqueSleepTime(reply) {
    const payload = decode(reply, WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.sleepTimeQuery);
    if (payload === null)
        return null;
    return wuqueU16(payload, 1);
}
/**
 * Decode the `[2,16]` ShakeOptimization reply (`app.pretty.js:51611`):
 * `enabled = t[3] === 1`, raw status preserved.
 */
export function decodeWuqueShakeOptimization(reply) {
    const payload = decode(reply, WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.shakeOptimizationSwitch);
    if (payload === null || payload.length < 2)
        return null;
    const status = payload[1];
    return { enabled: status === 1, status };
}
/**
 * Decode the `[2,14,0]` MacroSpaceInfo reply. Hardware `[2,14,0]` →
 * `02 0e 00 10 c0 03` ⇒ macroCount 16, macroNumber 960.
 */
export function decodeWuqueMacroSpaceInfo(reply) {
    const payload = decode(reply, WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.macroSpaceInfoQuery);
    if (payload === null || payload.length < 4)
        return null;
    const macroNumber = wuqueU16(payload, 2);
    if (macroNumber === null)
        return null;
    return { macroCount: payload[1], macroNumber };
}
/**
 * Decode the `[2,8,0]` EffectArea reply. Hardware `[2,8]` →
 * `02 08 00 01 00 14 06 0f …` ⇒ total 1, area {index 0, count 0x14=20, rows 6,
 * cols 0x0f=15}.
 */
export function decodeWuqueEffectArea(reply) {
    const payload = decode(reply, WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.effectAreaQuery);
    if (payload === null || payload.length < 2)
        return null;
    const total = payload[1];
    if (payload.length < 2 + 4 * total)
        return null;
    const areas = [];
    for (let n = 0; n < total; n++) {
        const base = 2 + 4 * n;
        areas.push({
            index: payload[base],
            count: payload[base + 1],
            rows: payload[base + 2],
            cols: payload[base + 3],
        });
    }
    return { total, areas };
}
/** Decode the `[2,10,0]` DoubleLighting reply (`app.pretty.js:52751`): `t[3]`. */
export function decodeWuqueDoubleLighting(reply) {
    const payload = decode(reply, WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.doubleLightingQuery);
    if (payload === null || payload.length < 2)
        return null;
    return { doubleLighting: payload[1] };
}
/**
 * Decode the `[2,11,0]` SpecialLighting reply (`app.pretty.js:52755`): the app maps
 * `t[3]` through `[1,3,5]` and falls back to 1 for anything else. Hardware `[2,11]`
 * → `02 0b 00 02` ⇒ 5.
 */
export function decodeWuqueSpecialLighting(reply) {
    const payload = decode(reply, WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.specialLightingQuery);
    if (payload === null || payload.length < 2)
        return null;
    const selector = payload[1];
    return { specialLighting: [1, 3, 5][selector] ?? 1 };
}
/** `[16,1]` — getKeyboardMode (`app.pretty.js:53736`). */
export function encodeWuqueGetKeyboardMode() {
    return encodeWuqueCommand(WUQUE_GROUP.handle, WUQUE_HANDLE_COMMAND.getKeyboardMode);
}
/**
 * `[16,2,selector]` — openHandleMode (`app.pretty.js:53754`). The vendor maps
 * mode 1→1, 2→2 and anything else→0 (0 is the close selector).
 */
export function encodeWuqueSetKeyboardMode(mode) {
    const value = mode === 1 ? 1 : mode === 2 ? 2 : 0;
    return encodeWuqueCommand(WUQUE_GROUP.handle, WUQUE_HANDLE_COMMAND.setKeyboardMode, [value]);
}
/**
 * Decode the `[16,1]` reply. Hardware `[16,1]` → `10 ff 00 …` on the 60 HE, i.e.
 * unsupported (`subCommand` echoed 0xFF) ⇒ `null`.
 */
export function decodeWuqueKeyboardMode(reply) {
    const payload = decode(reply, WUQUE_GROUP.handle, WUQUE_HANDLE_COMMAND.getKeyboardMode);
    if (payload === null || payload.length < 15)
        return null;
    const flags = payload[0];
    return {
        xboxSupported: !!(flags & 1),
        normalSupported: !!(flags & 2),
        handleEnabled: !!(flags & 0x80),
        mode: payload[1],
        xVid: wuqueU16(payload, 2),
        xPid: wuqueU16(payload, 4),
        nVid: wuqueU16(payload, 6),
        nPid: wuqueU16(payload, 8),
        compatibilityMode: payload[14] !== 0,
    };
}
/** `[13,1]` — getBasicInfo (`app.pretty.js:52994`). */
export function encodeWuqueThreeModeBasicInfo() {
    return encodeWuqueCommand(WUQUE_GROUP.threeMode, WUQUE_THREE_MODE_COMMAND.getBasicInfo);
}
/** `[13,3]` — getSleepTime (`app.pretty.js:53022`). */
export function encodeWuqueThreeModeSleepTimeGet() {
    return encodeWuqueCommand(WUQUE_GROUP.threeMode, WUQUE_THREE_MODE_COMMAND.getSleepTime);
}
/**
 * `[13,2, ...u32 shallow, ...u32 deep]` — setSleepTime (`app.pretty.js:53006-53014`).
 * Both are u32 LE seconds; `deepSeconds` defaults to `shallowSeconds`.
 */
export function encodeWuqueThreeModeSleepTimeSet(shallowSeconds, deepSeconds = shallowSeconds) {
    return encodeWuqueCommand(WUQUE_GROUP.threeMode, WUQUE_THREE_MODE_COMMAND.setSleepTime, [
        ...wuqueU32Bytes(shallowSeconds),
        ...wuqueU32Bytes(deepSeconds),
    ]);
}
/**
 * Decode the `[13,1]` reply (`app.pretty.js:52996-53005`), which requires at least
 * 5 bytes: mode / charge / battery at payload[0..3] (`t[2..5]`).
 */
export function decodeWuqueThreeModeBasicInfo(reply) {
    const payload = decode(reply, WUQUE_GROUP.threeMode, WUQUE_THREE_MODE_COMMAND.getBasicInfo);
    if (payload === null || payload.length < 3)
        return null;
    return { mode: payload[0], charge: payload[1], battery: payload[2] };
}
/**
 * Decode the `[13,3]` reply (`app.pretty.js:53024-53035`), requiring ≥10 bytes:
 * shallow u32 LE at payload[0..4] (`t[2..6]`), deep u32 LE at payload[4..8].
 */
export function decodeWuqueThreeModeSleepTime(reply) {
    const payload = decode(reply, WUQUE_GROUP.threeMode, WUQUE_THREE_MODE_COMMAND.getSleepTime);
    if (payload === null || payload.length < 8)
        return null;
    const shallowSleepTime = wuqueU32(payload, 0);
    const deepSleepTime = wuqueU32(payload, 4);
    if (shallowSleepTime === null || deepSleepTime === null)
        return null;
    return { shallowSleepTime, deepSleepTime };
}
/** `[18,1]` — GFSUSBModeGetStatus (`hub/current.pretty.js:4337`). */
export function encodeWuqueUsbModeStatus() {
    return encodeWuqueCommand(WUQUE_GROUP.usbMode, WUQUE_USB_MODE_COMMAND.getStatus);
}
/** `[18,2]` — GFSUSBModeGetStored (`hub/current.pretty.js:4357`). */
export function encodeWuqueUsbModeStored() {
    return encodeWuqueCommand(WUQUE_GROUP.usbMode, WUQUE_USB_MODE_COMMAND.getStoredMode);
}
/**
 * `[18,3,mode,rate|0]` — GFSUSBModeSet (`hub/current.pretty.js:4376-4386`). Missing
 * rate becomes 0, matching the vendor's `s !== void 0 ? In[s] : 0`.
 */
export function encodeWuqueUsbModeSet(mode, rate) {
    const rateValue = rate === undefined ? 0 : selector(rate, WUQUE_REPORT_RATE);
    return encodeWuqueCommand(WUQUE_GROUP.usbMode, WUQUE_USB_MODE_COMMAND.setMode, [
        selector(mode, WUQUE_USB_MODE),
        rateValue,
    ]);
}
/**
 * Decode the `[18,1]` reply (`hub/current.pretty.js:4348-4356`). Hardware
 * `[18,1]` → `12 ff 00 …` on the 60 HE, i.e. unsupported ⇒ `null`.
 */
export function decodeWuqueUsbModeStatus(reply) {
    const payload = decode(reply, WUQUE_GROUP.usbMode, WUQUE_USB_MODE_COMMAND.getStatus);
    if (payload === null || payload.length < 11)
        return null;
    return {
        mode: payload[0],
        driverStatus: payload[1],
        vid: wuqueU16(payload, 2),
        pid: wuqueU16(payload, 4),
        bootVid: wuqueU16(payload, 6),
        bootPid: wuqueU16(payload, 8),
        needInstallDriver: payload[10],
    };
}
/** Decode the `[18,2]` reply (`hub/current.pretty.js:4368-4375`). */
export function decodeWuqueUsbModeStored(reply) {
    const payload = decode(reply, WUQUE_GROUP.usbMode, WUQUE_USB_MODE_COMMAND.getStoredMode);
    if (payload === null || payload.length < 2)
        return null;
    return { mode: payload[0], pollingRate: nameOf(WUQUE_REPORT_RATE, payload[1]) };
}
/**
 * Decode the `[18,3]` reply (`hub/current.pretty.js:4387`). The vendor's `success`
 * is just the echoed subCommand (`i[1] === 3`) and is always true for any reply;
 * it is not a real status byte. Unsupported/short replies still yield `null`.
 */
export function decodeWuqueUsbModeSetResult(reply) {
    const payload = decode(reply, WUQUE_GROUP.usbMode, WUQUE_USB_MODE_COMMAND.setMode);
    if (payload === null)
        return null;
    return { success: reply[1] === WUQUE_USB_MODE_COMMAND.setMode };
}
