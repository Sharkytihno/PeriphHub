import { RAWM_DEVICES, RAWM_PRODUCT_IDS, RAWM_REPORT_ID, RAWM_USAGE, RAWM_USAGE_PAGE, RAWM_VENDOR_ID, buildRawmMouseParams, buildRawmQuery, buildRawmSleepCommand, frameRawmEvent, frameRawmEvents, parseRawmQueryResult, rawmEventPayload, } from "../../rawm/index.js";
const QUERY_TIMEOUT_MS = 1_500;
const WRITE_CHUNK_DELAY_MS = 25;
const WRITE_SETTLE_MS = 100;
const delay = (milliseconds) => new Promise((resolve) => { setTimeout(resolve, milliseconds); });
const signedByte = (value) => {
    const byte = value & 0xff;
    return byte >= 0x80 ? byte - 0x100 : byte;
};
export class RawmHidClient {
    device;
    stream = new Uint8Array();
    pending = null;
    onInputReport = (event) => {
        if (event.reportId !== RAWM_REPORT_ID)
            return;
        const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
        const payload = rawmEventPayload(bytes, RAWM_DEVICES.get(this.device.productId)?.receiver ? 0 : undefined);
        if (!payload)
            return;
        const combined = new Uint8Array(this.stream.length + payload.length);
        combined.set(this.stream);
        combined.set(payload, this.stream.length);
        this.stream = combined;
        try {
            const identity = parseRawmQueryResult(this.stream);
            if (!identity || !this.pending)
                return;
            clearTimeout(this.pending.timer);
            const { resolve } = this.pending;
            this.pending = null;
            this.stream = new Uint8Array();
            resolve(identity);
        }
        catch { /* A JSON result can span several input reports. */ }
    };
    constructor(device) { this.device = device; }
    getDpiOptions() {
        const values = [];
        for (let dpi = 50; dpi <= 42_000; dpi += 50)
            values.push(dpi);
        return values;
    }
    static isSupported(device) {
        if (device.vendorId !== RAWM_VENDOR_ID || !RAWM_PRODUCT_IDS.has(device.productId))
            return false;
        return device.collections.some((collection) => collection.usagePage === RAWM_USAGE_PAGE
            && collection.usage === RAWM_USAGE
            && collection.inputReports.some((report) => report.reportId === RAWM_REPORT_ID)
            && collection.outputReports.some((report) => report.reportId === RAWM_REPORT_ID));
    }
    async open() {
        if (!this.device.opened)
            await this.device.open();
        this.device.removeEventListener("inputreport", this.onInputReport);
        this.device.addEventListener("inputreport", this.onInputReport);
    }
    async close() {
        this.device.removeEventListener("inputreport", this.onInputReport);
        this.fail(new Error("The RAWM device was closed."));
        if (this.device.opened)
            await this.device.close();
    }
    async readStatus() {
        const identity = await this.query();
        const definition = RAWM_DEVICES.get(this.device.productId);
        const wireless = definition.receiver || identity.wired === false;
        const packedDpi = identity.dpi ?? 0;
        const dpi = (packedDpi & 0xffff) || (identity.dpiLevels?.find((value) => value > 0) ?? 0);
        return {
            brand: "RAWM",
            name: identity.deviceName || definition.name,
            ui: { family: "rawm", defaultDisplayName: definition.name, settingsReady: definition.verified === true, valuesVerified: definition.verified === true, hideUnsupportedPollingRates: true, showAdvancedSection: true },
            batteryPercent: identity.battery ?? null,
            batteryState: identity.charging ? "Charging" : wireless ? "Discharging" : "Unknown",
            dpi,
            dpiY: packedDpi > 0xffff ? packedDpi >>> 16 : undefined,
            supportsSeparateDpiAxes: packedDpi > 0xffff,
            dpiStages: identity.dpiLevels?.filter((value) => value > 0).map((value) => value & 0xffff),
            pollingRateHz: identity.pollingRate ?? 0,
            supportedPollingRates: [125, 250, 500, 1000, 2000, 4000, 8000],
            activeProfile: 1,
            connectionType: wireless ? "Wireless" : "Wired",
            connectionDetail: definition.receiver ? "2.4 GHz receiver" : "USB",
            motionSync: identity.motionSync ?? null,
            angleSnapping: identity.angleSnapping ?? null,
            rippleControl: identity.rippleControl ?? null,
            performanceMode: identity.powerMode === undefined ? null : identity.powerMode >= 2,
            angleTuning: identity.angleTuning === undefined ? null : signedByte(identity.angleTuning),
            debounceMs: identity.keyDelay?.[0] ?? null,
            sleepTimeout: identity.sleepTime ?? null,
            liftOffDistance: identity.lod === undefined ? null : identity.lod <= 1 ? "Low" : "High",
            firmware: [identity.revision, identity.sensor].filter((value) => Boolean(value)),
        };
    }
    async setDpi(dpi, dpiY = dpi) {
        if (!Number.isInteger(dpi) || !Number.isInteger(dpiY) || dpi < 50 || dpi > 42_000 || dpiY < 50 || dpiY > 42_000) {
            throw new RangeError("RAWM DPI must be from 50 to 42000.");
        }
        const packed = dpi === dpiY ? dpi : ((dpi & 0xffff) | ((dpiY & 0xffff) << 16)) >>> 0;
        const after = await this.updateParams((identity) => { identity.dpi = packed; });
        if (after.dpi !== packed)
            throw new Error("RAWM did not confirm the requested DPI.");
        return (after.dpi ?? 0) & 0xffff;
    }
    async setPollingRate(pollingRateHz) {
        if (![125, 250, 500, 1000, 2000, 4000, 8000].includes(pollingRateHz))
            throw new RangeError("Unsupported RAWM polling rate.");
        const after = await this.updateParams((identity) => { identity.pollingRate = pollingRateHz; });
        if (after.pollingRate !== pollingRateHz)
            throw new Error("RAWM did not confirm the requested polling rate.");
        return after.pollingRate ?? pollingRateHz;
    }
    async setLiftOffDistance(value) {
        if (value !== "Low" && value !== "High")
            throw new RangeError("RAWM supports Low or High lift-off distance.");
        const after = await this.updateParams((identity) => { identity.lod = value === "Low" ? 1 : 2; });
        const confirmed = (after.lod ?? 1) <= 1 ? "Low" : "High";
        if (confirmed !== value)
            throw new Error("RAWM did not confirm the requested lift-off distance.");
        return confirmed;
    }
    async setMotionSync(enabled) { return this.setBoolean("motionSync", enabled); }
    async setAngleSnapping(enabled) { return this.setBoolean("angleSnapping", enabled); }
    async setRippleControl(enabled) { return this.setBoolean("rippleControl", enabled); }
    async setPerformanceMode(enabled) {
        const after = await this.updateParams((identity) => { identity.powerMode = enabled ? 2 : 1; });
        const confirmed = (after.powerMode ?? 0) >= 2;
        if (confirmed !== enabled)
            throw new Error("RAWM did not confirm the requested performance mode.");
        return confirmed;
    }
    async setAngleTuning(degrees) {
        if (!Number.isInteger(degrees) || degrees < -30 || degrees > 30)
            throw new RangeError("RAWM angle tuning must be from -30 to 30 degrees.");
        const after = await this.updateParams((identity) => { identity.angleTuning = degrees; });
        const confirmed = after.angleTuning === undefined ? undefined : signedByte(after.angleTuning);
        if (confirmed !== degrees)
            throw new Error("RAWM did not confirm the requested angle tuning.");
        return confirmed;
    }
    async setDebounceTime(milliseconds) {
        if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 255)
            throw new RangeError("RAWM debounce must fit in one byte.");
        const after = await this.updateParams((identity) => {
            identity.keyDelay = identity.keyDelay.map(() => milliseconds);
        });
        if (after.keyDelay?.[0] !== milliseconds)
            throw new Error("RAWM did not confirm the requested debounce time.");
        return after.keyDelay?.[0] ?? milliseconds;
    }
    async setSleepTimeout(seconds) {
        const before = await this.query();
        await this.sendCommand(buildRawmSleepCommand(seconds, before.crcSupported === true));
        await delay(WRITE_SETTLE_MS);
        const after = await this.query();
        if (after.sleepTime !== seconds)
            throw new Error("RAWM did not confirm the requested sleep timeout.");
        return after.sleepTime ?? seconds;
    }
    async setBoolean(field, enabled) {
        const after = await this.updateParams((identity) => { identity[field] = enabled; });
        if (after[field] !== enabled)
            throw new Error(`RAWM did not confirm ${field}.`);
        return after[field];
    }
    async updateParams(change) {
        const identity = await this.query();
        change(identity);
        await this.sendCommand(buildRawmMouseParams(identity));
        await delay(WRITE_SETTLE_MS);
        return this.query();
    }
    async sendCommand(command) {
        await this.open();
        const receiver = RAWM_DEVICES.get(this.device.productId).receiver;
        const frames = frameRawmEvents(command, receiver ? 0 : undefined);
        for (const [index, frame] of frames.entries()) {
            await this.device.sendReport(RAWM_REPORT_ID, frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
            if (index + 1 < frames.length)
                await delay(WRITE_CHUNK_DELAY_MS);
        }
    }
    async query() {
        await this.open();
        this.fail(new Error("A newer RAWM status query replaced the previous one."));
        this.stream = new Uint8Array();
        const receiver = RAWM_DEVICES.get(this.device.productId).receiver;
        const result = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pending?.timer !== timer)
                    return;
                this.pending = null;
                reject(new Error("RAWM did not answer the status query."));
            }, QUERY_TIMEOUT_MS);
            this.pending = { resolve, reject, timer };
        });
        const framed = frameRawmEvent(buildRawmQuery(), receiver ? 0 : undefined);
        await this.device.sendReport(RAWM_REPORT_ID, framed.buffer.slice(framed.byteOffset, framed.byteOffset + framed.byteLength));
        return await result;
    }
    fail(error) {
        if (!this.pending)
            return;
        clearTimeout(this.pending.timer);
        this.pending.reject(error);
        this.pending = null;
    }
}
