import { PULSAR_FLASH as FLASH } from "../../pulsar/index.js";
import { teevolutionDecodeDpi, teevolutionEncodeDpi } from "../../teevolution/index.js";
import { PulsarHidClient } from "../pulsar/pulsar-hid.js";
import { GRAVASTAR_PRODUCT_IDS } from "./products.js";
// GravaStar's web configurator (controlhub.top/gravastar) is the same Compx
// "Control Hub" build as bbb.pulsar.gg: report 8, the same commands and the
// same flash map, so the Pulsar report-8 client does the talking. Its cfg.json
// (v1.1.0, CID 18) is the source for the per-model limits below.
const GRAVASTAR_VENDOR_ID = 0x3554;
// cfg.json: MID 1-2 carry a PAW3395 (50-26,000 DPI), MID 3-5 a PAW3950
// (50-30,000 in 50s, then 100s to 32,000 through the x2 dpiEx flag).
const PAW3950_MIDS = new Set([3, 4, 5]);
// LightOffTimeOptions, in the flash's 10-second units.
const SLEEP_UNITS = [1, 3, 6, 12, 18, 30, 60, 90];
export class GravaStarHidClient extends PulsarHidClient {
    static isSupported(device) {
        return device.vendorId === GRAVASTAR_VENDOR_ID
            && GRAVASTAR_PRODUCT_IDS.has(device.productId)
            && PulsarHidClient.hasConfigCollection(device);
    }
    async readStatus() {
        const status = await super.readStatus();
        return {
            ...status,
            brand: "GravaStar",
            name: this.device.productName || "GravaStar Mouse",
            sleepTimeout: status.sleepTimeout == null ? null : status.sleepTimeout * 10,
            supportedLiftOffDistances: this.liftOffDistances(),
            // GravaStar's app hides the receiver LED (receiverLightShow: false).
            dongleLedEnabled: null,
        };
    }
    getDpiOptions() {
        const paw3950 = this.hasPaw3950();
        const options = [];
        for (let dpi = 50; dpi <= (paw3950 ? 30000 : 26000); dpi += 50)
            options.push(dpi);
        if (paw3950)
            for (let dpi = 30100; dpi <= 32000; dpi += 100)
                options.push(dpi);
        return options;
    }
    getSleepOptions() {
        return SLEEP_UNITS.map((units) => units * 10);
    }
    async setSleepTimeout(seconds) {
        const units = seconds / 10;
        if (!SLEEP_UNITS.includes(units))
            throw new Error("Unsupported GravaStar sleep timeout.");
        // Unlike Pulsar's, GravaStar's app writes only the sleep byte: 183 is the
        // separate highest-performance duration.
        return (await this.setVerifiedByte(FLASH.sleepTime, units, "sleep timeout")) * 10;
    }
    async setLiftOffDistance(liftOffDistance) {
        if (!this.liftOffDistances().includes(liftOffDistance)) {
            throw new Error(`${liftOffDistance} lift-off distance is not available on this sensor.`);
        }
        return await super.setLiftOffDistance(liftOffDistance);
    }
    encodeDpi(dpi) {
        return teevolutionEncodeDpi(dpi);
    }
    decodeDpi(data) {
        return teevolutionDecodeDpi(data);
    }
    // The PAW3395 offers 1 mm and 2 mm only; the PAW3950 adds 0.7 mm (Low).
    liftOffDistances() {
        return this.hasPaw3950() ? ["Low", "Medium", "High"] : ["Medium", "High"];
    }
    hasPaw3950() {
        return PAW3950_MIDS.has(this.deviceInfo?.mid ?? 0);
    }
}
