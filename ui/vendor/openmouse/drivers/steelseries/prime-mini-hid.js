import { PRIME_MINI_DEFAULT_DPI_PRESETS, PRIME_MINI_DEFAULT_POLLING_RATE, PRIME_MINI_MAX_DPI_PRESETS, PRIME_MINI_POLLING_RATES, PRIME_MINI_REPORT_ID, STEELSERIES_PRODUCTS, STEELSERIES_VENDOR_ID, steelseriesPrimeMiniDecodeFirmware, steelseriesPrimeMiniDpiOptions, steelseriesPrimeMiniEncodeButtonsMapping, steelseriesPrimeMiniEncodeDpiPresets, steelseriesPrimeMiniEncodePollingRate, steelseriesPrimeMiniEncodeZoneColor, steelseriesPrimeMiniFirmwareQuery, steelseriesPrimeMiniSaveCommand, } from "../../steelseries/index.js";
/** rivalcfg's `command_approve_delay`, shared across every SteelSeries family. */
const COMMAND_DELAY_MS = 50;
/** Firmware replies are small; allow slack over rivalcfg-style timeouts. */
const FIRMWARE_TIMEOUT_MS = 500;
/**
 * SteelSeries Prime Mini WebHID control (`1038:184D`, wired only).
 *
 * DPI presets, polling rate, buttons, and lighting are write-only; only
 * the 15-byte firmware version string (`90 00`) can be read back, and this
 * driver uses it as its connectivity probe. `readStatus` therefore reports
 * the session's last-written values (or the vendor's documented defaults
 * before any write) with `valuesVerified: false`. Every setter follows its
 * write with the save command so the change persists in the mouse's onboard
 * memory. See `../../steelseries/prime-mini.ts` for the full protocol
 * writeup — reconstructed from the vendor's GG device specification, not
 * from rivalcfg, which does not cover this mouse.
 *
 * DPI is managed as five stages (the vendor's factory table), mirroring
 * the Aerox wireless drivers: `setDpi` edits the active stage, and the
 * whole table is rewritten on every change because the device exposes no
 * getter. Do not confuse this mouse with the Prime Mini Wireless
 * (`1038:184A`/`1038:1848`, a different command set).
 */
export class SteelSeriesPrimeMiniHidClient {
    device;
    queue = Promise.resolve();
    listenerAttached = false;
    inputWaiters = new Set();
    dpiStages = [...PRIME_MINI_DEFAULT_DPI_PRESETS];
    activeDpiStage = 0;
    pollingRateHz = PRIME_MINI_DEFAULT_POLLING_RATE;
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
        return STEELSERIES_PRODUCTS.get(device.productId)?.family === "prime-mini";
    }
    get pollIntervalMs() { return 30_000; }
    get supportedPollingRates() { return [...PRIME_MINI_POLLING_RATES]; }
    getDpiOptions() { return steelseriesPrimeMiniDpiOptions(); }
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
            const name = this.device.productName?.trim() || `SteelSeries ${product?.model ?? "Prime Mini"}`;
            return {
                brand: "SteelSeries",
                name,
                ui: {
                    family: "steelseries-prime-mini",
                    settingsReady: true,
                    valuesVerified: false,
                    hideUnsupportedPollingRates: true,
                    hideProcessingCard: true,
                    pollingNote: "The Prime Mini cannot report its current settings; values shown are the last written by this app, or assumed defaults.",
                    defaultDisplayName: "SteelSeries Prime Mini",
                },
                batteryPercent: null,
                batteryState: "Unknown",
                dpi: this.dpiStages[this.activeDpiStage] ?? PRIME_MINI_DEFAULT_DPI_PRESETS[0],
                pollingRateHz: this.pollingRateHz,
                supportedPollingRates: this.supportedPollingRates,
                activeProfile: null,
                connectionType: "Wired",
                liftOffDistance: null,
                firmware: [firmware],
            };
        });
    }
    /** writes `dpi` into the active stage. */
    async setDpi(dpi) {
        return await this.setDpiStageValue(this.activeDpiStage, dpi);
    }
    async setDpiStageValue(stage, dpi) {
        this.requireStage(stage);
        const stages = this.dpiStages.map((value, index) => (index === stage ? dpi : value));
        await this.writePresets(stages, this.activeDpiStage);
        return dpi;
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
        await this.commit(steelseriesPrimeMiniEncodePollingRate(pollingRateHz));
        this.pollingRateHz = pollingRateHz;
        return pollingRateHz;
    }
    async setButtonsMapping(mapping) {
        await this.commit(steelseriesPrimeMiniEncodeButtonsMapping(mapping));
    }
    async setZoneColor(r, g, b) {
        await this.commit(steelseriesPrimeMiniEncodeZoneColor(r, g, b));
    }
    requireStage(stage) {
        if (!Number.isInteger(stage) || stage < 0 || stage >= PRIME_MINI_MAX_DPI_PRESETS) {
            throw new Error(`The Prime Mini holds ${PRIME_MINI_MAX_DPI_PRESETS} DPI stages.`);
        }
    }
    async writePresets(stages, activeStage) {
        this.requireStage(activeStage);
        const report = steelseriesPrimeMiniEncodeDpiPresets(stages, activeStage);
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesPrimeMiniSaveCommand());
            this.dpiStages = [...stages];
            this.activeDpiStage = activeStage;
        });
    }
    async commit(report) {
        await this.run(async () => {
            await this.open();
            await this.write(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.write(steelseriesPrimeMiniSaveCommand());
        });
    }
    /**
     * `90 00` — 15-byte firmware version string. Doubles as the proof that
     * the granted interface is the config channel.
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
        await this.write(steelseriesPrimeMiniFirmwareQuery());
        const payload = await response;
        if (!payload) {
            throw new Error("The Prime Mini did not answer the firmware query on this interface. Add the device again and choose another entry.");
        }
        return steelseriesPrimeMiniDecodeFirmware(payload);
    }
    async write(payload) {
        await this.device.sendReport(PRIME_MINI_REPORT_ID, payload.buffer);
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
