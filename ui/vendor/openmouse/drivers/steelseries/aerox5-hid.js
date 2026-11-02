import { AEROX5_POLLING_RATES, AEROX5_REPORT_ID, STEELSERIES_PRODUCTS, STEELSERIES_VENDOR_ID, steelseriesAerox5DpiOptions, steelseriesAerox5EncodeButtonsMapping, steelseriesAerox5EncodeDefaultLighting, steelseriesAerox5EncodeDpiPresets, steelseriesAerox5EncodeLedBrightness, steelseriesAerox5EncodePollingRate, steelseriesAerox5EncodeRainbowEffect, steelseriesAerox5EncodeReactiveColor, steelseriesAerox5EncodeZoneColor, steelseriesAerox5SaveCommand, } from "../../steelseries/index.js";
/** rivalcfg's `command_approve_delay`, shared across every SteelSeries family. */
const COMMAND_DELAY_MS = 50;
/** rivalcfg profile defaults (`aerox5.py`: "400, 800, 1200, 2400, 3200"). */
const DEFAULT_DPI = 400;
const DEFAULT_POLLING_HZ = 1000;
/**
 * SteelSeries Aerox 5 WebHID control (`1038:1850`, wired-only — see
 * `SteelSeriesAerox5WirelessHidClient` for the separately-sold Aerox 5
 * Wireless, a different command layout entirely).
 *
 * Like Aerox 3, this device has **no readable value at all** — no firmware
 * query exists in `aerox5.py`, so there is nothing to probe the device
 * with. `readStatus` therefore treats a successful `open()` as the only
 * available connectivity signal and reports the session's last-written
 * values (or rivalcfg's documented defaults before any write) with
 * `valuesVerified: false`. Every setter follows its write with the save
 * command so the change persists in the mouse's onboard memory, mirroring
 * rivalcfg's CLI default.
 *
 * The config channel is hidapi interface 3, per `aerox5.py`'s `"endpoint": 3`
 * model entry; its WebHID collection shape has not been captured yet, so the
 * picker offers every interface.
 */
export class SteelSeriesAerox5HidClient {
    device;
    queue = Promise.resolve();
    lastWritten = {
        dpi: null,
        pollingRateHz: null,
    };
    constructor(device) {
        this.device = device;
    }
    static isSupported(device) {
        if (device.vendorId !== STEELSERIES_VENDOR_ID)
            return false;
        const product = STEELSERIES_PRODUCTS.get(device.productId);
        return product?.family === "aerox5";
    }
    get pollIntervalMs() { return 30_000; }
    get supportedPollingRates() { return [...AEROX5_POLLING_RATES]; }
    getDpiOptions() { return steelseriesAerox5DpiOptions(); }
    async open() {
        if (!this.device.opened)
            await this.device.open();
    }
    async close() {
        if (this.device.opened)
            await this.device.close();
    }
    async readStatus() {
        return await this.run(async () => {
            await this.open();
            const name = this.device.productName?.trim() || "SteelSeries Aerox 5";
            return {
                brand: "SteelSeries",
                name,
                ui: {
                    family: "steelseries-aerox5",
                    settingsReady: true,
                    valuesVerified: false,
                    hideUnsupportedPollingRates: true,
                    hideProcessingCard: true,
                    pollingNote: "The Aerox 5 cannot report its current settings; values shown are the last written by this app, or assumed defaults.",
                    defaultDisplayName: "SteelSeries Aerox 5",
                },
                batteryPercent: null,
                batteryState: "Unknown",
                dpi: this.lastWritten.dpi ?? DEFAULT_DPI,
                pollingRateHz: this.lastWritten.pollingRateHz ?? DEFAULT_POLLING_HZ,
                supportedPollingRates: this.supportedPollingRates,
                activeProfile: null,
                connectionType: "Wired",
                liftOffDistance: null,
                firmware: [],
            };
        });
    }
    /**
     * Replaces the mouse's DPI preset table with a single preset. The device
     * is write-only, so the existing presets cannot be read and preserved —
     * record them before testing.
     */
    async setDpi(dpi) {
        const report = steelseriesAerox5EncodeDpiPresets([dpi], 0);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesAerox5SaveCommand());
            this.lastWritten.dpi = dpi;
        });
        return dpi;
    }
    async setPollingRate(pollingRateHz) {
        const report = steelseriesAerox5EncodePollingRate(pollingRateHz);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesAerox5SaveCommand());
            this.lastWritten.pollingRateHz = pollingRateHz;
        });
        return pollingRateHz;
    }
    async setZoneColor(zone, r, g, b) {
        const report = steelseriesAerox5EncodeZoneColor(zone, r, g, b);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesAerox5SaveCommand());
        });
    }
    async setReactiveColor(color) {
        const report = steelseriesAerox5EncodeReactiveColor(color);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesAerox5SaveCommand());
        });
    }
    async setLedBrightness(percent) {
        const report = steelseriesAerox5EncodeLedBrightness(percent);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesAerox5SaveCommand());
        });
    }
    async setRainbowEffect(zones) {
        const report = steelseriesAerox5EncodeRainbowEffect(zones);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesAerox5SaveCommand());
        });
    }
    async setDefaultLighting(mode) {
        const report = steelseriesAerox5EncodeDefaultLighting(mode);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesAerox5SaveCommand());
        });
    }
    async setButtonsMapping(mapping) {
        const report = steelseriesAerox5EncodeButtonsMapping(mapping);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesAerox5SaveCommand());
        });
    }
    async write(payload) {
        await this.device.sendReport(AEROX5_REPORT_ID, payload.buffer);
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
