/**
 * X13 Pro identity and raw status framing. Evidence: docs/redgear-x13-pro-testing.md.
 * DPI/rate mappings come from intercepted original vendor calls (writes blocked).
 * Hardware acceptance remains separate from encoding evidence.
 */
export const REDGEAR_X13_VENDOR_ID = 0x1b80;
export const REDGEAR_X13_PRODUCT_ID = 0xb412;
export const REDGEAR_X13_USAGE_PAGE = 0xff00;
export const REDGEAR_X13_USAGE = 1;
export const REDGEAR_X13_STATUS_REPORT_ID = 3;
export const REDGEAR_X13_STATUS_BYTES = 40;
export const REDGEAR_X13_SUPPORT = {
    name: "Redgear X13 Pro",
    verified: false,
    nativeStatusReadTested: true,
    bridgeStatusReadTested: true,
    dpiWriteReadBackTested: true,
    pollingWriteReadBackTested: true,
    staticColorChannelsTested: true,
    standardButtonWriteReadBackTested: true,
    settingsReady: true,
};
/** Accept a complete native Windows feature buffer, including its report ID. */
export function redgearDecodeRawStatus(report) {
    if (report.length !== REDGEAR_X13_STATUS_BYTES) {
        throw new RangeError(`X13 Pro status must be ${REDGEAR_X13_STATUS_BYTES} bytes including its report ID`);
    }
    if (report[0] !== REDGEAR_X13_STATUS_REPORT_ID) {
        throw new Error("Unexpected X13 Pro status report ID");
    }
    // Ownership is separate from the input buffer; framing does not interpret fields.
    return { payload: report.slice(1) };
}
/** WebHID/Bridge return feature data without the separately requested report ID. */
export function redgearDecodeStatusPayload(payload) {
    if (payload.length !== REDGEAR_X13_STATUS_BYTES - 1) {
        throw new RangeError("X13 Pro status payload must be 39 bytes without its report ID");
    }
    return { payload: payload.slice() };
}
export const REDGEAR_X13_DPI = [
    400, 800, 1200, 2400, 3200, 4000, 4800,
];
export const REDGEAR_X13_RATES = [125, 250, 500, 1000];
export function redgearDecodeSettings(payload) {
    redgearDecodeStatusPayload(payload);
    const dpi = REDGEAR_X13_DPI[payload[0]];
    const pollingRateHz = REDGEAR_X13_RATES[payload[1]];
    if (dpi === undefined || pollingRateHz === undefined)
        throw new RangeError("Unknown X13 Pro DPI/rate code");
    return { dpi, pollingRateHz };
}
/** Mutate exactly one proven byte in a fresh status payload. Never use cached vendor defaults. */
export function redgearEncodeDpi(payload, dpi) {
    redgearDecodeSettings(payload);
    const index = REDGEAR_X13_DPI.indexOf(dpi);
    if (index < 0)
        throw new RangeError("Unsupported X13 Pro DPI");
    const result = payload.slice();
    result[0] = index;
    return result;
}
export function redgearEncodePollingRate(payload, rate) {
    redgearDecodeSettings(payload);
    const index = REDGEAR_X13_RATES.indexOf(rate);
    if (index < 0)
        throw new RangeError("Unsupported X13 Pro polling rate");
    const result = payload.slice();
    result[1] = index;
    return result;
}
/** Original vendor UI encoding. Kept distinct from the corrected physical channel order. */
export function redgearEncodeVendorStaticColor(payload, color) {
    redgearDecodeSettings(payload);
    if (!/^#[0-9a-f]{6}$/i.test(color))
        throw new RangeError("Expected #rrggbb colour");
    const result = payload.slice();
    // High nibble: mode 0 (Lock Single-Color). Bit 0: automatic colour cycle off.
    // Preserve the other low-nibble flags, DPI/rate, speed, bindings and stage colours.
    result[2] = result[2] & 0x0e;
    for (let channel = 0; channel < 3; channel++)
        result[4 + channel] = parseInt(color.slice(1 + channel * 2, 3 + channel * 2), 16);
    return result;
}
/** Tested hardware order is R,B,G; the vendor UI mistakenly sends R,G,B. */
export function redgearEncodeStaticColor(payload, color) {
    if (!/^#[0-9a-f]{6}$/i.test(color))
        throw new RangeError("Expected #rrggbb colour");
    return redgearEncodeVendorStaticColor(payload, `#${color.slice(1, 3)}${color.slice(5, 7)}${color.slice(3, 5)}`);
}
export function redgearDecodeStaticColor(payload) {
    redgearDecodeSettings(payload);
    const color = `#${[payload[4], payload[6], payload[5]].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    return { mode: (payload[2] & 0xf1) === 0 ? "Static" : null, color };
}
export { redgearDecodeButtons, redgearEncodeButton, X13_BUTTON_NAMES, X13_BUTTON_ACTIONS, } from "./buttons.js";
