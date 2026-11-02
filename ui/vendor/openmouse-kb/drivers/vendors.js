import { ARBITER_CONFIG_USAGE, ARBITER_PRODUCTS, ARBITER_VENDOR_ID, ARBITER_VENDOR_ID_ALT, } from "../arbiter/index.js";
import { KOCHI_VENDOR_ID, KOCHI_HB68_PRODUCT_ID, KOCHI_CONFIG_USAGE_PAGE, KOCHI_CONFIG_USAGE } from "../kochi/index.js";
import { WOOTING_CONFIG_USAGE, WOOTING_CONFIG_USAGE_PAGE, WOOTING_CONFIG_USAGE_PAGE_STANDARD, WOOTING_VENDOR_ID, } from "../wooting/index.js";
import { WUQUE_CONFIG_USAGE, WUQUE_CONFIG_USAGE_PAGE, WUQUE_PRODUCTS, WUQUE_PRODUCT_IDS, WUQUE_VENDOR_ID, WUQUE_VENDOR_ID_ALT, } from "../wuque/index.js";
import { RAZER_KEYBOARD_PRODUCT_IDS, RAZER_VENDOR_ID, } from "../razer/index.js";
import { LOGITECH_HIDPP_BLUETOOTH_USAGE_PAGE, LOGITECH_HIDPP_USAGE_PAGE, LOGITECH_KEYBOARD_PRODUCT_IDS, LOGITECH_RECEIVER_PRODUCT_IDS, LOGITECH_VENDOR_ID, } from "../logitech/index.js";
import { KEYCHRON_CONFIG_USAGE, KEYCHRON_CONFIG_USAGE_PAGE, KEYCHRON_HE_PRODUCT_IDS, KEYCHRON_VENDOR_ID, } from "../keychron/index.js";
import { STEELSERIES_CONFIG_USAGE, STEELSERIES_CONFIG_USAGE_PAGE, STEELSERIES_KEYBOARD_PRODUCT_IDS, STEELSERIES_VENDOR_ID, } from "../steelseries/index.js";
import { VIA_USAGE, VIA_USAGE_PAGE } from "../via/index.js";
export const VENDOR_ID = {
    kochi: KOCHI_VENDOR_ID,
    wooting: WOOTING_VENDOR_ID,
    wuque: WUQUE_VENDOR_ID,
    wuqueAlt: WUQUE_VENDOR_ID_ALT,
    razer: RAZER_VENDOR_ID,
    logitech: LOGITECH_VENDOR_ID,
    steelseries: STEELSERIES_VENDOR_ID,
    keychron: KEYCHRON_VENDOR_ID,
    arbiter: ARBITER_VENDOR_ID,
    arbiterAlt: ARBITER_VENDOR_ID_ALT,
};
// Match the two command-capable collections rather than enumerating every
// product and variant PID. The driver checks the PID family after selection.
export const WOOTING_HID_FILTERS = [
    { vendorId: WOOTING_VENDOR_ID, usagePage: WOOTING_CONFIG_USAGE_PAGE, usage: WOOTING_CONFIG_USAGE },
    { vendorId: WOOTING_VENDOR_ID, usagePage: WOOTING_CONFIG_USAGE_PAGE_STANDARD, usage: WOOTING_CONFIG_USAGE },
];
// Wuque Studio boards expose their command interface on usage page 0xFFB0,
// usage 0x01. As with Wooting, offer only that collection: the same physical
// keyboard also presents a boot-keyboard, a consumer-control and a mouse
// collection on the same interface, and matching those would list it several
// times in the picker. Product ids are paired with their own vendor id — the
// 80 HE ids are enumerated under 0x36B5, not 0x1CA6.
export const WUQUE_HID_FILTERS = WUQUE_PRODUCT_IDS.map((productId) => ({
    vendorId: WUQUE_PRODUCTS[productId].vendorId,
    productId,
    usagePage: WUQUE_CONFIG_USAGE_PAGE,
    usage: WUQUE_CONFIG_USAGE,
}));
/** Only the HB68 config collection; never its keyboard or streaming usages. */
export const KOCHI_HID_FILTERS = [{
        vendorId: KOCHI_VENDOR_ID, productId: KOCHI_HB68_PRODUCT_ID,
        usagePage: KOCHI_CONFIG_USAGE_PAGE, usage: KOCHI_CONFIG_USAGE,
    }];
