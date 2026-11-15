/**
 * Scyrox's CompX generation — vendor id 0x3554 and the report-8 flash
 * protocol this package already implements for the Lamzu Atlantis generation,
 * the Pulsar 4K receiver, VGN and Teevolution. Scyrox is one more brand on
 * CompX's ODM stack, so this module adds only the product catalog and the
 * device identity; the transport, flash layout and field sealing are
 * inherited from the shared family modules. Two things are not inherited:
 * the rate bytes follow CompX's own table, not Lamzu's (both products declare
 * the "pulsar" rate family), and the 3955 sensor keeps its DPI stage values
 * in a region of their own rather than the legacy fields (both declare
 * dpiLayout "sensor3955").
 *
 * Verified read-only on a Scyrox V8S, mouse firmware v5.07: the wired mouse
 * 0x3554:0xf515 and its "Scyrox Turbo 8k dongle" receiver 0x3554:0xf517 — see
 * docs/scyrox-v8s-testing.md. Every other flash field the Atlantis client
 * reads decoded cleanly on both transports; no write has been exercised yet.
 */
export const SCYROX_VENDOR_ID = 0x3554;
/** The V8S identity from the command 0x01 handshake, read on wired 0xf515. */
export const SCYROX_V8S_CID = 0x3e;
export const SCYROX_V8S_MID = 0x05;
/** Product ids this brand owns on CompX's shared vendor id. */
export const SCYROX_PRODUCT_IDS = [0xf515, 0xf517];
/**
 * The "20K" switch: 20,000 FPS sensor scanning, which the vendor configurator
 * offers in advanced settings and disables until Competitive Mode (this
 * driver's performance mode) is on. A one-byte field at flash 8, named
 * Scyrox20K in the vendor's own flash map.
 */
export const SCYROX_V8S_20K_ADDRESS = 8;
/**
 * The 3955's five lift-off heights, as codes 1-5 of the shared lift-off byte
 * (flash 10). From the configurator's UI strings, which list them per sensor;
 * the V8S read code 2 (0.9 mm) on both transports.
 */
export const SCYROX_V8S_LIFT_OFF_MILLIMETRES = [0.7, 0.9, 1.2, 1.4, 1.6];
/**
 * Polling rates Scyrox's web configurator offers on the V8S. The 1,000 Hz byte
 * (0x01) was read on the wire on both transports, and the 4,000 Hz byte (0x20)
 * was read from a mouse the configurator had set to 4,000 Hz; the rest of the
 * byte table is the configurator's own encoder.
 */
const RATES_V8S = [125, 250, 500, 1000, 2000, 4000, 8000];
/**
 * Both transports speak CompX's own rate bytes (`rateFamily: "pulsar"`): the
 * vendor configurator writes 0x10, 0x20 and 0x40 for 2,000, 4,000 and 8,000 Hz,
 * and the mouse held 0x20 while reporting 4,000 Hz. Neither Lamzu family fits —
 * "wired" would write 0x20 for 2,000 Hz, which this firmware reads as 4,000,
 * and the read-back would then confirm a rate the mouse is not on, while
 * "receiver" would write 0x10 for 1,000 Hz, which it reads as 2,000.
 */
