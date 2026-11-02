import { SENSEI310_POLLING_RATES, STEELSERIES_PRODUCTS, STEELSERIES_SENSEI310_REPORT_ID, STEELSERIES_VENDOR_ID, steelseriesSensei310DecodeFirmware, steelseriesSensei310DpiOptions, steelseriesSensei310EncodeButtonsMapping, steelseriesSensei310EncodeLedColor, steelseriesSensei310EncodePollingRate, steelseriesSensei310EncodeSensitivity1, steelseriesSensei310FirmwareQuery, steelseriesSensei310SaveCommand, } from "../../steelseries/index.js";
/** rivalcfg's `command_approve_delay`, shared across every SteelSeries family. */
const COMMAND_DELAY_MS = 50;
/** rivalcfg reads the firmware response with a 200 ms timeout; allow slack. */
const FIRMWARE_TIMEOUT_MS = 500;
/** Vendor default DPI levels (`raw_cpi` 800/1600 in the GG seed), shown only until this session writes a value. */
const DEFAULT_DPI = 800;
const DEFAULT_POLLING_HZ = 1000;
/**
 * SteelSeries Sensei 310 WebHID control (`1038:1722`).
 *
 * The vendor GG specification includes Rival 310's profile wholesale and
 * overrides only the button table (8 slots instead of 6), so this driver
 * mirrors `SteelSeriesRival310HidClient`: write-only settings, with the
 * two-byte firmware version (`90 00`) as the only readable value and the
 * connectivity probe. See `../../steelseries/sensei-310.ts` for the full
 * protocol writeup.
 *
 * The config channel is hidapi `endpoint 0`; its WebHID collection shape
 * has not been captured yet, so the picker offers every interface and the
 * wrong ones fail the firmware probe loudly.
 *
 * LED color writes are HID **feature** reports, not output reports —
 * `setLedColor` routes through `device.sendFeatureReport`, unlike every
 * other setter here.
 */
export class SteelSeriesSensei310HidClient {
    device;
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
    }
    static isSupported(device) {
        if (device.vendorId !== STEELSERIES_VENDOR_ID)
            return false;
        return STEELSERIES_PRODUCTS.get(device.productId)?.family === "sensei-310";
    }
    get pollIntervalMs() { return 30_000; }
    get supportedPollingRates() { return [...SENSEI310_POLLING_RATES]; }
    getDpiOptions() { return steelseriesSensei310DpiOptions(); }
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
            const firmware = await this.probeFirmware();
            const product = STEELSERIES_PRODUCTS.get(this.device.productId);
            const name = this.device.productName?.trim() || `SteelSeries ${product?.model ?? "Sensei 310"}`;
            return {
                brand: "SteelSeries",
                name,
                ui: {
                    family: "steelseries-sensei-310",
                    settingsReady: true,
                    valuesVerified: false,
                    hideUnsupportedPollingRates: true,
                    hideProcessingCard: true,
                    pollingNote: "The Sensei 310 cannot report its current settings; values shown are the last written by this app, or assumed defaults.",
                    defaultDisplayName: "SteelSeries Sensei 310",
                },
                batteryPercent: null,
                batteryState: "Unknown",
                dpi: this.lastWritten.dpi ?? DEFAULT_DPI,
                pollingRateHz: this.lastWritten.pollingRateHz ?? DEFAULT_POLLING_HZ,
                supportedPollingRates: this.supportedPollingRates,
                activeProfile: null,
                connectionType: "Wired",
                liftOffDistance: null,
                firmware: [firmware.display],
            };
        });
    }
    /**
     * Writes sensitivity preset 1 only. The device is write-only, so the
     * existing preset 2 and button/lighting configuration cannot be read and
     * preserved — record them before testing.
     */
    async setDpi(dpi) {
        const report = steelseriesSensei310EncodeSensitivity1(dpi);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesSensei310SaveCommand());
            this.lastWritten.dpi = dpi;
        });
        return dpi;
    }
    async setPollingRate(pollingRateHz) {
        const report = steelseriesSensei310EncodePollingRate(pollingRateHz);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesSensei310SaveCommand());
            this.lastWritten.pollingRateHz = pollingRateHz;
        });
        return pollingRateHz;
    }
    async setLedColor(led, r, g, b) {
        const report = steelseriesSensei310EncodeLedColor(led, r, g, b);
        await this.run(async () => {
            await this.open();
            await this.device.sendFeatureReport(STEELSERIES_SENSEI310_REPORT_ID, report.buffer);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesSensei310SaveCommand());
        });
    }
    async setButtonsMapping(mapping) {
        const report = steelseriesSensei310EncodeButtonsMapping(mapping);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesSensei310SaveCommand());
        });
    }
    /**
     * The `90 00` firmware query is the device's only readable value, so it
     * doubles as the proof that the granted interface is the config channel.
     */
    async probeFirmware() {
        const response = new Promise((resolve) => {
            let timer;
            const finish = (payload) => {
                clearTimeout(timer);
                this.inputWaiters.delete(finish);
                resolve(payload);
            };
            timer = setTimeout(() => finish(null), FIRMWARE_TIMEOUT_MS);
            this.inputWaiters.add(finish);
        });
        await this.write(steelseriesSensei310FirmwareQuery());
        const payload = await response;
        if (!payload) {
            throw new Error("The Sensei 310 did not answer the firmware query on this interface. Add the device again and choose another entry.");
        }
        return steelseriesSensei310DecodeFirmware(payload);
    }
    async write(payload) {
        await this.device.sendReport(STEELSERIES_SENSEI310_REPORT_ID, payload.buffer);
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
