import { CMD, HYPERX_USAGE, HYPERX_USAGE_PAGE, HYPERX_VENDOR_ID_HP, HYPERX_VENDOR_ID_KINGSTON, SUPPORTED_POLLING_RATES, decodeBattery, decodeConnection, decodeDpiSettings, decodeHardwareInfo, dpiOptions, encodeSave, encodeSetDpi, encodeSetLod, encodeSetPollingRate, isValidDpi, } from "../../hyperx/index.js";
const REPORT_SIZE = 64;
const RESPONSE_TIMEOUT_MS = 500;
const RESPONSE_POLL_MS = 5;
const WRITE_SETTLE_MS = 60;
const WRITE_CONFIRM_ATTEMPTS = 5;
function hex(value) {
    return `0x${value.toString(16).padStart(2, "0")}`;
}
/**
 * HyperX Pulsefire Haste — WebHID client.
 *
 * The config channel is a single vendor collection (usage page 0xFF00, usage
 * 0x01) carrying one 64-byte **output** report and one 64-byte **input**
 * report.  It declares no feature report, so this driver transfers through
 * `sendReport()` / the `inputreport` event instead of `sendFeatureReport()`.
 *
 * Reads (0x46/0x50/0x51/0x53/0x54) echo the request's opcode at byte 0 of
 * their reply; writes (0xD0/0xD3/0xDE) are fire-and-forget and must be
 * confirmed by re-reading the matching getter.
 *
 * The mouse is write-direct: DPI writes target onboard profile 0 (the profile
 * NGENUITY opens as "Profile 1") and are persisted with a SAVE packet, then
 * re-read through the 0x53 DPI-settings report so staged values are confirmed
 * rather than assumed.
 */