/**
 * Razer keyboards put the 90-byte control channel on the Generic Desktop /
 * Mouse collection. Each catalogued keyboard id is filtered explicitly so a
 * Razer mouse with the same collection never appears in the keyboard picker.
 */
export const RAZER_HID_FILTERS = RAZER_KEYBOARD_PRODUCT_IDS.map((productId) => ({
    vendorId: RAZER_VENDOR_ID,
    productId,
    usagePage: 0x0001,
    usage: 0x0002,
}));
/**
 * Logitech HID++ keyboards answer on the 0xFF00 pair over USB and on 0xFF43
 * over Bluetooth. Both pages and every catalogued keyboard product id are
 * offered; the driver rejects a collection without a HID++ page.
 */
export const LOGITECH_HID_FILTERS = [
    ...LOGITECH_KEYBOARD_PRODUCT_IDS.flatMap((productId) => [
        { vendorId: LOGITECH_VENDOR_ID, productId, usagePage: LOGITECH_HIDPP_USAGE_PAGE, usage: 0x0002 },
        { vendorId: LOGITECH_VENDOR_ID, productId, usagePage: LOGITECH_HIDPP_BLUETOOTH_USAGE_PAGE },
    ]),
    ...LOGITECH_RECEIVER_PRODUCT_IDS.flatMap((productId) => [
        { vendorId: LOGITECH_VENDOR_ID, productId, usagePage: LOGITECH_HIDPP_USAGE_PAGE, usage: 0x0002 },
        { vendorId: LOGITECH_VENDOR_ID, productId, usagePage: LOGITECH_HIDPP_BLUETOOTH_USAGE_PAGE },
    ]),
];
/** SteelSeries Apex Pro command collection (0xFFC0:1). */
export const STEELSERIES_HID_FILTERS = STEELSERIES_KEYBOARD_PRODUCT_IDS.map((productId) => ({
    vendorId: STEELSERIES_VENDOR_ID,
    productId,
    usagePage: STEELSERIES_CONFIG_USAGE_PAGE,
    usage: STEELSERIES_CONFIG_USAGE,
}));
/**
 * Keychron Hall-effect boards expose the HE command group on the VIA raw-HID
 * collection (0xFF60:0x61). Each catalogued HE product id is filtered
 * explicitly so a non-HE Keychron keyboard never reaches the picker.
 */
export const KEYCHRON_HID_FILTERS = KEYCHRON_HE_PRODUCT_IDS.map((productId) => ({
    vendorId: KEYCHRON_VENDOR_ID,
    productId,
    usagePage: KEYCHRON_CONFIG_USAGE_PAGE,
    usage: KEYCHRON_CONFIG_USAGE,
}));
/**
 * Arbiter Studio keyboards expose one configuration collection per catalog
 * entry. Each product id is paired with its own vendor id and usage page
 * (0xFF01 or 0xFF02), because the same keyboard also presents boot-keyboard and
 * consumer collections that would list it several times in the picker.
 */
export const ARBITER_HID_FILTERS = ARBITER_PRODUCTS.map((entry) => ({
    vendorId: entry.vendorId,
    productId: entry.productId,
    usagePage: entry.usagePage,
    usage: ARBITER_CONFIG_USAGE,
}));
/**
 * VIA/QMK raw HID (0xFF60:0x61). Any vendor can ship VIA firmware, so this
 * filter has no vendor or product id; it matches the collection only.
 */
export const VIA_HID_FILTERS = [{ usagePage: VIA_USAGE_PAGE, usage: VIA_USAGE }];
export const SUPPORTED_HID_FILTERS = [
    ...KOCHI_HID_FILTERS,
    ...WOOTING_HID_FILTERS,
    ...WUQUE_HID_FILTERS,
    ...RAZER_HID_FILTERS,
    ...LOGITECH_HID_FILTERS,
    ...STEELSERIES_HID_FILTERS,
    ...KEYCHRON_HID_FILTERS,
    ...ARBITER_HID_FILTERS,
    ...VIA_HID_FILTERS,
];
