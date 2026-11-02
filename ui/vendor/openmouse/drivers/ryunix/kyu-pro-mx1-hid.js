import { decodeKyuProMx1Telemetry, RYUNIX_CONFIG_REPORT_ID, RYUNIX_PRODUCT_IDS, RYUNIX_USAGE, RYUNIX_USAGE_PAGE, RYUNIX_VENDOR_ID, RYUNIX_WIRELESS_PRODUCT_ID, } from "../../ryunix/index.js";
function hasControlCollection(collections) {
    return collections.some((collection) => collection.usagePage === RYUNIX_USAGE_PAGE
        && collection.usage === RYUNIX_USAGE
        && collection.featureReports.some((report) => report.reportId === RYUNIX_CONFIG_REPORT_ID)
        || hasControlCollection(collection.children));
}
export class KyuProMx1Client {
    device;
    telemetry = null;
    listening = false;
    constructor(device) {
        this.device = device;
    }
    static isSupported(device) {
        return device.vendorId === RYUNIX_VENDOR_ID
            && RYUNIX_PRODUCT_IDS.has(device.productId)
            && hasControlCollection(device.collections);
    }
    onInputReport = (event) => {
        const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
        const telemetry = decodeKyuProMx1Telemetry(bytes, event.reportId);
        if (telemetry)
            this.telemetry = telemetry;
    };
    async open() {
        if (!KyuProMx1Client.isSupported(this.device)) {
            throw new Error("The Ryunix configuration collection is unavailable.");
        }
        if (!this.device.opened)
            await this.device.open();
        if (!this.listening) {
            this.device.addEventListener("inputreport", this.onInputReport);
            this.listening = true;
        }
    }
    async close() {
        if (this.listening) {
            this.device.removeEventListener("inputreport", this.onInputReport);
            this.listening = false;
        }
        if (this.device.opened)
            await this.device.close();
    }
    getDpiOptions() {
        return [];
    }
    getPollingRateOptions() {
        return [];
    }
    async readStatus() {
        await this.open();
        const telemetry = this.telemetry;
        const wireless = this.device.productId === RYUNIX_WIRELESS_PRODUCT_ID;
        return {
            brand: "Ryunix",
            name: this.device.productName || "Kyu Pro MX1",
            ui: {
                family: "ryunix",
                settingsReady: false,
                valuesVerified: false,
                pollingReadOnly: true,
                hideUnsupportedPollingRates: true,
                hideProcessingCard: true,
                hideSignalCard: true,
                hideSleepCard: true,
                forceShowBattery: true,
                defaultDisplayName: "Kyu Pro MX1",
                statusNote: telemetry
                    ? `Read-only telemetry; the mouse is ${telemetry.active ? "active" : "inactive"}.`
                    : "Read-only telemetry appears after the mouse sends a status report.",
            },
            batteryPercent: telemetry?.batteryPercent ?? null,
            batteryState: telemetry
                ? telemetry.charging ? "Charging" : "Discharging"
                : "Unknown",
            dpi: 0,
            pollingRateHz: telemetry?.pollingRateHz ?? 0,
            activeProfile: null,
            connectionType: wireless ? "Wireless" : "Wired",
            connectionDetail: wireless ? "2.4 GHz receiver" : "USB",
            liftOffDistance: null,
            ...(telemetry?.ledMode ? {
                lighting: {
                    zone: "Logo & Scroll",
                    modes: [telemetry.ledMode],
                    mode: telemetry.ledMode,
                    color: null,
                    color2: null,
                    colorModes: [],
                    dualColorModes: [],
                    reactiveModes: [],
                    speeds: [],
                    speed: null,
                },
            } : {}),
            firmware: [],
        };
    }
}
