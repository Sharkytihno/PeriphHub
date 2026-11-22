import { ryunixPollingHz } from "./protocol.js";
export const RYUNIX_VENDOR_ID = 0x04f3;
export const RYUNIX_WIRED_PRODUCT_ID = 0x026e;
export const RYUNIX_WIRELESS_PRODUCT_ID = 0x026f;
export const RYUNIX_PRODUCT_IDS = new Set([
    RYUNIX_WIRED_PRODUCT_ID,
    RYUNIX_WIRELESS_PRODUCT_ID,
]);
export const RYUNIX_USAGE_PAGE = 0x0a;
export const RYUNIX_USAGE = 0xc7;
export const RYUNIX_TELEMETRY_REPORT_ID = 0x04;
export const RYUNIX_CONFIG_REPORT_ID = 0x05;
const LED_MODES = {
    0x00: "Off",
    0x01: "Spectrum",
    0x02: "Breathing single",
    0x03: "Static",
    0x04: "Wave",
    0x05: "Reactive",
    0x06: "Cycling",
    0x07: "Wave",
};
/** Decode the telemetry body delivered by input report 0x04 (six bytes minimum, nine with sensor type). */
export function decodeKyuProMx1Telemetry(data, reportId) {
    if (reportId !== RYUNIX_TELEMETRY_REPORT_ID || data.length < 6)
        return null;
    const activeByte = data[0];
    const pollingRateHz = ryunixPollingHz(data[2]);
    const batteryPercent = data[3];
    const batteryStatusCode = data[4];
    if ((activeByte !== 0 && activeByte !== 1)
        || pollingRateHz === null
        || batteryPercent > 100
        || batteryStatusCode > 2)
        return null;
    return {
        active: activeByte === 1,
        dpiStage: data[1],
        pollingRateHz,
        batteryPercent,
        charging: batteryStatusCode === 1,
        batteryStatusCode,
        ledMode: LED_MODES[data[5]] ?? null,
        ledModeCode: data[5],
        maxPollingCode: data.length > 7 ? data[7] : null,
        sensorType: data.length > 8 && data[8] !== 0 ? data[8] : null,
    };
}
