import { AEROX3_WIRELESS_GEN2_DEFAULT_DPI_PRESETS, AEROX3_WIRELESS_GEN2_DEFAULT_POLLING_RATE, AEROX3_WIRELESS_GEN2_MAX_DPI_PRESETS, AEROX3_WIRELESS_GEN2_POLLING_RATES, AEROX3_WIRELESS_GEN2_REPORT_ID, STEELSERIES_PRODUCTS, STEELSERIES_VENDOR_ID, steelseriesAerox3WirelessGen2BatteryQuery, steelseriesAerox3WirelessGen2DecodeBattery, steelseriesAerox3WirelessGen2DecodeFirmware, steelseriesAerox3WirelessGen2DpiOptions, steelseriesAerox3WirelessGen2EncodeButtonsMapping, steelseriesAerox3WirelessGen2EncodeDpiPresets, steelseriesAerox3WirelessGen2EncodePollingRateSingle, steelseriesAerox3WirelessGen2FirmwareQuery, steelseriesAerox3WirelessGen2SaveCommand, } from "../../steelseries/index.js";
/** Vendor profile default delay between a write and its save. */
const COMMAND_DELAY_MS = 50;
/** Battery/firmware replies are small; allow slack over profile timeouts. */
const RESPONSE_TIMEOUT_MS = 500;
/** Lift-off distance written with DPI presets; the specification states no default. */
const DEFAULT_LIFT_OFF_DISTANCE = 0;
/**
 * SteelSeries Aerox 3 Wireless Gen 2 WebHID control (wired mode `1038:1892`,
 * 2.4 GHz dongle mode `1038:1890`).
 *
 * DPI presets, polling rate, and buttons are write-only, but unlike Gen 1
 * this mouse IS partially readable: `battery_level` (`92`) reports charge
 * level, and `firmware_version` (`90 00`) reports the version string, both
 * via input-report replies. `readStatus` uses the battery query as its
 * connectivity probe (the value most worth reading live for a wireless
 * mouse) and also reads firmware; DPI and polling rate remain the
 * session's last-written values (or documented defaults before any write),
 * with `valuesVerified: false` reflecting that those two specific values
 * are still unread. See `../../steelseries/aerox-3-wireless-gen2.ts` for
 * the full protocol writeup — reconstructed from the vendor's GG device
 * specification. Do not confuse this mouse with Gen 1 (`1038:183A`/
 * `1038:1838`, a different command set).
 *
 * The config channel is the usage page `0xFFC0` collection; its WebHID
 * shape has not been captured, so the picker offers every interface and
 * the wrong ones fail the battery probe loudly.
 */
