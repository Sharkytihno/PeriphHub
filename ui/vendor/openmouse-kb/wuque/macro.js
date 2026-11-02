/**
 * Wuque Studio vendor HID protocol — Macro group (7).
 *
 * Reverse-engineered from the vendor web configurator bundle (`app.pretty.js`)
 * and confirmed against a physical BABAO60 HE (`0x1CA6:0x1B10`, firmware
 * protocol 1.2.1.0). Group id and sub-command ids come verbatim from the
 * bundle's `Vo`/`Yg` enums (`app.pretty.js:50506`, `app.pretty.js:50538`);
 * request/reply layouts from the builders `yw` (`51908`) and `ww` (`51894`) and
 * the decoders `macroModeRecData` (`51931`) and `Cw` (`51924-51935`).
 *
 * The device stores macros as a flat array of packed 4-byte *events*; a macro is
 * a `{status, delay, keyCode}` action list (`macro.v2list` model, PROTOCOL.md §7).
 * A single `getMacro`/`setMacro` frame carries at most
 * {@link WUQUE_MACRO_EVENTS_PER_FRAME} 15 events, addressed by a 0-based chunk
 * index (`offset`): chunk `f` holds events `15*f .. 15*f+15-1`
 * (`app.pretty.js:56721`). The 60 HE reports 16 macro slots / 960 total actions
 * (`macroSpaceInfo`; group 2 sub 14 — decoded by the device/global module, not
 * here).
 *
 * Reply framing: the board echoes `[group, subCommand]` and the payload starts
 * at byte 2 (see `./framing.ts`). The Macro replies carry **no status byte** —
 * payload byte 0 is data (`app.pretty.js` findings §5.4). A short reply, a
 * group/sub-command echo mismatch, or `isWuqueUnsupported(reply)` all decode to
 * `null`; these decoders never throw.
 */
import { WUQUE_GROUP, WUQUE_MACRO_COMMAND, WUQUE_MACRO_EVENTS_PER_FRAME, encodeWuqueCommand, isWuqueUnsupported, wuqueReplyPayload, wuqueU16, wuqueU16Bytes, wuqueU32, wuqueU32Bytes, } from "./framing.js";
/**
 * Pack an event into the vendor's u32 word
 * (`(status===1?1:0)<<31 | delay<<16 | keyCode`, `app.pretty.js:51915-51921`).
 *
 * Range-guards mirror the bundle's encoder: `delay` MUST be an integer in
 * `[0, 32767]` and `keyCode` an integer in `[0, 65535]`, otherwise `null` is
 * returned instead of throwing. `status` is coerced (`status === 1 ? 1 : 0`),
 * matching the vendor encoder.
 */
export function wuquePackMacroEvent(event) {
    const { status, delay, keyCode } = event;
    if (!Number.isInteger(delay) || delay < 0 || delay > 0x7fff)
        return null;
    if (!Number.isInteger(keyCode) || keyCode < 0 || keyCode > 0xffff)
        return null;
    const word = ((status === 1 ? 1 : 0) << 31) | (delay << 16) | (keyCode & 0xffff);
    return word >>> 0;
}
/**
 * Unpack a vendor u32 word back into `{status, delay, keyCode}`
 * (`wq`, `app.pretty.js:50590`): `status = word>>>31 & 1`,
 * `delay = word>>>16 & 0x7FFF`, `keyCode = word & 0xFFFF`. Every u32 is a valid
 * event, so this never fails.
 */
export function wuqueUnpackMacroEvent(word) {
    const value = word >>> 0;
    return {
        status: (value >>> 31) & 1,
        delay: (value >>> 16) & 0x7fff,
        keyCode: value & 0xffff,
    };
}
/** `getMacroMode` request: `[7,1,macroId]` (`yw`, `app.pretty.js:51894-51907`). */
export function encodeWuqueGetMacroMode(macroId) {
    return encodeWuqueCommand(WUQUE_GROUP.macro, WUQUE_MACRO_COMMAND.getMacroMode, [macroId]);
}
/**
 * `setMacroMode` request: `[7,2,macroId,valid,actNum(2B LE),repNum(2B LE),mode]`
 * (`NG`, `app.pretty.js:51898-51906`). `actNum`/`repNum` are written as
 * little-endian u16 and masked to 16 bits.
 */
