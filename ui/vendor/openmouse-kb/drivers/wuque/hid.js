import { WUQUE_CONFIG_USAGE, WUQUE_CONFIG_USAGE_PAGE, WUQUE_CONFIG_USAGE_PAGE_ALT, WUQUE_CUSTOM_COMMAND, WUQUE_CUSTOM_LIGHT_PAGES, WUQUE_DEVICE_COMMAND, WUQUE_GLOBAL_COMMAND, WUQUE_GROUP, WUQUE_HANDLE_COMMAND, WUQUE_HIGHER_KEY_COMMAND, WUQUE_HIGHER_KEY_MODE, WUQUE_KEY_COMMAND, WUQUE_LEDS_PER_FRAME, WUQUE_LIGHTING_AREA, WUQUE_LIGHTING_BLOCK, WUQUE_LIGHTING_COMMAND, WUQUE_LIST_ACCESS, WUQUE_MACRO_COMMAND, WUQUE_MACRO_EVENTS_PER_FRAME, WUQUE_MACRO_SLOTS, WUQUE_MATRIX_COLS, WUQUE_MATRIX_ROWS, WUQUE_PERFORMANCE_COMMAND, WUQUE_PRODUCTS, WUQUE_UNSUPPORTED, WUQUE_USB_MODE_COMMAND, decodeWuqueAxisAdc, decodeWuqueAxisCalibrate, decodeWuqueAxisKeyStatus, decodeWuqueAxisRoute, decodeWuqueBlackout, decodeWuqueConfigSwitch, decodeWuqueDeviceFeature, decodeWuqueDeviceInfo, decodeWuqueDoubleLighting, decodeWuqueEffectArea, decodeWuqueHigherKey, decodeWuqueKeyCode, decodeWuqueKeyboardColor, decodeWuqueKeyboardMode, decodeWuqueKeyLayout, decodeWuqueKeyLayoutDefault, decodeWuqueKeyLayoutStyle, decodeWuqueLightingBase, decodeWuqueLightingColorCorrection, decodeWuqueLightingCustom, decodeWuqueLightingPalette, decodeWuqueMacroData, decodeWuqueMacroMode, decodeWuqueMacroSpaceInfo, decodeWuquePerformance, decodeWuqueProtocolVersion, decodeWuqueReportRate, decodeWuqueReportRateList, decodeWuqueRtPrecision, decodeWuqueSaveResult, decodeWuqueShakeOptimization, decodeWuqueSleepTime, decodeWuqueSpecialLighting, decodeWuqueSystemSetting, decodeWuqueUsbModeStatus, decodeWuqueUsbModeStored, encodeWuqueAxisAdc, encodeWuqueAxisCalibrate, encodeWuqueAxisKeyStatus, encodeWuqueAxisRoute, encodeWuqueBlackoutGet, encodeWuqueBlackoutSet, encodeWuqueConfigSwitch, encodeWuqueDeviceFeature, encodeWuqueDeviceInfo, encodeWuqueDeviceProtocol, encodeWuqueDoubleLightingQuery, encodeWuqueEffectAreaQuery, encodeWuqueGetHigherKey, encodeWuqueGetKeyCode, encodeWuqueGetKeyboardMode, encodeWuqueGetKeyLayout, encodeWuqueGetKeyLayoutDefault, encodeWuqueGetKeyLayoutStyle, encodeWuqueGetLightingBase, encodeWuqueGetLightingColorCorrection, encodeWuqueGetLightingCustom, encodeWuqueGetLightingPalette, encodeWuqueGetMacro, encodeWuqueGetMacroMode, encodeWuqueGetPerformance, encodeWuqueGfsParamSave, encodeWuqueKeyboardColorGet, encodeWuqueKeyboardColorSet, encodeWuqueLightingCaps, encodeWuqueLightingDirectDrive, encodeWuqueMacroSpaceInfo, encodeWuqueReportRateSetting, encodeWuqueRtPrecisionQuery, encodeWuqueSetHigherKey, encodeWuqueSetKeyCode, encodeWuqueSetLightingBase, encodeWuqueSetLightingColorCorrection, encodeWuqueSetLightingCustom, encodeWuqueSetLightingPalette, encodeWuqueSetMacro, encodeWuqueSetMacroMode, encodeWuqueSetPerformance, encodeWuqueShakeOptimizationGet, encodeWuqueShakeOptimizationSet, encodeWuqueSleepTimeGet, encodeWuqueSleepTimeSet, encodeWuqueSpecialLightingQuery, encodeWuqueSystemSetting, encodeWuqueUsbModeStatus, encodeWuqueUsbModeStored, isWuqueUnsupported, wuqueProductName, } from "../../wuque/index.js";
/**
 * Wuque Studio analog keyboard HID control.
 *
 * Implements the safe subset of the vendor protocol, decoded by
 * `@openmouse/keyboard-protocol/wuque`:
 *
 * - identity reads (protocol / device info / device feature);
 * - key layout + keycode read, and a same-value-safe keycode write;
 * - performance read + write and the hall-sensor axis reads;
 * - advanced-key (higher-key) read + write (SOCD/RS send two frames in order);
 * - lighting reads, plus base / palette / colour-correction / custom /
 *   direct-drive / caps writes; blackout and keyboard shell colour;
 * - macro read + write (mode header then 15-event pages);
 * - global reads, and report-rate / system-type / sleep-time /
 *   shake-optimisation writes plus scoped save.
 *
 * NEVER implemented here: factory reset (`resetFactory`/GFSRestore), flash or
 * firmware upgrade, voice, haptics, the displayer group, and
 * `highPollingRateReset`. None of those leave the board in a recoverable RAM
 * state through this driver.
 *
 * Wire contract: every request is a 64-byte output report with report id 0
 * (`[group, subCommand, …params]`); the board answers with an input report that
 * echoes `[group, subCommand, …payload]`. The board never correlates a reply
 * with a request, so the client arms a waiter on the exact `(group, subCommand)`
 * it just sent and ignores all other input reports — boot-keyboard, consumer and
 * mouse chatter arrive on the same channel. Each command is retried up to
 * {@link WUQUE_COMMAND_ATTEMPTS} times, {@link WUQUE_RESPONSE_TIMEOUT_MS} apart
 * (mirroring the vendor tooling); a timeout or a `0xFF` echoed sub-command means
 * "unsupported" (`null`), never success. All commands are serialised through one
 * lock so two reads never share the reply channel.
 */
