import { MOTOSPEED_COMMAND_REPORT_ID, MOTOSPEED_INPUT_REPORT_ID, MOTOSPEED_POLLING_RATES, MOTOSPEED_PRODUCTS, MOTOSPEED_SETTINGS_REPORT_ID, MOTOSPEED_USAGE_PAGE, MOTOSPEED_VENDOR_ID, motospeedBuildButtonCommand, motospeedBuildDebounceCommand, motospeedBuildDpiCommand, motospeedBuildGeneralCommand, motospeedBuildLightingCommand, motospeedBuildPollingCommand, motospeedBuildSettingsRequest, motospeedBuildSleepCommand, motospeedDecodeSettings, } from "../../motospeed/index.js";
const LIGHTING_MODES = [
    "Off",
    "Static",
    "Breathing single",
    "Spectrum",
];
export class MotospeedHidClient {
    device;
    timeoutMs;
    canDisableSleep = false;
    queue = Promise.resolve();
    cancelRead = null;
    generation = 0;
    lighting = {
        zone: "Mouse",
        modes: LIGHTING_MODES,
        mode: null,
        color: null,
        color2: null,
        colorModes: ["Static", "Breathing single"],
        dualColorModes: [],
        reactiveModes: ["Breathing single", "Spectrum"],
        speeds: Array.from({ length: 255 }, (_, i) => i + 1),
        speed: null,
        brightness: null,
        brightnessLevels: Array.from({ length: 101 }, (_, i) => i),
        writeOnly: true,
    };
    constructor(device, timeoutMs = 2000) {
        this.device = device;
        this.timeoutMs = timeoutMs;
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            throw new RangeError("Timeout must be positive.");
        }
    }
    static isSupported(device) {
        return (device.vendorId === MOTOSPEED_VENDOR_ID &&
            MOTOSPEED_PRODUCTS.some((product) => product.productId === device.productId) &&
            hasControlCollection(device.collections));
    }
    get pollIntervalMs() {
        return 30_000;
    }
    getDpiOptions() {
        return Array.from({ length: 260 }, (_, i) => (i + 1) * 100);
    }
    getSupportedPollingRates() {
        return [...MOTOSPEED_POLLING_RATES];
    }
    getSleepOptions() {
        return Array.from({ length: 60 }, (_, i) => (i + 1) * 60);
    }
    getDebounceMaxMs() {
        return 20;
    }
    async open() {
        if (!MotospeedHidClient.isSupported(this.device)) {
            throw new Error("Unsupported Motospeed X6 control interface.");
        }
        if (!this.device.opened) {
            await this.device.open();
        }
    }
    async close() {
        this.generation++;
        this.cancelRead?.();
        await this.run(async () => {
            if (this.device.opened)
                await this.device.close();
        });
    }
    async startNotifications(_onChange) {
        return false;
    }
    async readSettings() {
        return this.run(async () => {
            await this.open();
            return this.readSettingsDirect();
        });
    }
    async readStatus() {
        // Mostly Motospeed X6-specific values, as other motospeed mice have not been reversed engineered.
        const settings = await this.readSettings();
        const wireless = this.device.productId === 0xffe0;
        return {
            brand: "Motospeed",
            name: "Motospeed X6",
            batteryPercent: settings.batteryPercent,
            batteryState: settings.charging === null
                ? "Unknown"
                : settings.charging
                    ? "Charging"
                    : "Discharging",
            connectionType: wireless ? "Wireless" : "Wired",
            connectionDetail: wireless ? "8K receiver" : "USB",
            dpi: settings.dpiStages[settings.activeDpiStage],
            dpiStages: settings.dpiStages.slice(0, settings.dpiStageCount),
            activeDpiStage: settings.activeDpiStage,
            pollingRateHz: settings.pollingRateHz,
            supportedPollingRates: this.getSupportedPollingRates(),
            activeProfile: null,
            firmware: [],
            liftOffDistance: settings.liftOffDistance,
            supportedLiftOffDistances: ["Low", "High"],
            motionSync: settings.motionSync,
            angleSnapping: settings.angleSnapping,
            rippleControl: settings.rippleControl,
            invertScroll: settings.invertScroll,
            supportsInvertScroll: true,
            performanceMode: settings.esportsMode,
            debounceMs: settings.debounceMs,
            sleepTimeout: settings.sleepMinutes * 60,
            lighting: structuredClone(this.lighting),
            ui: {
                family: "motospeed",
                defaultDisplayName: "Motospeed X6",
                hideSignalCard: true,
                hideUnsupportedPollingRates: true,
                showAdvancedSection: true,
                dpiStageEditor: {
                    maxStages: 5,
                    countEditable: true,
                    minDpi: 100,
                    maxDpi: 26000,
                    stepDpi: 100,
                },
            },
        };
    }
    async setDpi(dpi) {
        const confirmed = await this.updateDpi((current) => {
            current.dpiStages[current.activeDpiStage] = dpi;
        });
        return confirmed.dpiStages[confirmed.activeDpiStage];
    }
    async setDpiStageValue(stage, dpi) {
        if (!Number.isInteger(stage) || stage < 0 || stage > 4)
            throw new RangeError("DPI stage must be 0 through 4.");
        const confirmed = await this.updateDpi((current) => {
            current.dpiStages[stage] = dpi;
        });
        return confirmed.dpiStages[stage];
    }
    async setActiveDpiStage(slot) {
        return (await this.updateDpi((current) => {
            current.activeDpiStage = slot;
        })).activeDpiStage;
    }
    async setDpiStageCount(count) {
        if (!Number.isInteger(count) || count < 1 || count > 5)
            throw new RangeError("DPI stage count must be 1 through 5.");
        return (await this.updateDpi((current) => {
            current.dpiStageCount = count;
            current.activeDpiStage = Math.min(current.activeDpiStage, count - 1);
        })).dpiStageCount;
    }
    async setPollingRate(hz) {
        return (await this.writeVerified(motospeedBuildPollingCommand(hz), (s) => s.pollingRateHz === hz)).pollingRateHz;
    }
    async setDebounceTime(ms) {
        return (await this.writeVerified(motospeedBuildDebounceCommand(ms), (s) => s.debounceMs === ms)).debounceMs;
    }
    async setSleepTimeout(seconds) {
        return ((await this.writeVerified(motospeedBuildSleepCommand(seconds / 60), (s) => s.sleepMinutes * 60 === seconds)).sleepMinutes * 60);
    }
    async setLiftOffDistance(value) {
        if (value !== "Low" && value !== "High")
            throw new RangeError("Motospeed lift-off distance must be Low or High.");
        await this.updateGeneral({ liftOffDistance: value });
        return value;
    }
    async setMotionSync(value) {
        await this.updateGeneral({ motionSync: value });
        return value;
    }
    async setAngleSnapping(value) {
        await this.updateGeneral({ angleSnapping: value });
        return value;
    }
    async setRippleControl(value) {
        await this.updateGeneral({ rippleControl: value });
        return value;
    }
    async setInvertScroll(value) {
        await this.updateGeneral({ invertScroll: value });
        return value;
    }
    async setPerformanceMode(value) {
        await this.updateGeneral({ esportsMode: value });
        return value;
    }
    async setButtonMapping(button, mapping) {
        const packet = motospeedBuildButtonCommand(button, mapping);
        await this.run(async () => {
            await this.open();
            await this.send(packet);
        });
    }
    /**
     * Lighting is write-only,
     * there is no way to query the mouse's current lighting state,
     * Hence it returns its own state to record the successful write.
     */
    async setLighting(lighting) {
        const brightness = lighting.brightness ?? 100;
        if (!Number.isFinite(brightness) || brightness < 0 || brightness > 100)
            throw new RangeError("Brightness must be 0 through 100 percent.");
        const common = {
            brightness: Math.round((brightness * 255) / 100),
            speed: lighting.speed ?? 128,
        };
        let effect;
        switch (lighting.mode) {
            case "Off":
                effect = { mode: "off" };
                break;
            case "Spectrum":
                effect = { mode: "rainbow", ...common };
                break;
            case "Static":
            case "Breathing single": {
                const color = lighting.color;
                if (!color || !/^#[0-9a-f]{6}$/i.test(color))
                    throw new RangeError("Lighting requires a #rrggbb color.");
                effect = {
                    mode: lighting.mode === "Static" ? "static" : "breathing",
                    ...common,
                    color: [
                        parseInt(color.slice(1, 3), 16),
                        parseInt(color.slice(3, 5), 16),
                        parseInt(color.slice(5, 7), 16),
                    ],
                };
                break;
            }
            default:
                throw new RangeError("Unsupported Motospeed lighting mode.");
        }
        const packet = motospeedBuildLightingCommand(effect);
        const mode = lighting.mode;
        const color = lighting.color;
        return this.run(async () => {
            await this.open();
            await this.send(packet);
            this.lighting = {
                ...this.lighting,
                mode,
                color,
                brightness,
                speed: common.speed,
            };
            return structuredClone(this.lighting);
        });
    }
    async updateDpi(change) {
        return this.run(async () => {
            await this.open();
            const wanted = await this.readSettingsDirect();
            change(wanted);
            await this.send(motospeedBuildDpiCommand(wanted));
            return this.confirm((s) => s.activeDpiStage === wanted.activeDpiStage &&
                s.dpiStageCount === wanted.dpiStageCount &&
                s.dpiStages.every((dpi, i) => dpi === wanted.dpiStages[i]));
        });
    }
    async updateGeneral(change) {
        await this.run(async () => {
            await this.open();
            const current = await this.readSettingsDirect();
            const liftOffDistance = change.liftOffDistance ?? current.liftOffDistance;
            if (liftOffDistance === null) {
                throw new Error("Unknown Motospeed LOD value; refusing to overwrite it.");
            }
            if (current.settingsByte & 0x20) {
                // Bit 5 purpose is unknown, but is always consistently 0x20.
                throw new Error("Unknown Motospeed general setting bit is enabled.");
            }
            const wanted = { ...current, ...change, liftOffDistance };
            await this.send(motospeedBuildGeneralCommand(wanted));
            await this.confirm((s) => s.liftOffDistance === wanted.liftOffDistance &&
                s.motionSync === wanted.motionSync &&
                s.angleSnapping === wanted.angleSnapping &&
                s.rippleControl === wanted.rippleControl &&
                s.invertScroll === wanted.invertScroll &&
                s.esportsMode === wanted.esportsMode);
        });
    }
    async writeVerified(packet, matches) {
        return this.run(async () => {
            await this.open();
            await this.send(packet);
            return this.confirm(matches);
        });
    }
    async confirm(matches) {
        const settings = await this.readSettingsDirect();
        if (!matches(settings)) {
            throw new Error("Motospeed X6 did not retain the requested setting.");
        }
        return settings;
    }
    async send(packet) {
        let data = packet.data;
        if (packet.reportId === MOTOSPEED_SETTINGS_REPORT_ID) {
            const length = outputReportLength(this.device.collections, packet.reportId);
            if (length === 60) {
                data = data.slice(0, 60);
            }
            else if (length !== 0) {
                throw new Error(`Unsupported Motospeed settings report payload length ${length}.`);
            }
        }
        await this.device.sendReport(packet.reportId, new Uint8Array(data).buffer);
    }
    readSettingsDirect() {
        return new Promise((resolve, reject) => {
            let settled = false;
            let sent = false;
            let settings;
            const cleanup = () => {
                clearTimeout(timer);
                this.device.removeEventListener("inputreport", listener);
                this.cancelRead = null;
            };
            const fail = (error) => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                reject(error);
            };
            const finish = () => {
                if (settled || !sent || settings === undefined)
                    return;
                settled = true;
                cleanup();
                resolve(settings);
            };
            const listener = (event) => {
                if (event.device !== this.device ||
                    event.reportId !== MOTOSPEED_INPUT_REPORT_ID ||
                    event.data.byteLength === 0 ||
                    event.data.getUint8(0) !== 0x06) {
                    return;
                }
                try {
                    settings = motospeedDecodeSettings(event.data, this.device.productId === 0xffe0);
                    finish();
                }
                catch (error) {
                    fail(error);
                }
            };
            const timer = setTimeout(() => fail(new Error("Timed out waiting for Motospeed X6 settings.")), this.timeoutMs);
            this.cancelRead = () => fail(new Error("Motospeed X6 connection closed."));
            this.device.addEventListener("inputreport", listener);
            void this.send(motospeedBuildSettingsRequest()).then(() => {
                sent = true;
                finish();
            }, fail);
        });
    }
    async run(operation) {
        const generation = this.generation;
        const result = this.queue.then(() => {
            if (generation !== this.generation)
                throw new Error("Motospeed X6 connection closed.");
            return operation();
        });
        this.queue = result.then(() => undefined, () => undefined);
        return result;
    }
}
function hasControlCollection(collections) {
    return collections.some((collection) => (collection.usagePage === MOTOSPEED_USAGE_PAGE &&
        collection.inputReports.some((r) => r.reportId === MOTOSPEED_INPUT_REPORT_ID) &&
        collection.outputReports.some((r) => r.reportId === MOTOSPEED_SETTINGS_REPORT_ID) &&
        collection.outputReports.some((r) => r.reportId === MOTOSPEED_COMMAND_REPORT_ID)) ||
        hasControlCollection(collection.children));
}
function outputReportLength(collections, reportId) {
    for (const collection of collections) {
        if (collection.usagePage === MOTOSPEED_USAGE_PAGE) {
            const report = collection.outputReports.find((candidate) => candidate.reportId === reportId);
            if (report)
                return (report.items.reduce((bits, item) => bits + item.reportSize * item.reportCount, 0) / 8);
        }
        const nested = outputReportLength(collection.children, reportId);
        if (nested)
            return nested;
    }
    return 0;
}
