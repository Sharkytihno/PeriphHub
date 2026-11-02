import { buildDeluxM800MiniDpiReport as buildX11DpiReport, decodeDeluxM800MiniDpiReport as decodeX11DpiReport, DELUX_DPI_DEFAULT_ACTIVE as X11_DPI_DEFAULT_ACTIVE, DELUX_DPI_DEFAULT_STAGES as X11_DPI_DEFAULT_STAGES, DELUX_DPI_MAX, DELUX_DPI_MIN, DELUX_DPI_REPORT_ID as X11_DPI_REPORT_ID, DELUX_DPI_STAGE_COUNT as X11_DPI_STAGE_COUNT, DELUX_DPI_STEP, DELUX_DPI_VALUES, DELUX_M800_MINI_WIRELESS_PID, DELUX_OEM_VENDOR_ID, DELUX_POLLING_RATES, DELUX_PRODUCT_IDS, DELUX_PRODUCT_NAMES, DELUX_UNBRANDED_PRODUCT_IDS, nearestDeluxM800MiniDpi as nearestX11Dpi, } from "../../delux/index.js";
const POLLING_REPORT_ID = 0x06;
export const DELUX_POLLING_RATES_1D57 = [
    [0x08, 125],
    [0x04, 250],
    [0x02, 500],
    [0x01, 1000],
];
const CMD_DELAY_MS = 300;
function declaresFeatureReport(collection, reportId) {
    if (collection.featureReports.some((report) => report.reportId === reportId))
        return true;
    return collection.children.some((child) => declaresFeatureReport(child, reportId));
}
/**
 * True for the WebHID entry that carries the X11 config channel (feature
 * reports 0x04 DPI and 0x06 polling). Linux hidraw exposes it to the browser;
 * Windows splits it into a sub-collection the browser cannot open.
 */
function exposesConfigChannel(device) {
    return device.collections.some((collection) => declaresFeatureReport(collection, X11_DPI_REPORT_ID)
        && declaresFeatureReport(collection, POLLING_REPORT_ID));
}
const CONFIG_USAGE_PAGE = 0x0b;
function declaresAnyReport(collection) {
    return collection.inputReports.length > 0
        || collection.outputReports.length > 0
        || collection.featureReports.length > 0
        || collection.children.some(declaresAnyReport);
}
/**
 * True when the 0x0b config collection is listed but declares no reports: a
 * descriptor rebuilt from Windows preparsed data (OpenMouse Bridge on
 * Windows), which has no entry for this firmware's Constant-only items.
 * Bridge sends a report no collection declares to every path, and the config
 * path is the only one with a feature length. Chrome on Windows does not
 * list the collection at all (docs/delux-m600-pro-testing.md).
 */
