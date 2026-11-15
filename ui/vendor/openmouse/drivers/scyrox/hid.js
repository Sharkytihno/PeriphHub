import { LamzuAtlantisHidClient } from "../lamzu-atlantis/hid.js";
import { SCYROX_V8S_20K_ADDRESS, scyroxProduct } from "../../scyrox/index.js";
import { LAMZU_ATLANTIS_FLASH as FLASH, LAMZU_ATLANTIS_SENSOR3955_STAGE_STRIDE as SENSOR3955_STAGE_STRIDE, LAMZU_ATLANTIS_STAGE_STRIDE as STAGE_STRIDE, lamzuAtlantisFieldIsIntact, } from "../../lamzu/index.js";
/**
 * Scyrox's CompX generation: the V8S mouse (wired 0x3554:0xf515) and its
 * "Turbo 8k" dongle (0x3554:0xf517). The Atlantis client does the talking —
 * same report-8 transport, same flash fields, same per-field sealing — with
 * one exception the product catalog carries: the rate bytes follow CompX's own
 * table (rateFamily "pulsar"), not Lamzu's. The dongle answered the Atlantis
 * client's exact read sequence on hardware; the wired endpoint was read
 * through the Pulsar driver's full-image sweep before this catalog existed,
 * and every field that sweep covered holds the same bytes with the seal
 * intact.
 *
 * Reads are verified on both transports (see docs/scyrox-v8s-testing.md);
 * writes inherit the Atlantis client's write-then-read-back behavior and still
 * need hardware verification one by one.
 *
 * PeriphHub (1.5.3): CompX ships the same 0xf517 dongle with other brands' mice
 * (an "ATTACK SHARK Mouse" Attack Shark V8, diagnostic #17) whose sensor is not
 * the 3955: the six-byte records at flash 6912 are blank there and the read
 * failed with "corrupt DPI stage". The layout is now probed once per session —
 * the 3955 records when their seal holds, else the legacy four-byte fields
 * when theirs does — and a non-Scyrox mouse drops the Scyrox-only extras
 * (20K switch, 3955 lift-off scale, 50,000 DPI ceiling).
 */
export class ScyroxHidClient extends LamzuAtlantisHidClient {
    constructor(device) {
        super(device, scyroxProduct(device.vendorId, device.productId) ?? null);
        this.layoutProbed = false;
    }
    static isSupported(device) {
        return scyroxProduct(device.vendorId, device.productId) !== undefined
            && LamzuAtlantisHidClient.hasConfigCollection(device);
    }
    /** The "20K" switch is a Scyrox-only byte, so the catalog cannot carry it. */
    turboModeAddress() {
        return this.isOtherBrand() ? null : SCYROX_V8S_20K_ADDRESS;
    }
    isOtherBrand() {
        return this.productOverride?.otherBrand === true;
    }
    async readStatus(live = false) {
        if (!this.layoutProbed)
            await this.probeDpiLayout();
        return await super.readStatus(live);
    }
    /** Reads stage 0 in both layouts; keeps the catalog's one unless only the legacy seal holds. */
    async probeDpiLayout() {
        await this.open();
        await this.transaction(async () => {
            const base = this.productOverride;
            if (!base || base.dpiLayout !== "sensor3955") {
                this.layoutProbed = true;
                return;
            }
            const record3955 = await this.readRaw(FLASH.sensor3955DpiValues, SENSOR3955_STAGE_STRIDE);
            if (lamzuAtlantisFieldIsIntact(record3955)) {
                this.layoutProbed = true;
                return;
            }
            const legacy = await this.readRaw(FLASH.dpiValues, STAGE_STRIDE);
            if (lamzuAtlantisFieldIsIntact(legacy) && base.otherBrand) {
                // Already another brand in the catalog (VGN on 0x391D): keep its identity
                this.productOverride = { ...base, dpiLayout: "legacy", maxDpi: Math.min(base.maxDpi, 26000), liftOffMillimetres: undefined };
            }
            else if (lamzuAtlantisFieldIsIntact(legacy)) {
                const name = (this.device.productName || "").trim();
                const brand = /attack\s*shark/i.test(name) ? "Attack Shark" : (name || "CompX");
                this.productOverride = {
                    ...base,
                    brand,
                    model: brand === "Attack Shark" ? "V8" : "(dongle 8K)",
                    dpiLayout: "legacy",
                    verified: false,
                    otherBrand: true,
                    // PAW3395/3950-class ceiling; the legacy record itself encodes up to 51,200.
                    maxDpi: 26000,
                    liftOffMillimetres: undefined,
                    supportsAngleTuning: false,
                };
            }
            // Neither seal holds: keep the catalog layout so the read still fails loudly.
            this.layoutProbed = true;
        });
    }
}
