import { KEYCHRON_CONFIG_USAGE, KEYCHRON_CONFIG_USAGE_PAGE, KEYCHRON_HE_PRODUCTS, KEYCHRON_HE_SUBCOMMAND, KEYCHRON_REPORT_ID, KEYCHRON_VENDOR_ID, decodeKeychronAxisType, decodeKeychronCalibrationState, decodeKeychronCurve, decodeKeychronHeVersion, decodeKeychronProfileBuffer, decodeKeychronProfileName, decodeKeychronProfilesInfo, decodeKeychronRealtimeTravel, isKeychronHeReply, isKeychronHeVersion, joinKeychronProfile, keychronHeAcknowledged, keychronHeFrames, keychronNameWindow, keychronProfileChunk, keychronProfileNameBytes, keychronKeymapReadPlan, keychronViaFrames, isKeychronKeymapReply, decodeKeychronKeymapChunk, joinKeychronKeymap, decodeKeychronLayerCount, decodeKeychronViaProtocol, decodeKeychronKeycode, isKeychronKeycodeReply, keychronKeycodeIsChoosable, keychronKeycodeContext, keychronIsLayerKey, keychronProfileReadPlan, } from "../../keychron/index.js";
const REPLY_TIMEOUT_MS = 1500;
/**
 * Keychron Hall-effect keyboards over the VIA raw-HID collection (0xFF60:0x61).
 * Only boards in the HE catalog are claimed, so a non-HE Keychron keyboard
 * sharing the vendor id is never offered this driver.
 */
