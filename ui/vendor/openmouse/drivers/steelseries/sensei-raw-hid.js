import { SENSEI_RAW_DEFAULT_DPI_PRESET_1, SENSEI_RAW_DEFAULT_DPI_PRESET_2, SENSEI_RAW_POLLING_RATES, SENSEI_RAW_REPORT_ID, STEELSERIES_PRODUCTS, STEELSERIES_VENDOR_ID, steelseriesSenseiRawActiveCpiQuery, steelseriesSenseiRawDecodeFirmware, steelseriesSenseiRawDpiOptions, steelseriesSenseiRawEncodeButtonsMapping, steelseriesSenseiRawEncodeLedBrightness, steelseriesSenseiRawEncodeLedEffect, steelseriesSenseiRawEncodePollingRate, steelseriesSenseiRawEncodeSensitivity1, steelseriesSenseiRawEncodeSensitivity2, steelseriesSenseiRawFirmwareQuery, steelseriesSenseiRawSaveCommand, } from "../../steelseries/index.js";
/** rivalcfg's `command_approve_delay`, shared across every SteelSeries family. */
const COMMAND_DELAY_MS = 50;
/** rivalcfg reads input-report replies with a 200 ms timeout; allow slack. */
const RESPONSE_TIMEOUT_MS = 500;
const DEFAULT_POLLING_HZ = 1000;
/**
 * SteelSeries Sensei [RAW] WebHID control (`1038:1369` and its Diablo III /
 * Guild Wars 2 / CoD Black Ops II / World of Tanks / Heroes of the Storm
 * editions, one shared vendor profile — see
 * `../../steelseries/sensei-raw.ts`).
 *
 * DPI (two presets, `03 01`/`03 02`), polling, and the single LED are
 * write-only; the two readable values are the firmware version (`10 00`) and
 * the active preset index (`16 00`). This client uses the firmware query as
 * its connectivity probe, matching rivalcfg's `sensei_raw.py`.
 *
 * Because the active preset index is readable, `setDpi` writes the
 * **active** preset (so a change always takes effect, even after the CPI
 * button has selected preset 2) rather than always preset 1, and
 * `readStatus` reports that active preset's DPI. `setDpiPreset2` writes
 * preset 2 explicitly. Both presets are tracked independently; a preset
 * whose value this session has not written falls back to rivalcfg's
 * documented default for that preset, with `valuesVerified: false`.
 *
 * The config channel is hidapi interface 0; its WebHID collection shape has
 * not been captured yet, so the picker offers every interface and the wrong
 * ones fail the firmware probe loudly.
 */
export class SteelSeriesSenseiRawHidClient {
    device;
    queue = Promise.resolve();
    listenerAttached = false;
    inputWaiters = new Set();
    /** Last DPI this session wrote to each preset, if any. */
    presetDpi = { 1: null, 2: null };
    pollingRateHz = null;
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
        return STEELSERIES_PRODUCTS.get(device.productId)?.family === "sensei-raw";
    }
    get pollIntervalMs() { return 30_000; }
    get supportedPollingRates() { return [...SENSEI_RAW_POLLING_RATES]; }
    getDpiOptions() { return steelseriesSenseiRawDpiOptions(); }
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
            const activePreset = await this.readActivePreset();
            const product = STEELSERIES_PRODUCTS.get(this.device.productId);
            const name = this.device.productName?.trim() || `SteelSeries ${product?.model ?? "Sensei [RAW]"}`;
            return {
                brand: "SteelSeries",
                name,
                ui: {
                    family: "steelseries-sensei-raw",
                    settingsReady: true,
                    valuesVerified: false,
                    hideUnsupportedPollingRates: true,
                    hideProcessingCard: true,
                    pollingNote: `The Sensei [RAW] cannot report the DPI of a preset this app has not written; the value shown is the last written by this app for the active preset (${activePreset}), or that preset's assumed default.`,
                    defaultDisplayName: "SteelSeries Sensei [RAW]",
                },
                batteryPercent: null,
                batteryState: "Unknown",
                dpi: this.dpiForPreset(activePreset),
                pollingRateHz: this.pollingRateHz ?? DEFAULT_POLLING_HZ,
                supportedPollingRates: this.supportedPollingRates,
                activeProfile: null,
                connectionType: "Wired",
                liftOffDistance: null,
                firmware: [firmware.display],
            };
        });
    }
    /**
     * Writes `dpi` to the **active** preset (`03 01` or `03 02`), so the change
     * takes effect even after the CPI button has switched to preset 2. The
     * active index is read first; if that read fails, this falls back to
     * preset 1 rather than aborting the write.
     */
    async setDpi(dpi) {
        await this.run(async () => {
            await this.open();
            const preset = await this.readActivePreset();
            await this.write(preset === 2 ? steelseriesSenseiRawEncodeSensitivity2(dpi) : steelseriesSenseiRawEncodeSensitivity1(dpi));
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesSenseiRawSaveCommand());
            this.presetDpi[preset] = dpi;
        });
        return dpi;
    }
    /** `03 02 <byte>` — writes sensitivity preset 2 explicitly. */
    async setDpiPreset2(dpi) {
        await this.commit(steelseriesSenseiRawEncodeSensitivity2(dpi));
        this.presetDpi[2] = dpi;
        return dpi;
    }
    async setPollingRate(pollingRateHz) {
        await this.commit(steelseriesSenseiRawEncodePollingRate(pollingRateHz));
        this.pollingRateHz = pollingRateHz;
        return pollingRateHz;
    }
    async setLedBrightness(brightness) {
        await this.commit(steelseriesSenseiRawEncodeLedBrightness(brightness));
    }
    async setLedEffect(effect) {
        await this.commit(steelseriesSenseiRawEncodeLedEffect(effect));
    }
    async setButtonsMapping(mapping) {
        await this.commit(steelseriesSenseiRawEncodeButtonsMapping(mapping));
    }
    /** The DPI to display for a preset: last written by this session, else that preset's rivalcfg default. */
    dpiForPreset(preset) {
        return this.presetDpi[preset] ?? (preset === 2 ? SENSEI_RAW_DEFAULT_DPI_PRESET_2 : SENSEI_RAW_DEFAULT_DPI_PRESET_1);
    }
    async commit(report) {
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesSenseiRawSaveCommand());
        });
    }
    /**
     * `10 00` — two-byte firmware version. Doubles as the proof that the
     * granted interface is the config channel.
     */
    async probeFirmware() {
        const payload = await this.awaitResponse(steelseriesSenseiRawFirmwareQuery());
        if (!payload) {
            throw new Error("The Sensei [RAW] did not answer the firmware query on this interface. Add the device again and choose another entry.");
        }
        return steelseriesSenseiRawDecodeFirmware(payload);
    }
    /**
     * `16 00` — the active preset index (1 or 2). A failed or malformed reply
     * falls back to preset 1 so a DPI write is never blocked by the probe.
     */
    async readActivePreset() {
        const payload = await this.awaitResponse(steelseriesSenseiRawActiveCpiQuery());
        if (!payload)
            return 1;
        const level = payload[0];
        return level === 0x02 ? 2 : 1;
    }
    /** Send a query and resolve its first input report, or null on timeout. */
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
        await this.device.sendReport(SENSEI_RAW_REPORT_ID, payload.buffer);
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