export class HyperXHidClient {
    device;
    onReport = null;
    inbox = [];
    constructor(device) {
        this.device = device;
    }
    static isSupported(device) {
        const vid = device.vendorId;
        if (vid !== HYPERX_VENDOR_ID_KINGSTON && vid !== HYPERX_VENDOR_ID_HP)
            return false;
        const hasVendorCollection = (collections) => collections.some((collection) => (collection.usagePage === HYPERX_USAGE_PAGE && collection.usage === HYPERX_USAGE) ||
            hasVendorCollection(collection.children));
        return hasVendorCollection(device.collections);
    }
    get supportedPollingRates() {
        return [...SUPPORTED_POLLING_RATES];
    }
    getDpiOptions() {
        return dpiOptions();
    }
    async open() {
        if (!this.device.opened)
            await this.device.open();
        if (!this.onReport) {
            this.inbox = [];
            this.onReport = (event) => {
                const data = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
                if (data.length >= REPORT_SIZE) {
                    this.inbox.push(data.subarray(0, REPORT_SIZE));
                }
            };
            this.device.addEventListener("inputreport", this.onReport);
        }
    }
    async close() {
        if (this.onReport) {
            this.device.removeEventListener("inputreport", this.onReport);
            this.onReport = null;
        }
        this.inbox = [];
        if (this.device.opened)
            await this.device.close();
    }
    // ---------------------------------------------------------------------------
    // Report I/O
    // ---------------------------------------------------------------------------
    /**
     * Send a 64-byte output report and wait for a reply echoing `opcode` at byte
     * 0.  Other interfaces (mouse input, keyboard) share this HIDDevice; their
     * reports are filtered out by length and opcode.
     */
    async sendQuery(opcode) {
        await this.open();
        const buf = new Uint8Array(REPORT_SIZE);
        buf[0] = opcode;
        const deadline = performance.now() + RESPONSE_TIMEOUT_MS;
        await this.device.sendReport(0, buf);
        while (performance.now() < deadline) {
            const index = this.inbox.findIndex((candidate) => candidate[0] === opcode);
            if (index !== -1)
                return this.inbox.splice(index, 1)[0];
            await this.delay(RESPONSE_POLL_MS);
        }
        throw new Error(`HyperX command ${hex(opcode)} was not answered.`);
    }
    /** Fire-and-forget write; no reply is expected. */
    async sendCommand(buf) {
        await this.open();
        await this.device.sendReport(0, buf.buffer);
    }
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    // ---------------------------------------------------------------------------
    // Reads
    // ---------------------------------------------------------------------------
    async getHardwareInfo() {
        const resp = await this.sendQuery(CMD.GET_HARDWARE_INFO);
        const info = decodeHardwareInfo(resp);
        return {
            firmware: info?.firmware ?? "unknown",
            product: info?.product ?? this.device.productName ?? "",
        };
    }
    async getConnection() {
        const resp = await this.sendQuery(CMD.GET_CONNECTION);
        const type = decodeConnection(resp);
        return { type, detail: type === "Wireless" ? "2.4 GHz receiver" : type === "Wired" ? "USB" : "" };
    }
    async getBattery() {
        const resp = await this.sendQuery(CMD.GET_BATTERY);
        return decodeBattery(resp) ?? { percent: null, state: "Unknown" };
    }
    async getDpiSettings() {
        const resp = await this.sendQuery(CMD.GET_DPI);
        return decodeDpiSettings(resp);
    }
    // ---------------------------------------------------------------------------
    // Writes
    // ---------------------------------------------------------------------------
    async setDpi(dpi, dpiY = dpi) {
        if (!isValidDpi(dpi) || !isValidDpi(dpiY)) {
            throw new Error("HyperX DPI must be 200–16,000 in 100 DPI steps.");
        }
        await this.open();
        for (const [profile, value] of [[0, dpi], [1, dpiY]]) {
            const buf = encodeSetDpi(profile, value);
            if (buf)
                await this.sendCommand(buf);
        }
        const save = encodeSave(0x03);
        await this.sendCommand(save);
        await this.delay(WRITE_SETTLE_MS);
        const confirmed = await this.confirmDpi((settings) => settings !== null && settings.profiles[0] === dpi);
        if (confirmed && confirmed.profiles[0] !== dpi) {
            throw new Error(`The mouse kept ${confirmed.profiles[0].toLocaleString()} DPI instead of ${dpi.toLocaleString()}.`);
        }
        return confirmed?.profiles[0] ?? dpi;
    }
    async setPollingRate(rate) {
        if (!SUPPORTED_POLLING_RATES.includes(rate)) {
            throw new Error(`HyperX supports ${SUPPORTED_POLLING_RATES.join(", ")} Hz.`);
        }
        const buf = encodeSetPollingRate(rate);
        if (!buf)
            throw new Error(`Failed to encode polling rate ${rate} Hz.`);
        await this.sendCommand(buf);
        await this.delay(WRITE_SETTLE_MS);
        return rate;
    }
    async setLiftOffDistance(value) {
        if (value !== "Low" && value !== "High") {
            throw new Error("HyperX supports 1 mm (Low) or 2 mm (High) lift-off distance.");
        }
        const buf = encodeSetLod(value);
        await this.sendCommand(buf);
        const save = encodeSave(0x03);
        await this.sendCommand(save);
        await this.delay(WRITE_SETTLE_MS);
        const confirmed = await this.confirmDpi((settings) => settings !== null && settings.liftOffDistance === value);
        if (confirmed && confirmed.liftOffDistance !== value) {
            throw new Error(`The mouse kept ${confirmed.liftOffDistance ?? "an unknown"} lift-off distance instead of ${value}.`);
        }
    }
    /** Re-read DPI settings until they match, tolerating fire-and-forget write latency. */
    async confirmDpi(matches) {
        let settings = await this.getDpiSettings().catch(() => null);
        for (let attempt = 1; attempt < WRITE_CONFIRM_ATTEMPTS && !matches(settings); attempt += 1) {
            await this.delay(WRITE_SETTLE_MS);
            settings = await this.getDpiSettings().catch(() => null);
        }
        return settings;
    }
    // ---------------------------------------------------------------------------
    // High-level API
    // ---------------------------------------------------------------------------
    async readStatus() {
        await this.open();
        // Hardware info must answer, or this is not a HyperX config interface.
        const [infoResult, dpiResult, batteryResult, connectionResult] = await Promise.allSettled([
            this.getHardwareInfo(),
            this.getDpiSettings(),
            this.getBattery(),
            this.getConnection(),
        ]);
        if (infoResult.status === "rejected") {
            throw new Error(`HyperX control interface did not answer hardware info. ${infoResult.reason}`);
        }
        const info = infoResult.value;
        const dpi = dpiResult.status === "fulfilled" ? dpiResult.value : null;
        const battery = batteryResult.status === "fulfilled" ? batteryResult.value : null;
        const connection = connectionResult.status === "fulfilled" ? connectionResult.value : null;
        const activeDpi = dpi?.profiles[dpi.activeProfile] ?? dpi?.profiles[0] ?? 1600;
        const isWireless = connection?.type === "Wireless";
        const settingsReady = dpi !== null;
        return {
            brand: "HyperX",
            name: info.product || this.device.productName || "HyperX Mouse",
            ui: {
                family: "hyperx",
                settingsReady,
                hideLodLow: false,
                hideUnsupportedPollingRates: true,
                hideProcessingCard: true,
                defaultDisplayName: info.product || this.device.productName || "HyperX Mouse",
            },
            batteryPercent: isWireless ? battery?.percent ?? null : null,
            batteryState: isWireless ? battery?.state ?? "Unknown" : "Unknown",
            dpi: activeDpi,
            dpiY: activeDpi,
            pollingRateHz: 1000,
            supportedPollingRates: this.supportedPollingRates,
            activeProfile: dpi?.activeProfile ?? null,
            connectionType: connection?.type ?? (isWireless ? "Wireless" : "Wired"),
            connectionDetail: connection?.detail,
            liftOffDistance: dpi?.liftOffDistance ?? null,
            supportedLiftOffDistances: ["Low", "High"],
            firmware: info.firmware ? [`Mouse v${info.firmware}`] : [],
        };
    }
}