export const SCYROX_PRODUCTS = new Map([
    [0xf515, {
            brand: "Scyrox",
            model: "V8S",
            wireless: false,
            pollingRates: RATES_V8S,
            rateFamily: "pulsar",
            // The 3955 sensor keeps the stage values in six-byte records at flash
            // 6912; the legacy fields at 12 still hold the factory defaults, which is
            // why a driver reading them displayed 400 where the mouse was on 1,600.
            dpiLayout: "sensor3955",
            verified: true,
            minDpi: 50,
            maxDpi: 50000,
            dpiStep: 50,
            // Scyrox's configurator offers at most five DPI presets.
            maxDpiStages: 5,
            // The lift-off byte is a five-height scale here, not Lamzu's two stops,
            // so the stop setter stays off and the scale carries the control.
            supportsLiftOffDistance: false,
            liftOffMillimetres: SCYROX_V8S_LIFT_OFF_MILLIMETRES,
            // Flash 185 is SensorMode on this firmware, an LP/HP/Corded enum the
            // vendor tool mostly switches by itself, not the boolean the Atlantis
            // client's hyper mode expects. The configurator's "Highest performance"
            // toggle (shown as "Competitive Mode" once on) writes flash 181, which is
            // this client's performance mode and stays enabled.
            supportsHyperMode: false,
            // Mouse Angle Mode, -30 to 30 degrees at flash 189 and 191.
            supportsAngleTuning: true,
            // The configurator's Restore button: command 0x09.
            supportsFactoryReset: true,
            // The configurator's Scyrox sleep setter writes flash 173 and 183 alike.
            mirrorSleepToPerformanceTime: true,
        }],
    [0xf517, {
            brand: "Scyrox",
            model: "V8S",
            wireless: true,
            pollingRates: RATES_V8S,
            rateFamily: "pulsar",
            dpiLayout: "sensor3955",
            verified: true,
            minDpi: 50,
            maxDpi: 50000,
            dpiStep: 50,
            maxDpiStages: 5,
            supportsLiftOffDistance: false,
            liftOffMillimetres: SCYROX_V8S_LIFT_OFF_MILLIMETRES,
            supportsHyperMode: false,
            supportsAngleTuning: true,
            supportsFactoryReset: true,
            mirrorSleepToPerformanceTime: true,
        }],
]);
/**
 * PeriphHub (1.9.0): VGN's own vendor id 0x391D. VGN's web configurator
 * (hub.vgnlab.com) drives these mice with the same class it uses for its CompX
 * models on 0x3554 (family "vgn-y2": report 8 on usage page 0xFF02, flash read
 * 0x08 / write 0x07, per-field seal, 3955 stage records at 6912 or legacy
 * fields at 12 chosen by sensor, rate bytes 1000/rate below 1 kHz and
 * rate/2000*16 above — CompX's "pulsar" family). The stage layout is probed on
 * the mouse (ScyroxHidClient.probeDpiLayout), never assumed. Not verified on
 * hardware: every product is unverified and drops the Scyrox-only extras.
 */
export const VGN_COMPX_VENDOR_ID = 0x391d;
const vgnCompx = (model, wireless) => ({
    brand: "VGN",
    model,
    wireless,
    pollingRates: RATES_V8S,
    rateFamily: "pulsar",
    dpiLayout: "sensor3955",
    verified: false,
    otherBrand: true,
    minDpi: 50,
    maxDpi: 30000,
    dpiStep: 50,
    maxDpiStages: 8,
    supportsHyperMode: false,
    supportsAngleTuning: false,
    supportsFactoryReset: false,
});
/** From the configurator's device table: wired mouse, then its receiver (receiver: true). */
export const VGN_COMPX_PRODUCTS = new Map([
    [0x1005, vgnCompx("Dragonfly 3 Master", false)],
    [0x1a05, vgnCompx("Dragonfly 3 Master", true)],
    [0x101d, vgnCompx("Dragonfly 3 MasterGT", false)],
    [0x1a1a, vgnCompx("Dragonfly 3 MasterGT", true)],
    [0x1034, vgnCompx("Dragonfly Y2 V2 MasterGT", false)],
    [0x1a2f, vgnCompx("Dragonfly Y2 V2 MasterGT", true)],
    [0x1032, vgnCompx("Dragonfly F2 MasterGT", false)],
    [0x102d, vgnCompx("Dragonfly F2 MasterGT", true)],
    [0x1038, vgnCompx("Dragonfly F1 V2 SE+", false)],
    [0x1a32, vgnCompx("Dragonfly F1 V2 SE+", true)],
    [0x1036, vgnCompx("Dragonfly F2 Turbo+", false)],
    [0x1a31, vgnCompx("Dragonfly F2 Turbo+", true)],
    [0x1035, vgnCompx("Dragonfly F2 Turbo", false)],
    [0x1a30, vgnCompx("Dragonfly F2 Turbo", true)],
    [0x1039, vgnCompx("Dragonfly 3 MINI SE+", true)],
    [0x1a33, vgnCompx("Dragonfly 3 MINI SE+", false)],
]);
export function scyroxProduct(vendorId, productId) {
    if (vendorId === VGN_COMPX_VENDOR_ID)
        return VGN_COMPX_PRODUCTS.get(productId);
    if (vendorId !== SCYROX_VENDOR_ID)
        return undefined;
    return SCYROX_PRODUCTS.get(productId);
}
