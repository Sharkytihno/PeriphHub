import { SENSEI_RIVAL_PRO_POLLING_RATES, SENSEI_RIVAL_PRO_REPORT_ID, STEELSERIES_PRODUCTS, STEELSERIES_VENDOR_ID, steelseriesSenseiRivalProDpiOptions, steelseriesSenseiRivalProEncodeButtonsMapping, steelseriesSenseiRivalProEncodeDpiPresets, steelseriesSenseiRivalProEncodePollingRate, steelseriesSenseiRivalProSaveCommand, } from "../../steelseries/index.js";
/** Vendor profile default (first factory preset) until this session writes a value. */
const DEFAULT_DPI = 400;
const DEFAULT_POLLING_HZ = 1000;
/** Lift-off/landing bytes written with DPI presets; the vendor specification states no defaults. */
const DEFAULT_LIFT_OFF_DISTANCE = 0;
const DEFAULT_LANDING_DISTANCE = 0;
/**
 * SteelSeries Sensei Pro / Rival Pro WebHID control (base station
 * `1038:1880`, dongle `1038:1882`).
 *
 * DPI presets, polling rate, and buttons are effectively write-only in this
 * driver: the vendor specification does define read-back commands (`0xB4`
 * for DPI, `0xAC`/`0xAD` for polling, `0xAA` for buttons), but this driver
 * does not decode them yet, so a successful `open()` is the only available
 * connectivity signal and `readStatus` reports the session's last-written
 * values (or documented defaults before any write) with
 * `valuesVerified: false`. The four models share one specification and
 * report the model themselves; see `../../steelseries/sensei-rival-pro.ts`
 * for the full protocol writeup.
 *
 * `setDpi` replaces the whole five-preset table with five identical
 * presets: the device exposes no getter, so existing presets cannot be
 * read and preserved. Lift-off and landing distances reset to 0 for every
 * preset — the specification states no defaults for those bytes, so record
 * them in SteelSeries GG before testing and restore them there afterwards.
 */
export class SteelSeriesSenseiRivalProHidClient {
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
        return STEELSERIES_PRODUCTS.get(device.productId)?.family === "sensei-rival-pro";
    }
    get pollIntervalMs() { return 30_000; }
    get supportedPollingRates() { return [...SENSEI_RIVAL_PRO_POLLING_RATES]; }
    getDpiOptions() { return steelseriesSenseiRivalProDpiOptions(); }
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
            const product = STEELSERIES_PRODUCTS.get(this.device.productId);
            const name = this.device.productName?.trim() || `SteelSeries ${product?.model ?? "Sensei Pro / Rival Pro"}`;
            return {
                brand: "SteelSeries",
                name,
                ui: {
                    family: "steelseries-sensei-rival-pro",
                    settingsReady: true,
                    valuesVerified: false,
                    hideUnsupportedPollingRates: true,
                    hideProcessingCard: true,
                    pollingNote: "The Sensei Pro / Rival Pro cannot report its current DPI or polling rate through this driver; values shown are the last written by this app, or assumed defaults.",
                    defaultDisplayName: "SteelSeries Sensei Pro / Rival Pro",
                },
                batteryPercent: null,
                batteryState: "Unknown",
                dpi: this.lastWritten.dpi ?? DEFAULT_DPI,
                pollingRateHz: this.lastWritten.pollingRateHz ?? DEFAULT_POLLING_HZ,
                supportedPollingRates: this.supportedPollingRates,
                activeProfile: null,
                connectionType: "Wireless",
                liftOffDistance: null,
                firmware: [],
            };
        });
    }
    async setDpi(dpi) {
        const preset = {
            x: dpi,
            y: dpi,
            liftOffDistance: DEFAULT_LIFT_OFF_DISTANCE,
            landingDistance: DEFAULT_LANDING_DISTANCE,
        };
        const report = steelseriesSenseiRivalProEncodeDpiPresets([preset, preset, preset, preset, preset], 0);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(50);
            await this.write(steelseriesSenseiRivalProSaveCommand());
            this.lastWritten.dpi = dpi;
        });
        return dpi;
    }
    async setPollingRate(pollingRateHz) {
        const report = steelseriesSenseiRivalProEncodePollingRate(0, pollingRateHz);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(50);
            await this.write(steelseriesSenseiRivalProSaveCommand());
            this.lastWritten.pollingRateHz = pollingRateHz;
        });
        return pollingRateHz;
    }
    async setButtonsMapping(mapping) {
        const report = steelseriesSenseiRivalProEncodeButtonsMapping(mapping);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(50);
            await this.write(steelseriesSenseiRivalProSaveCommand());
        });
    }
    async write(payload) {
        await this.device.sendReport(SENSEI_RIVAL_PRO_REPORT_ID, payload.buffer);
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