export class KeychronHidClient {
    device;
    queue = Promise.resolve();
    listening = false;
    faulted = false;
    heVersion = null;
    info = null;
    pending = null;
    constructor(device) { this.device = device; }
    /** A catalogued HE board that exposes the raw-HID command collection. */
    static isSupported(device) {
        return device.vendorId === KEYCHRON_VENDOR_ID && device.productId in KEYCHRON_HE_PRODUCTS
            && KeychronHidClient.configCollection(device.collections) !== null;
    }
    static configCollection(collections) {
        for (const collection of collections) {
            if (collection.usagePage === KEYCHRON_CONFIG_USAGE_PAGE && collection.usage === KEYCHRON_CONFIG_USAGE) {
                return collection;
            }
            const nested = KeychronHidClient.configCollection(collection.children);
            if (nested)
                return nested;
        }
        return null;
    }
    async open() {
        if (!KeychronHidClient.isSupported(this.device))
            throw new Error("Not a Keychron Hall-effect configuration interface.");
        if (this.faulted)
            throw new Error("Reconnect the keyboard after a failed transaction.");
        if (!this.device.opened)
            await this.device.open();
        // close() can land while device.open() is pending; recheck before listening.
        if (this.faulted) {
            if (this.device.opened)
                await this.device.close();
            throw new Error("Reconnect the keyboard after a failed transaction.");
        }
        if (!this.listening) {
            this.device.addEventListener("inputreport", this.onReport);
            this.listening = true;
        }
    }
    async close() {
        this.faulted = true;
        this.pending?.reject(new Error("Keychron keyboard disconnected."));
        if (this.listening)
            this.device.removeEventListener("inputreport", this.onReport);
        this.listening = false;
        if (this.device.opened)
            await this.device.close();
    }
    onReport = (event) => {
        if (event.device !== this.device || event.reportId !== KEYCHRON_REPORT_ID || !this.pending)
            return;
        const frame = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
        if (this.pending.accepts(frame))
            this.pending.resolve(frame.slice());
    };
    serialized(operation) {
        const next = this.queue.then(operation);
        this.queue = next.catch(() => undefined);
        return next;
    }
    /** Send one report and wait for the reply `accepts` recognises. */
    async exchange(request, accepts, faultOnTimeout = true) {
        await this.open();
        let timer;
        const reply = new Promise((resolve, reject) => {
            this.pending = { accepts, resolve, reject };
            timer = setTimeout(() => reject(new Error(`Keychron keyboard did not answer command 0x${request[1].toString(16)}.`)), REPLY_TIMEOUT_MS);
        });
        try {
            const [frame] = await Promise.all([reply, this.device.sendReport(KEYCHRON_REPORT_ID, request)]);
            return frame;
        }
        catch (error) {
            // Replies carry no transaction id, so a delayed one could confirm a later
            // command. Do not reuse the session after a timeout or a failed send.
            // The optional VIA reads opt out of the timeout case: their replies carry
            // a different command id, so a late one can never satisfy an HE command.
            if (faultOnTimeout || !(error instanceof Error && error.message.includes("did not answer")))
                this.faulted = true;
            throw error;
        }
        finally {
            clearTimeout(timer);
            this.pending = null;
        }
    }
    call(request, subcommand) {
        return this.exchange(request, (frame) => isKeychronHeReply(frame, subcommand));
    }
    async version() {
        if (!this.heVersion) {
            const reply = decodeKeychronHeVersion(await this.call(keychronHeFrames.version(), KEYCHRON_HE_SUBCOMMAND.getVersion));
            if (!reply || !isKeychronHeVersion(reply.version)) {
                throw new Error("The keyboard reported an unsupported Hall-effect command version.");
            }
            this.heVersion = reply;
        }
        return this.heVersion.version;
    }
    async profilesInfo(refresh = false) {
        if (!this.info || refresh) {
            const version = await this.version();
            const info = decodeKeychronProfilesInfo(await this.call(keychronHeFrames.profilesInfo(), KEYCHRON_HE_SUBCOMMAND.getProfilesInfo), version);
            if (!info)
                throw new Error("The keyboard did not report its profile layout.");
            this.info = info;
        }
        return this.info;
    }
    async readRange(slot, offset, length) {
        const reply = await this.exchange(keychronHeFrames.readProfile(slot, offset, length), (frame) => isKeychronHeReply(frame, KEYCHRON_HE_SUBCOMMAND.getProfileBuffer)
            && frame[3] === (offset & 0xff) && frame[4] === (offset >> 8) && frame[5] === length);
        return keychronProfileChunk(reply).slice(0, length);
    }
    async readName(slot, version, size) {
        const { offset, length } = keychronNameWindow(version, size);
        const reply = await this.exchange(keychronHeFrames.readProfile(slot, offset, length), (frame) => isKeychronHeReply(frame, KEYCHRON_HE_SUBCOMMAND.getProfileBuffer)
            && frame[2] === slot && frame[3] === (offset & 0xff) && frame[4] === (offset >> 8) && frame[5] === length);
        return decodeKeychronProfileName(reply);
    }
    async readBuffer(slot, size) {
        const chunks = [];
        for (const { offset, length } of keychronProfileReadPlan(size))
            chunks.push(await this.readRange(slot, offset, length));
        return joinKeychronProfile(chunks, size);
    }
    matrix() {
        const product = KEYCHRON_HE_PRODUCTS[this.device.productId];
        if (!product)
            throw new Error("Unknown Keychron Hall-effect product.");
        return product;
    }
    /** Decode one onboard profile: actuation, rapid trigger, DKS and snap-tap slots. */
    readProfile(slot) {
        return this.serialized(async () => {
            const version = await this.version();
            const info = await this.profilesInfo(true);
            const target = slot ?? info.current;
            if (!Number.isInteger(target) || target < 0 || target >= info.total)
                throw new RangeError("Profile slot out of range.");
            const product = this.matrix();
            return decodeKeychronProfileBuffer(version, await this.readBuffer(target, info.size), product.rows, product.cols);
        });
    }
    readAxisType() {
        return this.serialized(async () => {
            const info = await this.profilesInfo();
            const axis = decodeKeychronAxisType(await this.call(keychronHeFrames.getAxisType(), KEYCHRON_HE_SUBCOMMAND.getAxisType), info.unit);
            if (!axis)
                throw new Error("The keyboard did not report its switch axis type.");
            return axis;
        });
    }
    /** Switch the board's active profile slot. */
    selectProfile(slot) {
        return this.serialized(async () => {
            const info = await this.profilesInfo();
            if (!Number.isInteger(slot) || slot < 0 || slot >= info.total)
                throw new RangeError("Profile slot out of range.");
            await this.call(keychronHeFrames.selectProfile(slot), KEYCHRON_HE_SUBCOMMAND.selectProfile);
            this.info = { ...info, current: slot };
        });
    }
    /**
     * Write actuation / rapid-trigger values into the active profile's working
     * buffer. Call `saveProfile()` afterwards to persist them, as Launcher does.
     * Values are in the profile's `unit` steps (`readStatus().keychron.unit`).
     */
    setTravel(setting) {
        return this.serialized(async () => {
            const version = await this.version();
            const info = await this.profilesInfo();
            const reply = await this.call(keychronHeFrames.setTravel(version, info.current, setting), KEYCHRON_HE_SUBCOMMAND.setTravel);
            if (!keychronHeAcknowledged(reply, KEYCHRON_HE_SUBCOMMAND.setTravel))
                throw new Error("The keyboard rejected the travel setting.");
        });
    }
    saveProfile() {
        return this.serialized(async () => {
            const info = await this.profilesInfo();
            const reply = await this.call(keychronHeFrames.saveProfile(info.current), KEYCHRON_HE_SUBCOMMAND.saveProfileBuffer);
            if (!keychronHeAcknowledged(reply, KEYCHRON_HE_SUBCOMMAND.saveProfileBuffer))
                throw new Error("The keyboard did not save the profile.");
        });
    }
    viaProtocol = null;
    /** The VIA protocol version the board reports; it selects the keycode table. */
    readViaProtocol() {
        return this.serialized(() => this.viaProtocolVersion());
    }
    async viaProtocolVersion() {
        if (this.viaProtocol === null) {
            const reply = await this.exchange(keychronViaFrames.protocolVersion(), (frame) => decodeKeychronViaProtocol(frame) !== null, false);
            this.viaProtocol = decodeKeychronViaProtocol(reply);
        }
        return this.viaProtocol;
    }
    /** Keycode context (protocol version and the board's custom keys) for legends and the picker. */
    keycodeContext() {
        return this.serialized(async () => keychronKeycodeContext(this.device.productId, await this.viaProtocolVersion()));
    }
    async readKey(layer, row, col) {
        const reply = await this.exchange(keychronViaFrames.getKeycode(layer, row, col), (frame) => isKeychronKeycodeReply(frame, layer, row, col), false);
        return decodeKeychronKeycode(reply);
    }
    /**
     * Set one key's keycode and confirm it by reading the key back. Launcher
     * writes without waiting for a reply, so the read-back is what proves the
     * board took it. The keycode must be one this module can name for the
     * board's protocol version, so a layer or custom code is never sent with the
     * wrong table. Persists in the board's memory.
     */
    setKeycode(layer, row, col, code) {
        return this.serialized(async () => {
            const product = this.matrix();
            if (row >= product.rows || col >= product.cols)
                throw new RangeError("Key position is outside the board's matrix.");
            const protocol = await this.viaProtocolVersion();
            const context = keychronKeycodeContext(this.device.productId, protocol);
            if (!keychronKeycodeIsChoosable(code, context))
                throw new RangeError("That keycode is not valid for this board's firmware.");
            await this.open();
            await this.device.sendReport(KEYCHRON_REPORT_ID, keychronViaFrames.setKeycode(layer, row, col, code));
            const confirmed = await this.readKey(layer, row, col);
            if (confirmed !== code)
                throw new Error("The keyboard did not keep the new key assignment.");
            return confirmed;
        });
    }
    /**
     * Warnings before replacing `row`,`col` on `layer` with `code`: replacing the
     * last layer key that reaches other layers can strand keys on those layers.
     */
    async remapWarnings(layer, row, col, code) {
        const protocol = await this.readViaProtocol();
        const keymap = await this.readKeymap(layer);
        const current = keymap[row]?.[col];
        const warnings = [];
        if (current !== undefined && keychronIsLayerKey(current, protocol) && !keychronIsLayerKey(code, protocol)) {
            const others = keymap.flat().filter((value, index) => keychronIsLayerKey(value, protocol) && index !== row * keymap[0].length + col);
            if (others.length === 0)
                warnings.push("This is the only layer key on this layer; replacing it removes the way to reach other layers from here.");
        }
        return warnings;
    }
    /** Number of keymap layers the board has. */
    readLayerCount() {
        return this.serialized(async () => {
            const count = decodeKeychronLayerCount(await this.exchange(keychronViaFrames.layerCount(), (frame) => decodeKeychronLayerCount(frame) !== null, false));
            if (count === null)
                throw new Error("The keyboard did not report its layer count.");
            return count;
        });
    }
    /**
     * Read one keymap layer as `keycodes[row][col]` using the standard VIA
     * dynamic-keymap read. Pair it with `keychronKeycodeLegend` to label keys.
     * A board that ignores the read rejects with "did not answer" but the
     * session stays usable for the Hall-effect commands.
     */
    readKeymap(layer = 0) {
        return this.serialized(async () => {
            const { rows, cols } = this.matrix();
            const chunks = [];
            for (const read of keychronKeymapReadPlan(layer, rows, cols)) {
                const reply = await this.exchange(keychronViaFrames.keymapBuffer(read), (frame) => isKeychronKeymapReply(frame, read.offset), false);
                const codes = decodeKeychronKeymapChunk(reply, read.bytes);
                if (!codes)
                    throw new Error("The keyboard sent a short keymap reply.");
                chunks.push(codes);
            }
            return joinKeychronKeymap(chunks, rows, cols);
        });
    }
    /** Rename a profile slot, then save, as Launcher does. */
    renameProfile(slot, name) {
        return this.serialized(async () => {
            const { chars, length } = keychronProfileNameBytes(name);
            const info = await this.profilesInfo();
            if (!Number.isInteger(slot) || slot < 0 || slot >= info.total)
                throw new RangeError("Profile slot out of range.");
            await this.call(keychronHeFrames.setProfileName(slot, chars, length), KEYCHRON_HE_SUBCOMMAND.setProfileName);
            const saved = await this.call(keychronHeFrames.saveProfile(info.current), KEYCHRON_HE_SUBCOMMAND.saveProfileBuffer);
            if (!keychronHeAcknowledged(saved, KEYCHRON_HE_SUBCOMMAND.saveProfileBuffer))
                throw new Error("The keyboard did not save the profile.");
        });
    }
    clearProfile() {
        return this.serialized(async () => {
            const info = await this.profilesInfo();
            await this.call(keychronHeFrames.clearProfile(info.current), KEYCHRON_HE_SUBCOMMAND.clearProfileBuffer);
        });
    }
    readCurve() {
        return this.serialized(async () => {
            const curve = decodeKeychronCurve(await this.call(keychronHeFrames.getCurve(), KEYCHRON_HE_SUBCOMMAND.getCurve));
            if (!curve)
                throw new Error("The keyboard did not report its response curve.");
            return curve;
        });
    }
    writeCurve(curve) {
        return this.serialized(async () => {
            await this.call(keychronHeFrames.setCurve(curve), KEYCHRON_HE_SUBCOMMAND.setCurve);
        });
    }
    /** Live travel of one key, in the profile's `unit` steps. */
    readKeyTravel(row, col) {
        return this.serialized(async () => {
            const version = await this.version();
            const reply = await this.exchange(keychronHeFrames.realtimeTravel(row, col), (frame) => decodeKeychronRealtimeTravel(frame, version, row, col) !== null);
            return decodeKeychronRealtimeTravel(reply, version, row, col);
        });
    }
    startCalibration() {
        return this.serialized(async () => {
            await this.call(keychronHeFrames.calibrate(), KEYCHRON_HE_SUBCOMMAND.calibrate);
        });
    }
    /** Stop calibration. The board sends no reply to this command. */
    stopCalibration() {
        return this.serialized(async () => {
            await this.open();
            await this.device.sendReport(KEYCHRON_REPORT_ID, keychronHeFrames.stopCalibration());
        });
    }
    readCalibration() {
        return this.serialized(async () => {
            const state = decodeKeychronCalibrationState(await this.call(keychronHeFrames.calibrationState(), KEYCHRON_HE_SUBCOMMAND.getCalibrateState));
            if (!state)
                throw new Error("The keyboard did not report its calibration state.");
            return state;
        });
    }
    readStatus() {
        return this.serialized(async () => {
            const product = this.matrix();
            const version = await this.version();
            const info = await this.profilesInfo(true);
            const names = [];
            for (let slot = 0; slot < info.total; slot++)
                names.push(await this.readName(slot, version, info.size));
            const versionInfo = this.heVersion;
            return {
                brand: "Keychron", name: product.name, connectionType: "Unknown", connectionDetail: "Raw HID",
                firmware: [`Hall-effect command v${version}`], firmwareVersion: null, layout: null, serial: null,
                activeProfile: info.current, profileCount: info.total, profileNames: names,
                ui: { family: "keychron", defaultDisplayName: product.name, settingsReady: false },
                keychron: {
                    productId: this.device.productId, heVersion: version, features: versionInfo.features,
                    unit: info.unit, profileSize: info.size, dksCount: info.dksCount, snapTapCount: info.snapTapCount,
                    rows: product.rows, cols: product.cols, travel: product.travel ?? null,
                },
            };
        });
    }
}
