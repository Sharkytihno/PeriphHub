/**
 * Control-shell integration for Endgame Gear WE (OP1we).
 *
 * Keeps multi-collection HID discovery, peer bind, and connect coalescing out
 * of control.ts so other brand PRs do not touch WE-specific paths.
 */
import { EggWeHidClient } from "./egg-we-hid.js";
/** WebHID filters for requestDevice (cmd FF02, notify FF01, identity FF04). */
export const EGG_WE_HID_FILTERS = [
    { vendorId: 0x3367, usagePage: 0xff02 },
    { vendorId: 0x3367, usagePage: 0xff01 },
    { vendorId: 0x3367, usagePage: 0xff04 },
    { vendorId: 0x3367 },
];
export const EGG_WE_DISPLAY_NAME = "Endgame Gear OP1we";
export function isEggWeClient(client) {
    return client instanceof EggWeHidClient;
}
export function eggWeIsSupported(device) {
    return EggWeHidClient.isSupported(device);
}
export function eggWeSupportScore(device) {
    return EggWeHidClient.supportScore(device);
}
export function eggWeCreate(device) {
    return new EggWeHidClient(device);
}
/** One logical mouse from cable + receiver (+ multi-collection USB). */
export function eggWePickDevices(devices) {
    return EggWeHidClient.pickDevices(devices);
}
export function eggWeFromAuthorized(devices) {
    return EggWeHidClient.fromAuthorizedDevices(devices);
}
/** Unique merge of requestDevice results + already-authorized devices. */
export async function eggWeAuthorizedPool(selected) {
    const granted = typeof navigator !== "undefined" && navigator.hid
        ? await navigator.hid.getDevices()
        : [];
    return [...selected, ...granted].filter((device, index, list) => list.indexOf(device) === index);
}
export async function eggWePrepare(client, devices) {
    const all = devices
        ?? (typeof navigator !== "undefined" && navigator.hid
            ? await navigator.hid.getDevices()
            : []);
    client.bindPeers(all);
}
/**
 * Sidebar list: non-WE devices + one WE logical entry.
 * `isOtherSupported` is provided by the shell (createSupportedClient !== null).
 */
export function eggWeMergeLogicalDevices(all, isOtherSupported) {
    const nonWe = all.filter((device) => isOtherSupported(device) && !EggWeHidClient.isSupported(device));
    return [...nonWe, ...EggWeHidClient.pickDevices(all)];
}
/**
 * Coalesce multi-interface connect events for an already-known or new WE mouse.
 */
export async function eggWeResolveConnect(eventDevice, active, activeDevice, allDevices) {
    const preferred = EggWeHidClient.pickDevices(allDevices)[0];
    if (!preferred)
        return { action: "ignore" };
    if (active?.ownsDevice(eventDevice) || activeDevice === preferred) {
        if (active) {
            active.bindPeers(allDevices);
            return { action: "refresh", client: active };
        }
        return { action: "ignore" };
    }
    if (preferred !== eventDevice) {
        const next = EggWeHidClient.fromAuthorizedDevices(allDevices);
        if (!next || next.device === activeDevice)
            return { action: "ignore" };
        return { action: "activate", client: next, reason: "path" };
    }
    if (activeDevice === preferred)
        return { action: "ignore" };
    const weClient = EggWeHidClient.fromAuthorizedDevices(allDevices);
    if (!weClient)
        return { action: "ignore" };
    return { action: "activate", client: weClient, reason: "new" };
}
export function eggWeOwnsDevice(client, device) {
    return client?.ownsDevice(device) ?? false;
}
