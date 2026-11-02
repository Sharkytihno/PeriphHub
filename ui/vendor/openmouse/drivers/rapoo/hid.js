import { RAPOO_ADDRESS, RAPOO_BLOCK_LENGTH, RAPOO_CONFIG_REPORT_ID, RAPOO_CONFIG_USAGE, RAPOO_CONFIG_USAGE_PAGE, RAPOO_NOTIFY_REPORT_ID, RAPOO_PRODUCT_IDS, RAPOO_STATUS_REPORT_ID, RAPOO_VENDOR_ID, RAPOO_WIRELESS_PRODUCT_ID, decodeRapooActiveStage, decodeRapooAnswer, decodeRapooBatteryAnswer, decodeRapooDpiTable, decodeRapooNotification, decodeRapooPerformance, decodeRapooSensor, decodeRapooTiming, encodeRapooBatteryQuery, encodeRapooRead, rapooAnswerBlock, rapooLinkConnection, rapooStatusBatteryPercent, } from "../../rapoo/index.js";
/**
 * How many times one frame is sent before a read is considered lost, and how
 * long to wait for the busy -> OK transition. The vendor driver sleeps 50 ms
 * between sends, shows busy within about 4 ms, and gives up on a frame 120 ms
 * after sending it - all three figures are its own.
 */
const EXCHANGE_ATTEMPTS = 4;
const EXCHANGE_RETRY_MS = 50;
const EXCHANGE_ACCEPT_MS = 120;
const EXCHANGE_POLL_MS = 2;
/**
 * How many times a whole read is retried before a register is called
 * unreadable. Four rounds of four sends read every address of the map on every
 * capture run, wired and wireless alike.
 */
const BLOCK_ROUNDS = 4;
const BLOCK_GAP_MS = 120;
/**
 * How many registers in a row have to come back empty before the walk gives up.
 *
 * One register can lose every frame and still be there - it was measured - so a
 * single empty result is not proof of anything. A mouse that is asleep or out
 * of range loses all of them, and the point of stopping is to keep that from
 * turning into a connect that looks hung: at ~2.9 s per silent register, a full
 * walk of the map costs about 14 s.
 */
const BLOCK_FAILURES_BEFORE_SLEEPING = 2;
/**
 * A battery query does not follow busy -> OK: the value is already sitting in
 * the device's input buffer, so the answer is found by looking for the marker
 * byte instead of by watching the handshake.
 */
const BATTERY_ROUNDS = 4;
const BATTERY_POLLS = 60;
const BATTERY_POLL_MS = 4;
/**
 * How long to wait before walking the register map again after a mouse that did
 * not answer. The sweep is the expensive part of a status read, and the app
 * refreshes status on a timer, so a mouse that was asleep at connect must not
 * make every refresh pay for it. It gets retried on the next read after the
 * window instead, which is what eventually catches a user who woke the mouse
 * up without reconnecting it.
 */