/** Per-attempt reply timeout, mirroring the vendor configurator. */
const WUQUE_RESPONSE_TIMEOUT_MS = 1000;
/** Send/receive attempts per command before the read is treated as unsupported. */
const WUQUE_COMMAND_ATTEMPTS = 3;
/** Reply cache key width: group + sub-command + up to eight parameter bytes. */
const WUQUE_CACHE_KEY_BYTES = 10;
export class WuqueHidClient {
    device;
    responseWaiter = null;
    responseTimer = null;
    // Each command's raw reply is read once per connection and cached, so a
    // silent board pays its timeouts once instead of on every background refresh.
    // Any write clears the cache so a subsequent readStatus re-reads the board.
    replies = new Map();
    // Serializes command sends so two reads never share the single input-report
    // reply channel at the same time.
    commandLock = Promise.resolve();
    listening = false;
    onInputReport = (event) => {
        const bytes = new Uint8Array(event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength));
        const waiter = this.responseWaiter;
        if (!waiter)
            return;
        if (bytes.length < 2)
            return;
        if (bytes[0] !== waiter.group)
            return;
        // Accept the matching sub-command and the board's unsupported echo (0xFF);
        // anything else is keypress/mouse chatter and is left for other listeners.
        if (bytes[1] !== waiter.subCommand && bytes[1] !== WUQUE_UNSUPPORTED)
            return;
        this.clearPendingRead();
        waiter.resolve(bytes);
    };
    constructor(device) {
        this.device = device;
    }
    /**
     * Wuque VID (either one) plus a known product id and a command-capable config
     * collection: usage page 0xFFB0 or 0xFF80, usage 1. Only that collection is
     * matched — a board also presents boot-keyboard / consumer interfaces, and
     * matching those would list the same physical keyboard several times.
     */
    static isSupported(device) {
        // Product ids are only unique per vendor: the 80 HE ids belong to 0x36B5,
        // so a 0x1CA6 device claiming one of them is not a Wuque board we drive.
        if (WUQUE_PRODUCTS[device.productId]?.vendorId !== device.vendorId)
            return false;
        return WuqueHidClient.configCollection(device.collections) !== null;
    }
    /** The command-capable config collection, if this device exposes one. */
    static configCollection(collections) {
        for (const collection of collections) {
            if (collection.usage === WUQUE_CONFIG_USAGE
                && (collection.usagePage === WUQUE_CONFIG_USAGE_PAGE
                    || collection.usagePage === WUQUE_CONFIG_USAGE_PAGE_ALT)) {
                return collection;
            }
            const nested = WuqueHidClient.configCollection(collection.children);
            if (nested)
                return nested;
        }
        return null;
    }
    async open() {
        if (!this.device.opened)
            await this.device.open();
        if (!this.listening) {
            this.device.addEventListener("inputreport", this.onInputReport);
            this.listening = true;
        }
    }
    async close() {
        if (this.listening) {
            this.device.removeEventListener("inputreport", this.onInputReport);
            this.listening = false;
        }
        if (this.device.opened)
            await this.device.close();
    }
    // ---------------------------------------------------------------------------
    // Status
    // ---------------------------------------------------------------------------
    /**
     * Identity + global settings for the connected board. Never throws: every leg
     * is best-effort and a sub-command the board does not answer falls back to
     * `null` (or an empty list) rather than being guessed. Key layout, lighting
     * and macros are deliberately NOT read here — those are separate on-demand
     * calls (`readKeyLayout`, `readLighting`, `readMacros`).
     */
    async readStatus() {
        await this.open();
        const device = await this.readDeviceState();
        const global = await this.readGlobalState();
        const name = wuqueProductName(this.device.productId);
        const protocol = device.protocol;
        const info = device.info;
        const firmwareVersion = protocol
            ? `${protocol.mainVersion}.${protocol.subVersion}.${protocol.hardwareVersion}.${protocol.softwareVersion}`
            : null;
        const lines = [];
        if (firmwareVersion)
            lines.push(`Firmware: ${firmwareVersion}`);
        if (info)
            lines.push(`App ${info.appVersion} · PCB ${info.pcbVersion}`);
        if (info?.sn)
            lines.push(`Serial: ${info.sn}`);
        const wuque = { device, global, keys: null, lighting: null, macros: null };
        return {
            brand: "Wuque Studio",
            name,
            ui: {
                family: "wuque",
                // No host surface consumes the nested objects yet; the fields are
                // present for the planned keyboard UI.
                settingsReady: false,
                defaultDisplayName: name,
            },
            connectionType: "Wired",
            connectionDetail: "USB",
            firmware: lines,
            firmwareVersion,
            layout: null,
            serial: info?.sn ? info.sn : null,
            activeProfile: global.configSwitch,
            // Four onboard config slots on every board this codec targets.
            profileCount: 4,
            profileNames: [],
            wuque,
        };
    }
    // ---------------------------------------------------------------------------
    // Device (group 1) — identity reads
    // ---------------------------------------------------------------------------
    /** Identity + capability block; each leg is independent and best-effort. */
    async readDeviceState() {
        await this.open();
        const protocol = await this.readDeviceProtocol();
        const info = await this.readDeviceInfo();
        const feature = await this.readDeviceFeature();
        return { protocol, info, feature };
    }
    /** `[1,1]` protocol version (main / sub / hardware / software). */
    async readDeviceProtocol() {
        await this.open();
        const reply = await this.readFrame(encodeWuqueDeviceProtocol(), WUQUE_GROUP.device, WUQUE_DEVICE_COMMAND.protocol);
        return reply ? decodeWuqueProtocolVersion(reply) : null;
    }
    /** `[1,2]` board id, app/PCB versions, run mode, serial and timestamp. */
    async readDeviceInfo() {
        await this.open();
        const reply = await this.readFrame(encodeWuqueDeviceInfo(), WUQUE_GROUP.device, WUQUE_DEVICE_COMMAND.deviceInfo);
        return reply ? decodeWuqueDeviceInfo(reply) : null;
    }
    /** `[1,3]` axis type, connection mode and basic/extended function bits. */
    async readDeviceFeature() {
        await this.open();
        const reply = await this.readFrame(encodeWuqueDeviceFeature(), WUQUE_GROUP.device, WUQUE_DEVICE_COMMAND.deviceFeature);
        return reply ? decodeWuqueDeviceFeature(reply) : null;
    }
    // ---------------------------------------------------------------------------
    // Global (group 2) — settings
    // ---------------------------------------------------------------------------
    /** `[2,4,1]` host OS setting (`WIN`/`MAC`). */
    async readSystemSetting() {
        await this.open();
        const reply = await this.readFrame(encodeWuqueSystemSetting(WUQUE_LIST_ACCESS.read), WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.systemSetting);
        return reply ? decodeWuqueSystemSetting(reply) : null;
    }
    /** `[2,3,1]` active config slot (the board's "profile"). */
    async readConfigSwitch() {
        await this.open();
        const reply = await this.readFrame(encodeWuqueConfigSwitch(WUQUE_LIST_ACCESS.read), WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.configSwitch);
        return reply ? decodeWuqueConfigSwitch(reply) : null;
    }
    /** Drop cached reads before a user-requested refresh. No HID writes are sent. */
    invalidateReadCache() { this.replies.clear(); }
    /** Switch a runtime config slot and verify the board's live selection. */
    async writeConfigSwitch(slot) {
        if (!Number.isInteger(slot) || slot < 0 || slot > 3)
            throw new RangeError("Config slot must be 0–3.");
        await this.open();
        const reply = await this.writeFrame(encodeWuqueConfigSwitch(WUQUE_LIST_ACCESS.write, slot), WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.configSwitch);
        if (!reply || decodeWuqueConfigSwitch(reply)?.value !== slot)
            throw new Error("Config switch was not acknowledged.");
        if ((await this.readConfigSwitch())?.value !== slot)
            throw new Error("Config switch was not confirmed.");
    }
    /** `[2,5,0]` polling rates the board advertises, in firmware order. */
    async readReportRates() {
        await this.open();
        const reply = await this.readFrame(encodeWuqueReportRateSetting(WUQUE_LIST_ACCESS.readList), WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.reportRateSetting);
        return reply ? decodeWuqueReportRateList(reply)?.list ?? [] : [];
    }
    /** `[2,5,1]` rate the board is running now, by name, or null when it stays silent. */
    async readReportRate() {
        await this.open();
        const reply = await this.readFrame(encodeWuqueReportRateSetting(WUQUE_LIST_ACCESS.read), WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.reportRateSetting);
        return reply ? decodeWuqueReportRate(reply)?.key ?? null : null;
    }
    /** `[2,13,1]` lighting sleep time in seconds. */
    async readSleepTime() {
        await this.open();
        const reply = await this.readFrame(encodeWuqueSleepTimeGet(), WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.sleepTimeQuery);
        return reply ? decodeWuqueSleepTime(reply) : null;
    }
    /** `[2,16,1]` shake-optimisation switch. */
    async readShakeOptimization() {
        await this.open();
        const reply = await this.readFrame(encodeWuqueShakeOptimizationGet(), WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.shakeOptimizationSwitch);
        return reply ? decodeWuqueShakeOptimization(reply) : null;
    }
    /** `[2,12,0]` rapid-trigger precision minimum, in millimetres. */
    async readRtPrecision() {
        await this.open();
        const reply = await this.readFrame(encodeWuqueRtPrecisionQuery(), WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.rtPrecisionQuery);
        return reply ? decodeWuqueRtPrecision(reply) : null;
    }
    /** `[2,14,0]` macro capacity (slots / packed actions). */
    async readMacroSpaceInfo() {
        await this.open();
        const reply = await this.readFrame(encodeWuqueMacroSpaceInfo(), WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.macroSpaceInfoQuery);
        return reply ? decodeWuqueMacroSpaceInfo(reply) : null;
    }
    /** `[2,8,0]` addressable lighting areas. */
    async readEffectAreas() {
        await this.open();
        const reply = await this.readFrame(encodeWuqueEffectAreaQuery(), WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.effectAreaQuery);
        return reply ? decodeWuqueEffectArea(reply) : null;
    }
    /** `[2,10,0]` double-lighting selector. */
    async readDoubleLighting() {
        await this.open();
        const reply = await this.readFrame(encodeWuqueDoubleLightingQuery(), WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.doubleLightingQuery);
        return reply ? decodeWuqueDoubleLighting(reply) : null;
    }
    /** `[2,11,0]` special-lighting selector. */
    async readSpecialLighting() {
        await this.open();
        const reply = await this.readFrame(encodeWuqueSpecialLightingQuery(), WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.specialLightingQuery);
        return reply ? decodeWuqueSpecialLighting(reply) : null;
    }
    /** `[16,1]` keyboard mode. The 60 HE answers unsupported (0xFF) → `null`. */
    async readKeyboardMode() {
        await this.open();
        const reply = await this.readFrame(encodeWuqueGetKeyboardMode(), WUQUE_GROUP.handle, WUQUE_HANDLE_COMMAND.getKeyboardMode);
        return reply ? decodeWuqueKeyboardMode(reply) : null;
    }
    /** `[18,1]` USB-mode status. The 60 HE answers unsupported (0xFF) → `null`. */
    async readUsbModeStatus() {
        await this.open();
        const reply = await this.readFrame(encodeWuqueUsbModeStatus(), WUQUE_GROUP.usbMode, WUQUE_USB_MODE_COMMAND.getStatus);
        return reply ? decodeWuqueUsbModeStatus(reply) : null;
    }
    /** `[18,2]` stored USB mode. The 60 HE answers unsupported (0xFF) → `null`. */
    async readUsbModeStored() {
        await this.open();
        const reply = await this.readFrame(encodeWuqueUsbModeStored(), WUQUE_GROUP.usbMode, WUQUE_USB_MODE_COMMAND.getStoredMode);
        return reply ? decodeWuqueUsbModeStored(reply) : null;
    }
    /** Every global setting the board answers, in one pass. Never throws. */
    async readGlobalState() {
        await this.open();
        const systemSetting = await this.readSystemSetting();
        const configSwitch = await this.readConfigSwitch();
        const reportRates = await this.readReportRates();
        const sleepTime = await this.readSleepTime();
        const shake = await this.readShakeOptimization();
        const rtPrecision = await this.readRtPrecision();
        const macroSpace = await this.readMacroSpaceInfo();
        const effectAreas = await this.readEffectAreas();
        const doubleLighting = await this.readDoubleLighting();
        const specialLighting = await this.readSpecialLighting();
        const blackout = await this.readBlackout();
        const usbMode = await this.readUsbModeStatus();
        return {
            systemType: systemSetting ? systemSetting.value : null,
            configSwitch: configSwitch ? configSwitch.value : null,
            reportRates,
            sleepTime,
            shakeOptimization: shake ? shake.enabled : null,
            rtPrecision: rtPrecision ? rtPrecision.min : null,
            macroSpace,
            effectAreas,
            doubleLighting: doubleLighting ? doubleLighting.doubleLighting : null,
            specialLighting: specialLighting ? specialLighting.specialLighting : null,
            blackout: blackout ? blackout.open : null,
            usbMode,
        };
    }
    /** `[2,4,2,system]` host OS setting write; returns the echoed setting. */
    async writeSystemSetting(system) {
        await this.open();
        const reply = await this.writeFrame(encodeWuqueSystemSetting(WUQUE_LIST_ACCESS.write, system), WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.systemSetting);
        return reply ? decodeWuqueSystemSetting(reply) : null;
    }
    /** `[2,5,2,rate]` polling-rate write. True when the board acknowledged. */
    async writeReportRate(rate) {
        await this.open();
        const reply = await this.writeFrame(encodeWuqueReportRateSetting(WUQUE_LIST_ACCESS.write, rate), WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.reportRateSetting);
        return reply !== null && !isWuqueUnsupported(reply);
    }
    /** `[2,13,0,lo,hi]` sleep-time write; returns the echoed seconds. */
    async writeSleepTime(seconds) {
        await this.open();
        const reply = await this.writeFrame(encodeWuqueSleepTimeSet(seconds), WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.sleepTimeQuery);
        return reply ? decodeWuqueSleepTime(reply) : null;
    }
    /** `[2,16,0,1|0]` shake-optimisation write; returns the echoed state. */
    async writeShakeOptimization(enabled) {
        await this.open();
        const reply = await this.writeFrame(encodeWuqueShakeOptimizationSet(enabled), WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.shakeOptimizationSwitch);
        return reply ? decodeWuqueShakeOptimization(reply) : null;
    }
    /**
     * `[2,2,scope]` scoped save (RAM → flash). The caller owns the blocking
     * "overwrites onboard flash" confirmation. Returns the echoed scope.
     */
    async saveScope(scope) {
        await this.open();
        const reply = await this.writeFrame(encodeWuqueGfsParamSave(scope), WUQUE_GROUP.global, WUQUE_GLOBAL_COMMAND.saveParam);
        return reply ? decodeWuqueSaveResult(reply) : null;
    }
    // ---------------------------------------------------------------------------
    // LayoutAndKey (group 3) — read + same-value-safe keycode write
    // ---------------------------------------------------------------------------
    /**
     * `[3,1,layer,row]` over all {@link WUQUE_MATRIX_ROWS} rows, assembled into
     * `rows[row][col]` with {@link WUQUE_MATRIX_COLS} slots per row. Silent rows
     * contribute zeros; the shape is always returned.
     */
    async readKeyLayout(layer = 0) {
        await this.open();
        const rows = [];
        for (let row = 0; row < WUQUE_MATRIX_ROWS; row += 1) {
            const reply = await this.readFrame(encodeWuqueGetKeyLayout(layer, row), WUQUE_GROUP.layoutAndKey, WUQUE_KEY_COMMAND.getKeyLayout);
            const keycodes = (reply ? decodeWuqueKeyLayout(reply) : null)?.keycodes ?? [];
            const slots = [];
            for (let col = 0; col < WUQUE_MATRIX_COLS; col += 1)
                slots.push(keycodes[col] ?? 0);
            rows.push(slots);
        }
        return { layer, rows };
    }
    /**
     * `[3,3,layer,row,col]` for every matrix slot, one explicit call. This is
     * 4×6×21 commands when repeated per layer, so it is never part of
     * {@link readStatus}. Silent slots report keycode 0.
     */
    async readKeyCodes(layer = 0) {
        await this.open();
        const codes = [];
        for (let row = 0; row < WUQUE_MATRIX_ROWS; row += 1) {
            for (let col = 0; col < WUQUE_MATRIX_COLS; col += 1) {
                const reply = await this.readFrame(encodeWuqueGetKeyCode(layer, row, col), WUQUE_GROUP.layoutAndKey, WUQUE_KEY_COMMAND.getKeyCode);
                codes.push((reply ? decodeWuqueKeyCode(reply) : null) ?? { layer, row, col, keycode: 0 });
            }
        }
        return codes;
    }
    /**
     * `[3,3,layer,row,col]` for one slot. Returns null when the board stays silent
     * for that position instead of inventing a keycode.
     */
    async readKeyCode(layer, row, col) {
        await this.open();
        const reply = await this.readFrame(encodeWuqueGetKeyCode(layer, row, col), WUQUE_GROUP.layoutAndKey, WUQUE_KEY_COMMAND.getKeyCode);
        return reply ? decodeWuqueKeyCode(reply) : null;
    }
    /**
     * `[3,4,layer,row,col,kcLo,kcHi]` keycode write. The board echoes the written
     * keycode, so the reply is verified and a mismatch throws — a reply the
     * driver cannot confirm as the requested value is never reported as success.
     */
    async writeKeyCode(layer, row, col, keycode) {
        await this.open();
        const reply = await this.writeFrame(encodeWuqueSetKeyCode(layer, row, col, keycode), WUQUE_GROUP.layoutAndKey, WUQUE_KEY_COMMAND.setKeyCode);
        const decoded = reply ? decodeWuqueKeyCode(reply) : null;
        if (!decoded || decoded.layer !== layer || decoded.row !== row || decoded.col !== col || decoded.keycode !== (keycode & 0xffff)) {
            throw new Error(`Wuque keycode write was not confirmed (layer ${layer}, ${row}:${col}).`);
        }
        return true;
    }
    /** `[3,5,index]` layout-style geometry for one row. */
    async readKeyLayoutStyle(index) {
        await this.open();
        const reply = await this.readFrame(encodeWuqueGetKeyLayoutStyle(index), WUQUE_GROUP.layoutAndKey, WUQUE_KEY_COMMAND.getKeyLayoutStyle);
        return reply ? decodeWuqueKeyLayoutStyle(reply) : null;
    }
    /** `[3,6,system<<4|fn,row]` default layout for one row. */
    async readKeyLayoutDefault(system, fn, row) {
        await this.open();
        const reply = await this.readFrame(encodeWuqueGetKeyLayoutDefault(system, fn, row), WUQUE_GROUP.layoutAndKey, WUQUE_KEY_COMMAND.getKeyLayoutDefault);
        return reply ? decodeWuqueKeyLayoutDefault(reply) : null;
    }
    // ---------------------------------------------------------------------------
    // HigherKey (group 6) — advanced keys
    // ---------------------------------------------------------------------------
    /** `[6,1,row,col,mode]` advanced-key read for one key. */
    async readHigherKey(row, col, mode = WUQUE_HIGHER_KEY_MODE.none) {
        await this.open();
        const reply = await this.readFrame(encodeWuqueGetHigherKey(row, col, mode), WUQUE_GROUP.higherKey, WUQUE_HIGHER_KEY_COMMAND.read);
        return reply ? decodeWuqueHigherKey(reply) : null;
    }
    /**
     * Advanced-key write. The codec returns one frame for NONE/DKS/MPT/MT/TGL/END
     * and **two** frames for SOCD/RS; each frame is sent in order and its reply
     * decoded, so the returned array is positionally aligned with the frames.
     */
    async writeHigherKey(write) {
        await this.open();
        const frames = encodeWuqueSetHigherKey(write);
        const decoded = [];
        for (const frame of frames) {
            const reply = await this.writeFrame(frame, WUQUE_GROUP.higherKey, WUQUE_HIGHER_KEY_COMMAND.write);
            decoded.push(reply ? decodeWuqueHigherKey(reply) : null);
        }
        return decoded;
    }
    // ---------------------------------------------------------------------------
    // Performance (group 4) — actuation + hall-sensor reads
    // ---------------------------------------------------------------------------
    /** `[4,1,row,col]` actuation / rapid-trigger settings for one key. */
    async readPerformance(row, col) {
        await this.open();
        const reply = await this.readFrame(encodeWuqueGetPerformance(row, col), WUQUE_GROUP.performance, WUQUE_PERFORMANCE_COMMAND.getPerformance);
        return reply ? decodeWuquePerformance(reply) : null;
    }
    /** `[4,2,…]` actuation / rapid-trigger write; returns the echoed block. */
    async writePerformance(settings) {
        await this.open();
        const reply = await this.writeFrame(encodeWuqueSetPerformance(settings), WUQUE_GROUP.performance, WUQUE_PERFORMANCE_COMMAND.setPerformance);
        return reply ? decodeWuquePerformance(reply) : null;
    }
    /** `[4,3,0,row]` raw per-row ADC samples. */
    async readAxisAdc(row) {
        return this.readAxisReading(encodeWuqueAxisAdc(row), decodeWuqueAxisAdc);
    }
    /** `[4,3,1,row]` per-row axis routing samples. */
    async readAxisRoute(row) {
        return this.readAxisReading(encodeWuqueAxisRoute(row), decodeWuqueAxisRoute);
    }
    /** `[4,3,2,row]` per-row calibration-status samples. */
    async readAxisCalibrate(row) {
        return this.readAxisReading(encodeWuqueAxisCalibrate(row), decodeWuqueAxisCalibrate);
    }
    /** `[4,3,3,row]` per-row key-status samples. */
    async readAxisKeyStatus(row) {
        return this.readAxisReading(encodeWuqueAxisKeyStatus(row), decodeWuqueAxisKeyStatus);
    }
    /** Shared body of the four `axisData` reads. */
    async readAxisReading(frame, decode) {
        await this.open();
        const reply = await this.enqueue(frame, WUQUE_GROUP.performance, WUQUE_PERFORMANCE_COMMAND.axisData);
        return reply ? decode(reply) : null;
    }
    // ---------------------------------------------------------------------------
    // Lighting (group 5 / group 10)
    // ---------------------------------------------------------------------------
    /** Base block + palette + colour correction + first custom page for one area. */
    async readLighting(area = WUQUE_LIGHTING_AREA.keyboard) {
        await this.open();
        const base = await this.readLightingBase(area);
        const palette = await this.readLightingPalette(area);
        const colorCorrection = await this.readLightingColorCorrection(area);
        const custom = await this.readLightingCustomPage(area, 0);
        if (!base && !palette && !colorCorrection && !custom)
            return null;
        return { area, base, palette, colorCorrection, custom };
    }
    /** `[5,1,area,block]` base block (`block` defaults to the base selector). */
    async readLightingBase(area = WUQUE_LIGHTING_AREA.keyboard, block = WUQUE_LIGHTING_BLOCK.base) {
        await this.open();
        const reply = await this.readFrame(encodeWuqueGetLightingBase(area, block), WUQUE_GROUP.lighting, WUQUE_LIGHTING_COMMAND.getBase);
        return reply ? decodeWuqueLightingBase(reply) : null;
    }
    /** `[5,1,area,1]` static palette (up to 8 colours). */
    async readLightingPalette(area = WUQUE_LIGHTING_AREA.keyboard) {
        await this.open();
        const reply = await this.readFrame(encodeWuqueGetLightingPalette(area), WUQUE_GROUP.lighting, WUQUE_LIGHTING_COMMAND.getBase);
        return reply ? decodeWuqueLightingPalette(reply) : null;
    }
    /** `[5,1,area,2]` per-area colour correction. */
    async readLightingColorCorrection(area = WUQUE_LIGHTING_AREA.keyboard) {
        await this.open();
        const reply = await this.readFrame(encodeWuqueGetLightingColorCorrection(area), WUQUE_GROUP.lighting, WUQUE_LIGHTING_COMMAND.getBase);
        return reply ? decodeWuqueLightingColorCorrection(reply) : null;
    }
    /**
     * `[5,3,area,page]` over all {@link WUQUE_CUSTOM_LIGHT_PAGES} pages,
     * concatenated in page order (15 LEDs per page). Silent pages contribute
     * nothing.
     */
    async readLightingCustom(area = WUQUE_LIGHTING_AREA.keyboard) {
        await this.open();
        const leds = [];
        for (let page = 0; page < WUQUE_CUSTOM_LIGHT_PAGES; page += 1) {
            const decoded = await this.readLightingCustomPage(area, page);
            if (decoded)
                leds.push(...decoded);
        }
        return leds;
    }
    /** One `[5,3,area,page]` custom LED page. */
    async readLightingCustomPage(area, page) {
        const reply = await this.readFrame(encodeWuqueGetLightingCustom(area, page), WUQUE_GROUP.lighting, WUQUE_LIGHTING_COMMAND.getCustom);
        return reply ? decodeWuqueLightingCustom(reply) : null;
    }
    /** `[5,2,…]` base-block write; returns the echoed base block. */
    async writeLightingBase(settings) {
        await this.open();
        const reply = await this.writeFrame(encodeWuqueSetLightingBase(settings), WUQUE_GROUP.lighting, WUQUE_LIGHTING_COMMAND.setBase);
        return reply ? decodeWuqueLightingBase(reply, WUQUE_LIGHTING_COMMAND.setBase) : null;
    }
    /** `[5,2,area,1,…]` palette write; returns the echoed colours. */
    async writeLightingPalette(area, colors) {
        await this.open();
        const reply = await this.writeFrame(encodeWuqueSetLightingPalette(area, colors), WUQUE_GROUP.lighting, WUQUE_LIGHTING_COMMAND.setBase);
        return reply ? decodeWuqueLightingPalette(reply, WUQUE_LIGHTING_COMMAND.setBase) : null;
    }
    /** `[5,2,area,2,R,G,B]` colour-correction write; returns the echoed colour. */
    async writeLightingColorCorrection(area, color) {
        await this.open();
        const reply = await this.writeFrame(encodeWuqueSetLightingColorCorrection(area, color), WUQUE_GROUP.lighting, WUQUE_LIGHTING_COMMAND.setBase);
        return reply ? decodeWuqueLightingColorCorrection(reply, WUQUE_LIGHTING_COMMAND.setBase) : null;
    }
    /**
     * `[5,4,area,page,…]` custom LED write, chunked into
     * {@link WUQUE_LEDS_PER_FRAME}-LED pages. Throws when a page is not
     * acknowledged.
     */
    async writeLightingCustom(area, leds) {
        await this.open();
        const pages = Math.ceil(leds.length / WUQUE_LEDS_PER_FRAME);
        for (let page = 0; page < pages; page += 1) {
            const chunk = leds.slice(page * WUQUE_LEDS_PER_FRAME, (page + 1) * WUQUE_LEDS_PER_FRAME);
            const reply = await this.writeFrame(encodeWuqueSetLightingCustom(area, page, chunk), WUQUE_GROUP.lighting, WUQUE_LIGHTING_COMMAND.setCustom);
            if (reply === null || isWuqueUnsupported(reply)) {
                throw new Error(`Wuque custom lighting page ${page} was not accepted.`);
            }
        }
        return true;
    }
    /**
     * `[5,5,area,page,…]` direct-drive push, chunked into
     * {@link WUQUE_LEDS_PER_FRAME}-LED pages. Fire-and-forget by protocol: the
     * board sends no reply.
     */
    async writeLightingDirectDrive(area, leds) {
        await this.open();
        const pages = Math.ceil(leds.length / WUQUE_LEDS_PER_FRAME);
        for (let page = 0; page < pages; page += 1) {
            const chunk = leds.slice(page * WUQUE_LEDS_PER_FRAME, (page + 1) * WUQUE_LEDS_PER_FRAME);
            await this.fire(encodeWuqueLightingDirectDrive(area, page, chunk));
        }
    }
    /** `[5,6,B,R,G]` caps indicator colour. Raw frame, no reply. */
    async writeLightingCaps(color) {
        await this.open();
        await this.fire(encodeWuqueLightingCaps(color));
    }
    /** `[10,1,0]` blackout status. */
    async readBlackout() {
        await this.open();
        const reply = await this.readFrame(encodeWuqueBlackoutGet(), WUQUE_GROUP.customCommand, WUQUE_CUSTOM_COMMAND.blackout);
        return reply ? decodeWuqueBlackout(reply) : null;
    }
    /** `[10,1,1,255|0]` blackout open/close. Fire-and-forget. */
    async writeBlackout(open) {
        await this.open();
        await this.fire(encodeWuqueBlackoutSet(open));
    }
    /** `[10,1,1]` keyboard shell colour. */
    async readKeyboardColor() {
        await this.open();
        const reply = await this.readFrame(encodeWuqueKeyboardColorGet(), WUQUE_GROUP.customCommand, WUQUE_CUSTOM_COMMAND.blackout);
        return reply ? decodeWuqueKeyboardColor(reply) : null;
    }
    /** `[10,1,2,255,B,G,R]` keyboard shell colour write; returns the echo. */
    async writeKeyboardColor(color) {
        await this.open();
        const reply = await this.writeFrame(encodeWuqueKeyboardColorSet(color), WUQUE_GROUP.customCommand, WUQUE_CUSTOM_COMMAND.blackout);
        return reply ? decodeWuqueKeyboardColor(reply) : null;
    }
    // ---------------------------------------------------------------------------
    // Macro (group 7)
    // ---------------------------------------------------------------------------
    /** `[7,1,macroId]` macro mode header (valid / actNum / repNum / mode). */
    async readMacroMode(macroId) {
        await this.open();
        const reply = await this.readFrame(encodeWuqueGetMacroMode(macroId), WUQUE_GROUP.macro, WUQUE_MACRO_COMMAND.getMacroMode);
        return reply ? decodeWuqueMacroMode(reply) : null;
    }
    /** `[7,2,…]` macro mode-header write; returns the echoed header. */
    async writeMacroMode(mode) {
        await this.open();
        const reply = await this.writeFrame(encodeWuqueSetMacroMode(mode), WUQUE_GROUP.macro, WUQUE_MACRO_COMMAND.setMacroMode);
        return reply ? decodeWuqueMacroMode(reply) : null;
    }
    /**
     * Read one macro: the mode header first, then `[7,3,macroId,page]` pages until
     * `actNum` events are collected (or the board stops answering). Returns `null`
     * only when the header itself is unreadable.
     */
    async readMacro(macroId, includeInactive = false) {
        await this.open();
        const header = await this.readMacroMode(macroId);
        if (!header)
            return null;
        if ((!header.valid && !includeInactive) || header.actNum <= 0)
            return { header, events: [] };
        const events = [];
        const pages = Math.ceil(header.actNum / WUQUE_MACRO_EVENTS_PER_FRAME);
        for (let page = 0; page < pages && events.length < header.actNum; page += 1) {
            const reply = await this.readFrame(encodeWuqueGetMacro(macroId, page), WUQUE_GROUP.macro, WUQUE_MACRO_COMMAND.getMacro);
            const decoded = reply ? decodeWuqueMacroData(reply) : null;
            if (!decoded)
                break;
            events.push(...decoded.events);
        }
        return { header, events: events.slice(0, header.actNum) };
    }
    /**
     * Capacity plus every valid macro-mode header. Event bodies are intentionally
     * omitted — read them one slot at a time with {@link readMacro}, which pages
     * the (potentially long) event list.
     */
    async readMacros() {
        await this.open();
        const space = await this.readMacroSpaceInfo();
        const count = Math.min(space?.macroCount ?? WUQUE_MACRO_SLOTS, WUQUE_MACRO_SLOTS);
        const slots = [];
        for (let macroId = 0; macroId < count; macroId += 1) {
            const mode = await this.readMacroMode(macroId);
            if (mode?.valid)
                slots.push(mode);
        }
        return { space, slots };
    }
    /**
     * Write one macro: set the mode header (valid / actNum / mode, optional
     * repetition count) first, then push the events in
     * {@link WUQUE_MACRO_EVENTS_PER_FRAME}-event pages. Throws when the header or
     * any page is not acknowledged, never reporting a partial macro as success.
     */
    async writeMacro(macroId, events, header = {}) {
        await this.open();
        const actNum = events.length;
        const mode = header.mode ?? 0;
        const repNum = header.repNum ?? 0;
        const valid = header.valid ?? actNum > 0;
        const modeReply = await this.writeFrame(encodeWuqueSetMacroMode({ macroId, valid, actNum, repNum, mode }), WUQUE_GROUP.macro, WUQUE_MACRO_COMMAND.setMacroMode);
        if (modeReply === null || isWuqueUnsupported(modeReply)) {
            throw new Error(`Wuque macro ${macroId} header was not accepted.`);
        }
        const pages = Math.ceil(actNum / WUQUE_MACRO_EVENTS_PER_FRAME);
        for (let page = 0; page < pages; page += 1) {
            const chunk = events.slice(page * WUQUE_MACRO_EVENTS_PER_FRAME, (page + 1) * WUQUE_MACRO_EVENTS_PER_FRAME);
            const frame = encodeWuqueSetMacro(macroId, page, chunk);
            if (!frame) {
                throw new RangeError(`Wuque macro ${macroId} page ${page} has an out-of-range event.`);
            }
            const reply = await this.writeFrame(frame, WUQUE_GROUP.macro, WUQUE_MACRO_COMMAND.setMacro);
            if (reply === null || isWuqueUnsupported(reply)) {
                throw new Error(`Wuque macro ${macroId} page ${page} was not accepted.`);
            }
        }
        return true;
    }
    // ---------------------------------------------------------------------------
    // Report I/O
    // ---------------------------------------------------------------------------
    /** Key identifying a request frame in the per-connection reply cache. */
    static cacheKey(frame) {
        let key = "";
        const end = Math.min(WUQUE_CACHE_KEY_BYTES, frame.length);
        for (let at = 0; at < end; at += 1)
            key += `${frame[at].toString(16).padStart(2, "0")},`;
        return key;
    }
    /**
     * Best-effort cached read of a request's raw reply; attempted once per
     * connection and then reused until a write clears the cache.
     */
    async readFrame(frame, group, subCommand) {
        const key = WuqueHidClient.cacheKey(frame);
        if (this.replies.has(key))
            return this.replies.get(key) ?? null;
        const raw = await this.enqueue(frame, group, subCommand);
        this.replies.set(key, raw);
        return raw;
    }
    /** Uncached write request; clears the read cache afterwards. */
    async writeFrame(frame, group, subCommand) {
        const raw = await this.enqueue(frame, group, subCommand);
        this.replies.clear();
        return raw;
    }
    /** Serialize a request-and-reply exchange on the single reply channel. */
    async enqueue(frame, group, subCommand) {
        const task = this.commandLock.then(() => this.probe(frame, group, subCommand));
        this.commandLock = task.then(() => undefined, () => undefined);
        return task;
    }
    /** Fire-and-forget write (no waiter); serialized on the command lock. */
    async fire(frame) {
        const task = this.commandLock.then(async () => {
            // DOM lib narrows BufferSource to ArrayBuffer-backed views; a codec frame is a plain Uint8Array.
            await this.device.sendReport(0, frame);
        });
        this.commandLock = task.then(() => undefined, () => undefined);
        await task;
        this.replies.clear();
    }
    /** Send a frame and retry up to {@link WUQUE_COMMAND_ATTEMPTS} times for a reply. */
    async probe(frame, group, subCommand) {
        for (let attempt = 0; attempt < WUQUE_COMMAND_ATTEMPTS; attempt += 1) {
            const reply = await this.send(frame, group, subCommand);
            if (reply)
                return reply;
        }
        return null;
    }
    /**
     * One send: arm a waiter on the exact `(group, subCommand)`, post the frame,
     * and resolve with the matching input report or `null` on timeout/send error.
     */
    async send(frame, group, subCommand) {
        const { promise, resolve } = Promise.withResolvers();
        this.responseWaiter = { group, subCommand, resolve };
        this.responseTimer = setTimeout(() => {
            this.clearPendingRead();
            resolve(null);
        }, WUQUE_RESPONSE_TIMEOUT_MS);
        try {
            await this.device.sendReport(0, frame);
        }
        catch {
            this.clearPendingRead();
            resolve(null);
        }
        return promise;
    }
    clearPendingRead() {
        if (this.responseTimer !== null) {
            clearTimeout(this.responseTimer);
            this.responseTimer = null;
        }
        this.responseWaiter = null;
    }
}