export class SteelSeriesAerox3WirelessGen2HidClient {
    device;
    queue = Promise.resolve();
    listenerAttached = false;
    inputWaiters = new Set();
    wireless;
    dpiStages = AEROX3_WIRELESS_GEN2_DEFAULT_DPI_PRESETS.map((dpi) => ({
        x: dpi,
        y: dpi,
        liftOffDistance: DEFAULT_LIFT_OFF_DISTANCE,
    }));
    activeDpiStage = 0;
    pollingRateHz = AEROX3_WIRELESS_GEN2_DEFAULT_POLLING_RATE;
    onInputReport = (event) => {
        const payload = new Uint8Array(event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength));
        for (const finish of [...this.inputWaiters])
            finish(payload);
    };
    constructor(device) {
        this.device = device;
        this.wireless = device.productId !== 0x1892;
    }
    static isSupported(device) {
        if (device.vendorId !== STEELSERIES_VENDOR_ID)
            return false;
        return STEELSERIES_PRODUCTS.get(device.productId)?.family === "aerox3-wireless-gen2";
    }
    get pollIntervalMs() { return 30_000; }
    get supportedPollingRates() { return [...AEROX3_WIRELESS_GEN2_POLLING_RATES]; }
    getDpiOptions() { return steelseriesAerox3WirelessGen2DpiOptions(); }
    async open() {
        if (!this.device.opened)
            await this.device.open();
        if (!this.listenerAttached) {
            this.device.addEventListener("inputreport", this.onInputReport);
            this.listenerAttached = true;
        }
    }
    async close() {
        if (this.listenerAttached) {
            this.device.removeEventListener("inputreport", this.onInputReport);
            this.listenerAttached = false;
        }
        if (this.device.opened)
            await this.device.close();
    }
    async readStatus() {
        return await this.run(async () => {
            await this.open();
            const battery = await this.probeBattery();
            const firmware = await this.probeFirmware();
            const product = STEELSERIES_PRODUCTS.get(this.device.productId);
            const name = this.device.productName?.trim() || `SteelSeries ${product?.model ?? "Aerox 3 Wireless Gen 2"}`;
            const active = this.dpiStages[this.activeDpiStage];
            return {
                brand: "SteelSeries",
                name,
                ui: {
                    family: "steelseries-aerox3-wireless-gen2",
                    settingsReady: true,
                    valuesVerified: false,
                    hideUnsupportedPollingRates: true,
                    hideProcessingCard: true,
                    pollingNote: "The Aerox 3 Wireless Gen 2 cannot report its current DPI or polling rate; values shown are the last written by this app, or assumed defaults.",
                    defaultDisplayName: "SteelSeries Aerox 3 Wireless Gen 2",
                },
                batteryPercent: battery.level,
                batteryState: "Unknown",
                dpi: active?.x ?? AEROX3_WIRELESS_GEN2_DEFAULT_DPI_PRESETS[0],
                pollingRateHz: this.pollingRateHz,
                supportedPollingRates: this.supportedPollingRates,
                activeProfile: null,
                connectionType: "Wireless",
                liftOffDistance: null,
                firmware: [firmware],
            };
        });
    }
    /** writes `dpi` into both axes of the active stage. */
    async setDpi(dpi) {
        await this.setDpiStageValue(this.activeDpiStage, { x: dpi, y: dpi, liftOffDistance: DEFAULT_LIFT_OFF_DISTANCE });
        return dpi;
    }
    async setDpiStageValue(stage, preset) {
        this.requireStage(stage);
        const stages = this.dpiStages.map((value, index) => (index === stage ? preset : value));
        await this.writePresets(stages, this.activeDpiStage);
        return preset;
    }
    async setActiveDpiStage(stage) {
        this.requireStage(stage);
        await this.writePresets(this.dpiStages, stage);
        return stage;
    }
    async setDpiStages(stages, activeStage = 0) {
        await this.writePresets(stages, activeStage);
    }
    async setPollingRate(pollingRateHz) {
        await this.commit(steelseriesAerox3WirelessGen2EncodePollingRateSingle(pollingRateHz, this.wireless));
        this.pollingRateHz = pollingRateHz;
        return pollingRateHz;
    }
    async setButtonsMapping(mapping) {
        await this.commit(steelseriesAerox3WirelessGen2EncodeButtonsMapping(mapping, this.wireless));
    }
    /**
     * `92` — battery level. Doubles as the proof that the granted interface
     * is the config channel. The status byte's encoding is undocumented, so
     * charging state stays unknown.
     */
    async probeBattery() {
        const payload = await this.awaitResponse(steelseriesAerox3WirelessGen2BatteryQuery(this.wireless));
        if (!payload) {
            throw new Error("The Aerox 3 Wireless Gen 2 did not answer on this interface. Close SteelSeries GG (and the SteelSeriesEngine service); if it still does not answer, add the device again and choose another entry.");
        }
        return steelseriesAerox3WirelessGen2DecodeBattery(payload);
    }
    /** `90 00` — firmware version string, read the same way. */
    async probeFirmware() {
        const payload = await this.awaitResponse(steelseriesAerox3WirelessGen2FirmwareQuery(this.wireless));
        if (!payload) {
            throw new Error("The Aerox 3 Wireless Gen 2 did not answer the firmware query on this interface.");
        }
        return steelseriesAerox3WirelessGen2DecodeFirmware(payload);
    }
    async awaitResponse(query) {
        const response = new Promise((resolve) => {
            let timer;
            const finish = (payload) => {
                clearTimeout(timer);
                this.inputWaiters.delete(finish);
                resolve(payload);
            };
            timer = setTimeout(() => finish(null), RESPONSE_TIMEOUT_MS);
            this.inputWaiters.add(finish);
        });
        await this.write(query);
        return await response;
    }
    requireStage(stage) {
        if (!Number.isInteger(stage) || stage < 0 || stage >= AEROX3_WIRELESS_GEN2_MAX_DPI_PRESETS) {
            throw new Error(`The Aerox 3 Wireless Gen 2 holds ${AEROX3_WIRELESS_GEN2_MAX_DPI_PRESETS} DPI stages.`);
        }
    }
    async writePresets(stages, activeStage) {
        this.requireStage(activeStage);
        const report = steelseriesAerox3WirelessGen2EncodeDpiPresets(stages, activeStage, this.wireless);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesAerox3WirelessGen2SaveCommand(this.wireless));
            this.dpiStages = [...stages];
            this.activeDpiStage = activeStage;
        });
    }
    async commit(report) {
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesAerox3WirelessGen2SaveCommand(this.wireless));
        });
    }
    async write(payload) {
        await this.device.sendReport(AEROX3_WIRELESS_GEN2_REPORT_ID, payload.buffer);
    }
    delay(milliseconds) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }
    async run(operation) {
        const result = this.queue.then(operation, operation);
        this.queue = result.then(() => undefined, () => undefined);
        return await result;
    }
}
