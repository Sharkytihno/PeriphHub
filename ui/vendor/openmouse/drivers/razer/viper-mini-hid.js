import { VENDOR_ID } from "../vendors.js";
import { openRazerDevice } from "./hid-open.js";
import { RAZER_READ, RAZER_REPORT_ID, RAZER_STATUS, RAZER_TRANSACTION_ID_3F, RazerProtocolError, decodeDpi, decodeFirmwareVersion, decodeLegacyPollingRate, decodeRazerResponse, decodeSerial, encodeRazerRequest, razerSetDpiCommand, razerSetExtendedEffectCommand, razerSetLegacyPollingCommand, } from "../../razer/index.js";
export const VIPER_MINI_PRODUCT_ID = 0x008a;
/**
 * Transaction id used by openrazer's legacy group (Viper / Viper Ultimate);
 * kept separate from `0x1f`, verified on the newer Viper V3 Pro firmware.
 */
export const VIPER_MINI_TRANSACTION_ID = 0xff;
// Openrazer reads DPI with the no-store byte and writes with the storage byte.
export const VIPER_MINI_DPI_READ = {
    commandClass: 0x04,
    commandId: 0x85,
    dataSize: 0x07,
    args: [0x00],
};
// Wired-only, so the legacy polling command (a divisor of 1000) covers every rate.
const RATES_WIRED = [125, 500, 1000];
const DPI_MIN = 100;
const DPI_MAX = 8500;
const RESPONSE_DELAY_MS = 100;
const RESPONSE_ATTEMPTS = 6;
const VIPER_MINI_LIGHTING_ZONE = "Logo";
const VIPER_MINI_EFFECT_MODES = [
    "Off",
    "Spectrum",
    "Static",
    "Reactive",
    "Breathing random",
    "Breathing single",
    "Breathing dual",
];
const VIPER_MINI_COLOR_MODES = ["Static", "Reactive", "Breathing single", "Breathing dual"];
const VIPER_MINI_DUAL_COLOR_MODES = ["Breathing dual"];
const VIPER_MINI_REACTIVE_MODES = ["Reactive"];
const VIPER_MINI_REACTIVE_SPEEDS = [1, 2, 3, 4];
/**
 * Razer's lighting writes answer on the legacy 0x3f transaction id, unlike this
 * mouse's DPI and polling reads, which verified 0xff. A mismatch is silent: the
 * mouse never replies and the write times out.
 */
export const VIPER_MINI_EFFECT_TRANSACTION_ID = RAZER_TRANSACTION_ID_3F;
/**
 * Razer exposes its control channel on the interface whose only collection is
 * Generic Desktop Mouse. Every other interface either belongs to a different
 * function or is a protected collection the browser will not talk to.
 */
function isControlInterface(device) {
    const [collection, ...rest] = device.collections;
    return rest.length === 0 && collection?.usagePage === 0x01 && collection?.usage === 0x02;
}
/**
 * Razer's extended effect list is a superset of Synapse's modes; only the
 * single-colour breathing mode maps to a different id (a colour tuple of zeroes
 * instead of its own id).
 */
