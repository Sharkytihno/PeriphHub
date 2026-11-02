import { RIVAL3_WIRELESS_V2_DEFAULT_DPI_PRESETS, RIVAL3_WIRELESS_V2_DEFAULT_POLLING_RATE, RIVAL3_WIRELESS_V2_MAX_DPI_PRESETS, RIVAL3_WIRELESS_V2_POLLING_RATES, RIVAL3_WIRELESS_V2_REPORT_ID, STEELSERIES_PRODUCTS, STEELSERIES_VENDOR_ID, steelseriesRival3WirelessV2DecodeBattery, steelseriesRival3WirelessV2DecodeFirmware, steelseriesRival3WirelessV2DpiOptions, steelseriesRival3WirelessV2BatteryQuery, steelseriesRival3WirelessV2EncodeButtonsMapping, steelseriesRival3WirelessV2EncodeDpiPresets, steelseriesRival3WirelessV2EncodePollingRate, steelseriesRival3WirelessV2EncodeWheelMapping, steelseriesRival3WirelessV2FirmwareQuery, steelseriesRival3WirelessV2SaveCommand, } from "../../steelseries/index.js";
/** Vendor profile default delay between a write and its save. */
const COMMAND_DELAY_MS = 50;
/** Battery/firmware replies are small; allow slack over profile timeouts. */
const RESPONSE_TIMEOUT_MS = 500;
/**
 * SteelSeries Rival 3 Wireless Gen 2 WebHID control (`1038:1872`, 2.4 GHz
 * mode).
 *
 * DPI presets, polling rate, and buttons are write-only, but unlike Gen 1
 * this mouse IS partially readable: `battery_level` (`AA 01`) reports a
 * two-byte charge level, and `firmware_version` (`10`) reports
 * major/minor bytes. `readStatus` uses the battery query as its
 * connectivity probe (the value most worth reading live for a wireless
 * mouse) and also reads firmware; DPI and polling rate remain the
 * session's last-written values (or documented defaults before any write),
 * with `valuesVerified: false` reflecting that those two specific values
 * are still unread. See `../../steelseries/rival-3-wireless-v2.ts` for the
 * full protocol writeup — reconstructed from the vendor's GG device
 * specification. Do not confuse this mouse with Gen 1 (`1038:1830`, a
 * different command set).
 *
 * The config channel shape has not been captured yet, so the picker offers
 * every interface and the wrong ones fail the battery probe loudly.
 */
export class SteelSeriesRival3WirelessV2HidClient {
    device;
    queue = Promise.resolve();
    listenerAttached = false;
    inputWaiters = new Set();
    dpiStages = RIVAL3_WIRELESS_V2_DEFAULT_DPI_PRESETS.map((dpi) => ({ x: dpi, y: dpi }));
    activeDpiStage = 0;
    pollingRateHz = RIVAL3_WIRELESS_V2_DEFAULT_POLLING_RATE;
    onInputReport = (event) => {
        const payload = new Uint8Array(event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength));
        for (const finish of [...this.inputWaiters])
            finish(payload);
    };
    constructor(device) {
        this.device = device;
    }
    static isSupported(device) {
        if (device.vendorId !== STEELSERIES_VENDOR_ID)
            return false;
        return STEELSERIES_PRODUCTS.get(device.productId)?.family === "rival3-wireless-v2";
    }
    get pollIntervalMs() { return 30_000; }
    get supportedPollingRates() { return [...RIVAL3_WIRELESS_V2_POLLING_RATES]; }
    getDpiOptions() { return steelseriesRival3WirelessV2DpiOptions(); }
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
            const name = this.device.productName?.trim() || `SteelSeries ${product?.model ?? "Rival 3 Wireless Gen 2"}`;
            const active = this.dpiStages[this.activeDpiStage];
            return {
                brand: "SteelSeries",
                name,
                ui: {
                    family: "steelseries-rival3-wireless-v2",
                    settingsReady: true,
                    valuesVerified: false,
                    hideUnsupportedPollingRates: true,
                    hideProcessingCard: true,
                    pollingNote: "The Rival 3 Wireless Gen 2 cannot report its current DPI or polling rate; values shown are the last written by this app, or assumed defaults.",
                    defaultDisplayName: "SteelSeries Rival 3 Wireless Gen 2",
                },
                batteryPercent: battery.level,
                batteryState: "Unknown",
                dpi: active?.x ?? RIVAL3_WIRELESS_V2_DEFAULT_DPI_PRESETS[0],
                pollingRateHz: this.pollingRateHz,
                supportedPollingRates: this.supportedPollingRates,
                activeProfile: null,
                connectionType: "Wireless",
                liftOffDistance: null,
                firmware: [firmware.display],
            };
        });
    }
    /** writes `dpi` into both axes of the active stage. */
    async setDpi(dpi) {
        await this.setDpiStageValue(this.activeDpiStage, { x: dpi, y: dpi });
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
        await this.commit(steelseriesRival3WirelessV2EncodePollingRate(pollingRateHz));
        this.pollingRateHz = pollingRateHz;
        return pollingRateHz;
    }
    async setButtonsMapping(mapping) {
        await this.commit(steelseriesRival3WirelessV2EncodeButtonsMapping(mapping));
    }
    async setWheelMapping(mapping) {
        await this.commit(steelseriesRival3WirelessV2EncodeWheelMapping(mapping));
    }
    /**
     * `AA 01` — battery level. Doubles as the proof that the granted
     * interface is the config channel. Unlike Gen 1's reply this packet
     * carries no charging flag, so charging state stays unknown.
     */
    async probeBattery() {
        const payload = await this.awaitResponse(steelseriesRival3WirelessV2BatteryQuery());
        if (!payload) {
            throw new Error("The Rival 3 Wireless Gen 2 did not answer on this interface. Close SteelSeries GG (and the SteelSeriesEngine service); if it still does not answer, add the device again and choose another entry.");
        }
        return steelseriesRival3WirelessV2DecodeBattery(payload);
    }
    /** `10` — major/minor firmware bytes, read the same way. */
    async probeFirmware() {
        const payload = await this.awaitResponse(steelseriesRival3WirelessV2FirmwareQuery());
        if (!payload) {
            throw new Error("The Rival 3 Wireless Gen 2 did not answer the firmware query on this interface.");
        }
        return steelseriesRival3WirelessV2DecodeFirmware(payload);
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
        if (!Number.isInteger(stage) || stage < 0 || stage >= RIVAL3_WIRELESS_V2_MAX_DPI_PRESETS) {
            throw new Error(`The Rival 3 Wireless Gen 2 holds ${RIVAL3_WIRELESS_V2_MAX_DPI_PRESETS} DPI stages.`);
        }
    }
    async writePresets(stages, activeStage) {
        this.requireStage(activeStage);
        const report = steelseriesRival3WirelessV2EncodeDpiPresets(stages, activeStage);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesRival3WirelessV2SaveCommand());
            this.dpiStages = [...stages];
            this.activeDpiStage = activeStage;
        });
    }
    async commit(report) {
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesRival3WirelessV2SaveCommand());
        });
    }
    async write(payload) {
        await this.device.sendReport(RIVAL3_WIRELESS_V2_REPORT_ID, payload.buffer);
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
