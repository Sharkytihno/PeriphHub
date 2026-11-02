import { decodeWootingAkcProfile, decodeWootingActuationProfile, decodeWootingAnalogProfilesCount, decodeWootingAnalogReport, decodeWootingAnalogSnapshot, decodeWootingDeviceConfig, decodeWootingDksProfile, decodeWootingFlashChipConnected, decodeWootingFlashStats, decodeWootingFullRapidTriggerProfile, decodeWootingFunctionMappingProfile, decodeWootingGamepadProfile, decodeWootingGlobalSettings, decodeWootingKeyPropertyProfile, decodeWootingKeyPropertyProfileBody, decodeWootingKeyboardProfile, decodeWootingPartialRapidTriggerProfile, decodeWootingRapidTriggerProfileBody, decodeWootingMainMappingProfile, decodeWootingMappingProfile, decodeWootingNumberOfKeys, decodeWootingProfileIndex, decodeWootingProfileMetadata, decodeWootingRapidTriggerProfile, decodeWootingReplyBody, decodeWootingRgbColors, decodeWootingRgbCore, decodeWootingRgbProfileColors, decodeWootingRgbProfileCore, encodeWootingRgbColorsReport, encodeWootingRgbCore, decodeWootingRgbProfileCount, decodeWootingRgbLayer, decodeWootingVersion, encodeWootingCommand, encodeWootingProfileCommand, encodeWootingProfileSwitch, encodeWootingRgbBuffer, encodeWootingSaveCommand, encodeWootingSingleColor, encodeWootingGlobalSettingsReport, encodeWootingAkcProfileReport, encodeWootingAkcChunkReport, encodeWootingAkcChunks, encodeWootingAkcProfileFromItems, encodeWootingAkcItem, encodeWootingAkcPayload, patchWootingAkcProfile, encodeWootingRgbProfileCoreReport, encodeWootingKeyboardBaseReport, encodeWootingActuationProfileReport, encodeWootingKeyPropertyProfileReport, encodeWootingRapidTriggerProfileReport, patchWootingKeyPropertyProfile, patchWootingKeyboardBase, patchWootingActuationProfile, patchWootingGlobalSettings, patchWootingRapidTriggerProfile, isWootingReply, wootingActuationMm, wootingCapabilities, wootingFeatureReport, wootingKeyPropertyGroups, wootingProduct, wootingProductName, wootingReplyOk, WOOTING_PROFILE_SWITCH_SETTLE_MS, WOOTING_ANALOG_USAGE_PAGE, WOOTING_ANALOG_USAGE_PAGE_ALT, WOOTING_COMMAND, WOOTING_CONFIG_USAGE, WOOTING_CONFIG_USAGE_PAGE, WOOTING_CONFIG_USAGE_PAGE_STANDARD, WOOTING_STATUS_ERROR, WOOTING_VENDOR_ID, WOOTING_MAGIC_MULTI, WOOTING_MAGIC_SINGLE, WOOTING_MAGIC_WORD_1, } from "../../wooting/index.js";
/** Settle delay so the analog-stream collect window never overlaps a reply. */
function wootingDelay(ms) {
    const { promise, resolve } = Promise.withResolvers();
    setTimeout(resolve, ms);
    return promise;
}
/**
 * Wooting analog keyboard (60HE+) HID control — identity + profile reads plus
 * the safe write subset: RAM-only profile switching (0x21/0x17/0x26),
 * RAM-only RGB-direct (0x1E/0x1F/0x20) and full-buffer push, and
 * confirm-gated flash saves (0x08/0x2A/0x2F/0x35).
 *
 * NEVER encoded here: 0x02 (bootloader — leaves HID), 0x15 (keys_off — kills
 * output), 0x19 (soft reset — drops RAM), 0x2B (factory reset). Writes bypass
 * the read cache and invalidate it after, so a readStatus after any write
 * re-reads the board instead of echoing stale bytes.
 */
const CONFIG_RESPONSE_TIMEOUT_MS = 400;
/** How long to gather input reports for a multi-report reply (ack + data). */
const COLLECT_WINDOW_MS = 130;
/**
 * Upper bound on profile slots probed via get_profile_metadata before giving
 * up. Real boards ship ≤ 4; the cap only bounds a board that answers every
 * probe with garbage.
 */