export function viperMiniLightingEffect(lighting) {
    switch (lighting.mode) {
        case "Off":
            return "off";
        case "Spectrum":
            return "spectrum";
        case "Static":
            return "static";
        case "Reactive":
            return "reactive";
        case "Breathing random":
            return "breathing-random";
        case "Breathing single":
            return "breathing-single";
        case "Breathing dual":
            return "breathing-dual";
        default:
            return null;
    }
}
export class RazerViperMiniHidClient {
    queue = Promise.resolve();
    staticReads = new Map();
    /**
     * Razer exposes no way to read the current effect back, so the driver keeps
     * the last value it wrote here, mirroring how Synapse's settings window
     * starts from whatever it last applied rather than from the device.
     */
    lighting = null;
    device;
    constructor(device) {
        this.device = device;
    }
    static isSupported(device) {
        return device.vendorId === VENDOR_ID.razer
            && device.productId === VIPER_MINI_PRODUCT_ID
            && isControlInterface(device);
    }
    async open() {
        // On Linux "Failed to open the device" means the hidraw node for 1532:008a
        // is root-owned or the razermouse kernel driver claimed the interface.
        // Fix: udev rule granting plugdev access to that vendor/product, then
        // `sudo rmmod razermouse`. On macOS the same message means the browser
        // lacks Input Monitoring permission — see `openRazerDevice`.
        await openRazerDevice(this.device);
    }
    async close() {
        this.staticReads.clear();
        if (this.device.opened)
            await this.device.close();
    }
    displayName() {
        return this.device.productName || "Razer Viper Mini";
    }
    isWireless() {
        return false;
    }
    maxDpi() {
        return DPI_MAX;
    }
    getSupportedPollingRates() {
        return [...RATES_WIRED];
    }
    /** Every whole value, because the control validates entries against this list. */
    getDpiOptions() {
        const options = [];
        for (let dpi = DPI_MIN; dpi <= this.maxDpi(); dpi += 1)
            options.push(dpi);
        return options;
    }
    async readStatus() {
        await this.open();
        const firmware = await this.once("firmware", () => this.request(RAZER_READ.firmware));
        if (!firmware)
            throw new Error("The mouse did not report a firmware version.");
        const serial = await this.once("serial", () => this.request(RAZER_READ.serial).catch(() => null));
        const dpi = decodeDpi(await this.request(VIPER_MINI_DPI_READ));
        const pollingRateHz = decodeLegacyPollingRate(await this.request(RAZER_READ.pollingRate));
        return {
            brand: "Razer",
            name: this.displayName(),
            ui: {
                family: "razer",
                settingsReady: true,
                valuesVerified: true,
                hideUnsupportedPollingRates: true,
                // No lift-off or sensor-processing command is confirmed, so neither
                // control is offered rather than offered and left inert.
                hideProcessingCard: true,
                defaultDisplayName: "Viper Mini",
            },
            // Wired-only model: openrazer exposes no battery attribute, so neither
            // the level nor the charging query is sent.
            batteryPercent: null,
            batteryState: "Unknown",
            dpi: dpi.x,
            dpiY: dpi.y,
            supportsSeparateDpiAxes: true,
            pollingRateHz,
            supportedPollingRates: this.getSupportedPollingRates(),
            activeProfile: null,
            connectionType: "Wired",
            connectionDetail: "Wired USB",
            unitId: serial ? decodeSerial(serial) : null,
            liftOffDistance: null,
            supportedLiftOffDistances: [],
            lighting: this.lightingFromCache(),
            firmware: [`Mouse ${decodeFirmwareVersion(firmware)}`],
        };
    }
    async setDpi(dpi, dpiY = dpi) {
        const ceiling = this.maxDpi();
        for (const value of [dpi, dpiY]) {
            if (!Number.isInteger(value) || value < DPI_MIN || value > ceiling) {
                throw new Error(`DPI must be a whole number between ${DPI_MIN} and ${ceiling.toLocaleString()}.`);
            }
        }
        await this.request(razerSetDpiCommand(dpi, dpiY));
        const confirmed = decodeDpi(await this.request(VIPER_MINI_DPI_READ));
        if (confirmed.x !== dpi || confirmed.y !== dpiY) {
            throw new Error(`The mouse kept ${confirmed.x.toLocaleString()} DPI instead of ${dpi.toLocaleString()}.`);
        }
        return confirmed.x;
    }
    async setPollingRate(pollingRateHz) {
        if (!this.getSupportedPollingRates().includes(pollingRateHz)) {
            throw new Error(`This mouse does not support ${pollingRateHz.toLocaleString()} Hz on this connection.`);
        }
        await this.request(razerSetLegacyPollingCommand(pollingRateHz));
        const confirmed = decodeLegacyPollingRate(await this.request(RAZER_READ.pollingRate));
        if (confirmed !== pollingRateHz) {
            throw new Error(`The mouse kept ${confirmed.toLocaleString()} Hz instead of ${pollingRateHz.toLocaleString()} Hz.`);
        }
        return confirmed;
    }
    /**
     * Writes a lighting zone. The effect commands have no read back, so unlike
     * DPI and polling there is nothing to confirm against; the value written is
     * cached and returned as the current state.
     */
    async setLighting(lighting) {
        await this.open();
        if (lighting.zone !== VIPER_MINI_LIGHTING_ZONE) {
            throw new Error(`This mouse has no "${lighting.zone}" lighting zone.`);
        }
        const effect = viperMiniLightingEffect(lighting);
        if (!effect)
            throw new Error("Pick an effect first.");
        if (lighting.speed !== null && !VIPER_MINI_REACTIVE_SPEEDS.some((speed) => speed === lighting.speed)) {
            throw new Error(`Unknown reactive speed ${lighting.speed}.`);
        }
        const options = {};
        if (lighting.color !== null)
            options.color = lighting.color;
        if (lighting.color2 !== null)
            options.color2 = lighting.color2;
        if (lighting.speed !== null)
            options.speed = lighting.speed;
        await this.request(razerSetExtendedEffectCommand(effect, options), VIPER_MINI_EFFECT_TRANSACTION_ID);
        this.lighting = { ...lighting };
        return this.lighting;
    }
    lightingFromCache() {
        this.lighting ??= {
            zone: VIPER_MINI_LIGHTING_ZONE,
            modes: VIPER_MINI_EFFECT_MODES,
            mode: null,
            color: null,
            color2: null,
            colorModes: VIPER_MINI_COLOR_MODES,
            dualColorModes: VIPER_MINI_DUAL_COLOR_MODES,
            reactiveModes: VIPER_MINI_REACTIVE_MODES,
            speeds: VIPER_MINI_REACTIVE_SPEEDS,
            speed: null,
            writeOnly: true,
        };
        return this.lighting;
    }
    once(key, read) {
        const pending = this.staticReads.get(key);
        if (pending)
            return pending;
        const started = read();
        this.staticReads.set(key, started);
        started.catch(() => this.staticReads.delete(key));
        return started;
    }
    async request(command, transactionId = VIPER_MINI_TRANSACTION_ID) {
        const run = this.queue.then(() => this.exchange(command, transactionId), () => this.exchange(command, transactionId));
        this.queue = run.catch(() => undefined);
        return await run;
    }
    async exchange(command, transactionId) {
        await this.open();
        await this.device.sendFeatureReport(RAZER_REPORT_ID, encodeRazerRequest(command, transactionId));
        for (let attempt = 0; attempt < RESPONSE_ATTEMPTS; attempt += 1) {
            await this.delay(RESPONSE_DELAY_MS);
            const reply = this.copyDataView(await this.device.receiveFeatureReport(RAZER_REPORT_ID));
            try {
                return decodeRazerResponse(reply, command);
            }
            catch (error) {
                if (error instanceof RazerProtocolError && error.status === RAZER_STATUS.busy)
                    continue;
                throw error;
            }
        }
        throw new Error("The mouse stayed busy — it may be asleep or out of range.");
    }
    copyDataView(view) {
        return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    }
    delay(milliseconds) {
        return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
    }
}