function rebuiltConfigChannel(device) {
    return device.collections.some((collection) => collection.usagePage === CONFIG_USAGE_PAGE && !declaresAnyReport(collection));
}
const dpiStates = new Map();
export function resetDeluxDpiState(productId) {
    if (productId !== undefined) {
        dpiStates.delete(productId);
    }
    else {
        dpiStates.clear();
    }
}
function dpiStateFor(productId) {
    let state = dpiStates.get(productId);
    if (!state) {
        state = {
            stages: [...X11_DPI_DEFAULT_STAGES],
            activeStage: X11_DPI_DEFAULT_ACTIVE,
            angleSnap: false,
            rippleControl: true,
        };
        dpiStates.set(productId, state);
    }
    return state;
}
const runtimeStates = new Map();
export function resetDeluxRuntimeState(productId) {
    if (productId !== undefined) {
        runtimeStates.delete(productId);
    }
    else {
        runtimeStates.clear();
    }
}
function runtimeFor(productId) {
    let state = runtimeStates.get(productId);
    if (!state) {
        state = { pollingRateHz: 1000, batteryPercent: null };
        runtimeStates.set(productId, state);
    }
    return state;
}
export class DeluxHidClient {
    device;
    queue = Promise.resolve();
    lastStatus = null;
    listening = false;
    constructor(device) {
        this.device = device;
    }
    static isSupported(device) {
        if (device.vendorId !== DELUX_OEM_VENDOR_ID)
            return false;
        if (DELUX_UNBRANDED_PRODUCT_IDS.has(device.productId)) {
            return device.collections.length === 0
                || exposesConfigChannel(device)
                || rebuiltConfigChannel(device);
        }
        if (!DELUX_PRODUCT_IDS.has(device.productId)
            || !/\bdelux\b/i.test(device.productName || "")) {
            return false;
        }
        if (device.collections.length === 0)
            return true;
        return device.productId === DELUX_M800_MINI_WIRELESS_PID
            && device.collections.some((collection) => collection.usagePage === 0x0c);
    }
    get nativeConfig() {
        return this.device.collections.length === 0;
    }
    /**
     * Native adapters always reach the config channel. Through WebHID it is
     * enabled only for the unbranded models whose writes were verified on
     * hardware over that path (docs/delux-m600-pro-testing.md), whether the
     * collection declares its reports (Linux hidraw) or was rebuilt without
     * them (Bridge on Windows).
     */
    get settingsReachable() {
        return this.nativeConfig
            || (DELUX_UNBRANDED_PRODUCT_IDS.has(this.device.productId)
                && (exposesConfigChannel(this.device) || rebuiltConfigChannel(this.device)));
    }
    displayName() {
        const fromMap = DELUX_PRODUCT_NAMES.get(this.device.productId);
        if (fromMap)
            return fromMap;
        const name = this.device.productName?.trim();
        if (!name || name === "2.4G Wireless Device") {
            return "Delux M800 Mini";
        }
        return /^delux/i.test(name) ? name : `Delux ${name}`;
    }
    deviceBrand() {
        return "Delux";
    }
    isWireless() {
        return this.device.productId === DELUX_M800_MINI_WIRELESS_PID
            || /receiver|dongle|wireless|2\.4g/i.test(this.device.productName || "");
    }
    getSupportedPollingRates() {
        return [...DELUX_POLLING_RATES];
    }
    getDpiOptions() {
        // Every value the stage editor can encode: the app snaps stage edits to
        // this list, so a preset subset would silently round them.
        return [...DELUX_DPI_VALUES];
    }
    async open() {
        if (!this.device.opened) {
            await this.device.open();
        }
        this.startListening();
    }
    async close() {
        this.stopListening();
        this.lastStatus = null;
        if (this.device.opened) {
            await this.device.close();
        }
    }
    async startNotifications(_onChange) {
        this.startListening();
        return false;
    }
    onInputReport = (event) => {
        const data = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
        // Battery packet: report 0x03, signature 0x55, 0x40, 0x01, <percent>
        if (event.reportId === 0x03 && data.length >= 4 && data[0] === 0x55 && data[1] === 0x40 && data[2] === 0x01) {
            const pct = data[3];
            if (typeof pct === "number" && pct <= 100) {
                runtimeFor(this.device.productId).batteryPercent = pct;
                if (this.lastStatus) {
                    this.lastStatus = {
                        ...this.lastStatus,
                        batteryPercent: pct,
                        batteryState: "Discharging",
                    };
                }
            }
        }
    };
    startListening() {
        if (this.listening)
            return;
        this.listening = true;
        this.device.addEventListener("inputreport", this.onInputReport);
    }
    stopListening() {
        if (!this.listening)
            return;
        this.listening = false;
        this.device.removeEventListener("inputreport", this.onInputReport);
    }
    run(action) {
        const result = this.queue.then(action);
        this.queue = result.catch(() => { });
        return result;
    }
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    async readStatus() {
        await this.open();
        const dpiState = dpiStateFor(this.device.productId);
        if (this.nativeConfig && this.isWireless()) {
            await this.readDpiState();
        }
        const runtime = runtimeFor(this.device.productId);
        const dpi = dpiState.stages[dpiState.activeStage - 1] ?? 1600;
        const status = {
            brand: "Delux",
            name: this.displayName(),
            ui: {
                family: "delux",
                settingsReady: this.settingsReachable,
                hideUnsupportedPollingRates: true,
                hideProcessingCard: true,
                forceShowBattery: this.isWireless(),
                statusNote: this.settingsReachable
                    ? undefined
                    : "Status only: this mouse's settings channel is not reachable from a browser and needs a native driver.",
                dpiStageEditor: {
                    maxStages: X11_DPI_STAGE_COUNT,
                    countEditable: false,
                    minDpi: DELUX_DPI_MIN,
                    maxDpi: DELUX_DPI_MAX,
                    stepDpi: DELUX_DPI_STEP,
                },
            },
            batteryPercent: runtime.batteryPercent,
            batteryState: runtime.batteryPercent !== null ? "Discharging" : "Unknown",
            dpi,
            dpiStages: [...dpiState.stages],
            activeDpiStage: dpiState.activeStage - 1,
            angleSnapping: dpiState.angleSnap,
            rippleControl: dpiState.rippleControl,
            pollingRateHz: runtime.pollingRateHz,
            supportedPollingRates: this.getSupportedPollingRates(),
            activeProfile: null,
            connectionType: this.isWireless() ? "Wireless" : "Wired",
            liftOffDistance: null,
            firmware: [],
        };
        this.lastStatus = status;
        return status;
    }
    async setPollingRate(pollingRateHz) {
        await this.open();
        const entry = DELUX_POLLING_RATES_1D57.find(([, hz]) => hz === pollingRateHz);
        if (!entry) {
            throw new Error(`This mouse does not support ${pollingRateHz} Hz.`);
        }
        const rateByte = entry[0];
        const data = new Uint8Array([0x09, 0x01, rateByte, (0xff - rateByte) & 0xff, 0, 0, 0, 0]);
        await this.run(() => this.device.sendFeatureReport(POLLING_REPORT_ID, data));
        await this.delay(CMD_DELAY_MS);
        runtimeFor(this.device.productId).pollingRateHz = pollingRateHz;
        if (this.lastStatus) {
            this.lastStatus = { ...this.lastStatus, pollingRateHz };
        }
        return pollingRateHz;
    }
    async setDpi(dpi) {
        await this.open();
        const state = dpiStateFor(this.device.productId);
        const value = nearestX11Dpi(dpi);
        state.stages[state.activeStage - 1] = value;
        await this.writeDpiTable();
        if (this.lastStatus) {
            this.lastStatus = { ...this.lastStatus, dpi: value };
        }
        return value;
    }
    async setActiveDpiStage(stage) {
        await this.open();
        if (!Number.isInteger(stage) || stage < 0 || stage >= X11_DPI_STAGE_COUNT) {
            throw new RangeError(`Invalid DPI stage ${stage + 1}.`);
        }
        const state = dpiStateFor(this.device.productId);
        state.activeStage = stage + 1;
        await this.writeDpiTable();
        if (this.lastStatus) {
            this.lastStatus = {
                ...this.lastStatus,
                dpi: state.stages[stage] ?? this.lastStatus.dpi,
                activeDpiStage: stage,
            };
        }
        return stage;
    }
    async setDpiStageValue(stage, dpi) {
        await this.open();
        if (!Number.isInteger(stage) || stage < 0 || stage >= X11_DPI_STAGE_COUNT) {
            throw new RangeError(`Invalid DPI stage ${stage + 1}.`);
        }
        const state = dpiStateFor(this.device.productId);
        const value = nearestX11Dpi(dpi);
        state.stages[stage] = value;
        await this.writeDpiTable();
        if (this.lastStatus) {
            this.lastStatus = { ...this.lastStatus, dpiStages: [...state.stages] };
        }
        return value;
    }
    async setAngleSnapping(enabled) {
        await this.open();
        const state = dpiStateFor(this.device.productId);
        state.angleSnap = enabled;
        await this.writeDpiTable();
        if (this.lastStatus) {
            this.lastStatus = { ...this.lastStatus, angleSnapping: enabled };
        }
        return enabled;
    }
    async setRippleControl(enabled) {
        await this.open();
        const state = dpiStateFor(this.device.productId);
        state.rippleControl = enabled;
        await this.writeDpiTable();
        if (this.lastStatus) {
            this.lastStatus = { ...this.lastStatus, rippleControl: enabled };
        }
        return enabled;
    }
    async readDpiState() {
        const state = dpiStateFor(this.device.productId);
        try {
            const view = await this.run(() => this.device.receiveFeatureReport(X11_DPI_REPORT_ID));
            const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
            const decoded = decodeX11DpiReport(bytes);
            if (!decoded)
                return;
            state.stages = [...decoded.stages];
            state.activeStage = decoded.activeStage;
            state.angleSnap = decoded.angleSnap;
            state.rippleControl = decoded.rippleControl;
        }
        catch {
            // Some transports cannot read this feature report; preserve cached state.
        }
    }
    async writeDpiTable() {
        const state = dpiStateFor(this.device.productId);
        const report = buildX11DpiReport({
            stages: state.stages,
            activeStage: state.activeStage,
            angleSnap: state.angleSnap,
            rippleControl: state.rippleControl,
            wired: !this.isWireless(),
        });
        const payload = new Uint8Array(report.length - 1);
        payload.set(report.subarray(1));
        await this.run(() => this.device.sendFeatureReport(X11_DPI_REPORT_ID, payload));
        await this.delay(CMD_DELAY_MS);
    }
}