const SWEEP_RETRY_MS = 30_000;
function delay(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}
function asBytes(view) {
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}
export class RapooHidClient {
    device;
    /** The last unsolicited 0xBB status, which arrives about every three seconds. */
    notification = null;
    /**
     * The last battery answer from 0xAA - the only place the charge state is
     * readable. Kept across a status read so a frame lost to the lossy channel
     * does not blank the field.
     */
    battery = null;
    /**
     * The register map, walked once per session: five registers at four rounds
     * each is slow enough that repeating it on every status would hold up the
     * connect flow. The two values that change while the window is open - the
     * active DPI stage and the battery - are re-read every time instead.
     */
    registers = null;
    /** When the walk last ran, so a silent mouse is retried and not re-walked. */
    lastSweepAt = 0;
    /**
     * Status reads are serialized the way every driver here does it. The app can
     * ask for a status from its refresh timer while another read is in flight,
     * and two interleaved exchanges would pair one command's answer with
     * another's.
     */
    queue = Promise.resolve();
    listening = false;
    constructor(device) {
        this.device = device;
    }
    static isSupported(device) {
        const search = (collection) => (collection.usagePage === RAPOO_CONFIG_USAGE_PAGE
            && collection.usage === RAPOO_CONFIG_USAGE)
            || collection.children.some(search);
        return device.vendorId === RAPOO_VENDOR_ID
            && RAPOO_PRODUCT_IDS.has(device.productId)
            && device.collections.some(search);
    }
    nativeTransport() {
        const candidate = this.device;
        return typeof candidate.receiveInputReport === "function"
            ? candidate
            : null;
    }
    onInputReport = (event) => {
        if (event.reportId !== RAPOO_NOTIFY_REPORT_ID)
            return;
        const notification = decodeRapooNotification(asBytes(event.data));
        if (notification)
            this.notification = notification;
    };
    async open() {
        if (!RapooHidClient.isSupported(this.device)) {
            throw new Error("The Rapoo configuration collection is unavailable.");
        }
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
    /** Nothing is writable yet, so there is no range to offer. */
    getDpiOptions() {
        return [];
    }
    getPollingRateOptions() {
        return [];
    }
    async readStatus() {
        const next = this.queue.then(() => this.readStatusNow(), () => this.readStatusNow());
        this.queue = next.catch(() => undefined);
        return next;
    }
    async readStatusNow() {
        await this.open();
        const native = this.nativeTransport();
        const wireless = this.device.productId === RAPOO_WIRELESS_PRODUCT_ID;
        // Feature reports work while the mouse is idle, and are the only Rapoo
        // read a browser can perform, so this one is always tried.
        const featureBattery = await this.readFeatureBattery();
        if (native) {
            if (!this.registers && Date.now() - this.lastSweepAt >= SWEEP_RETRY_MS) {
                this.lastSweepAt = Date.now();
                this.registers = await this.readRegisters(native);
            }
            // The battery query rides the same channel as the register walk, so it is
            // only worth asking when that walk found the mouse awake.
            if (this.registers)
                this.battery = await this.readBattery(native) ?? this.battery;
        }
        else {
            this.registers = null;
            this.battery = null;
        }
        const registers = this.registers;
        const liveStage = native && registers ? await this.readActiveStage(native) : null;
        const table = registers?.dpi ?? null;
        const stageIndex = liveStage ?? registers?.activeStage ?? null;
        const dpi = table && stageIndex !== null ? table.stages[stageIndex] ?? 0 : 0;
        const performance = registers?.performance ?? null;
        const pollingRateHz = (wireless ? performance?.receiverHz : performance?.wiredHz) ?? 0;
        const percent = this.battery?.percent
            ?? featureBattery
            ?? this.notification?.batteryPercent
            ?? null;
        const batteryState = this.battery
            ? this.battery.charging ? "Charging" : "Discharging"
            : "Unknown";
        // The 0xBB link byte is the live answer; the product id is the fallback,
        // because the byte has only ever been seen as 0x01 (receiver).
        const linked = this.notification ? rapooLinkConnection(this.notification.linkCode) : null;
        const connectionType = linked ?? (wireless ? "Wireless" : "Wired");
        return {
            brand: "Rapoo",
            name: this.device.productName?.trim() || "Rapoo Mouse",
            ui: {
                family: "rapoo",
                settingsReady: false,
                valuesVerified: registers !== null,
                pollingReadOnly: true,
                hideProcessingCard: true,
                hideSignalCard: true,
                hideSleepCard: true,
                forceShowBattery: true,
                defaultDisplayName: "Rapoo Mouse",
                statusNote: this.statusNote(registers !== null, native !== null),
            },
            batteryPercent: percent,
            batteryState,
            dpi,
            ...(table ? {
                dpiStages: table.stages.slice(0, table.enabledStages),
            } : {}),
            ...(table && stageIndex !== null ? { activeDpiStage: stageIndex } : {}),
            pollingRateHz,
            activeProfile: null,
            // The stored lift-off selector is read, but the scale it indexes is not
            // established for this mouse, so no Low/Medium/High claim is made.
            liftOffDistance: null,
            ...(registers?.sensor ? { motionSync: registers.sensor.motionSync } : {}),
            ...(registers?.timing ? {
                // The mouse stores press and release separately; the shared field is
                // the press figure and the codec keeps both.
                debounceMs: registers.timing.pressDebounceMs,
                sleepTimeout: registers.timing.sleepMinutes * 60,
                angleSnapping: !registers.timing.angleSnapOff,
                rippleControl: !registers.timing.rippleOff,
            } : {}),
            connectionType,
            connectionDetail: connectionType === "Wireless" ? "2.4 GHz receiver" : "USB",
            firmware: [],
        };
    }
    statusNote(readable, native) {
        if (readable) {
            return "Settings are read through OpenMouse Bridge. This driver does not write to the mouse yet.";
        }
        if (native) {
            return "The mouse did not answer its register channel. Move it to wake it up and reconnect.";
        }
        return "Read-only in the browser: reading Rapoo's registers needs GET_REPORT(Input), which WebHID does not have, so only the battery is available. OpenMouse Bridge adds it and unlocks DPI, polling rate and the sensor settings.";
    }
    /** One more read of the live DPI stage, so a stage change is picked up. */
    async readActiveStage(native) {
        const block = await this.readBlock(native, RAPOO_ADDRESS.activeStage, 4);
        return block ? decodeRapooActiveStage(block) : null;
    }
    async readRegisters(native) {
        let answered = 0;
        let silent = 0;
        const blocks = new Map();
        const read = async (address) => {
            const block = await this.readBlock(native, address, RAPOO_BLOCK_LENGTH[address]);
            if (block) {
                answered += 1;
                silent = 0;
            }
            else {
                silent += 1;
            }
            if (block)
                blocks.set(address, block);
            return block;
        };
        const addresses = [
            RAPOO_ADDRESS.performance,
            RAPOO_ADDRESS.sensor,
            RAPOO_ADDRESS.dpiX,
            RAPOO_ADDRESS.activeStage,
            RAPOO_ADDRESS.timing,
        ];
        await read(addresses[0]);
        for (const address of addresses.slice(1)) {
            if (silent < BLOCK_FAILURES_BEFORE_SLEEPING)
                await read(address);
        }
        // A mouse that answered nothing is asleep or out of range; saying so beats
        // reporting five null fields as if the registers did not exist.
        if (answered === 0)
            return null;
        // The first frames of a walk are the ones a mouse that was asleep a moment
        // ago loses: on the cable, one cold walk came back with the polling rate
        // missing and the three walks after it read it. One more pass over whatever
        // is still empty costs a healthy mouse nothing - it is only reached while
        // the mouse is answering, and every read here is idempotent - and turns
        // that gap into a value instead of a zero.
        for (const address of addresses) {
            if (!blocks.has(address))
                await read(address);
        }
        const performance = blocks.get(RAPOO_ADDRESS.performance) ?? null;
        const sensor = blocks.get(RAPOO_ADDRESS.sensor) ?? null;
        const dpi = blocks.get(RAPOO_ADDRESS.dpiX) ?? null;
        const activeStage = blocks.get(RAPOO_ADDRESS.activeStage) ?? null;
        const timing = blocks.get(RAPOO_ADDRESS.timing) ?? null;
        return {
            performance: performance ? decodeRapooPerformance(performance) : null,
            sensor: sensor ? decodeRapooSensor(sensor) : null,
            dpi: dpi ? decodeRapooDpiTable(dpi) : null,
            activeStage: activeStage ? decodeRapooActiveStage(activeStage) : null,
            timing: timing ? decodeRapooTiming(timing) : null,
        };
    }
    /**
     * Read one register block, resending the frame until the device answers.
     *
     * Reads are idempotent, so a resend costs nothing but time; the alternative -
     * treating the first silence as "the register does not exist" - is what makes
     * a lossy channel look like a missing feature.
     */
    async readBlock(native, address, length) {
        const frame = encodeRapooRead(address, length);
        for (let round = 0; round < BLOCK_ROUNDS; round += 1) {
            if (round > 0)
                await delay(BLOCK_GAP_MS);
            const answer = await this.exchange(native, frame);
            const block = answer ? rapooAnswerBlock(answer, length) : null;
            if (block)
                return block;
        }
        return null;
    }
    /**
     * Send one frame and wait for the busy -> OK handshake.
     *
     * The input report holds the previous answer until the receiver picks the
     * frame up, so an OK that arrives without a busy in between belongs to the
     * command before this one and must not be handed back as data. Nothing
     * arrives at all for a dropped frame, so the wait is bounded and the frame is
     * sent again.
     */
    async exchange(native, frame) {
        for (let attempt = 0; attempt < EXCHANGE_ATTEMPTS; attempt += 1) {
            if (attempt > 0)
                await delay(EXCHANGE_RETRY_MS);
            try {
                await this.device.sendReport(RAPOO_CONFIG_REPORT_ID, frame.buffer);
            }
            catch {
                continue;
            }
            const sent = Date.now();
            let busy = false;
            // Busy shows up within a few milliseconds and the fresh answer follows it
            // across the radio round trip. A frame that has neither by 120 ms was
            // dropped, whatever the transport is doing in the meantime.
            while (Date.now() - sent < EXCHANGE_ACCEPT_MS) {
                const raw = await this.getInputReport(native);
                const answer = raw ? decodeRapooAnswer(raw) : null;
                if (answer) {
                    if (!answer.ok) {
                        busy = true;
                    }
                    else if (busy) {
                        return answer;
                    }
                }
                await delay(EXCHANGE_POLL_MS);
            }
        }
        return null;
    }
    /**
     * The `0xAA` battery query. Its answer is marked by a non-zero byte 1 rather
     * than by the handshake, so each send is followed by a short poll for the
     * marker instead of the busy -> OK wait.
     */
    async readBattery(native) {
        const frame = encodeRapooBatteryQuery();
        for (let round = 0; round < BATTERY_ROUNDS; round += 1) {
            try {
                await this.device.sendReport(RAPOO_CONFIG_REPORT_ID, frame.buffer);
            }
            catch {
                return null;
            }
            for (let poll = 0; poll < BATTERY_POLLS; poll += 1) {
                const raw = await this.getInputReport(native);
                const answer = raw ? decodeRapooAnswer(raw) : null;
                const battery = answer ? decodeRapooBatteryAnswer(answer) : null;
                if (battery)
                    return battery;
                await delay(BATTERY_POLL_MS);
            }
        }
        return null;
    }
    async getInputReport(native) {
        try {
            return asBytes(await native.receiveInputReport(RAPOO_CONFIG_REPORT_ID));
        }
        catch {
            // A transport with nothing buffered throws. That is a "not yet", not a
            // reason to abandon the exchange.
            return null;
        }
    }
    /** The battery out of the 0x2A feature block, or null when it will not read. */
    async readFeatureBattery() {
        try {
            const view = await this.device.receiveFeatureReport(RAPOO_STATUS_REPORT_ID);
            return rapooStatusBatteryPercent(asBytes(view));
        }
        catch {
            return null;
        }
    }
}
