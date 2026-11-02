import { CMD, decodeButtonAction, DONGLE_CMD, DPI_RGB_OFFSET, DPI_X_OFFSET, DPI_Y_OFFSET, encodeButtonAction, encodeCommand, gearHubBluetoothPacket, GEARHUB_BLUETOOTH_BATTERY, GEARHUB_BLUETOOTH_ENVELOPE, GEARHUB_BLUETOOTH_REPORT_ID, GEARHUB_BLUETOOTH_REPORT_SIZE, GEARHUB_BLUETOOTH_SLEEPING, GEARHUB_BLUETOOTH_USAGE, GEARHUB_BLUETOOTH_USAGE_PAGE, GEARHUB_BUTTON_ACTIONS, GEARHUB_BUTTONS, GEARHUB_DEBOUNCE_MAX_MS, GEARHUB_FALLBACK_PROFILE, GEARHUB_LIFT_OFF_LEVELS, GEARHUB_MAX_DPI_STAGES, GEARHUB_PRODUCTS, GEARHUB_RATES, GEARHUB_REPORT_ID, GEARHUB_REPORT_SIZE, GEARHUB_SLEEP_OPTIONS, GEARHUB_VENDOR_ID, gearHubProfileFor, OPT0_DEBOUNCE, OPT0_FLAG_RIPPLE, OPT0_FLAGS, OPT0_REPORT_RATE, OPT0_SILENT_HEIGHT, OPT0_SLEEP_24G, OPT0_SLEEP_BT, OPT0_STRAIGHT_CORRECTION, REPORT_RATE_DECODE, REPORT_RATE_ENCODE, TARGET_MOUSE, } from "../../gearhub/index.js";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export class GearHubHidClient {
    device;
    currentProfile = 0;
    /** What the product id tells us before we connect: the transport. */
    transportEntry;
    /** Model identity, resolved from the device id on the first readStatus(). */
    resolvedProfile = null;
    targetSelected = false;
    /**
     * The relay is stateful — select target, poll ready, send, notice-read,
     * read — so two exchanges in flight at once interleave and corrupt each
     * other. Every public operation is chained through here so only one runs at
     * a time, the same way GearHub serialises through its own send queue.
     */
    queue = Promise.resolve();
    enqueue(task) {
        const run = this.queue.then(task, task);
        this.queue = run.catch(() => undefined);
        return run;
    }
    constructor(device) {
        this.device = device;
        this.transportEntry = GEARHUB_PRODUCTS.get(device.productId);
    }
    static isSupported(device) {
        if (device.vendorId !== GEARHUB_VENDOR_ID)
            return false;
        if (!GEARHUB_PRODUCTS.has(device.productId))
            return false;
        const bluetooth = GEARHUB_PRODUCTS.get(device.productId)?.transport === "bluetooth";
        const hasControl = (collections) => collections.some((collection) => (collection.usagePage === (bluetooth ? GEARHUB_BLUETOOTH_USAGE_PAGE : 0xffff) &&
            collection.usage === (bluetooth ? GEARHUB_BLUETOOTH_USAGE : 0x02)) ||
            hasControl(collection.children ?? []));
        return hasControl(device.collections);
    }
    /** Product-specific link: receiver relay, direct USB, or Bluetooth reports. */
    get transport() {
        return this.transportEntry?.transport ?? "direct";
    }
    get supportedPollingRates() {
        const profile = this.resolvedProfile ?? GEARHUB_FALLBACK_PROFILE;
        const linkCeiling = this.transportEntry?.wiredPollingCeilingHz ?? Infinity;
        const ceiling = Math.min(profile.maxPollingHz, linkCeiling);
        return GEARHUB_RATES.filter((hz) => hz <= ceiling);
    }
    /** Every writable DPI step, not just a shortlist of presets. The app uses
     * this list to validate and round typed stage values as well as sliders. */
    getDpiOptions() {
        const { minDpi, maxDpi, dpiStep } = this.resolvedProfile ?? GEARHUB_FALLBACK_PROFILE;
        return Array.from({ length: Math.floor((maxDpi - minDpi) / dpiStep) + 1 }, (_, index) => minDpi + index * dpiStep);
    }
    async open() {
        if (!this.device.opened)
            await this.device.open();
    }
    async close() {
        if (this.device.opened)
            await this.device.close();
    }
    // ---------------------------------------------------------------------------
    // Raw feature-report I/O
    // ---------------------------------------------------------------------------
    async rawSend(bytes) {
        const buf = new Uint8Array(GEARHUB_REPORT_SIZE);
        buf.set(bytes instanceof Uint8Array
            ? bytes.subarray(0, GEARHUB_REPORT_SIZE)
            : bytes.slice(0, GEARHUB_REPORT_SIZE));
        await this.device.sendFeatureReport(GEARHUB_REPORT_ID, buf);
    }
    async rawRead() {
        const view = await this.device.receiveFeatureReport(GEARHUB_REPORT_ID);
        return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    }
    // ---------------------------------------------------------------------------
    // 2.4 GHz receiver relay
    // ---------------------------------------------------------------------------
    /**
     * Poll the receiver for link state and battery. A receiver command, so no
     * checksum. Measured layout, live: `01 00 2D 01 00 01` — ready to read,
     * no keyboard, mouse at 0x2D = 45%, keyboard offline, mouse online, ready
     * to send.
     */
    async readDongleStatus() {
        return this.enqueue(() => this.pollStatus());
    }
    /** Unqueued: callers already holding the queue slot use this. */
    async pollStatus() {
        await this.rawSend([DONGLE_CMD.GET_STATUS]);
        await delay(10);
        const r = await this.rawRead();
        return {
            canRead: r[0] === 1,
            keyboardBattery: r[1],
            mouseBattery: r[2],
            keyboardOnline: r[3] === 0,
            mouseOnline: r[4] === 0,
            canSend: r[5] === 1,
        };
    }
    async selectMouse() {
        if (this.targetSelected)
            return;
        await this.rawSend([DONGLE_CMD.SELECT_TARGET, TARGET_MOUSE]);
        await delay(50);
        this.targetSelected = true;
    }
    async waitReady(direction) {
        for (let attempt = 0; attempt < 8; attempt++) {
            await delay(100);
            const status = await this.pollStatus();
            if (direction === "send" ? status.canSend : status.canRead)
                return true;
        }
        return false;
    }
    // ---------------------------------------------------------------------------
    // Command exchange
    // ---------------------------------------------------------------------------
    /**
     * Run one command and return its reply, rejecting a reply that is not an
     * answer. Most reads echo the command id in byte 0; an unrelayed or
     * unchecksummed command comes back as 64 zeros, which must never be mistaken
     * for data. `GET_KEYMATRIX` is the exception — its reply is pure matrix data
     * with no echo byte — so `echoes: false` keeps only the all-zero guard.
     */
    async command(bytes, opts = {}) {
        return this.enqueue(() => this.exchange(bytes, opts.echoes ?? true));
    }
    async exchange(bytes, echoes) {
        await this.open();
        const encoded = encodeCommand(bytes);
        if (this.transport === "bluetooth") {
            return this.exchangeBluetooth(encoded, bytes[0], echoes);
        }
        if (this.transport === "direct") {
            await this.rawSend(encoded);
            await delay(10);
            return this.verifyReply(await this.rawRead(), bytes[0], echoes);
        }
        await this.selectMouse();
        if (!(await this.waitReady("send"))) {
            throw new Error("The 2.4 GHz receiver never became ready to send.");
        }
        await this.rawSend(encoded);
        if (!(await this.waitReady("read"))) {
            throw new Error("The 2.4 GHz receiver never became ready to read.");
        }
        await this.rawSend([DONGLE_CMD.NOTICE_READ]);
        await delay(10);
        return this.verifyReply(await this.rawRead(), bytes[0], echoes);
    }
    /** Bluetooth replies are input reports. Attach before sending and release
     * the listener on success, invalid response, timeout, or send failure.
     * Callers own the command queue; null means an unrelated input report. */
    requestBluetooth(request, decode) {
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timer);
                this.device.removeEventListener("inputreport", onReport);
            };
            const onReport = (event) => {
                if (event.reportId !== GEARHUB_BLUETOOTH_REPORT_ID)
                    return;
                const packet = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
                if (packet.length !== GEARHUB_BLUETOOTH_REPORT_SIZE)
                    return;
                try {
                    const result = decode(packet);
                    if (result === null)
                        return;
                    cleanup();
                    resolve(result);
                }
                catch (error) {
                    cleanup();
                    reject(error);
                }
            };
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error("GearHub Bluetooth did not answer. Move the mouse and retry."));
            }, 2000);
            this.device.addEventListener("inputreport", onReport);
            this.device.sendReport(GEARHUB_BLUETOOTH_REPORT_ID, request).catch((error) => {
                cleanup();
                reject(error);
            });
        });
    }
    exchangeBluetooth(encoded, command, echoes) {
        return this.requestBluetooth(gearHubBluetoothPacket(encoded), (packet) => {
            if (packet[0] !== GEARHUB_BLUETOOTH_ENVELOPE)
                return null;
            const reply = packet.slice(1);
            if (echoes && reply[0] !== command)
                return null;
            if (reply.every((value, i) => value === (encoded[i] ?? 0))) {
                throw new Error("Bluetooth command was echoed without device data.");
            }
            return this.verifyReply(reply, command, echoes);
        });
    }
    /** BLE link status is a separate envelope, not a USB command: [0x77].
     * The vendor BLE reader reads raw byte 2 as battery; WebHID
     * strips report id 6, so it is payload byte 1. 0x88 means sleeping.
     * No charging-state field has been established in this report. */
    async getBluetoothBattery() {
        return this.enqueue(async () => {
            if (this.transport !== "bluetooth")
                throw new Error("Bluetooth battery requires a Bluetooth connection.");
            await this.open();
            const request = new Uint8Array(GEARHUB_BLUETOOTH_REPORT_SIZE);
            request[0] = GEARHUB_BLUETOOTH_BATTERY;
            return this.requestBluetooth(request, (packet) => {
                if (packet[0] !== GEARHUB_BLUETOOTH_BATTERY && packet[0] !== GEARHUB_BLUETOOTH_SLEEPING)
                    return null;
                if (packet[0] === GEARHUB_BLUETOOTH_SLEEPING)
                    throw new Error("GearHub Bluetooth is sleeping.");
                if (packet.every((value, i) => value === request[i])) {
                    throw new Error("Bluetooth battery request was echoed without data.");
                }
                if (packet[1] > 100)
                    throw new Error("GearHub Bluetooth returned an invalid battery percentage.");
                return packet[1];
            });
        });
    }
    verifyReply(resp, cmd, echoes) {
        if (resp.length < GEARHUB_REPORT_SIZE) {
            throw new Error(`GearHub command 0x${cmd.toString(16)} returned ${resp.length} bytes, expected ${GEARHUB_REPORT_SIZE}.`);
        }
        if (resp.every((byte) => byte === 0)) {
            throw new Error(`GearHub command 0x${cmd.toString(16)} was not answered (all-zero response).`);
        }
        if (echoes && resp[0] !== cmd) {
            throw new Error(`GearHub command 0x${cmd.toString(16)} answered with id 0x${resp[0].toString(16)}.`);
        }
        return resp;
    }
    // ---------------------------------------------------------------------------
    // Reads
    // ---------------------------------------------------------------------------
    /** Device id — the key GearHub looks its model table up by. M5 Pro answers 2285. */
    async getDeviceId() {
        const resp = await this.command([CMD.GET_USB_VERSION]);
        return (resp[1] | (resp[2] << 8) | (resp[3] << 16) | (resp[4] << 24)) >>> 0;
    }
    /** Firmware revision: byte 2 high, byte 1 low. M5 Pro answers 0x0303. */
    async getFirmwareVersion() {
        const resp = await this.command([CMD.GET_FIRMWARE]);
        return (resp[2] << 8) | resp[1];
    }
    /**
     * Read the 64-byte OPTIONPARAM0 block — report rate (byte 9), debounce
     * (10), lift-off (52), sleep, sensitivity. GearHub reads and writes this
     * whole; the driver picks out the fields it exposes.
     */
    async getOptionParam0() {
        return this.command([CMD.GET_OPTIONPARAM0]);
    }
    async getReportRate() {
        const opt0 = await this.getOptionParam0();
        const hz = REPORT_RATE_DECODE[opt0[OPT0_REPORT_RATE]];
        if (hz === undefined) {
            throw new Error(`GearHub OPTIONPARAM0 held an unknown report-rate code ${opt0[OPT0_REPORT_RATE]}.`);
        }
        return hz;
    }
    /** The lift-off stops this model offers, ascending; empty when unknown. */
    liftOffLevels() {
        const profile = this.resolvedProfile ?? GEARHUB_FALLBACK_PROFILE;
        return GEARHUB_LIFT_OFF_LEVELS[profile.sensor] ?? [];
    }
    /** Every DPI stage of the active profile, plus which one is selected. */
    async getDpi() {
        const resp = await this.command([CMD.GET_DPI, this.currentProfile]);
        const activeIndex = resp[2] >= GEARHUB_MAX_DPI_STAGES ? 0 : resp[2];
        const count = Math.min(resp[3], GEARHUB_MAX_DPI_STAGES);
        if (count === 0)
            throw new Error("GearHub GET_DPI reported no DPI stages.");
        const stages = [];
        for (let i = 0; i < count; i++) {
            stages.push({
                x: resp[DPI_X_OFFSET + i * 2] | (resp[DPI_X_OFFSET + 1 + i * 2] << 8),
                y: resp[DPI_Y_OFFSET + i * 2] | (resp[DPI_Y_OFFSET + 1 + i * 2] << 8),
                rgb: (resp[DPI_RGB_OFFSET + i * 3] << 16) |
                    (resp[DPI_RGB_OFFSET + 1 + i * 3] << 8) |
                    resp[DPI_RGB_OFFSET + 2 + i * 3],
            });
        }
        return { stages, activeIndex };
    }
    // ---------------------------------------------------------------------------
    // Writes
    // ---------------------------------------------------------------------------
    /**
     * Change fields in OPTIONPARAM0 by read-modify-write. GearHub's settings
     * only take effect when the whole 64-byte block is written back, so every
     * byte not in `overrides` is carried over from the current read. Bytes
     * 17/18 are stamped the way GearHub's own writer stamps them.
     */
    async patchOptionParam0(overrides) {
        const current = await this.getOptionParam0();
        const block = new Uint8Array(GEARHUB_REPORT_SIZE);
        block.set(current.subarray(8, GEARHUB_REPORT_SIZE), 8);
        block[0] = CMD.SET_OPTIONPARAM0;
        block[17] = 255;
        block[18] = 8;
        for (const [offset, value] of Object.entries(overrides)) {
            const i = Number(offset);
            block[i] = (typeof value === "function" ? value(current[i]) : value) & 0xff;
        }
        await this.sendWrite(block);
    }
    async setReportRate(hz) {
        const code = REPORT_RATE_ENCODE[hz];
        if (code === undefined || !this.supportedPollingRates.includes(hz)) {
            throw new Error(`Unsupported rate ${hz} Hz. Supported: ${this.supportedPollingRates.join(", ")}`);
        }
        await this.patchOptionParam0({ [OPT0_REPORT_RATE]: code });
        return hz;
    }
    /** Set the lift-off distance. Levels come from `liftOffLevels()`. */
    async setLiftOffDistance(level) {
        const index = this.liftOffLevels().indexOf(level);
        if (index < 0) {
            throw new Error(`Lift-off level "${level}" is not available on this model.`);
        }
        await this.patchOptionParam0({ [OPT0_SILENT_HEIGHT]: index });
        return level;
    }
    /** Debounce (button click filter), 0..10 ms — GearHub's "Debounce" slider. */
    getDebounceMaxMs() {
        return GEARHUB_DEBOUNCE_MAX_MS;
    }
    /** The exact debounce values to offer (0..10 ms), so the UI never presents
     *  a value the firmware would clamp. */
    getDebounceOptions() {
        return Array.from({ length: GEARHUB_DEBOUNCE_MAX_MS + 1 }, (_, ms) => ms);
    }
    async setDebounceTime(ms) {
        const clamped = Math.max(0, Math.min(GEARHUB_DEBOUNCE_MAX_MS, Math.round(ms)));
        await this.patchOptionParam0({ [OPT0_DEBOUNCE]: clamped });
        return clamped;
    }
    /** Standby-time stops, seconds; 0 = never. GearHub's "Sleep Settings". */
    getSleepOptions() {
        return [...GEARHUB_SLEEP_OPTIONS];
    }
    /**
     * Idle seconds before standby. GearHub keeps a 2.4 GHz timer and a Bluetooth
     * timer; OpenMouse has one control, so both are set to the same value.
     */
    async setSleepTimeout(seconds) {
        const s = Math.max(0, Math.min(0xffff, Math.round(seconds)));
        await this.patchOptionParam0({
            [OPT0_SLEEP_24G]: s & 0xff,
            [OPT0_SLEEP_24G + 1]: (s >> 8) & 0xff,
            [OPT0_SLEEP_BT]: s & 0xff,
            [OPT0_SLEEP_BT + 1]: (s >> 8) & 0xff,
        });
        return s;
    }
    /** "Straight Correction" — GearHub's angle-snapping / line-repair toggle. */
    async setAngleSnapping(enabled) {
        await this.patchOptionParam0({ [OPT0_STRAIGHT_CORRECTION]: enabled ? 1 : 0 });
        return enabled;
    }
    /** "Ripple Correction" — bit 2 of the OPTIONPARAM0 flags word. */
    async setRippleControl(enabled) {
        await this.patchOptionParam0({
            [OPT0_FLAGS]: (current) => enabled ? current | OPT0_FLAG_RIPPLE : current & ~OPT0_FLAG_RIPPLE,
        });
        return enabled;
    }
    // ── Button remapping ──────────────────────────────────────────────────────
    /**
     * Raw keymatrix reply for a profile: 14 slots x 4 bytes, no echo byte. Read
     * late in `readStatus` after several other relay exchanges, so it retries
     * once — the relay is more likely to miss its ready window under load.
     */
    async getKeyMatrix(profile = 0) {
        const read = async () => {
            const reply = await this.command([CMD.GET_KEYMATRIX, profile], { echoes: false });
            // A lost relay response may leave an earlier echoed GET packet buffered.
            // Matrix action types are small values, never a command id (>= 0x80).
            if (reply[0] >= 0x80)
                throw new Error("GearHub returned a stale command instead of button mappings.");
            return reply;
        };
        try {
            return await read();
        }
        catch {
            return read();
        }
    }
    buttonMappingsFrom(reply) {
        const out = {};
        for (const { name, slot } of this.buttons()) {
            const o = slot * 4;
            out[name] = decodeButtonAction([reply[o], reply[o + 1], reply[o + 2], reply[o + 3]]);
        }
        return out;
    }
    buttons() {
        return this.resolvedProfile?.buttons ?? GEARHUB_BUTTONS;
    }
    /** Every action `setButtonMapping` accepts, in display order. */
    getButtonOptions() {
        return GEARHUB_BUTTON_ACTIONS.map(([label]) => label);
    }
    /** Reassign one physical button. `button` is a `GEARHUB_BUTTONS` name. */
    async setButtonMapping(button, action) {
        const target = this.buttons().find((b) => b.name === button);
        if (!target)
            throw new Error(`Unknown button "${button}".`);
        const value = encodeButtonAction(action);
        if (!value)
            throw new Error(`Unsupported button action "${action}".`);
        const cmd = new Uint8Array(GEARHUB_REPORT_SIZE);
        cmd[0] = CMD.SET_KEYMATRIX;
        cmd[1] = this.currentProfile;
        cmd[2] = target.slot;
        cmd[8] = value[0];
        cmd[9] = value[1];
        cmd[10] = value[2];
        cmd[11] = value[3];
        await this.sendWrite(cmd);
    }
    /**
     * Replace one DPI stage's resolution. SET_DPI carries the whole stage table,
     * so the other stages — and every stage's indicator colour — are read back
     * and echoed unchanged rather than zeroed.
     */
    async setDpiForStage(x, y, index) {
        if (this.resolvedProfile) {
            const { minDpi, maxDpi, dpiStep } = this.resolvedProfile;
            if (![x, y].every((value) => Number.isInteger(value) && value >= minDpi && value <= maxDpi && (value - minDpi) % dpiStep === 0)) {
                throw new Error(`GearHub DPI must be ${minDpi}..${maxDpi} in ${dpiStep} DPI steps.`);
            }
        }
        const { stages, activeIndex } = await this.getDpi();
        const target = index >= 0 && index < stages.length ? index : activeIndex;
        stages[target] = { ...stages[target], x, y };
        await this.writeDpiTable(stages, activeIndex);
        return x;
    }
    /**
     * The app's shared-name entry point for the stage editor, which checks for
     * this exact method to decide a stage table is writable. A gear has one
     * DPI value per stage, so both axes take it. Active-stage selection and
     * per-stage colour already have their shared-name methods here.
     */
    async setDpiStageValue(stage, dpi) {
        return this.setDpiForStage(dpi, dpi, stage);
    }
    /**
     * Recolour one DPI stage's indicator LED. Same whole-table write as
     * `setDpiForStage`, changing `rgb` instead of the resolution. `color` is
     * `#rrggbb`; returns it normalised.
     */
    async setDpiStageColor(index, color) {
        const rgb = Number.parseInt(color.replace(/^#/, ""), 16);
        if (!Number.isFinite(rgb))
            throw new Error(`Invalid DPI stage colour "${color}".`);
        const { stages, activeIndex } = await this.getDpi();
        const target = index >= 0 && index < stages.length ? index : activeIndex;
        stages[target] = { ...stages[target], rgb: rgb & 0xffffff };
        await this.writeDpiTable(stages, activeIndex);
        return `#${(rgb & 0xffffff).toString(16).padStart(6, "0")}`;
    }
    /**
     * Switch which DPI stage the mouse is on. SET_DPI's byte 2 is the active
     * index; re-send the unchanged table with it moved.
     */
    async setActiveDpiStage(index) {
        const { stages } = await this.getDpi();
        if (stages.length === 0)
            throw new Error("GearHub reported no DPI stages.");
        const target = Math.max(0, Math.min(index, stages.length - 1));
        await this.writeDpiTable(stages, target);
        return target;
    }
    /** Encode the full stage table into one SET_DPI report and send it. */
    async writeDpiTable(stages, active) {
        const cmd = new Uint8Array(GEARHUB_REPORT_SIZE);
        cmd[0] = CMD.SET_DPI;
        cmd[1] = this.currentProfile;
        cmd[2] = active;
        cmd[3] = stages.length;
        stages.forEach((stage, i) => {
            cmd[DPI_X_OFFSET + i * 2] = stage.x & 0xff;
            cmd[DPI_X_OFFSET + 1 + i * 2] = (stage.x >> 8) & 0xff;
            cmd[DPI_Y_OFFSET + i * 2] = stage.y & 0xff;
            cmd[DPI_Y_OFFSET + 1 + i * 2] = (stage.y >> 8) & 0xff;
            cmd[DPI_RGB_OFFSET + i * 3] = (stage.rgb >> 16) & 0xff;
            cmd[DPI_RGB_OFFSET + 1 + i * 3] = (stage.rgb >> 8) & 0xff;
            cmd[DPI_RGB_OFFSET + 2 + i * 3] = stage.rgb & 0xff;
        });
        await this.sendWrite(cmd);
    }
    /** A write takes the same relay path as a read, minus the read-back. */
    async sendWrite(cmd) {
        return this.enqueue(() => this.writeThrough(cmd));
    }
    async writeThrough(cmd) {
        await this.open();
        const encoded = encodeCommand([...cmd]);
        if (this.transport === "bluetooth") {
            await this.device.sendReport(GEARHUB_BLUETOOTH_REPORT_ID, gearHubBluetoothPacket(encoded));
            await delay(60);
            return;
        }
        if (this.transport === "direct") {
            await this.rawSend(encoded);
            await delay(10);
            return;
        }
        await this.selectMouse();
        if (!(await this.waitReady("send"))) {
            throw new Error("The 2.4 GHz receiver never became ready to send.");
        }
        await this.rawSend(encoded);
        await delay(50);
    }
    // ---------------------------------------------------------------------------
    // High-Level API
    // ---------------------------------------------------------------------------
    async readStatus() {
        await this.open();
        let battery = null;
        let connectionType = "Wired";
        let connectionDetail = "USB";
        if (this.transport === "bluetooth") {
            connectionType = "Wireless";
            connectionDetail = "Bluetooth";
            try {
                battery = await this.getBluetoothBattery();
            }
            catch { /* Optional: settings remain usable without battery. */ }
        }
        if (this.transport === "dongle") {
            connectionType = "Wireless";
            connectionDetail = "2.4 GHz";
            const status = await this.readDongleStatus();
            if (!status.mouseOnline) {
                throw new Error("The 2.4 GHz receiver is present but no mouse is linked to it — the mouse is asleep, powered off, or switched to Bluetooth/wired mode. Move the mouse and try again.");
            }
            battery = status.mouseBattery > 0 && status.mouseBattery <= 100 ? status.mouseBattery : null;
        }
        // Identify the model before the first data read. GearHub keys its model
        // table off this id; the receiver's shared VID:PID cannot. A failure here
        // (older firmware, a sibling that does not answer 0x8F) is non-fatal — we
        // fall back to the generic GearHub-V5 profile.
        let deviceId = null;
        try {
            deviceId = await this.getDeviceId();
        }
        catch {
            deviceId = null;
        }
        this.resolvedProfile = deviceId !== null ? gearHubProfileFor(deviceId) : null;
        const profile = this.resolvedProfile ?? GEARHUB_FALLBACK_PROFILE;
        const displayName = `${profile.brand} ${profile.model}`;
        // The DPI read has to work: it carries the values the UI exists to show,
        // and it is the cheapest proof the whole relay + checksum path is right.
        const dpi = await this.getDpi();
        // AJ179 PRO reports capacity (8), including trailing disabled zero slots.
        // Trim only the UI view; getDpi()/writes retain the complete wire table.
        if (profile.dpiStageCountIsCapacity) {
            while (dpi.stages.length > 1 && dpi.stages.at(-1)?.x === 0 && dpi.stages.at(-1)?.y === 0) {
                dpi.stages.pop();
            }
        }
        const active = dpi.stages[dpi.activeIndex] ?? dpi.stages[0];
        // Report rate and lift-off both live in the OPTIONPARAM0 block — one read
        // covers both. A failure leaves the rate at a safe default and lift-off
        // unreported rather than sinking the whole status.
        const [opt0Result, keyMatrixResult, firmwareResult] = await Promise.allSettled([
            this.getOptionParam0(),
            this.getKeyMatrix(this.currentProfile),
            this.getFirmwareVersion(),
        ]);
        let pollingRateHz = 1000;
        let liftOffDistance = null;
        let supportedLiftOffDistances;
        let debounceMs = null;
        let angleSnapping = null;
        let rippleControl = null;
        let sleepTimeout = null;
        if (opt0Result.status === "fulfilled") {
            const opt0 = opt0Result.value;
            pollingRateHz = REPORT_RATE_DECODE[opt0[OPT0_REPORT_RATE]] ?? pollingRateHz;
            debounceMs = opt0[OPT0_DEBOUNCE];
            angleSnapping = opt0[OPT0_STRAIGHT_CORRECTION] !== 0;
            rippleControl = (opt0[OPT0_FLAGS] & OPT0_FLAG_RIPPLE) !== 0;
            const sleepOffset = this.transport === "bluetooth" ? OPT0_SLEEP_BT : OPT0_SLEEP_24G;
            sleepTimeout = opt0[sleepOffset] | (opt0[sleepOffset + 1] << 8);
            const levels = this.liftOffLevels();
            if (levels.length > 0) {
                liftOffDistance = levels[opt0[OPT0_SILENT_HEIGHT]] ?? levels[0];
                if (levels.length < 3)
                    supportedLiftOffDistances = [...levels];
            }
        }
        const firmware = firmwareResult.status === "fulfilled" && firmwareResult.value !== 0
            ? [`v${(firmwareResult.value >> 8) & 0xff}.${String(firmwareResult.value & 0xff).padStart(2, "0")}`]
            : [];
        const buttonMappings = keyMatrixResult.status === "fulfilled"
            ? this.buttonMappingsFrom(keyMatrixResult.value)
            : undefined;
        return {
            brand: profile.brand,
            name: displayName,
            ui: {
                family: "gearhub",
                settingsReady: true,
                defaultDisplayName: displayName,
                // Stage-list DPI editor: per-stage resolution + indicator colour, the
                // way GearHub itself shows it. Stage count is fixed (no SET for it), so
                // countEditable is left off and the count picker stays hidden.
                dpiStageEditor: {
                    maxStages: dpi.stages.length,
                    minDpi: profile.minDpi,
                    maxDpi: profile.maxDpi,
                    stepDpi: profile.dpiStep,
                },
            },
            batteryPercent: battery,
            batteryState: battery === null || profile.batteryPercentageOnly ? "Unknown" : "Discharging",
            dpi: active.x,
            dpiY: active.y,
            supportsSeparateDpiAxes: true,
            dpiStages: dpi.stages.map((stage) => stage.x),
            dpiStageColors: dpi.stages.map((stage) => `#${(stage.rgb & 0xffffff).toString(16).padStart(6, "0")}`),
            activeDpiStage: dpi.activeIndex,
            pollingRateHz,
            supportedPollingRates: this.supportedPollingRates,
            activeProfile: this.currentProfile,
            connectionType,
            connectionDetail,
            liftOffDistance,
            ...(supportedLiftOffDistances ? { supportedLiftOffDistances } : {}),
            debounceMs,
            angleSnapping,
            rippleControl,
            sleepTimeout,
            ...(buttonMappings ? { buttonMappings, buttonOptions: this.getButtonOptions() } : {}),
            firmware: [...firmware, profile.sensor],
        };
    }
    async setDpi(dpi, dpiY = dpi) {
        const { activeIndex } = await this.getDpi();
        await this.setDpiForStage(dpi, dpiY, activeIndex);
        return dpi;
    }
    async setPollingRate(rate) {
        return this.setReportRate(rate);
    }
}
