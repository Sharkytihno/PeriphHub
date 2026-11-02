import { WootingHidClient } from "./wooting/hid.js";
import { WuqueHidClient } from "./wuque/hid.js";
import { KochiHidClient } from "./kochi/hid.js";
import { RazerKeyboardHidClient } from "./razer/hid.js";
import { LogitechKeyboardHidClient } from "./logitech/hid.js";
import { SteelSeriesKeyboardHidClient } from "./steelseries/hid.js";
import { KeychronHidClient } from "./keychron/hid.js";
import { ArbiterKeyboardHidClient } from "./arbiter/hid.js";
import { ViaHidClient } from "./via/hid.js";
export const DEVICE_DRIVERS = [
    { brand: "Kochi", supports: (device) => KochiHidClient.isSupported(device), create: (device) => new KochiHidClient(device), score: () => 6 },
    { brand: "Wooting", supports: (device) => WootingHidClient.isSupported(device), create: (device) => new WootingHidClient(device), score: () => 6 },
    { brand: "Wuque Studio", supports: (device) => WuqueHidClient.isSupported(device), create: (device) => new WuqueHidClient(device), score: () => 6 },
    { brand: "Razer", supports: (device) => RazerKeyboardHidClient.isSupported(device), create: (device) => new RazerKeyboardHidClient(device), score: () => 6 },
    { brand: "Logitech", supports: (device) => LogitechKeyboardHidClient.isSupported(device), create: (device) => new LogitechKeyboardHidClient(device), score: () => 6 },
    { brand: "SteelSeries", supports: (device) => SteelSeriesKeyboardHidClient.isSupported(device), create: (device) => new SteelSeriesKeyboardHidClient(device), score: () => 6 },
    { brand: "Keychron", supports: (device) => KeychronHidClient.isSupported(device), create: (device) => new KeychronHidClient(device), score: () => 6 },
    { brand: "Arbiter Studio", supports: (device) => ArbiterKeyboardHidClient.isSupported(device), create: (device) => new ArbiterKeyboardHidClient(device), score: () => 6 },
    // Last: VIA matches any board with a raw-HID collection, so brand drivers win.
    { brand: "VIA", supports: (device) => ViaHidClient.isSupported(device), create: (device) => new ViaHidClient(device), score: () => 5 },
];
function driverFor(device) {
    return DEVICE_DRIVERS.find((driver) => driver.supports(device));
}
export function createSupportedClient(device) {
    return driverFor(device)?.create(device) ?? null;
}
export function clientSupportScore(device) {
    return driverFor(device)?.score(device) ?? 0;
}
export function deviceBrand(client) {
    return driverFor(client.device)?.brand ?? "Unknown";
}
