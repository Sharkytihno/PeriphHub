import { FATER_CMD, FATER_CONFIG_USAGE_PAGE, FATER_POLLING_RATES, FATER_PRODUCT_IDS, FATER_PRODUCT_NAMES, FATER_REPORT_ID, FATER_VENDOR_ID, faterDecodeValue, faterDividerToHz, faterEncodeGet, } from "../../fater/index.js";
/**
 * Fater MCR-9000B over its Holtek vendor feature report (see
 * `@openmouse/protocol/fater`). Read-only on purpose: the frame is borrowed
 * from a sibling firmware and has not been seen on this mouse, so the first
 * hardware test only has to prove that the two GET commands echo back. Writes
 * (polling divider, active profile) are the same frame without the GET bit
 * and follow once a read round-trips.
 */
export class FaterHidClient {
    device;
    queue = Promise.resolve();
    constructor(device) {
        this.device = device;
    }
    static isSupported(device) {
        if (device.vendorId !== FATER_VENDOR_ID)
            return false;
        if (!FATER_PRODUCT_IDS.includes(device.productId))
            return false;
        const search = (collection) => collection.usagePage === FATER_CONFIG_USAGE_PAGE || collection.children.some(search);
        return device.collections.some(search);
    }
    getDpiOptions() {
        return [];
    }
    async open() {
        if (!this.device.opened)
            await this.device.open();
    }
    async close() {
        if (this.device.opened)
            await this.device.close();
    }
    async readStatus() {
        await this.open();
        const divider = await this.query(FATER_CMD.reportRateDivider);
        const profile = await this.query(FATER_CMD.profile);
        const pollingRateHz = divider === null ? null : faterDividerToHz(divider);
        const name = FATER_PRODUCT_NAMES.get(this.device.productId)
            ?? (this.device.productName?.trim() || "Fater mouse");
        return {
            brand: "Fater",
            name,
            ui: {
                family: "fater",
                settingsReady: false,
                valuesVerified: pollingRateHz !== null,
                hideUnsupportedPollingRates: true,
                statusNote: pollingRateHz === null
                    ? "The mouse did not answer its polling-rate query, so nothing could be read."
                    : "Read-only for now: polling rate and active profile. DPI lives in a config page WebHID cannot read on Windows.",
            },
            batteryPercent: null,
            batteryState: "Unknown",
            dpi: 0,
            pollingRateHz: pollingRateHz ?? 0,
            supportedPollingRates: [...FATER_POLLING_RATES],
            activeProfile: profile,
            liftOffDistance: null,
            connectionType: "Wired",
            firmware: [],
        };
    }
    /** Value byte of a GET reply, or null when the mouse does not echo the command. */
    query(command) {
        const run = this.queue.then(async () => {
            try {
                await this.device.sendFeatureReport(FATER_REPORT_ID, faterEncodeGet(command));
                const view = await this.device.receiveFeatureReport(FATER_REPORT_ID);
                return faterDecodeValue(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), command);
            }
            catch {
                return null;
            }
        });
        this.queue = run.catch(() => undefined);
        return run;
    }
}
