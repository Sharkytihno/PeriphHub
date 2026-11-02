import { VGN_ADDRESS, VGN_COMMAND, VGN_REPORT_ID, vgnBuildReadPayload, vgnBuildSimplePayload, vgnBuildWritePayload, vgnBuildWriteScalarPayload, vgnDecodeProfile, vgnEncodeDpi, vgnEncodePollingRate, vgnParseBattery, vgnParseReadResponse, vgnReportChecksumIsValid, } from "../../vgn/index.js";
import { TEEVOLUTION_SHARED_BUTTON_OPTIONS, teevolutionDecodeButtonMappings, teevolutionReadKeyTable, teevolutionRemapButton, } from "../../teevolution/index.js";
const VGN_VENDOR_ID = 0x3554;
const VGN_RECEIVER_PID = 0xfb56;
const VGN_WIRED_PID = 0xfb57;
const RESPONSE_TIMEOUT_MS = 700;
const SUPPORTED_POLLING_RATES = [125, 250, 500, 1000, 2000, 4000, 8000];
export class VgnF2HidClient {
    device;
    waiter = null;
    onInputReport = (event) => {
        if (event.reportId !== VGN_REPORT_ID)
            return;
        const response = new Uint8Array(event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength));
        const waiter = this.waiter;
        if (!waiter || response[0] !== waiter.command)
            return;
        window.clearTimeout(waiter.timer);
        this.waiter = null;
        waiter.resolve(response);
    };
    constructor(device) {
        this.device = device;
    }
    static isSupported(device) {
        if (device.vendorId !== VGN_VENDOR_ID)
            return false;
        if (device.productId !== VGN_RECEIVER_PID && device.productId !== VGN_WIRED_PID)
            return false;
        return device.collections.some((collection) => collection.usagePage === 0xff02
            && collection.inputReports.some((report) => report.reportId === VGN_REPORT_ID && this.reportLength(report) === 16)
            && collection.outputReports.some((report) => report.reportId === VGN_REPORT_ID && this.reportLength(report) === 16));
    }
    get pollIntervalMs() {
        return this.isWirelessPath() ? 10_000 : 30_000;
    }
    isWirelessPath() {
        return this.device.productId === VGN_RECEIVER_PID;
    }
    getDpiOptions() {
        const values = [];
        for (let dpi = 50; dpi <= 26_000; dpi += 50)
            values.push(dpi);
        return values;
    }
    async open() {
        if (!this.device.opened)
            await this.device.open();
        this.device.removeEventListener("inputreport", this.onInputReport);
        this.device.addEventListener("inputreport", this.onInputReport);
    }
    async readStatus() {
        await this.open();
        const batteryResponse = await this.transact(vgnBuildSimplePayload(VGN_COMMAND.battery));
        const firmwareResponse = await this.transact(vgnBuildSimplePayload(VGN_COMMAND.firmware));
        const profile = await this.readProfile();
        // Optional: a mouse that will not read its key table keeps the rest of its status.
        const keys = await teevolutionReadKeyTable((address, length) => this.readPaced(address, length)).catch(() => null);
        const battery = vgnParseBattery(batteryResponse);
        const settings = vgnDecodeProfile(profile);
        const firmware = this.version(firmwareResponse);
        const wireless = this.isWirelessPath();
        return {
            brand: "VGN",
            name: "VGN Dragonfly F2 Master+",
            batteryPercent: battery?.percent ?? null,
            batteryVoltageMv: battery?.voltageMv ?? null,
            batteryState: battery
                ? battery.charging ? (battery.percent >= 99 ? "Full" : "Charging") : "Discharging"
                : "Unknown",
            dpi: settings.dpi,
            pollingRateHz: settings.pollingRateHz,
            supportedPollingRates: SUPPORTED_POLLING_RATES,
            activeProfile: null,
            connectionType: wireless ? "Wireless" : "Wired",
            connectionDetail: wireless ? "2.4 GHz receiver · 8K protocol" : "USB · 8K protocol",
            motionSync: settings.motionSync,
            debounceMs: settings.debounceMs,
            sleepTimeout: settings.sleepTimeout === null ? null : settings.sleepTimeout / 10,
            angleSnapping: settings.angleSnapping,
            rippleControl: settings.rippleControl,
            performanceMode: settings.performanceMode,
            liftOffDistance: settings.liftOffDistance,
            ...(keys ? { buttonMappings: teevolutionDecodeButtonMappings(keys, 0), buttonOptions: TEEVOLUTION_SHARED_BUTTON_OPTIONS } : {}),
            firmware: firmware ? [`Mouse ${firmware}`] : [],
            ui: {
                family: "vgn-f2",
                hideUnsupportedPollingRates: true,
                forceShowBattery: true,
                pollingNote: "F2 Master+ supports 125 Hz through 8,000 Hz over its captured 8K protocol.",
                defaultDisplayName: "VGN Dragonfly F2 Master+",
            },
        };
    }
    async setDpi(dpi) {
        const profile = vgnDecodeProfile(await this.readProfile());
        const address = VGN_ADDRESS.dpiStages + profile.activeDpiStage * 4;
        await this.write(address, [...vgnEncodeDpi(dpi)]);
        const confirmed = vgnDecodeProfile(await this.readProfile()).dpi;
        if (confirmed !== dpi)
            throw new Error(`The VGN mouse kept ${confirmed} DPI instead of ${dpi} DPI.`);
        return confirmed;
    }
    async setPollingRate(rate) {
        await this.writeScalar(VGN_ADDRESS.pollingRate, vgnEncodePollingRate(rate));
        const confirmed = vgnDecodeProfile(await this.readProfile()).pollingRateHz;
        if (confirmed !== rate)
            throw new Error(`The VGN mouse kept ${confirmed} Hz instead of ${rate} Hz.`);
        return confirmed;
    }
    async setLiftOffDistance(value) {
        const raw = value === "Low" ? 3 : value === "Medium" ? 1 : 2;
        await this.writeScalar(VGN_ADDRESS.lod, raw);
        const confirmed = vgnDecodeProfile(await this.readProfile()).liftOffDistance;
        if (confirmed !== value)
            throw new Error(`The VGN mouse kept ${confirmed ?? "unknown"} LOD instead of ${value}.`);
        return confirmed;
    }
    async setMotionSync(enabled) { return this.setBoolean(VGN_ADDRESS.motionSync, enabled); }
    async setAngleSnapping(enabled) { return this.setBoolean(VGN_ADDRESS.angleSnapping, enabled); }
    async setRippleControl(enabled) { return this.setBoolean(VGN_ADDRESS.rippleControl, enabled); }
    async setPerformanceMode(enabled) { return this.setBoolean(VGN_ADDRESS.performanceMode, enabled); }
    async setDebounceTime(value) {
        if (!Number.isInteger(value) || value < 0 || value > 30)
            throw new Error("VGN debounce must be 0–30 ms.");
        await this.writeScalar(VGN_ADDRESS.debounce, value);
        return value;
    }
    async setSleepTimeout(value) {
        if (![1, 3, 6, 12, 30, 60, 180].includes(value))
            throw new Error("VGN sleep timeout is not supported.");
        await this.writeScalar(VGN_ADDRESS.sleep, value);
        return value;
    }
    /**
     * Same key table as Teevolution and G-Wolves: six 4-byte records at 0x60.
     *
     * ponytail: G-Wolves' web driver writes this exact table on the same
     * reference design, but nobody has captured VGN's own software doing it.
     */
    async setButtonMapping(button, action) {
        await teevolutionRemapButton((address, length) => this.readPaced(address, length), (address, data) => this.write(address, [...data]), button, action, { actions: TEEVOLUTION_SHARED_BUTTON_OPTIONS });
    }
    async close() {
        this.failWaiter(new Error("The VGN device was closed."));
        this.device.removeEventListener("inputreport", this.onInputReport);
        if (this.device.opened)
            await this.device.close();
    }
    async setBoolean(address, enabled) {
        await this.writeScalar(address, enabled ? 1 : 0);
        return enabled;
    }
    async readProfile() {
        const profile = new Uint8Array(0xb7);
        for (const [start, end] of [[0, 0x2c], [0xa8, 0xb7]]) {
            for (let address = start; address < end; address += 10) {
                const length = Math.min(10, end - address);
                profile.set(await this.readPaced(address, length), address);
            }
        }
        return profile;
    }
    /** Spaces back-to-back reads on the receiver, as readProfile always has. */
    async readPaced(address, length) {
        const data = await this.read(address, length);
        if (this.isWirelessPath())
            await new Promise((resolve) => window.setTimeout(resolve, 10));
        return data;
    }
    async read(address, length) {
        const response = await this.transact(vgnBuildReadPayload(address, length));
        const data = vgnParseReadResponse(response, address, length);
        if (!data)
            throw new Error(`VGN flash read failed at 0x${address.toString(16)}.`);
        return data;
    }
    async writeScalar(address, value) {
        const response = await this.transact(vgnBuildWriteScalarPayload(address, value));
        if (!vgnReportChecksumIsValid(response) || response[0] !== VGN_COMMAND.write || response[1] !== 0) {
            throw new Error(`VGN flash write failed at 0x${address.toString(16)}.`);
        }
        const confirmed = await this.read(address, 2);
        if (confirmed[0] !== value || ((confirmed[0] + confirmed[1]) & 0xff) !== 0x55) {
            throw new Error(`The VGN mouse did not retain the value written at 0x${address.toString(16)}.`);
        }
    }
    async write(address, data) {
        const response = await this.transact(vgnBuildWritePayload(address, data));
        if (!vgnReportChecksumIsValid(response) || response[0] !== VGN_COMMAND.write || response[1] !== 0) {
            throw new Error(`VGN flash write failed at 0x${address.toString(16)}.`);
        }
    }
    async transact(payload) {
        await this.open();
        this.failWaiter(new Error("Superseded by another VGN request."));
        const command = payload[0];
        const response = new Promise((resolve, reject) => {
            const timer = window.setTimeout(() => {
                if (this.waiter?.resolve === resolve)
                    this.waiter = null;
                reject(new Error(`Timed out waiting for VGN command 0x${command.toString(16)}.`));
            }, RESPONSE_TIMEOUT_MS);
            this.waiter = { command, resolve, reject, timer };
        });
        try {
            await this.device.sendReport(VGN_REPORT_ID, new Uint8Array(payload).buffer);
        }
        catch (error) {
            this.failWaiter(error instanceof Error ? error : new Error(String(error)));
        }
        return response;
    }
    version(response) {
        if (!vgnReportChecksumIsValid(response) || response[0] !== VGN_COMMAND.firmware || response[1] !== 0)
            return null;
        return `v${response[5] ?? 0}.${(response[6] ?? 0).toString(16).padStart(2, "0")}`;
    }
    failWaiter(error) {
        const waiter = this.waiter;
        if (!waiter)
            return;
        window.clearTimeout(waiter.timer);
        this.waiter = null;
        waiter.reject(error);
    }
    static reportLength(report) {
        return report.items.reduce((sum, item) => sum + item.reportSize * item.reportCount, 0) / 8;
    }
}
