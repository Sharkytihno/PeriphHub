import { SC380_PRO_DPI_STEP, SC380_PRO_MAX_DPI, SC380_PRO_POLLING_RATES, SC380_PRO_READ_SETTINGS, SC380_PRO_RECEIVER_ID, SC380_PRO_REPORT_ID, SC380_PRO_SETTINGS_LENGTH, SC380_PRO_USAGE, SC380_PRO_USAGE_PAGE, SC380_PRO_VENDOR_ID, decodeSc380ProReply, decodeSc380ProSettings, encodeSc380ProReport, setSc380ProStageDpi, } from "../../aula/index.js";
const NAME = "AULA SC380 Pro";
const MODEL_SIGNATURE = [0x04, 0, 0, 0, 0, 0x2e];
const WRITE_SETTINGS = 0x04;
const READ_IDENTITY = 0x05;
const READ_LINK = 0x07;
const READ_BATTERY = 0x09;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function hasSettingsReport(collection) {
    return (collection.usagePage === SC380_PRO_USAGE_PAGE && collection.usage === SC380_PRO_USAGE
        && collection.featureReports.some((report) => report.reportId === SC380_PRO_REPORT_ID))
        || collection.children.some(hasSettingsReport);
}
export class AulaSc380ProHidClient {
    device;
    queue = Promise.resolve();
    pollIntervalMs = 0;
    constructor(device) {
        this.device = device;
    }
    static isSupported(device) {
        return device.vendorId === SC380_PRO_VENDOR_ID && device.productId === SC380_PRO_RECEIVER_ID
            && device.collections.some(hasSettingsReport);
    }
    get supportedPollingRates() {
        return [...SC380_PRO_POLLING_RATES];
    }
    getDpiOptions() {
        return Array.from({ length: SC380_PRO_MAX_DPI / SC380_PRO_DPI_STEP }, (_, index) => (index + 1) * SC380_PRO_DPI_STEP);
    }
    async open() {
        if (!this.device.opened)
            await this.device.open();
    }
    async close() {
        await this.run(async () => {
            if (this.device.opened)
                await this.device.close();
        });
    }
    async readStatus() {
        return this.run(async () => {
            await this.open();
            await this.identify();
            const linked = await this.isLinked();
            const settings = linked ? decodeSc380ProSettings(await this.readSettings()) : null;
            const battery = linked ? (await this.read(READ_BATTERY, 1, 1).catch(() => null))?.[0] : undefined;
            return {
                brand: "AULA",
                name: NAME,
                ui: {
                    family: "aula-sc380-pro",
                    defaultDisplayName: NAME,
                    settingsReady: settings !== null,
                    hideUnsupportedPollingRates: true,
                    hideProcessingCard: true,
                    hideSleepCard: true,
                    hideSignalCard: true,
                    ...(settings ? {
                        dpiStageEditor: {
                            maxStages: settings.x.length,
                            countEditable: false,
                            minDpi: SC380_PRO_DPI_STEP,
                            maxDpi: SC380_PRO_MAX_DPI,
                            stepDpi: SC380_PRO_DPI_STEP,
                        },
                    } : { statusNote: "Wake the mouse to read its settings." }),
                },
                dpi: settings?.x[settings.active] ?? 0,
                dpiY: settings?.y[settings.active],
                dpiStages: settings?.x,
                dpiStagesY: settings?.y,
                activeDpiStage: settings?.active,
                supportsSeparateDpiAxes: settings !== null,
                pollingRateHz: settings?.polling ?? 0,
                supportedPollingRates: this.supportedPollingRates,
                batteryPercent: battery !== undefined && battery <= 100 ? battery : null,
                batteryState: "Unknown",
                activeProfile: null,
                connectionType: "Wireless",
                connectionDetail: "2.4 GHz receiver",
                liftOffDistance: null,
                firmware: [],
            };
        });
    }
    async setPollingRate(hz) {
        const code = this.supportedPollingRates.indexOf(hz) + 1;
        if (code === 0)
            throw new Error("Unsupported AULA SC380 Pro polling rate.");
        return this.update((block) => { block[2] = (block[2] & 0xf0) | code; }, (actual) => actual.polling === hz);
    }
    setActiveDpiStage(stage) {
        return this.update((block, current) => {
            if (!Number.isInteger(stage) || stage < 0 || stage >= current.x.length) {
                throw new Error("Invalid AULA SC380 Pro DPI stage.");
            }
            block[3] = ((stage + 1) << 4) | (block[3] & 0x0f);
        }, (actual) => actual.active === stage);
    }
    setDpiStageValue(stage, dpi) {
        return this.setDpiStageAxes(stage, dpi, dpi);
    }
    setDpiStageAxes(stage, x, y) {
        return this.update((block) => setSc380ProStageDpi(block, stage, x, y), (actual) => actual.x[stage] === x && actual.y[stage] === y);
    }
    setDpi(dpi) {
        let stage = 0;
        return this.update((block, current) => {
            stage = current.active;
            setSc380ProStageDpi(block, stage, dpi, dpi);
        }, (actual) => actual.x[stage] === dpi && actual.y[stage] === dpi);
    }
    async identify() {
        const signature = await this.read(READ_IDENTITY, 1, MODEL_SIGNATURE.length);
        if (!MODEL_SIGNATURE.every((byte, index) => signature[index] === byte)) {
            throw new Error("This receiver did not identify as an AULA SC380 Pro.");
        }
    }
    async isLinked() {
        return (await this.read(READ_LINK, 0, 1))[0] === 1;
    }
    readSettings() {
        return this.read(SC380_PRO_READ_SETTINGS, 0, SC380_PRO_SETTINGS_LENGTH);
    }
    async read(command, argument, length) {
        await this.device.sendFeatureReport(SC380_PRO_REPORT_ID, encodeSc380ProReport(command, argument, length));
        await delay(30);
        const view = await this.device.receiveFeatureReport(SC380_PRO_REPORT_ID);
        return decodeSc380ProReply(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), command, argument, length);
    }
    update(edit, verify) {
        return this.run(async () => {
            await this.open();
            await this.identify();
            if (!await this.isLinked())
                throw new Error("Wake the AULA SC380 Pro before changing settings.");
            const block = await this.readSettings();
            edit(block, decodeSc380ProSettings(block));
            await this.device.sendFeatureReport(SC380_PRO_REPORT_ID, encodeSc380ProReport(WRITE_SETTINGS, 0, block.length, block));
            await delay(250);
            if (!verify(decodeSc380ProSettings(await this.readSettings()))) {
                throw new Error("The AULA SC380 Pro did not keep the requested setting.");
            }
        });
    }
    run(operation) {
        const result = this.queue.then(operation);
        this.queue = result.then(() => undefined, () => undefined);
        return result;
    }
}
