import { AEROX5_WIRELESS_POLLING_RATES, AEROX5_WIRELESS_REPORT_ID, STEELSERIES_PRODUCTS, STEELSERIES_VENDOR_ID, steelseriesAerox5WirelessBatteryQuery, steelseriesAerox5WirelessDecodeBattery, steelseriesAerox5WirelessDpiOptions, steelseriesAerox5WirelessEncodeButtonsMapping, steelseriesAerox5WirelessEncodeDefaultLighting, steelseriesAerox5WirelessEncodeDimTimer, steelseriesAerox5WirelessEncodeDpiPresets, steelseriesAerox5WirelessEncodePollingRate, steelseriesAerox5WirelessEncodeRainbowEffect, steelseriesAerox5WirelessEncodeReactiveColor, steelseriesAerox5WirelessEncodeSleepTimer, steelseriesAerox5WirelessEncodeZoneColor, steelseriesAerox5WirelessSaveCommand, } from "../../steelseries/index.js";
/** rivalcfg's `command_approve_delay`, shared across every SteelSeries family. */
const COMMAND_DELAY_MS = 50;
/** rivalcfg reads input-report replies with a 200 ms timeout; allow slack. */
const RESPONSE_TIMEOUT_MS = 500;
/** rivalcfg profile default (`aerox5_wireless_wired.py`: "400, 800, 1200, 2400, 3200"). */
const DEFAULT_DPI = 400;
const DEFAULT_POLLING_HZ = 1000;
/**
 * SteelSeries Aerox 5 Wireless WebHID control.
 *
 * One physical mouse, two transport-dependent product-id groups, one class:
 * the USB-cabled group (`1038:1854`/`185E`/`1862` — "wired mode" in
 * rivalcfg's naming) and the 2.4 GHz dongle group (`1038:1852`/`185C`/`1860`).
 * Both use the exact same command set; only the wireless flag bit
 * (`applyWirelessFlag` in the protocol module) and, per rivalcfg, a longer
 * expected readback differ. `this.wireless` is fixed from the granted
 * device's product id at construction and threaded through every encode
 * call so a client instance never mixes flagged and unflagged commands.
 *
 * DPI presets, polling rate, zone colors, reactive color, sleep/dim timers,
 * rainbow, default lighting, and buttons are write-only — neither rivalcfg
 * file for this device defines a getter for any of them. Battery level
 * **is** readable (`92`/`D2`, 2-byte reply, different response shape from
 * the Rival 3 Wireless's `AA 01`/3-byte reply — see the protocol module's
 * doc comment) and `readStatus` uses it as the connectivity probe, same
 * role the Rival 3 Wireless's battery probe plays.
 *
 * The config channel is hidapi interface 3, per both rivalcfg files'
 * `"endpoint": 3` model entries; its WebHID collection shape has not been
 * captured yet, so the picker offers every interface and the wrong ones
 * fail the battery probe loudly.
 */