export function encodeWuqueSetMacroMode(mode) {
    return encodeWuqueCommand(WUQUE_GROUP.macro, WUQUE_MACRO_COMMAND.setMacroMode, [
        mode.macroId,
        mode.valid ? 1 : 0,
        ...wuqueU16Bytes(mode.actNum),
        ...wuqueU16Bytes(mode.repNum),
        mode.mode,
    ]);
}
/**
 * Decode a `getMacroMode`/`setMacroMode` reply (`macroModeRecData`,
 * `app.pretty.js:51931`). Payload layout: `macroId` (byte 0), `valid`
 * (`byte 1 === 1`), `actNum` u16 LE (bytes 2-3), `repNum` u16 LE (bytes 4-5),
 * `mode` (byte 6) — seven bytes, no status byte.
 *
 * Returns `null` for a short reply, a group/sub-command echo mismatch (including
 * `0xFF` unsupported), or fewer than 7 payload bytes. Both sub-commands are
 * accepted because `setMacroMode` shares this decoder (`app.pretty.js` findings
 * §2.1).
 */
export function decodeWuqueMacroMode(reply) {
    if (isWuqueUnsupported(reply))
        return null;
    const payload = wuqueReplyPayload(reply, WUQUE_GROUP.macro, WUQUE_MACRO_COMMAND.getMacroMode) ??
        wuqueReplyPayload(reply, WUQUE_GROUP.macro, WUQUE_MACRO_COMMAND.setMacroMode);
    if (payload === null || payload.length < 7)
        return null;
    const actNum = wuqueU16(payload, 2);
    const repNum = wuqueU16(payload, 4);
    if (actNum === null || repNum === null)
        return null;
    return {
        macroId: payload[0],
        valid: payload[1] === 1,
        actNum,
        repNum,
        mode: payload[6],
    };
}
/**
 * `getMacro` request: `[7,3,macroId,offset]` (`ww` Read, `app.pretty.js:51908-51923`).
 * `offset` is the 0-based chunk index (each chunk holds up to 15 events).
 */
export function encodeWuqueGetMacro(macroId, offset) {
    return encodeWuqueCommand(WUQUE_GROUP.macro, WUQUE_MACRO_COMMAND.getMacro, [macroId, offset]);
}
/**
 * Decode a `getMacro` reply (`Cw`, `app.pretty.js:51924-51935`). Payload:
 * `macroId` (byte 0), `offset` (byte 1), then packed little-endian u32 events
 * from byte 2 through the end of the (64-byte) frame.
 *
 * Returns `null` for a short reply, a group/sub-command echo mismatch, an
 * unsupported (`0xFF`) answer, or fewer than 2 payload bytes. The board
 * zero-pads the frame, so trailing all-zero events are returned as-is; the
 * number of *real* actions is `actNum` from {@link decodeWuqueMacroMode}.
 */
export function decodeWuqueMacroData(reply) {
    if (isWuqueUnsupported(reply))
        return null;
    const payload = wuqueReplyPayload(reply, WUQUE_GROUP.macro, WUQUE_MACRO_COMMAND.getMacro);
    if (payload === null || payload.length < 2)
        return null;
    const events = [];
    for (let at = 2; at + 4 <= payload.length && events.length < WUQUE_MACRO_EVENTS_PER_FRAME; at += 4) {
        events.push(wuqueUnpackMacroEvent(wuqueU32(payload, at)));
    }
    return { macroId: payload[0], offset: payload[1], events };
}
/**
 * `setMacro` request: `[7,4,macroId,offset, ...event(4B LE)...]` (`OG` Write,
 * `app.pretty.js:51908-51923`). At most
 * {@link WUQUE_MACRO_EVENTS_PER_FRAME} events fit in one frame
 * (`4 + 15*4 = 64` bytes), so extra events are **truncated** to the first 15 —
 * matching the vendor UI, which slices the action list into 15-event chunks
 * before calling the builder (`app.pretty.js:56721`).
 *
 * Returns `null` when any of the first 15 events is out of range for
 * {@link wuquePackMacroEvent} (delay > 32767 or keyCode > 65535); otherwise the
 * 64-byte frame.
 */
export function encodeWuqueSetMacro(macroId, offset, events) {
    const params = [macroId, offset];
    const count = Math.min(events.length, WUQUE_MACRO_EVENTS_PER_FRAME);
    for (let i = 0; i < count; i++) {
        const word = wuquePackMacroEvent(events[i]);
        if (word === null)
            return null;
        params.push(...wuqueU32Bytes(word));
    }
    return encodeWuqueCommand(WUQUE_GROUP.macro, WUQUE_MACRO_COMMAND.setMacro, params);
}
