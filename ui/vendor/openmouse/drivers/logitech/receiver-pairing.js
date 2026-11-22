import { isBoltReceiverProduct } from "../../logitech/index.js";
import { hasHidppLongCollection, hasHidppShortCollection } from "./bolt.js";
const DEVICE_KINDS = {
    0x00: "unknown",
    0x01: "keyboard",
    0x02: "mouse",
    0x03: "numpad",
    0x04: "presenter",
    0x07: "remote",
    0x08: "trackball",
    0x09: "touchpad",
    0x0a: "tablet",
    0x0b: "gamepad",
    0x0c: "joystick",
    0x0d: "headset",
};
export const RECEIVER_PAIRING_SLOTS = [1, 2, 3, 4, 5, 6];
const SHORT_REPORT_ID = 0x10;
const LONG_REPORT_ID = 0x11;
const RECEIVER_DEVICE_INDEX = 0xff;
const HIDPP1_GET_LONG_REGISTER = 0x83;
const HIDPP1_ERROR = 0x8f;
const RECEIVER_INFO_REGISTER = 0xb5;
const UNIFYING_PAIRING_INFO = 0x20;
const BOLT_PAIRING_INFO = 0x50;
/** The receiver answers from its own memory; a missing answer means it never will. */
export const RECEIVER_PAIRING_TIMEOUT_MS = 500;
/** Sub-register holding one slot's pairing information. */
export function receiverPairingSubRegister(productId, slot) {
    return isBoltReceiverProduct(productId) ? BOLT_PAIRING_INFO + slot : UNIFYING_PAIRING_INFO + slot - 1;
}
/** The short request that reads one slot's pairing information (report 0x10 body). */
export function encodeReceiverPairingRequest(productId, slot) {
    return new Uint8Array([
        RECEIVER_DEVICE_INDEX,
        HIDPP1_GET_LONG_REGISTER,
        RECEIVER_INFO_REGISTER,
        receiverPairingSubRegister(productId, slot),
        0x00,
        0x00,
    ]);
}
/**
 * HID++ 1.0 errors that mean "nothing on this slot": invalid address, invalid
 * value and unknown device. Busy, resource and other errors leave the slot
 * unknown, so an occupied slot is never reported empty by a passing error.
 */
const EMPTY_SLOT_ERRORS = new Set([0x02, 0x03, 0x08]);
/**
 * Decode a reply to `encodeReceiverPairingRequest`, given without its report
 * id. Returns the slot's kind for a pairing reply, `"empty"` or `"failed"` for
 * an HID++ 1.0 error on the register, and `undefined` for any other report.
 */
export function decodeReceiverPairingReply(productId, slot, reportId, report) {
    const subRegister = receiverPairingSubRegister(productId, slot);
    if (report[0] !== RECEIVER_DEVICE_INDEX)
        return undefined;
    // An HID++ 1.0 error echoes the sub-ID and register, then the error code
    // (`[0xFF, 0x8F, 0x83, 0xB5, code]`), but not the sub-register. Only one read
    // is in flight at a time, and the reader stops at the first slot that does
    // not answer, so a late error can never be taken for another slot's.
    if (reportId === SHORT_REPORT_ID && report[1] === HIDPP1_ERROR
        && report[2] === HIDPP1_GET_LONG_REGISTER && report[3] === RECEIVER_INFO_REGISTER) {
        return EMPTY_SLOT_ERRORS.has(report[4] ?? -1) ? "empty" : "failed";
    }
    if (reportId !== LONG_REPORT_ID || report[1] !== HIDPP1_GET_LONG_REGISTER
        || report[2] !== RECEIVER_INFO_REGISTER || report[3] !== subRegister) {
        return undefined;
    }
    // `pairInfo[0]` is the echoed sub-register, as Solaar indexes it.
    const pairInfo = report.subarray(3);
    const kindByte = isBoltReceiverProduct(productId) ? pairInfo[1] : pairInfo[7];
    if (kindByte === undefined)
        return undefined;
    return DEVICE_KINDS[kindByte & 0x0f] ?? "unknown";
}
/** Kinds that are pointing devices the mouse drivers serve. */
export function isPointingKind(kind) {
    return kind === "mouse" || kind === "trackball" || kind === "touchpad";
}
/**
 * Read every pairing slot of a Logitech receiver.
 *
 * `interfaces` are the authorized HID interfaces of one receiver (on Windows,
 * WebHID returns the short and long HID++ collections as separate devices and
 * the long reply arrives on the long one). Interfaces this call opened are
 * closed again; one that was already open is left open.
 *
 * The result is all or nothing. It resolves `null`, so the caller keeps its
 * descriptor-level guess, whenever the table cannot be read in full: a slot
 * that does not answer in time, an error that does not mean "empty", a send
 * that fails or hangs, a receiver that cannot be opened (an older Nano
 * receiver), or one where every slot is empty, which looks the same as a
 * receiver without the register. A list is never partial.
 */
export async function readLogitechReceiverPairings(interfaces, timeoutMs = RECEIVER_PAIRING_TIMEOUT_MS) {
    const sender = interfaces.find(hasHidppShortCollection);
    if (!sender)
        return null;
    const listeners = interfaces.filter((device) => hasHidppShortCollection(device) || hasHidppLongCollection(device));
    const productId = sender.productId;
    const opened = [];
    let pending = null;
    const onInputReport = (event) => {
        if (!pending)
            return;
        const report = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
        const reply = decodeReceiverPairingReply(productId, pending.slot, event.reportId, report);
        if (reply === undefined)
            return;
        const { resolve } = pending;
        pending = null;
        resolve(reply);
    };
    try {
        for (const device of listeners) {
            if (!device.opened) {
                await device.open();
                opened.push(device);
            }
            device.addEventListener("inputreport", onInputReport);
        }
        const pairings = [];
        for (const slot of RECEIVER_PAIRING_SLOTS) {
            // One deadline covers both the send and the reply, so a send that never
            // settles cannot hold the interfaces open.
            let timer;
            const reply = await new Promise((resolve) => {
                timer = setTimeout(() => {
                    pending = null;
                    resolve(undefined);
                }, timeoutMs);
                pending = { slot, resolve };
                sender.sendReport(SHORT_REPORT_ID, encodeReceiverPairingRequest(productId, slot)).catch(() => {
                    pending = null;
                    resolve("failed");
                });
            });
            clearTimeout(timer);
            if (reply === undefined || reply === "failed")
                return null;
            if (reply !== "empty")
                pairings.push({ slot, kind: reply });
        }
        return pairings.length > 0 ? pairings : null;
    }
    catch {
        return null;
    }
    finally {
        pending = null;
        for (const device of listeners)
            device.removeEventListener("inputreport", onInputReport);
        for (const device of opened)
            await device.close().catch(() => undefined);
    }
}