export class SteelSeriesAerox5WirelessHidClient {
    device;
    wireless;
    queue = Promise.resolve();
    listenerAttached = false;
    inputWaiters = new Set();
    lastWritten = {
        dpi: null,
        pollingRateHz: null,
    };
    onInputReport = (event) => {
        const payload = new Uint8Array(event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength));
        for (const finish of [...this.inputWaiters])
            finish(payload);
    };
    constructor(device) {
        this.device = device;
        this.wireless = STEELSERIES_PRODUCTS.get(device.productId)?.wireless === true
            && WIRELESS_MODE_PRODUCT_IDS.has(device.productId);
    }
    static isSupported(device) {
        if (device.vendorId !== STEELSERIES_VENDOR_ID)
            return false;
        return STEELSERIES_PRODUCTS.get(device.productId)?.family === "aerox5-wireless";
    }
    get pollIntervalMs() { return 30_000; }
    get supportedPollingRates() { return [...AEROX5_WIRELESS_POLLING_RATES]; }
    getDpiOptions() { return steelseriesAerox5WirelessDpiOptions(); }
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
            const product = STEELSERIES_PRODUCTS.get(this.device.productId);
            const name = this.device.productName?.trim() || `SteelSeries ${product?.model ?? "Aerox 5 Wireless"}`;
            return {
                brand: "SteelSeries",
                name,
                ui: {
                    family: "steelseries-aerox5-wireless",
                    settingsReady: true,
                    valuesVerified: false,
                    hideUnsupportedPollingRates: true,
                    hideProcessingCard: true,
                    pollingNote: "The Aerox 5 Wireless cannot report its current DPI or polling rate; values shown are the last written by this app, or assumed defaults.",
                    defaultDisplayName: "SteelSeries Aerox 5 Wireless",
                },
                batteryPercent: battery.level,
                batteryState: battery.isCharging ? "Charging" : "Discharging",
                dpi: this.lastWritten.dpi ?? DEFAULT_DPI,
                pollingRateHz: this.lastWritten.pollingRateHz ?? DEFAULT_POLLING_HZ,
                supportedPollingRates: this.supportedPollingRates,
                activeProfile: null,
                connectionType: this.wireless ? "Wireless" : "Wired",
                liftOffDistance: null,
                firmware: [],
            };
        });
    }
    /**
     * Replaces the mouse's DPI preset table with a single preset. The device
     * does not expose a getter for DPI, so the existing presets cannot be read
     * and preserved — record them in SteelSeries GG before testing.
     */
    async setDpi(dpi) {
        const report = steelseriesAerox5WirelessEncodeDpiPresets([dpi], 0, this.wireless);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesAerox5WirelessSaveCommand(this.wireless));
            this.lastWritten.dpi = dpi;
        });
        return dpi;
    }
    async setPollingRate(pollingRateHz) {
        const report = steelseriesAerox5WirelessEncodePollingRate(pollingRateHz, this.wireless);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesAerox5WirelessSaveCommand(this.wireless));
            this.lastWritten.pollingRateHz = pollingRateHz;
        });
        return pollingRateHz;
    }
    async setZoneColor(zone, r, g, b) {
        const report = steelseriesAerox5WirelessEncodeZoneColor(zone, r, g, b, this.wireless);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesAerox5WirelessSaveCommand(this.wireless));
        });
    }
    async setReactiveColor(color) {
        const report = steelseriesAerox5WirelessEncodeReactiveColor(color, this.wireless);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesAerox5WirelessSaveCommand(this.wireless));
        });
    }
    async setSleepTimer(minutes) {
        const report = steelseriesAerox5WirelessEncodeSleepTimer(minutes, this.wireless);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesAerox5WirelessSaveCommand(this.wireless));
        });
    }
    async setDimTimer(seconds) {
        const report = steelseriesAerox5WirelessEncodeDimTimer(seconds, this.wireless);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesAerox5WirelessSaveCommand(this.wireless));
        });
    }
    async setRainbowEffect() {
        const report = steelseriesAerox5WirelessEncodeRainbowEffect(this.wireless);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesAerox5WirelessSaveCommand(this.wireless));
        });
    }
    async setDefaultLighting(mode) {
        const report = steelseriesAerox5WirelessEncodeDefaultLighting(mode, this.wireless);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesAerox5WirelessSaveCommand(this.wireless));
        });
    }
    async setButtonsMapping(mapping) {
        const report = steelseriesAerox5WirelessEncodeButtonsMapping(mapping, this.wireless);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesAerox5WirelessSaveCommand(this.wireless));
        });
    }
    /** `92`/`D2` — battery percentage and charging state. Doubles as the connectivity probe. */
    async probeBattery() {
        const payload = await this.awaitResponse(steelseriesAerox5WirelessBatteryQuery(this.wireless));
        if (!payload) {
            throw new Error("The Aerox 5 Wireless did not answer on this interface. Close SteelSeries GG (and the SteelSeriesEngine service); if it still does not answer, add the device again and choose another entry.");
        }
        return steelseriesAerox5WirelessDecodeBattery(payload);
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
    async write(payload) {
        await this.device.sendReport(AEROX5_WIRELESS_REPORT_ID, payload.buffer);
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
/** The 2.4 GHz dongle-mode PIDs — distinguishes which transform to apply from `wireless: true` in `devices.ts`. */
const WIRELESS_MODE_PRODUCT_IDS = new Set([0x1852, 0x185c, 0x1860]);
