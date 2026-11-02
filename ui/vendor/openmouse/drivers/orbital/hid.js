import "./host-protocol.js";
import { ORBITAL_DEVICES, ORBITAL_REPORT_RATES_HZ as REPORT_RATES, ORBITAL_VENDOR_ID as VENDOR_ID, } from "../../orbital/index.js";
function protocol() {
    const value = globalThis.OrbitalHostProtocol;
    if (!value)
        throw new Error("Orbital host protocol did not load.");
    return value;
}
export class OrbitalHidClient {
    client = null;
    settings = null;
    device;
    constructor(device) {
        this.device = device;
    }
    static isSupported(device) {
        return device.vendorId === VENDOR_ID
            && ORBITAL_DEVICES.has(device.productId)
            && device.collections.some((collection) => collection.usagePage === 0xff0a && collection.usage === 1);
    }
    async open() {
        if (!this.client)
            this.client = new (protocol().OrbitalMouseClient)(this.device);
        await this.client.open();
    }
    async close() {
        await this.client?.close();
    }
    getDpiOptions() {
        const values = [];
        for (let dpi = 50; dpi <= 30000; dpi += 50)
            values.push(dpi);
        return values;
    }
    async readStatus() {
        await this.open();
        const snapshot = await this.client.readEverything();
        const { identity, settings, power } = snapshot;
        this.settings = settings;
        const stage = settings.dpiStages[settings.activeDpiStage] ?? [800, 800];
        const definition = ORBITAL_DEVICES.get(this.device.productId);
        return {
            brand: "Orbital",
            name: identity.productName || definition.name,
            ui: { defaultDisplayName: definition.name, hideLodLow: false, hideUnsupportedPollingRates: true },
            batteryPercent: definition.receiver ? power.percent : null,
            batteryState: power.state === 2 ? "Full" : power.state === 1 || power.state === 3 ? "Charging" : "Discharging",
            dpi: stage[0],
            dpiY: stage[1],
            supportsSeparateDpiAxes: true,
            pollingRateHz: settings.reportRateHz,
            supportedPollingRates: REPORT_RATES.slice(0, identity.definition.maxReportRateIndex + 1),
            activeProfile: power.profile + 1,
            connectionType: definition.receiver ? "Wireless" : "Wired",
            motionSync: settings.sensor.motionSync,
            debounceMs: settings.debounceMs,
            sleepTimeout: settings.sleepSeconds,
            angleSnapping: settings.sensor.angleSnapping,
            rippleControl: settings.sensor.rippleControl,
            performanceMode: settings.sensor.maxSpeedMode,
            angleTuning: settings.sensor.angleTuning,
            liftOffDistance: ["Low", "Medium", "High"][settings.sensor.liftOffDistance],
            firmware: [`${settings.protocol.toUpperCase()} protocol`],
        };
    }
    async apply(changes) {
        await this.open();
        await this.client.applySettings(changes);
        this.settings = null;
    }
    async setDpi(dpi, dpiY = dpi) {
        await this.readStatus();
        const stages = this.settings.dpiStages.map((pair, index) => index === this.settings.activeDpiStage ? [dpi, dpiY] : pair);
        await this.apply({ dpiStages: stages, activeDpiStage: this.settings.activeDpiStage });
    }
    async setPollingRate(rate) { await this.apply({ reportRateIndex: REPORT_RATES.indexOf(rate) }); }
    async setLiftOffDistance(lod) { await this.apply({ liftOffDistance: ["Low", "Medium", "High"].indexOf(lod) }); }
    async setMotionSync(enabled) { await this.apply({ motionSync: enabled }); }
    async setAngleSnapping(enabled) { await this.apply({ angleSnapping: enabled }); }
    async setRippleControl(enabled) { await this.apply({ rippleControl: enabled }); }
    async setPerformanceMode(enabled) { await this.apply({ highPerformance: enabled }); }
    async setDebounceTime(value) { await this.apply({ debounceMs: value }); }
    async setSleepTimeout(value) { await this.apply({ sleepSeconds: value }); }
}