const MAX_PROFILE_PROBE_SLOTS = 8;
export class WootingHidClient {
    device;
    responseWaiter = null;
    responseTimer = null;
    // Each command's raw reply is read once per connection and cached, so a
    // failure (or a device that just will not answer) never re-spams writes on
    // every background refresh.
    replies = new Map();
    // Serializes command sends so a profile read and a status refresh never share
    // the single input-report reply channel at the same time.
    commandLock = Promise.resolve();
    // When set, input reports are accumulated here instead of resolving a single
    // waiter — used to gather a multi-report reply (ack + data) for one command.
    collecting = null;
    onInputReport = (event) => {
        const bytes = new Uint8Array(event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength));
        if (this.collecting) {
            this.collecting.push(bytes);
            return;
        }
        // Keypress chatter (plain keyboard/boot reports, analog-stream frames)
        // arrives on this same channel — only a magic-word reply echoing the
        // command this waiter was armed for may resolve it. Anything else is
        // left for the analog listener and the waiter keeps waiting for the
        // real reply (or times out, and the caller falls back to null, never
        // to a keystroke).
        const waiter = this.responseWaiter;
        if (!waiter)
            return;
        if (!isWootingReply(bytes))
            return;
        if (waiter.commandId >= 0 && bytes[2] !== waiter.commandId)
            return;
        this.clearPendingRead();
        waiter.resolve(bytes);
    };
    listening = false;
    constructor(device) {
        this.device = device;
    }
    /**
     * Wooting VID plus the command-capable config collection: usage page `0xFF55`
     * (ARM, 60HE+ and later) or `0x1337` (Standard, One / Two / original 60HE),
     * usage `0x01`. Only these collections are matched — a board also presents a
     * legacy `0xFF00` collection and the analog stream, and matching those would
     * list the same physical keyboard several times.
     */
    static isSupported(device) {
        if (device.vendorId !== WOOTING_VENDOR_ID)
            return false;
        if (!wootingProduct(device.productId))
            return false;
        return WootingHidClient.configCollection(device.collections) !== null;
    }
    /** The collection, rather than the PID, determines Standard versus ARM framing. */
    multiReport() {
        return WootingHidClient.configCollection(this.device.collections)?.usagePage === WOOTING_CONFIG_USAGE_PAGE;
    }
    /** The command-capable config collection, if this device exposes one. */
    static configCollection(collections) {
        for (const collection of collections) {
            if (collection.usage === WOOTING_CONFIG_USAGE
                && (collection.usagePage === WOOTING_CONFIG_USAGE_PAGE
                    || collection.usagePage === WOOTING_CONFIG_USAGE_PAGE_STANDARD)) {
                return collection;
            }
            const nested = WootingHidClient.configCollection(collection.children);
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
    /**
     * Model/firmware gates from Wootility 5.4.2. Reads `get_version` once per
     * connection (cached), then applies the ARM/Flaretech and firmware gates.
     */
    async capabilities() {
        const reply = await this.command(WOOTING_COMMAND.getVersion).catch(() => null);
        return wootingCapabilities(this.device.productId, reply ? decodeWootingVersion(reply) : null);
    }
    async close() {
        if (this.listening) {
            this.device.removeEventListener("inputreport", this.onInputReport);
            this.listening = false;
        }
        if (this.device.opened)
            await this.device.close();
    }
    /**
     * Subscribe to the live analog key stream. The board pushes a full snapshot
     * of the currently-pressed keys as input reports on its analog interface
     * (0xFF53, or 0xFF54 on some PIDs — a sibling of the config interface).
     * Opens that interface, forwards each decoded frame to `onFrame`, and
     * resolves to a stop function that detaches the listener. Rejects if the
     * analog interface is not available to the page.
     */
    async startAnalog(onFrame) {
        const analog = await this.analogDevice();
        if (!analog) {
            throw new Error("This Wooting's analog interface is not available to OpenMouse.");
        }
        if (!analog.opened)
            await analog.open();
        const listener = (event) => {
            const data = new Uint8Array(event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength));
            onFrame(decodeWootingAnalogReport(data));
        };
        analog.addEventListener("inputreport", listener);
        return () => analog.removeEventListener("inputreport", listener);
    }
    /** The sibling analog-stream interface (same board, usage page 0xFF53/0xFF54). */
    async analogDevice() {
        const hid = globalThis.navigator?.hid;
        if (!hid)
            return null;
        const devices = await hid.getDevices();
        return devices.find((device) => device.vendorId === WOOTING_VENDOR_ID
            && device.productId === this.device.productId
            && device.collections.some((collection) => (collection.usagePage === WOOTING_ANALOG_USAGE_PAGE
                || collection.usagePage === WOOTING_ANALOG_USAGE_PAGE_ALT)
                && collection.usage === WOOTING_CONFIG_USAGE)) ?? null;
    }
    async readStatus() {
        await this.open();
        // Sequential: each reply is awaited before the next command is sent, so the
        // input-report answers never interleave.
        const version = await this.command(WOOTING_COMMAND.getVersion);
        const config = await this.command(WOOTING_COMMAND.getDeviceConfig);
        const serial = await this.command(WOOTING_COMMAND.getSerial);
        const profile = await this.readProfileState();
        const name = wootingProductName(this.device.productId);
        const firmwareVersion = version ? decodeWootingVersion(version) : null;
        const layout = config?.subarray(4).some((byte) => byte !== 0)
            ? decodeWootingDeviceConfig(config)?.layout ?? null
            : null;
        const lines = [];
        if (version)
            lines.push(firmwareVersion ? `Firmware: ${firmwareVersion}` : `Version reply: ${wootingHexPreview(version, 20)}`);
        if (config) {
            // A header-only config answer has no payload to decode — show the raw
            // bytes, never an invented layout.
            lines.push(layout ? `Layout: ${layout}` : `Config reply: ${wootingHexPreview(config, 20)}`);
        }
        return {
            brand: "Wooting",
            name,
            ui: {
                family: "wooting",
                // No host consumer reads the nested objects yet, so the mouse grid
                // stays hidden; the fields are present for the planned keyboard UI.
                settingsReady: false,
                defaultDisplayName: name,
            },
            connectionType: "Wired",
            connectionDetail: "USB",
            firmware: lines,
            firmwareVersion,
            layout,
            serial: serial ? wootingSerialText(serial) : null,
            activeProfile: profile.active,
            profileCount: profile.count,
            profileNames: profile.names,
            analogProfile: profile.analogProfile,
            perKeyActuation: profile.perKeyActuation,
            rapidTrigger: profile.rapidTrigger,
            perKeyRapidTrigger: profile.perKeyRapidTrigger,
            mappings: profile.mappings,
            dks: profile.dks,
            akc: profile.akc,
            gamepad: profile.gamepad,
            rgb: profile.rgb,
            diagnostics: profile.diagnostics,
            analogSnapshot: profile.analogSnapshot,
            capabilities: profile.capabilities,
        };
    }
    /**
     * Active profile slot plus the named-slot census. Never throws: every leg is
     * best-effort and an unreadable board reports nulls the host renders as
     * "unknown" rather than a guessed slot.
     *
     * GetDigitalProfilesCount answers 0x66 on ARM, so slot existence is probed
     * one metadata read at a time (wootswitch): the census stops at the first
     * slot the board reports empty. A nameless-but-populated slot still counts
     * (name null), because the metadata length prefix is what proves existence.
     */
    async readProfileState() {
        const capabilities = await this.capabilities();
        const indexReply = await this.command(WOOTING_COMMAND.getCurrentKeyboardProfileIndex);
        const active = indexReply ? decodeWootingProfileIndex(indexReply)?.active ?? null : null;
        // GetDigitalProfilesCount answers 0x66 on ARM — probe per-slot metadata
        // instead (wootswitch). A direct count is still tried first: Standard
        // boards answer it and it costs one round trip.
        const direct = await this.command(WOOTING_COMMAND.getDigitalProfilesCount);
        let count;
        let names;
        if (direct && direct[3] !== WOOTING_STATUS_ERROR && direct.length > 4) {
            count = direct[4];
            names = await this.readProfileNames(count);
        }
        else {
            const probed = [];
            let probedCount = null;
            for (let slot = 0; slot < MAX_PROFILE_PROBE_SLOTS; slot += 1) {
                const reply = await this.sendProfileCommand(WOOTING_COMMAND.getProfileMetadata, slot).catch(() => null);
                const decoded = reply ? decodeWootingProfileMetadata(reply) : null;
                if (!decoded?.exists)
                    break;
                probed.push(decoded.name);
                probedCount = slot + 1;
            }
            count = probedCount;
            names = probed;
        }
        // Deep feature reads target the runtime-active slot (0 when the index is
        // unreadable) and stay best-effort: every helper catches its own failure,
        // so identity (firmware/layout/profiles) always survives a silent extra.
        const target = active ?? 0;
        const [analogProfile, perKeyActuation, rapidTrigger, perKeyRapidTrigger, mappings, dks, akc, gamepad, rgb, diagnostics, analogSnapshot] = await Promise.all([
            this.readAnalogProfileFull(target).catch(() => null),
            this.readPerKeyActuation(target).catch(() => null),
            this.readRapidTrigger(target).catch(() => null),
            this.readPerKeyRapidTrigger(target).catch(() => null),
            this.readMappings(target).catch(() => null),
            this.readDks(target).catch(() => null),
            this.readAkc(target).catch(() => null),
            this.readGamepad(target).catch(() => null),
            this.readRgb(target).catch(() => null),
            this.readDiagnostics().catch(() => null),
            this.readAnalogSnapshot().catch(() => ({ available: false, keys: [] })),
        ]);
        return { active, count, names, analogProfile, perKeyActuation, rapidTrigger, perKeyRapidTrigger, mappings, dks, akc, gamepad, rgb, diagnostics, analogSnapshot, capabilities };
    }
    /** Profile names for slots `0..slotCount`, null where the board stays silent. */
    async readProfileNames(slotCount) {
        const names = [];
        for (let slot = 0; slot < slotCount; slot += 1) {
            const reply = await this.sendProfileCommand(WOOTING_COMMAND.getProfileMetadata, slot).catch(() => null);
            names.push(reply ? decodeWootingProfileMetadata(reply)?.name ?? null : null);
        }
        return names;
    }
    // ---------------------------------------------------------------------------
    // Report I/O
    // ---------------------------------------------------------------------------
    /**
     * Best-effort live read of a command's raw reply, attempted once per connection
     * and then cached. Never throws: on any failure it returns null, the caller
     * falls back to whatever it has, and the failure is remembered so a background
     * refresh does not try (and fail) the write again.
     */
    async command(commandId) {
        if (this.replies.has(commandId))
            return this.replies.get(commandId) ?? null;
        const raw = await this.sendCommand(commandId).catch(() => null);
        this.replies.set(commandId, raw);
        return raw;
    }
    /**
     * Actuation + rapid trigger for the active profile (0x27) plus global
     * settings (0x33). Never throws: every leg is best-effort and a silent
     * board reports nulls. Live 60HE+ 0x27 body is 22 bytes with actuation raw
     * 17203 = 0.20mm on the contract line `raw = 16384 + mm * 4096`.
     */
    async readAnalogProfileFull(slot) {
        await this.open();
        const target = slot ?? await this.activeSlotOrDefault();
        const keyboard = target === null ? null : await this.sendProfileCommand(WOOTING_COMMAND.getKeyboardProfile, target).catch(() => null);
        const globalReply = await this.command(WOOTING_COMMAND.getSettings);
        if (!keyboard && !globalReply)
            return null;
        const decoded = keyboard ? decodeWootingKeyboardProfile(keyboard, { multiReport: this.multiReport() }) : null;
        const actuationRaw = decoded?.actuationRaw ?? null;
        return {
            actuationRaw,
            actuationMm: actuationRaw === null ? null : wootingActuationMm(actuationRaw),
            profileFields: decoded?.fields ?? [],
            global: globalReply ? decodeWootingGlobalSettings(globalReply) : null,
        };
    }
    /** Per-key actuation overrides (0x31); an empty body means no overrides. */
    async readPerKeyActuation(slot) {
        await this.open();
        const target = slot ?? await this.activeSlotOrDefault();
        if (target === null)
            return null;
        const reply = await this.sendProfileCommand(WOOTING_COMMAND.getActuationProfile, target).catch(() => null);
        return reply ? decodeWootingActuationProfile(reply, { multiReport: this.multiReport() }) : null;
    }
    /**
     * Legacy rapid-trigger profile (0x36, Wootility's `KeyPropertyProfile`). ARM
     * boards answer empty even when per-key rapid trigger is configured; use
     * {@link readPerKeyRapidTrigger} (0x3D) there. Kept for Standard firmware.
     */
    async readRapidTrigger(slot) {
        await this.open();
        const target = slot ?? await this.activeSlotOrDefault();
        if (target === null)
            return null;
        const reply = await this.sendProfileCommand(WOOTING_COMMAND.getRapidTriggerProfile, target).catch(() => null);
        return reply && (reply[4] || reply[5]) ? decodeWootingRapidTriggerProfile(reply) : null;
    }
    /**
     * ARM per-key rapid-trigger groups (0x3D, Wootility's
     * `getFullRapidTriggerProfile`). An OK reply with an empty body decodes to
     * `{ groups: [], raw: empty }` — the board has no per-key overrides. Onboard
     * slots only; linked-profile selectors are not exposed yet.
     */
    async readPerKeyRapidTrigger(slot) {
        await this.open();
        const target = slot ?? await this.activeSlotOrDefault();
        if (target === null)
            return null;
        const capabilities = await this.capabilities();
        if (capabilities.perKeyRapidTrigger === "full") {
            const reply = await this.sendProfileCommand(WOOTING_COMMAND.getFullRapidTriggerProfile, target).catch(() => null);
            return reply ? decodeWootingFullRapidTriggerProfile(reply) : null;
        }
        if (capabilities.perKeyRapidTrigger === "partial") {
            const reply = await this.sendProfileCommand(WOOTING_COMMAND.getRapidTriggerProfile, target).catch(() => null);
            return reply ? decodeWootingPartialRapidTriggerProfile(reply, { multiReport: this.multiReport() }) : null;
        }
        // Unknown/older model: probe the ARM commands without inventing a mode.
        if (!this.multiReport())
            return null;
        const fullReply = await this.sendProfileCommand(WOOTING_COMMAND.getFullRapidTriggerProfile, target).catch(() => null);
        const full = fullReply ? decodeWootingFullRapidTriggerProfile(fullReply) : null;
        if (full)
            return full;
        const partialReply = await this.sendProfileCommand(WOOTING_COMMAND.getRapidTriggerProfile, target).catch(() => null);
        return partialReply ? decodeWootingPartialRapidTriggerProfile(partialReply, { multiReport: true }) : null;
    }
    /** Key mappings for one slot: generic blob (0x30) plus Fn layers (0x11/0x12). */
    async readMappings(slot) {
        await this.open();
        const target = slot ?? await this.activeSlotOrDefault();
        if (target === null)
            return null;
        const mappingReply = await this.sendProfileCommand(WOOTING_COMMAND.getMappingProfile, target).catch(() => null);
        const mainReply = await this.sendProfileCommand(WOOTING_COMMAND.getMainMappingProfile, target).catch(() => null);
        const functionReply = await this.sendProfileCommand(WOOTING_COMMAND.getFunctionMappingProfile, target).catch(() => null);
        if (!mappingReply && !mainReply && !functionReply)
            return null;
        return {
            slot: target,
            mapping: mappingReply ? decodeWootingMappingProfile(mappingReply) : null,
            main: mainReply ? decodeWootingMainMappingProfile(mainReply) : null,
            function: functionReply ? decodeWootingFunctionMappingProfile(functionReply) : null,
        };
    }
    /** Dynamic-keystroke profile (0x18); zero-length means unbound. */
    async readDks(slot) {
        await this.open();
        const target = slot ?? await this.activeSlotOrDefault();
        if (target === null)
            return null;
        const reply = await this.sendProfileCommand(WOOTING_COMMAND.getDksProfile, target).catch(() => null);
        return reply && (reply[4] || reply[5]) ? decodeWootingDksProfile(reply) : null;
    }
    /**
     * Advanced-keys-combo profile for one slot (0x34). Multi-part replies are
     * followed with `startPoint = items.length` until `totalItems` is reached.
     */
    async readAkc(slot) {
        await this.open();
        const target = slot ?? await this.activeSlotOrDefault();
        if (target === null)
            return null;
        const reply = await this.sendProfileCommand(WOOTING_COMMAND.getAkcProfile, target).catch(() => null);
        const first = reply ? decodeWootingAkcProfile(reply) : null;
        if (!first || first.totalItems <= first.combos.length)
            return first;
        const combos = [...first.combos];
        while (combos.length < first.totalItems) {
            const chunkReply = await this.readAkcChunk(target, combos.length).catch(() => null);
            const chunk = chunkReply ? decodeWootingAkcProfile(chunkReply) : null;
            if (!chunk?.combos.length)
                break;
            combos.push(...chunk.combos);
        }
        return { ...first, combos };
    }
    async readAkcChunk(slot, startPoint) {
        const buffer = encodeWootingCommand(WOOTING_COMMAND.getAkcProfile, 0, startPoint, 0, slot & 0xff, { multiReport: true });
        const run = this.commandLock.then(() => this.probeRawCommand(buffer));
        this.commandLock = run.then(() => undefined, () => undefined);
        return run.catch(() => null);
    }
    /**
     * Gamepad layer: 0x29 profile rows only. 0x28 answers an empty OK body on
     * every ARM board (confirmed live), so `mapping` stays null on ARM.
     */
    async readGamepad(slot) {
        await this.open();
        const target = slot ?? await this.activeSlotOrDefault();
        if (target === null)
            return null;
        const profileReply = await this.sendProfileCommand(WOOTING_COMMAND.getGamepadProfile, target).catch(() => null);
        if (!profileReply)
            return null;
        return {
            slot: target,
            mapping: null,
            profile: decodeWootingGamepadProfile(profileReply),
        };
    }
    /**
     * RGB blocks for one slot: core (0x32), colour pages (0x23/0x24), layer
     * (0x39). Read-only sizes/fields — no effect writes.
     */
    async readRgb(slot) {
        await this.open();
        const target = slot ?? await this.activeSlotOrDefault();
        if (target === null)
            return null;
        const coreReply = await this.sendProfileCommand(WOOTING_COMMAND.getRgbProfileCore, target).catch(() => null);
        const colors1Reply = await this.sendProfileCommand(WOOTING_COMMAND.getRgbProfileColors1, target).catch(() => null);
        const colors2Reply = await this.sendProfileCommand(WOOTING_COMMAND.getRgbProfileColors2, target).catch(() => null);
        const layerReply = await this.sendProfileCommand(WOOTING_COMMAND.getRgbLayer, target).catch(() => null);
        if (!coreReply && !colors1Reply && !colors2Reply && !layerReply)
            return null;
        return {
            slot: target,
            core: coreReply ? decodeWootingRgbProfileCore(coreReply) : null,
            colors1: colors1Reply ? decodeWootingRgbProfileColors(colors1Reply) : null,
            colors2: colors2Reply ? decodeWootingRgbProfileColors(colors2Reply) : null,
            layer: layerReply ? decodeWootingRgbLayer(layerReply) : null,
        };
    }
    /** Counts + flash health (0x10 / 0x04 / 0x0A / 0x38 / 0x3A). */
    async readDiagnostics() {
        await this.open();
        const keysReply = await this.command(WOOTING_COMMAND.getNumberOfKeys);
        const rgbCountReply = await this.command(WOOTING_COMMAND.getRgbProfileCount);
        const analogCountReply = await this.command(WOOTING_COMMAND.getAnalogProfilesCount);
        const flashReply = await this.command(WOOTING_COMMAND.isFlashChipConnected);
        const flashStatsReply = await this.command(WOOTING_COMMAND.getFlashStats);
        if (!keysReply && !rgbCountReply && !analogCountReply && !flashReply && !flashStatsReply)
            return null;
        return {
            keyCount: keysReply ? decodeWootingNumberOfKeys(keysReply) : null,
            rgbProfileCount: rgbCountReply ? decodeWootingRgbProfileCount(rgbCountReply) : null,
            analogProfileCount: analogCountReply ? decodeWootingAnalogProfilesCount(analogCountReply) : null,
            flashConnected: flashReply ? decodeWootingFlashChipConnected(flashReply) : null,
            flashStats: flashStatsReply ? decodeWootingFlashStats(flashStatsReply) : null,
        };
    }
    /**
     * One-shot analog snapshot (0x14) versus the streaming `startAnalog`
     * interface. The board answers opaque profile-layout rows (all zero at
     * rest), so groups are preserved verbatim. `available` is false when the
     * board stays silent.
     */
    async readAnalogSnapshot() {
        await this.open();
        const reply = await this.command(WOOTING_COMMAND.getAnalogValues);
        const decoded = reply ? decodeWootingAnalogSnapshot(reply) : null;
        if (!decoded)
            return { available: false, keys: [] };
        return { available: true, keys: [] };
    }
    /** Active profile slot for default targeting; 0 when the board stays silent. */
    async activeSlotOrDefault() {
        const reply = await this.command(WOOTING_COMMAND.getCurrentKeyboardProfileIndex);
        const decoded = reply ? decodeWootingProfileIndex(reply) : null;
        if (decoded)
            return decoded.active;
        return 0;
    }
    /**
     * Live (uncached) read of the connected profile's actuation / rapid-trigger
     * settings: the current profile index plus the raw analog-profile "main part"
     * reply, for the analog UI to decode.
     */
    async readAnalogProfile() {
        const indexReply = await this.sendCommand(WOOTING_COMMAND.getCurrentKeyboardProfileIndex).catch(() => null);
        const decoded = indexReply ? decodeWootingProfileIndex(indexReply) : null;
        // get_keyboard_profile (0x39) carries the actuation (nested field 1 = mm ×
        // 20480) and rapid-trigger fields. Read it over the working channel
        // (feature, magic 0xD1, current-profile selector 0xFFFF).
        const command = new Uint8Array([
            this.multiReport() ? WOOTING_MAGIC_MULTI : WOOTING_MAGIC_SINGLE,
            WOOTING_MAGIC_WORD_1, WOOTING_COMMAND.getKeyboardProfile, 0xff, 0xff, 0x00, 0x00,
        ]);
        const reports = await this.collectCommand(command, false).catch(() => []);
        const note = reports.some((report) => report.subarray(4).some((byte) => byte !== 0))
            ? "get_keyboard_profile"
            : "no body";
        return { index: decoded?.active ?? null, reports, note };
    }
    /**
     * RAM-only profile switch (wootswitch sequence, live-verified no-op-safe):
     * WootDevInit → ActivateProfile(slot) → settle 100ms → ReloadProfile(slot)
     * → settle 100ms → verify 0x0b active == slot. Returns the verified slot.
     * Throws when any step answers 0x66/timeout or the verify mismatches —
     * the caller surfaces it, never a guessed switch. Invalidates the read
     * cache after so the next readStatus re-reads the board.
     *
     * Live 60HE+ note: this board holds ONE profile (count 1), so switching to
     * slot 0 verifies clean while slot 7 acks every send yet 0x0b still reads
     * 0 — the verify throw is the correct outcome, not a driver bug. Boards
     * with 4 populated slots should move the index; that path is covered by
     * the fake (which tracks the active slot) until multi-profile hardware
     * confirms it live.
     */
    async switchProfile(slot) {
        await this.open();
        const [init, activate, reload] = encodeWootingProfileSwitch(slot, { multiReport: this.multiReport() });
        const initReply = await this.sendRawWrite(init);
        if (!initReply || !wootingReplyOk(initReply))
            throw new Error(`WootDevInit was not accepted (slot ${slot}).`);
        const activateReply = await this.sendRawWrite(activate);
        if (!activateReply || !wootingReplyOk(activateReply))
            throw new Error(`ActivateProfile was not accepted (slot ${slot}).`);
        await wootingDelay(WOOTING_PROFILE_SWITCH_SETTLE_MS);
        const reloadReply = await this.sendRawWrite(reload);
        if (!reloadReply || !wootingReplyOk(reloadReply))
            throw new Error(`ReloadProfile was not accepted (slot ${slot}).`);
        await wootingDelay(WOOTING_PROFILE_SWITCH_SETTLE_MS);
        this.replies.clear();
        const verify = await this.sendCommand(WOOTING_COMMAND.getCurrentKeyboardProfileIndex).catch(() => null);
        const active = verify ? decodeWootingProfileIndex(verify)?.active ?? null : null;
        if (active !== slot)
            throw new Error(`Profile switch did not stick (wanted ${slot}, board reports ${active}).`);
        this.replies.clear();
        return slot;
    }
    /**
     * FLASH-persisting save (0x08/0x2A/0x2F/0x35). Requires confirmed: true —
     * without it the codec encoder throws and nothing is sent. Verifies the
     * 0x88 reply, invalidates the cache, and returns true. The caller owns the
     * blocking "overwrites onboard flash" modal.
     */
    async saveProfile(commandId, slot, confirmed) {
        await this.open();
        const buffer = encodeWootingSaveCommand(commandId, slot, { confirmed, multiReport: this.multiReport() });
        const reply = await this.sendRawWrite(buffer);
        if (!reply || !wootingReplyOk(reply))
            throw new Error(`Save command 0x${commandId.toString(16)} was not accepted (slot ${slot}).`);
        this.replies.clear();
        return true;
    }
    /** Persist the active profile's base actuation and rapid-trigger defaults. */
    async writeAnalogDefaults(changes, confirmed) {
        if (!confirmed)
            throw new Error("Saving Wooting analog settings requires confirmation.");
        if (!Object.keys(changes).length)
            throw new Error("No Wooting analog settings were supplied.");
        await this.open();
        if (!this.multiReport()) {
            throw new Error("Standard/AVR base profile writes use the fixed-128/CRC command space and are not implemented yet.");
        }
        const slot = await this.activeSlotOrDefault();
        if (slot === null)
            throw new Error("Could not identify the active Wooting profile.");
        const multiReport = this.multiReport();
        const original = await this.sendProfileCommand(WOOTING_COMMAND.getKeyboardProfile, slot);
        const body = original ? decodeWootingReplyBody(original, WOOTING_COMMAND.getKeyboardProfile, { multiReport }) : null;
        if (!body?.length)
            throw new Error("Could not read a complete Wooting keyboard profile before saving.");
        const edited = patchWootingKeyboardBase(body, changes);
        const packet = encodeWootingKeyboardBaseReport(edited, { multiReport, save: true, profileIndex: slot });
        const run = this.commandLock.then(() => this.sendOutput(packet));
        this.commandLock = run.then(() => undefined, () => undefined);
        await run;
        this.replies.clear();
        const reply = await this.sendProfileCommand(WOOTING_COMMAND.getKeyboardProfile, slot);
        const actual = reply ? decodeWootingKeyboardProfile(reply, { multiReport }) : null;
        const header = multiReport
            ? [0xd1, 0xda, WOOTING_COMMAND.getKeyboardProfile, 0x88, edited.length & 0xff, edited.length >>> 8]
            : [0xd0, 0xda, WOOTING_COMMAND.getKeyboardProfile, 0x88, edited.length];
        const expected = decodeWootingKeyboardProfile(new Uint8Array([...header, ...edited]), { multiReport });
        if (!actual || !expected
            || (changes.actuationMm !== undefined && actual.actuationRaw !== expected.actuationRaw)
            || (changes.rapidTriggerEnabled !== undefined && actual.rapidTriggerEnabled !== expected.rapidTriggerEnabled)
            || (changes.rapidTriggerSensitivityMm !== undefined && actual.releaseSensitivityRaw !== expected.releaseSensitivityRaw)) {
            throw new Error("Wooting analog settings save was not confirmed by read-back.");
        }
        this.replies.clear();
        return true;
    }
    async writeActuationDefault(actuationMm, confirmed) {
        return this.writeAnalogDefaults({ actuationMm }, confirmed);
    }
    async writeRapidTriggerDefault(enabled, sensitivityMm, confirmed) {
        return this.writeAnalogDefaults({ rapidTriggerEnabled: enabled, rapidTriggerSensitivityMm: sensitivityMm }, confirmed);
    }
    /** Read, edit, save, and verify one actuation override without replacing other keys. */
    async editPerKeyActuation(key, actuationMm, confirmed) {
        if (!confirmed)
            throw new Error("Saving Wooting per-key actuation requires confirmation.");
        await this.open();
        if (!this.multiReport())
            throw new Error("Per-key actuation output is only captured for ARM Wooting devices.");
        const slot = await this.activeSlotOrDefault();
        if (slot === null)
            throw new Error("Could not identify the active Wooting profile.");
        this.replies.clear();
        const originalReply = await this.sendProfileCommand(WOOTING_COMMAND.getActuationProfile, slot);
        const original = originalReply ? decodeWootingActuationProfile(originalReply, { multiReport: true }) : null;
        if (!original)
            throw new Error("Could not read the complete per-key actuation profile before editing.");
        const edited = patchWootingActuationProfile(original.raw, key, actuationMm);
        const expected = decodeWootingActuationProfile(new Uint8Array([0xd1, 0xda, WOOTING_COMMAND.getActuationProfile, 0x88,
            edited.length & 0xff, edited.length >>> 8, ...edited]), { multiReport: true });
        if (!expected)
            throw new Error("Could not decode edited actuation profile.");
        const packet = encodeWootingActuationProfileReport(edited, { multiReport: true, save: true });
        const run = this.commandLock.then(() => this.sendOutput(packet));
        this.commandLock = run.then(() => undefined, () => undefined);
        await run;
        this.replies.clear();
        const verifyReply = await this.sendProfileCommand(WOOTING_COMMAND.getActuationProfile, slot);
        const verified = verifyReply ? decodeWootingActuationProfile(verifyReply, { multiReport: true }) : null;
        const ordered = (profile) => profile.overrides
            .map(({ key: matrixKey, actuationRaw }) => `${matrixKey}:${actuationRaw}`).sort();
        if (!verified || JSON.stringify(ordered(verified)) !== JSON.stringify(ordered(expected))) {
            throw new Error("Wooting per-key actuation save was not confirmed by read-back.");
        }
        this.replies.clear();
        return true;
    }
    /**
     * Read, edit, save, and verify per-key rapid trigger. ARM firmware >=2.10
     * uses full groups (0x3D/0x1D) with per-key sensitivity; older ARM firmware
     * uses the legacy KeyPropertyProfile (0x36/0x19), which only supports
     * enabled/disabled per key. `target` null removes the override; a config
     * target is rejected on the legacy path. The profile's base rapid-trigger
     * switch is left untouched: a live 60HE+ stores groups with that switch on,
     * and changing it is a separate base-profile write.
     */
    async editPerKeyRapidTrigger(keys, target, confirmed) {
        if (!confirmed)
            throw new Error("Saving Wooting per-key rapid trigger requires confirmation.");
        await this.open();
        const slot = await this.activeSlotOrDefault();
        if (slot === null)
            throw new Error("Could not identify the active Wooting profile.");
        const capabilities = await this.capabilities();
        this.replies.clear();
        if (capabilities.perKeyRapidTrigger === "full")
            return this.editFullPerKeyRapidTrigger(slot, keys, target);
        if (capabilities.perKeyRapidTrigger === "partial")
            return this.editPartialPerKeyRapidTrigger(slot, keys, target);
        if (!this.multiReport())
            throw new Error("Per-key rapid trigger is not supported on this Wooting transport.");
        const probe = await this.readPerKeyRapidTrigger(slot);
        if (!probe)
            throw new Error("Could not determine the Wooting per-key rapid-trigger mode.");
        this.replies.clear();
        return probe.mode === "full"
            ? this.editFullPerKeyRapidTrigger(slot, keys, target)
            : this.editPartialPerKeyRapidTrigger(slot, keys, target);
    }
    async editFullPerKeyRapidTrigger(slot, keys, target) {
        const originalReply = await this.sendProfileCommand(WOOTING_COMMAND.getFullRapidTriggerProfile, slot);
        const original = originalReply ? decodeWootingFullRapidTriggerProfile(originalReply) : null;
        if (!original)
            throw new Error("Could not read the complete per-key rapid-trigger profile before editing.");
        const edited = patchWootingRapidTriggerProfile(original.raw, keys, target);
        const expected = decodeWootingRapidTriggerProfileBody(edited);
        const packet = encodeWootingRapidTriggerProfileReport(edited, {
            multiReport: true, save: true, profileIndex: slot,
        });
        const run = this.commandLock.then(() => this.sendOutput(packet));
        this.commandLock = run.then(() => undefined, () => undefined);
        await run;
        this.replies.clear();
        const verifyReply = await this.sendProfileCommand(WOOTING_COMMAND.getFullRapidTriggerProfile, slot);
        const verified = verifyReply ? decodeWootingFullRapidTriggerProfile(verifyReply) : null;
        if (!verified || !this.perKeyRapidTriggerMatches(verified.groups, expected)) {
            throw new Error("Wooting per-key rapid trigger save was not confirmed by read-back.");
        }
        this.replies.clear();
        return true;
    }
    async editPartialPerKeyRapidTrigger(slot, keys, target) {
        if (target !== null && !("enabled" in target)) {
            throw new Error("Per-key rapid-trigger sensitivity requires full per-key RT support.");
        }
        const value = target === null ? 0 : target.enabled ? 2 : 1;
        const originalReply = await this.sendProfileCommand(WOOTING_COMMAND.getRapidTriggerProfile, slot);
        const original = originalReply
            ? decodeWootingKeyPropertyProfile(originalReply, { multiReport: this.multiReport() })
            : null;
        if (!original)
            throw new Error("Could not read the complete per-key rapid-trigger profile before editing.");
        const edited = patchWootingKeyPropertyProfile(original, keys, value);
        const expected = wootingKeyPropertyGroups(decodeWootingKeyPropertyProfileBody(edited));
        const packet = encodeWootingKeyPropertyProfileReport(edited, {
            multiReport: this.multiReport(), save: true, profileIndex: slot,
        });
        const run = this.commandLock.then(() => this.sendOutput(packet));
        this.commandLock = run.then(() => undefined, () => undefined);
        await run;
        this.replies.clear();
        const verifyReply = await this.sendProfileCommand(WOOTING_COMMAND.getRapidTriggerProfile, slot);
        const verified = verifyReply
            ? decodeWootingPartialRapidTriggerProfile(verifyReply, { multiReport: this.multiReport() })
            : null;
        if (!verified || !this.perKeyRapidTriggerMatches(verified.groups, expected)) {
            throw new Error("Wooting per-key rapid trigger save was not confirmed by read-back.");
        }
        this.replies.clear();
        return true;
    }
    /** Compare per-key settings by key, ignoring group boundaries and order. */
    perKeyRapidTriggerMatches(actual, expected) {
        const describe = (groups) => {
            const settings = new Map();
            for (const group of groups) {
                const value = group.config
                    ? `config:${group.config.primarySensitivityRaw}:${group.config.secondarySensitivityRaw ?? "-"}:${group.config.continuousMode === null ? "-" : Number(group.config.continuousMode)}`
                    : `enabled:${group.enabled}`;
                for (const key of group.keys) {
                    if (settings.has(key))
                        return null;
                    settings.set(key, value);
                }
            }
            return [...settings.entries()].sort(([a], [b]) => a - b).map(([key, value]) => `${key}=${value}`).join(",");
        };
        const description = describe(actual);
        return description !== null && description === describe(expected);
    }
    /**
     * Write a complete, field-preserving GlobalSettings message and read it back.
     * Wootility sends this as output report 1 / command 0x17. This confirms the
     * device's current value; persistence across power cycles still requires the
     * model-specific save sequence.
     */
    async writeGlobalSettings(changes) {
        await this.open();
        if (!this.multiReport())
            throw new Error("Global settings output is only captured for ARM Wooting devices.");
        const original = await this.sendCommand(WOOTING_COMMAND.getSettings);
        const decoded = original ? decodeWootingGlobalSettings(original) : null;
        if (!decoded)
            throw new Error("Could not read complete Wooting global settings before writing.");
        const expected = patchWootingGlobalSettings(decoded.raw, changes);
        const packet = encodeWootingGlobalSettingsReport(0, expected);
        const run = this.commandLock.then(() => this.device.sendReport(packet.reportId, new Uint8Array(packet.data)));
        this.commandLock = run.then(() => undefined, () => undefined);
        await run;
        this.replies.clear();
        const verifyReply = await this.sendCommand(WOOTING_COMMAND.getSettings);
        const verified = verifyReply ? decodeWootingGlobalSettings(verifyReply) : null;
        if (!verified || !this.globalSettingsMatch(verified, changes)) {
            throw new Error("Wooting global settings write was not confirmed by read-back.");
        }
        return true;
    }
    /** Stage a complete RGB core message and verify the board's current copy. */
    async writeRgbProfileCore(slot, completeMessage) {
        await this.open();
        if (!this.multiReport())
            throw new Error("RGB core output is only captured for ARM Wooting devices.");
        const packet = encodeWootingRgbProfileCoreReport(slot, completeMessage);
        const run = this.commandLock.then(() => this.device.sendReport(packet.reportId, new Uint8Array(packet.data)));
        this.commandLock = run.then(() => undefined, () => undefined);
        await run;
        this.replies.clear();
        const reply = await this.sendProfileCommand(WOOTING_COMMAND.getRgbProfileCore, slot);
        const actual = reply ? decodeWootingRgbProfileCore(reply)?.raw : null;
        if (!actual || actual.length !== completeMessage.length || actual.some((byte, index) => byte !== completeMessage[index])) {
            throw new Error("Wooting RGB core write was not confirmed by read-back.");
        }
        this.replies.clear();
        return true;
    }
    /** Typed RGB profile core (base brightness/lock colors + V2 effect layers). */
    async readRgbCore(slot) {
        await this.open();
        const target = slot ?? await this.activeSlotOrDefault();
        if (target === null)
            return null;
        const reply = await this.sendProfileCommand(WOOTING_COMMAND.getRgbProfileCore, target).catch(() => null);
        return reply ? decodeWootingRgbCore(reply, { multiReport: this.multiReport() }) : null;
    }
    /** Typed per-key color page (part 1 = 0x23, part 2 = 0x24). */
    async readRgbColors(part, slot) {
        await this.open();
        const target = slot ?? await this.activeSlotOrDefault();
        if (target === null)
            return null;
        const command = part === 1 ? WOOTING_COMMAND.getRgbProfileColors1 : WOOTING_COMMAND.getRgbProfileColors2;
        const reply = await this.sendProfileCommand(command, target).catch(() => null);
        return reply ? decodeWootingRgbColors(reply, { multiReport: this.multiReport() }) : null;
    }
    /** Encode and stage a typed RGB core, then verify the exact read-back. */
    async writeRgbCore(core, slot) {
        const target = slot ?? await this.activeSlotOrDefault();
        if (target === null)
            throw new Error("Could not identify the active Wooting profile.");
        return this.writeRgbProfileCore(target, encodeWootingRgbCore(core));
    }
    /** Stage a typed color page (0x0E/0x0F), verify read-back, require confirm. */
    async writeRgbColors(part, rows, confirmed, slot) {
        if (!confirmed)
            throw new Error("Saving Wooting RGB colors requires confirmation.");
        await this.open();
        if (!this.multiReport())
            throw new Error("RGB color output is only captured for ARM Wooting devices.");
        const target = slot ?? await this.activeSlotOrDefault();
        if (target === null)
            throw new Error("Could not identify the active Wooting profile.");
        const packet = encodeWootingRgbColorsReport(part, rows, {
            multiReport: true, save: true, profileIndex: target,
        });
        const run = this.commandLock.then(() => this.sendOutput(packet));
        this.commandLock = run.then(() => undefined, () => undefined);
        await run;
        this.replies.clear();
        const actual = await this.readRgbColors(part, target);
        if (!actual || JSON.stringify(actual.rows) !== JSON.stringify(rows)) {
            throw new Error("Wooting RGB colors write was not confirmed by read-back.");
        }
        this.replies.clear();
        return true;
    }
    /**
     * Persist a complete AKC profile using the captured output 0x18 → feature
     * save 0x35 sequence, then compare the read-back body. The caller owns the
     * complete message and must explicitly confirm the flash overwrite.
     */
    async writeAkcProfile(scope, completeMessage, confirmed) {
        if (!confirmed)
            throw new Error("Saving a Wooting AKC profile requires confirmation.");
        await this.open();
        if (!this.multiReport())
            throw new Error("AKC output is only captured for ARM Wooting devices.");
        if (scope !== 0)
            throw new Error("AKC save scope is only verified for scope 0.");
        if (completeMessage.length > 56)
            return this.writeAkcProfileChunked(scope, completeMessage, true);
        const packet = encodeWootingAkcProfileReport(scope, completeMessage);
        const run = this.commandLock.then(() => this.device.sendReport(packet.reportId, new Uint8Array(packet.data)));
        this.commandLock = run.then(() => undefined, () => undefined);
        await run;
        await this.saveProfile(WOOTING_COMMAND.saveAkcProfile, scope, true);
        const reply = await this.sendProfileCommand(WOOTING_COMMAND.getAkcProfile, scope);
        const length = reply && wootingReplyOk(reply) ? (reply[4] ?? 0) | ((reply[5] ?? 0) << 8) : -1;
        const actual = reply?.subarray(6, 6 + length);
        if (!actual || length !== completeMessage.length || actual.some((byte, index) => byte !== completeMessage[index])) {
            throw new Error("Wooting AKC save was not confirmed by read-back.");
        }
        this.replies.clear();
        return true;
    }
    /**
     * Persist an AKC profile that exceeds one 62-byte report: Wootility sends
     * `PartialAKCProfile` chunks of 10 items, setting the save bit only on the
     * last chunk, then verifies the combined multi-part read.
     */
    async writeAkcProfileChunked(scope, completeMessage, confirmed) {
        if (!confirmed)
            throw new Error("Saving a Wooting AKC profile requires confirmation.");
        await this.open();
        if (!this.multiReport())
            throw new Error("AKC output is only captured for ARM Wooting devices.");
        if (scope !== 0)
            throw new Error("AKC save scope is only verified for scope 0.");
        const chunks = encodeWootingAkcChunks(completeMessage);
        for (let index = 0; index < chunks.length; index += 1) {
            const packet = encodeWootingAkcChunkReport(chunks[index], {
                multiReport: true, save: index === chunks.length - 1, profileIndex: scope,
            });
            const run = this.commandLock.then(() => this.sendOutput(packet));
            this.commandLock = run.then(() => undefined, () => undefined);
            await run;
        }
        await this.saveProfile(WOOTING_COMMAND.saveAkcProfile, scope, true);
        this.replies.clear();
        const expected = decodeWootingAkcProfile(new Uint8Array([
            0xd1, 0xda, WOOTING_COMMAND.getAkcProfile, 0x88,
            completeMessage.length & 0xff, completeMessage.length >>> 8, ...completeMessage,
        ]));
        const actual = await this.readAkc(scope);
        const signature = (profile) => profile
            ? profile.combos.map((combo) => `${combo.keyIndex}:${combo.layer}:${combo.kind}:${[...combo.raw]}`).sort().join("|")
            : "";
        // An entry-less message is an empty profile: match it against an empty
        // combo list instead of failing after the flash save already ran.
        const expectedSignature = expected ? signature(expected)
            : chunks.every((chunk) => chunk.totalItems === 0) ? "" : null;
        if (expectedSignature === null || signature(actual) !== expectedSignature) {
            throw new Error("Wooting AKC chunked save was not confirmed by read-back.");
        }
        this.replies.clear();
        return true;
    }
    /** Replace one AKC binding in the current profile, preserving other items. */
    async editAkcItem(scope, keyIndex, layer, binding, confirmed) {
        if (!confirmed)
            throw new Error("Saving a Wooting AKC profile requires confirmation.");
        await this.open();
        if (scope !== 0)
            throw new Error("AKC save scope is only verified for scope 0.");
        this.replies.clear();
        const profile = await this.readAkc(scope);
        let original = profile
            ? encodeWootingAkcProfileFromItems(profile.combos.map((combo) => combo.raw))
            : null;
        if (!original) {
            // An OK reply with a zero-length body is an empty profile, not a
            // failure: start from the empty combo list so add-first works.
            // Anything else (silent board, error status) stays an error.
            // The read above cached its miss, so drop it before re-probing.
            this.replies.clear();
            const raw = await this.sendProfileCommand(WOOTING_COMMAND.getAkcProfile, scope);
            const length = !raw || !wootingReplyOk(raw) ? -1
                : this.multiReport() ? ((raw[4] ?? 0) | ((raw[5] ?? 0) << 8)) : (raw[4] ?? 0);
            if (length !== 0)
                throw new Error("Could not read a complete AKC profile before editing.");
            original = encodeWootingAkcProfileFromItems([]);
        }
        const item = binding ? encodeWootingAkcItem({
            keyIndex, layer, kind: binding.kind, payload: encodeWootingAkcPayload(binding),
        }) : null;
        const edited = patchWootingAkcProfile(original, keyIndex, layer, item);
        return this.writeAkcProfileChunked(scope, edited, true);
    }
    globalSettingsMatch(actual, changes) {
        return (changes.rgbDimMinutes === undefined || actual.rgbSleep?.dimMinutes === changes.rgbDimMinutes)
            && (changes.rgbOffMinutes === undefined || actual.rgbSleep?.offMinutes === changes.rgbOffMinutes)
            && (changes.rgbTurnOff === undefined || actual.rgbSleep?.turnOff === changes.rgbTurnOff)
            && (changes.invertNumLock === undefined || actual.invertNumLock === changes.invertNumLock)
            && (changes.debounceFilter === undefined || actual.debounceFilter === changes.debounceFilter)
            && (changes.deviceName === undefined || actual.deviceName === changes.deviceName);
    }
    /**
     * RAM-only single-key RGB set (0x1E). Live 60HE+ answers 0x88. Returns true
     * when the board accepts; clears the cache.
     */
    async setSingleKeyColor(keyIndex, red, green, blue) {
        await this.open();
        const reply = await this.sendRawWrite(encodeWootingSingleColor(keyIndex, red, green, blue, { multiReport: this.multiReport() }));
        if (!reply || !wootingReplyOk(reply))
            throw new Error(`Single-key color was not accepted (key ${keyIndex}).`);
        this.replies.clear();
        return true;
    }
    /**
     * RAM-only RGB reset (0x1F single key / 0x20 all). Live 60HE+ answers 0x88
     * to both. Returns true when accepted; clears the cache.
     */
    async resetRgb(keyIndex) {
        await this.open();
        const buffer = keyIndex === undefined
            ? encodeWootingCommand(WOOTING_COMMAND.wootDevResetAll, 0, 0, 0, 0, { multiReport: this.multiReport() })
            : encodeWootingProfileCommand(WOOTING_COMMAND.wootDevResetColor, keyIndex, { multiReport: this.multiReport() });
        const reply = await this.sendRawWrite(buffer);
        if (!reply || !wootingReplyOk(reply))
            throw new Error("RGB reset was not accepted.");
        this.replies.clear();
        return true;
    }
    /**
     * RAM-only full-board RGB buffer push (SDK v3 shape, report index 5).
     * Live note: refresh (0x1D) answers 0x66 on this firmware, so a push the
     * board will not display returns applied: false (NOT success) — the UI
     * must show "board kept its profile RGB" rather than a painted preview.
     */
    async setRgbBuffer(colors) {
        await this.open();
        if (!this.multiReport())
            return { applied: false };
        const buffer = encodeWootingRgbBuffer(colors);
        const reportId = buffer[0] ?? 5;
        const run = this.commandLock.then(async () => {
            try {
                await this.device.sendReport(reportId, buffer.slice(1));
            }
            catch {
                return { applied: false };
            }
            await wootingDelay(COLLECT_WINDOW_MS);
            const refreshed = await this.probeRawCommand(encodeWootingCommand(WOOTING_COMMAND.refreshRgbColors, 0, 0, 0, 0, { multiReport: true })).catch(() => null);
            return { applied: refreshed !== null && wootingReplyOk(refreshed) };
        });
        this.commandLock = run.then(() => undefined, () => undefined);
        const result = await run;
        if (result.applied)
            this.replies.clear();
        return result;
    }
    /** Uncached single write: bypasses `replies`, serialized on commandLock. */
    async sendRawWrite(buffer) {
        const run = this.commandLock.then(() => this.probeRawCommand(buffer));
        this.commandLock = run.then(() => undefined, () => undefined);
        return run.catch(() => null);
    }
    /**
     * Send an output-report packet using Wootility's transport rules. ARM uses
     * magic D1 and report IDs 1–6 with fixed sizes; Standard/AVR sends report ID
     * 0, padded to the interface revision (64-byte chunks, or one 128/256-byte
     * report).
     */
    async sendOutput(packet) {
        if (this.multiReport()) {
            await this.device.sendReport(packet.reportId, new Uint8Array(packet.data));
            return;
        }
        const collection = WootingHidClient.configCollection(this.device.collections);
        const reportCount = collection?.outputReports?.[0]?.items?.reduce((sum, item) => sum + (item.reportCount ?? 0), 0) ?? 0;
        if (reportCount === 64) {
            const padded = new Uint8Array(2046);
            padded.set(packet.data);
            for (let at = 0; at < padded.length; at += 64) {
                await this.device.sendReport(0, padded.slice(at, at + 64));
            }
            return;
        }
        const size = reportCount === 256 ? 256 : reportCount === 128 ? 128 : 0;
        if (!size)
            throw new Error("Unable to determine the Wooting Standard interface revision.");
        if (packet.data.length > size)
            throw new Error(`Wooting Standard packet exceeds the ${size}-byte report.`);
        const padded = new Uint8Array(size);
        padded.set(packet.data);
        await this.device.sendReport(0, padded);
    }
    /**
     * Send a command and gather every input report it triggers within a short
     * window. `viaOutput` chooses Wootility's output-report channel (id 2) versus
     * the feature-report channel.
     */
    async collectCommand(command, viaOutput) {
        const run = this.commandLock.then(async () => {
            this.collecting = [];
            try {
                if (viaOutput) {
                    const report = new Uint8Array(62);
                    report.set(command.subarray(0, 62));
                    await this.device.sendReport(2, report);
                }
                else {
                    await this.device.sendFeatureReport(this.featureReportId(), command.slice());
                }
            }
            catch (error) {
                this.collecting = null;
                throw error;
            }
            await wootingDelay(COLLECT_WINDOW_MS);
            const reports = this.collecting ?? [];
            this.collecting = null;
            return reports;
        });
        this.commandLock = run.then(() => undefined, () => undefined);
        return run;
    }
    /** Serialize command sends so overlapping callers never share the reply channel. */
    async sendCommand(commandId, param0 = 0) {
        const run = this.commandLock.then(() => this.probeCommand(commandId, param0));
        this.commandLock = run.then(() => undefined, () => undefined);
        return run;
    }
    /** Serialize a slot-taking command (profile argument placement is variant-specific). */
    async sendProfileCommand(commandId, slot) {
        // Slot reads are static per connection (profile names live in flash), so
        // they share the once-per-connection cache: a silent board pays its
        // timeouts once, not on every background refresh.
        const key = 0x10000 | ((commandId << 8) | (slot & 0xff));
        if (this.replies.has(key))
            return this.replies.get(key) ?? null;
        const run = this.commandLock.then(() => this.probeRawCommand(encodeWootingProfileCommand(commandId, slot, { multiReport: this.multiReport() })));
        this.commandLock = run.then(() => undefined, () => undefined);
        const raw = await run.catch(() => null);
        this.replies.set(key, raw);
        return raw;
    }
    /**
     * Send a command on the config interface's declared feature report and read the
     * reply. ARM boards answer with the multi-report magic (0xD1), so commands go
     * out in that form. The answer arrives as an input report (matching Wooting's
     * own tooling); a feature GET is tried only as a fallback. Returns the raw
     * reply for the matching command, or null if nothing usable came back.
     */
    async probeCommand(commandId, param0 = 0) {
        // Magic + command payload, without hidapi's leading report-index byte —
        // WebHID carries the report id separately.
        return this.probeRawCommand(encodeWootingCommand(commandId, param0, 0, 0, 0, { multiReport: this.multiReport() }));
    }
    /** Send a pre-encoded command buffer and read its reply off both channels. */
    async probeRawCommand(buffer) {
        const reportId = this.featureReportId();
        const body = wootingFeatureReport(buffer).data;
        // Byte 3 of the 8-byte buffer is the command id (byte 2 of the body
        // without the hidapi index byte). Replies echo it, so a stale reply to
        // an earlier command — or a keypress-shaped report that happens to
        // start with the magic word — can never resolve this command's waiter.
        const commandId = buffer[3] ?? -1;
        const inputReply = this.nextInputReport(commandId);
        inputReply.catch(() => { }); // guard: this promise may go unused
        try {
            await this.device.sendFeatureReport(reportId, body);
        }
        catch {
            this.clearPendingRead();
            return null;
        }
        const viaInput = await inputReply.catch(() => null);
        if (viaInput && viaInput[2] === commandId && isWootingReply(viaInput))
            return viaInput;
        this.clearPendingRead();
        const viaFeature = await this.device.receiveFeatureReport(reportId)
            .then((view) => new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
            .catch(() => null);
        if (viaFeature && viaFeature[2] === commandId && isWootingReply(viaFeature))
            return viaFeature;
        return null;
    }
    /** Report id of the config collection's declared feature report (0 if none). */
    featureReportId() {
        const collection = WootingHidClient.configCollection(this.device.collections);
        return collection?.featureReports?.[0]?.reportId ?? 0;
    }
    /** Resolve with the next input report echoing `commandId`, or reject on timeout. */
    nextInputReport(commandId = -1) {
        const { promise, resolve, reject } = Promise.withResolvers();
        this.responseWaiter = { resolve, reject, commandId };
        this.responseTimer = setTimeout(() => {
            this.clearPendingRead();
            reject(new Error("Wooting keyboard did not answer the config request."));
        }, CONFIG_RESPONSE_TIMEOUT_MS);
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
/** Serial bytes as text; falls back to hex when the payload is not printable. */
function wootingSerialText(reply) {
    const body = reply.subarray(4);
    const printable = [...body].every((byte) => byte === 0 || (byte >= 0x20 && byte < 0x7f));
    if (!printable)
        return [...body].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
    return String.fromCharCode(...[...body].filter((byte) => byte !== 0));
}
/** First `count` bytes of a buffer as spaced hex, with an ellipsis if truncated. */
function wootingHexPreview(bytes, count) {
    const shown = [...bytes.subarray(0, count)].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
    return bytes.length > count ? `${shown} …` : shown;
}
