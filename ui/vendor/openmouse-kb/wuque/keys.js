/**
 * Wuque Studio (BABAO / ZOOM) vendor HID protocol — LayoutAndKey (group 3) and
 * HigherKey / advanced keys (group 6) codecs, plus the device keycode category
 * table.
 *
 * Reverse-engineered from the vendor bundle `app.pretty.js`
 * (`findings/3-keys-layout.md`, read ranges 50460-50610, 51580-51790,
 * 52098-52232, 52782-52903, 56836-56956) and confirmed against a physical
 * BABAO60 HE (`0x1CA6:0x1B10`, firmware protocol 1.2.1.0).
 *
 * All requests are 64-byte output reports (report id 0); replies are input
 * reports echoing `[group, subCommand]` with the payload from byte 2 (see
 * `./framing.ts`). Neither group carries a status byte on the 60 HE: payload
 * offset 0 of a Key reply is an echoed parameter, not a status.
 *
 * Every decoder returns `null` — never throws — on a short reply, a group /
 * subCommand echo mismatch, or an unsupported answer (`subCommand` echoed as
 * `0xFF`). Every multi-byte field is little-endian.
 */
import { WUQUE_ACCESS, WUQUE_GROUP, WUQUE_HIGHER_KEY_COMMAND, WUQUE_HIGHER_KEY_MODE, WUQUE_KEY_COMMAND, WUQUE_MATRIX_COLS, encodeWuqueCommand, encodeWuqueFrame, isWuqueUnsupported, wuqueReplyPayload, wuqueTravelMm, wuqueTravelRaw, wuqueU16, wuqueU16Bytes, } from "./framing.js";
/**
 * Payload of a group-3 reply whose echoed subCommand is one of `subCommands`,
 * or null when the reply is short, the group / subCommand does not match, or
 * the board reports the subCommand as unsupported (`0xFF`). Set variants
 * (`SetKeyLayout` = 2, `SetKeyCode` = 4) echo their own subCommand but are
 * decoded by the same readers, mirroring the vendor app (`keyLayoutResult`,
 * `keyCodeResult`).
 */
function wuqueKeyPayload(reply, ...subCommands) {
    if (reply.length < 3)
        return null;
    if (reply[0] !== WUQUE_GROUP.layoutAndKey)
        return null;
    if (isWuqueUnsupported(reply))
        return null;
    if (!subCommands.includes(reply[1]))
        return null;
    return reply.subarray(2);
}
/** Read up to {@link WUQUE_MATRIX_COLS} u16 keycodes from `at`. */
function wuqueKeycodes(bytes, at) {
    const keycodes = [];
    for (let i = 0; i < WUQUE_MATRIX_COLS; i += 1) {
        const keycode = wuqueU16(bytes, at + i * 2);
        if (keycode === null)
            break;
        keycodes.push(keycode);
    }
    return keycodes;
}
/** Request `GetKeyLayout` (subCommand 1): `[3, 1, layer, row]`. */
export function encodeWuqueGetKeyLayout(layer, row) {
    return encodeWuqueCommand(WUQUE_GROUP.layoutAndKey, WUQUE_KEY_COMMAND.getKeyLayout, [
        layer & 0xff,
        row & 0xff,
    ]);
}
/**
 * Decode `GetKeyLayout` (subCommand 1) **and** `SetKeyLayout` (subCommand 2)
 * replies: `[3, sub, layer, row, kc0lo, kc0hi, …]`. Up to
 * {@link WUQUE_MATRIX_COLS} (21) u16 keycodes are read; the vendor reader `Q2`
 * truncates to 21 the same way. Returns null on a short reply, a group /
 * subCommand mismatch, or an unsupported answer.
 */
export function decodeWuqueKeyLayout(reply) {
    const payload = wuqueKeyPayload(reply, WUQUE_KEY_COMMAND.getKeyLayout, WUQUE_KEY_COMMAND.setKeyLayout);
    if (!payload || payload.length < 4)
        return null;
    const layer = payload[0];
    const row = payload[1];
    return { layer, row, keycodes: wuqueKeycodes(payload, 2) };
}
/**
 * Request `SetKeyLayout` (subCommand 2): `[3, 2, layer, row, ...u16LE keycodes]`.
 *
 * Length rule: the 64-byte frame leaves 62 bytes for parameters, i.e. `layer`,
 * `row` and **30** u16 keycodes, but a 60 HE row has only
 * {@link WUQUE_MATRIX_COLS} (21) slots. Arrays longer than 21 are rejected with
 * a `RangeError` rather than silently truncated by the frame builder; shorter
 * arrays write fewer slots. Each keycode is masked to its low 16 bits by
 * {@link wuqueU16Bytes}.
 */
export function encodeWuqueSetKeyLayout(layer, row, keycodes) {
    if (keycodes.length > WUQUE_MATRIX_COLS) {
        throw new RangeError(`Wuque SetKeyLayout takes at most ${WUQUE_MATRIX_COLS} keycodes (got ${keycodes.length})`);
    }
    const params = [layer & 0xff, row & 0xff];
    for (const keycode of keycodes)
        params.push(...wuqueU16Bytes(keycode));
    return encodeWuqueCommand(WUQUE_GROUP.layoutAndKey, WUQUE_KEY_COMMAND.setKeyLayout, params);
}
/** Request `GetKeyCode` (subCommand 3): `[3, 3, layer, row, col]`. */
export function encodeWuqueGetKeyCode(layer, row, col) {
    return encodeWuqueCommand(WUQUE_GROUP.layoutAndKey, WUQUE_KEY_COMMAND.getKeyCode, [
        layer & 0xff,
        row & 0xff,
        col & 0xff,
    ]);
}
/**
 * Decode `GetKeyCode` (subCommand 3) **and** `SetKeyCode` (subCommand 4)
 * replies: `[3, sub, layer, row, col, kcLo, kcHi]` (`keycode = vt(t[5], t[6])`).
 * Returns null on a short reply, a group / subCommand mismatch, or an
 * unsupported answer.
 */
export function decodeWuqueKeyCode(reply) {
    const payload = wuqueKeyPayload(reply, WUQUE_KEY_COMMAND.getKeyCode, WUQUE_KEY_COMMAND.setKeyCode);
    if (!payload || payload.length < 5)
        return null;
    return {
        layer: payload[0],
        row: payload[1],
        col: payload[2],
        keycode: wuqueU16(payload, 3),
    };
}
/**
 * Request `SetKeyCode` (subCommand 4): `[3, 4, layer, row, col, kcLo, kcHi]`.
 * The keycode is masked to its low 16 bits by {@link wuqueU16Bytes}.
 */
export function encodeWuqueSetKeyCode(layer, row, col, keycode) {
    return encodeWuqueCommand(WUQUE_GROUP.layoutAndKey, WUQUE_KEY_COMMAND.setKeyCode, [
        layer & 0xff,
        row & 0xff,
        col & 0xff,
        ...wuqueU16Bytes(keycode),
    ]);
}
/** Request `GetKeyLayoutStyle` (subCommand 5): `[3, 5, index]`. */
export function encodeWuqueGetKeyLayoutStyle(index) {
    return encodeWuqueCommand(WUQUE_GROUP.layoutAndKey, WUQUE_KEY_COMMAND.getKeyLayoutStyle, [index & 0xff]);
}
/**
 * Decode `GetKeyLayoutStyle` (subCommand 5) replies:
 * `[3, 5, index, packed…]`. The packed region is a run of u16 LE entries
 * starting at reply byte 3 (`keyLayoutStyleResult`, 52123-52135).
 *
 * Per entry `a`: `rowRaw = (a >> 11) & 31`, `colRaw = (a >> 4) & 127`,
 * `ratio = a & 15`; decoded positions are `rowRaw / 4` and `colRaw / 4`
 * (quarter-cell granularity, 52110-52122). `ratio === 12` is a knob and
 * `ratio` 13-15 a screen, otherwise a key. At most {@link WUQUE_MATRIX_COLS}
 * (21) entries are returned. Returns null on a short reply or a
 * group / subCommand mismatch (`0xFF` cannot equal subCommand 5).
 */
export function decodeWuqueKeyLayoutStyle(reply) {
    const payload = wuqueReplyPayload(reply, WUQUE_GROUP.layoutAndKey, WUQUE_KEY_COMMAND.getKeyLayoutStyle);
    if (!payload || payload.length < 3)
        return null;
    const entries = [];
    for (let i = 0; i < WUQUE_MATRIX_COLS; i += 1) {
        const raw = wuqueU16(payload, 1 + i * 2);
        if (raw === null)
            break;
        const ratio = raw & 15;
        entries.push({
            row: ((raw >> 11) & 31) / 4,
            col: ((raw >> 4) & 127) / 4,
            ratio,
            type: ratio === 12 ? "knob" : ratio >= 13 && ratio <= 15 ? "screen" : "key",
        });
    }
    return { index: payload[0], entries };
}
/** Request `GetKeyLayoutDefault` (subCommand 6): `[3, 6, system<<4 | fn, row]`. */
export function encodeWuqueGetKeyLayoutDefault(system, fn, row) {
    return encodeWuqueCommand(WUQUE_GROUP.layoutAndKey, WUQUE_KEY_COMMAND.getKeyLayoutDefault, [
        ((system & 0x0f) << 4) | (fn & 0x0f),
        row & 0xff,
    ]);
}
/**
 * Decode `GetKeyLayoutDefault` (subCommand 6) replies:
 * `[3, 6, sysfn, row, kc0lo, kc0hi, …]` where `system = sysfn >> 4` and
 * `fn = sysfn & 15` (52110-52228). Up to {@link WUQUE_MATRIX_COLS} keycodes.
 * Returns null on a short reply or a group / subCommand mismatch.
 */
export function decodeWuqueKeyLayoutDefault(reply) {
    const payload = wuqueReplyPayload(reply, WUQUE_GROUP.layoutAndKey, WUQUE_KEY_COMMAND.getKeyLayoutDefault);
    if (!payload || payload.length < 4)
        return null;
    const sysfn = payload[0];
    return {
        system: sysfn >> 4,
        fn: sysfn & 0x0f,
        row: payload[1],
        keycodes: wuqueKeycodes(payload, 2),
    };
}
// ---------------------------------------------------------------------------
// HigherKey / advanced keys — group 6
//
// Commands are `Read=1` / `Write=2` (`rh`). Base frame:
// `[6, access, row, col, mode]` (mode from `Xg`: NONE=0, DKS=1, MPT=2, MT=3,
// TGL=4, END=5, SOCD=6, RS=7). Replies are `[6, cmd, row, col, mode, …data]`;
// `higherKeyUnpackData` (52791-52812) dispatches on reply byte 4 (mode).
// SOCD and RS writes each emit **two** frames (one per key of the pair).
// ---------------------------------------------------------------------------
/** SOCD resolution mode (`K2`): `Cover=0, PriorityA=1, PriorityB=2, Neutral=3`. */
export const WUQUE_SOCD_MODE = {
    cover: 0,
    priorityA: 1,
    priorityB: 2,
    neutral: 3,
};
/**
 * Per-direction priority bytes derived from the SOCD mode (`S` table,
 * 51707-51738): Cover → `[0,0]`, PriorityA → `[1,2]`, PriorityB → `[2,1]`,
 * Neutral → `[3,3]`. Unknown values fall back to `[0,0]`.
 */
function wuqueSocdPriority(mode) {
    switch (mode) {
        case WUQUE_SOCD_MODE.priorityA:
            return [1, 2];
        case WUQUE_SOCD_MODE.priorityB:
            return [2, 1];
        case WUQUE_SOCD_MODE.neutral:
            return [3, 3];
        default:
            return [0, 0];
    }
}
/** Payload of a group-6 read or write reply, or null when unusable. */
function wuqueHigherKeyPayload(reply) {
    if (reply.length < 5)
        return null;
    if (reply[0] !== WUQUE_GROUP.higherKey)
        return null;
    if (isWuqueUnsupported(reply))
        return null;
    const sub = reply[1];
    if (sub !== WUQUE_HIGHER_KEY_COMMAND.read && sub !== WUQUE_HIGHER_KEY_COMMAND.write)
        return null;
    return reply.subarray(2);
}
/** Base bytes of a HigherKey write frame: `[6, 2, row, col, mode]`. */
function wuqueHigherKeyWriteBase(row, col, mode) {
    return [WUQUE_GROUP.higherKey, WUQUE_ACCESS.write, row & 0xff, col & 0xff, mode & 0xff];
}
/** Request `HigherKey.Read` (subCommand 1): `[6, 1, row, col, mode]`. */
export function encodeWuqueGetHigherKey(row, col, mode) {
    return encodeWuqueCommand(WUQUE_GROUP.higherKey, WUQUE_HIGHER_KEY_COMMAND.read, [
        row & 0xff,
        col & 0xff,
        mode,
    ]);
}
/** Request `HigherKey.Write` for mode 0 (NONE): clears the advanced key. */
export function encodeWuqueSetHigherKeyNone(row, col) {
    return encodeWuqueFrame(wuqueHigherKeyWriteBase(row, col, WUQUE_HIGHER_KEY_MODE.none));
}
/**
 * Request `HigherKey.Write` mode 1 (DKS, 51644-51656):
 * `[6, 2, row, col, 1, kc0..3 (4×u16), trp0..3 (4×u8), db0, db1 (2×u16 = mm×1000)]`.
 */
export function encodeWuqueSetHigherKeyDks(input) {
    if (input.keycodes.length !== 4) {
        throw new RangeError(`Wuque DKS takes 4 keycodes (got ${input.keycodes.length})`);
    }
    if (input.travelPoints.length !== 4) {
        throw new RangeError(`Wuque DKS takes 4 travel points (got ${input.travelPoints.length})`);
    }
    if (input.deadBandsMm.length !== 2) {
        throw new RangeError(`Wuque DKS takes 2 dead bands (got ${input.deadBandsMm.length})`);
    }
    const bytes = wuqueHigherKeyWriteBase(input.row, input.col, WUQUE_HIGHER_KEY_MODE.dks);
    for (const keycode of input.keycodes)
        bytes.push(...wuqueU16Bytes(keycode));
    for (const travelPoint of input.travelPoints)
        bytes.push(travelPoint & 0xff);
    for (const deadBand of input.deadBandsMm)
        bytes.push(...wuqueU16Bytes(wuqueTravelRaw(deadBand)));
    return encodeWuqueFrame(bytes);
}
/**
 * Request `HigherKey.Write` mode 2 (MPT, 51657-51670):
 * `[6, 2, row, col, 2, kc0..2 (3×u16), db0..2 (3×u16 = mm×1000)]`.
 */
export function encodeWuqueSetHigherKeyMpt(input) {
    if (input.keycodes.length !== 3) {
        throw new RangeError(`Wuque MPT takes 3 keycodes (got ${input.keycodes.length})`);
    }
    if (input.deadBandsMm.length !== 3) {
        throw new RangeError(`Wuque MPT takes 3 dead bands (got ${input.deadBandsMm.length})`);
    }
    const bytes = wuqueHigherKeyWriteBase(input.row, input.col, WUQUE_HIGHER_KEY_MODE.mpt);
    for (const keycode of input.keycodes)
        bytes.push(...wuqueU16Bytes(keycode));
    for (const deadBand of input.deadBandsMm)
        bytes.push(...wuqueU16Bytes(wuqueTravelRaw(deadBand)));
    return encodeWuqueFrame(bytes);
}
/**
 * Request `HigherKey.Write` mode 3 (MT, 51671-51682):
 * `[6, 2, row, col, 3, kc0, kc1 (2×u16), time (u16)]`.
 */
export function encodeWuqueSetHigherKeyMt(input) {
    if (input.keycodes.length !== 2) {
        throw new RangeError(`Wuque MT takes 2 keycodes (got ${input.keycodes.length})`);
    }
    const bytes = wuqueHigherKeyWriteBase(input.row, input.col, WUQUE_HIGHER_KEY_MODE.mt);
    for (const keycode of input.keycodes)
        bytes.push(...wuqueU16Bytes(keycode));
    bytes.push(...wuqueU16Bytes(input.time));
    return encodeWuqueFrame(bytes);
}
/**
 * Request `HigherKey.Write` mode 4 (TGL, 51683-51694):
 * `[6, 2, row, col, 4, kc (u16), time (u16)]`.
 */
export function encodeWuqueSetHigherKeyTgl(input) {
    const bytes = wuqueHigherKeyWriteBase(input.row, input.col, WUQUE_HIGHER_KEY_MODE.tgl);
    bytes.push(...wuqueU16Bytes(input.keycode), ...wuqueU16Bytes(input.time));
    return encodeWuqueFrame(bytes);
}
/**
 * Request `HigherKey.Write` mode 5 (END, 51695-51706):
 * `[6, 2, row, col, 5, kc0, kc1 (2×u16), delay (u16)]`.
 */
export function encodeWuqueSetHigherKeyEnd(input) {
    if (input.keycodes.length !== 2) {
        throw new RangeError(`Wuque END takes 2 keycodes (got ${input.keycodes.length})`);
    }
    const bytes = wuqueHigherKeyWriteBase(input.row, input.col, WUQUE_HIGHER_KEY_MODE.end);
    for (const keycode of input.keycodes)
        bytes.push(...wuqueU16Bytes(keycode));
    bytes.push(...wuqueU16Bytes(input.delay));
    return encodeWuqueFrame(bytes);
}
/**
 * Request `HigherKey.Write` mode 6 (SOCD, 51707-51738) — **two** frames, one per
 * key of the pair, each carrying the other's coordinate and a per-direction
 * priority byte 0 (`S[0]`, `S[1]`):
 *
 * ```
 * A: [6,2,row, col, 6, row2,col2, kc0 (u16), kc1 (u16), delay (u16), S0]
 * B: [6,2,row2,col2,6, row, col,  kc1 (u16), kc0 (u16), delay (u16), S1]
 * ```
 */
export function encodeWuqueSetHigherKeySocd(input) {
    if (input.keycodes.length !== 2) {
        throw new RangeError(`Wuque SOCD takes 2 keycodes (got ${input.keycodes.length})`);
    }
    const [keycodeA, keycodeB] = [input.keycodes[0], input.keycodes[1]];
    const [priorityA, priorityB] = wuqueSocdPriority(input.socdMode);
    const frameA = [
        ...wuqueHigherKeyWriteBase(input.row, input.col, WUQUE_HIGHER_KEY_MODE.socd),
        input.row2 & 0xff,
        input.col2 & 0xff,
        ...wuqueU16Bytes(keycodeA),
        ...wuqueU16Bytes(keycodeB),
        ...wuqueU16Bytes(input.delay),
        priorityA,
    ];
    const frameB = [
        ...wuqueHigherKeyWriteBase(input.row2, input.col2, WUQUE_HIGHER_KEY_MODE.socd),
        input.row & 0xff,
        input.col & 0xff,
        ...wuqueU16Bytes(keycodeB),
        ...wuqueU16Bytes(keycodeA),
        ...wuqueU16Bytes(input.delay),
        priorityB,
    ];
    return [encodeWuqueFrame(frameA), encodeWuqueFrame(frameB)];
}
/**
 * Request `HigherKey.Write` mode 7 (RS, 51739-51775) — **two** frames, one per
 * key of the pair, each carrying the other's coordinate (no priority byte):
 *
 * ```
 * A: [6,2,row, col, 7, row2,col2, kc0 (u16), kc1 (u16), delay (u16)]
 * B: [6,2,row2,col2,7, row, col,  kc1 (u16), kc0 (u16), delay (u16)]
 * ```
 */
export function encodeWuqueSetHigherKeyRs(input) {
    if (input.keycodes.length !== 2) {
        throw new RangeError(`Wuque RS takes 2 keycodes (got ${input.keycodes.length})`);
    }
    const [keycodeA, keycodeB] = [input.keycodes[0], input.keycodes[1]];
    const frameA = [
        ...wuqueHigherKeyWriteBase(input.row, input.col, WUQUE_HIGHER_KEY_MODE.rs),
        input.row2 & 0xff,
        input.col2 & 0xff,
        ...wuqueU16Bytes(keycodeA),
        ...wuqueU16Bytes(keycodeB),
        ...wuqueU16Bytes(input.delay),
    ];
    const frameB = [
        ...wuqueHigherKeyWriteBase(input.row2, input.col2, WUQUE_HIGHER_KEY_MODE.rs),
        input.row & 0xff,
        input.col & 0xff,
        ...wuqueU16Bytes(keycodeB),
        ...wuqueU16Bytes(keycodeA),
        ...wuqueU16Bytes(input.delay),
    ];
    return [encodeWuqueFrame(frameA), encodeWuqueFrame(frameB)];
}
/**
 * Encode an advanced-key write for any mode. Returns the frames to send — one
 * frame for NONE / DKS / MPT / MT / TGL / END, **two** frames for SOCD and RS
 * (the vendor controller sends both, then decodes each reply).
 */
export function encodeWuqueSetHigherKey(write) {
    switch (write.mode) {
        case WUQUE_HIGHER_KEY_MODE.none:
            return [encodeWuqueSetHigherKeyNone(write.row, write.col)];
        case WUQUE_HIGHER_KEY_MODE.dks:
            return [encodeWuqueSetHigherKeyDks(write)];
        case WUQUE_HIGHER_KEY_MODE.mpt:
            return [encodeWuqueSetHigherKeyMpt(write)];
        case WUQUE_HIGHER_KEY_MODE.mt:
            return [encodeWuqueSetHigherKeyMt(write)];
        case WUQUE_HIGHER_KEY_MODE.tgl:
            return [encodeWuqueSetHigherKeyTgl(write)];
        case WUQUE_HIGHER_KEY_MODE.end:
            return [encodeWuqueSetHigherKeyEnd(write)];
        case WUQUE_HIGHER_KEY_MODE.socd:
            return [...encodeWuqueSetHigherKeySocd(write)];
        case WUQUE_HIGHER_KEY_MODE.rs:
            return [...encodeWuqueSetHigherKeyRs(write)];
    }
}
/**
 * Decode any HigherKey reply (`[6, cmd, row, col, mode, …data]`, read or write
 * echo), dispatching on the mode byte at payload offset 2
 * (`higherKeyUnpackData`, 52791-52812). Returns null on a short reply, a group /
 * subCommand mismatch, an unsupported answer, or an unknown mode.
 */
export function decodeWuqueHigherKey(reply) {
    const payload = wuqueHigherKeyPayload(reply);
    if (!payload)
        return null;
    const row = payload[0];
    const col = payload[1];
    const mode = payload[2];
    switch (mode) {
        case WUQUE_HIGHER_KEY_MODE.none:
            return { row, col, mode: WUQUE_HIGHER_KEY_MODE.none };
        case WUQUE_HIGHER_KEY_MODE.dks: {
            if (payload.length < 19)
                return null;
            return {
                row,
                col,
                mode: WUQUE_HIGHER_KEY_MODE.dks,
                keycodes: [wuqueU16(payload, 3), wuqueU16(payload, 5), wuqueU16(payload, 7), wuqueU16(payload, 9)],
                travelPoints: [payload[11], payload[12], payload[13], payload[14]],
                deadBandsMm: [wuqueTravelMm(wuqueU16(payload, 15)), wuqueTravelMm(wuqueU16(payload, 17))],
            };
        }
        case WUQUE_HIGHER_KEY_MODE.mpt: {
            if (payload.length < 15)
                return null;
            return {
                row,
                col,
                mode: WUQUE_HIGHER_KEY_MODE.mpt,
                keycodes: [wuqueU16(payload, 3), wuqueU16(payload, 5), wuqueU16(payload, 7)],
                deadBandsRaw: [wuqueU16(payload, 9), wuqueU16(payload, 11), wuqueU16(payload, 13)],
            };
        }
        case WUQUE_HIGHER_KEY_MODE.mt: {
            if (payload.length < 9)
                return null;
            return {
                row,
                col,
                mode: WUQUE_HIGHER_KEY_MODE.mt,
                keycodes: [wuqueU16(payload, 3), wuqueU16(payload, 5)],
                time: wuqueU16(payload, 7),
            };
        }
        case WUQUE_HIGHER_KEY_MODE.tgl: {
            if (payload.length < 7)
                return null;
            return {
                row,
                col,
                mode: WUQUE_HIGHER_KEY_MODE.tgl,
                keycode: wuqueU16(payload, 3),
                time: wuqueU16(payload, 5),
            };
        }
        case WUQUE_HIGHER_KEY_MODE.end: {
            if (payload.length < 9)
                return null;
            return {
                row,
                col,
                mode: WUQUE_HIGHER_KEY_MODE.end,
                keycodes: [wuqueU16(payload, 3), wuqueU16(payload, 5)],
                delay: wuqueU16(payload, 7),
            };
        }
        case WUQUE_HIGHER_KEY_MODE.socd: {
            if (payload.length < 12)
                return null;
            return {
                row,
                col,
                mode: WUQUE_HIGHER_KEY_MODE.socd,
                row2: payload[3],
                col2: payload[4],
                keycodes: [wuqueU16(payload, 5), wuqueU16(payload, 7)],
                delay: wuqueU16(payload, 9),
                socdMode: (payload[11] & 0x03),
            };
        }
        case WUQUE_HIGHER_KEY_MODE.rs: {
            if (payload.length < 11)
                return null;
            return {
                row,
                col,
                mode: WUQUE_HIGHER_KEY_MODE.rs,
                row2: payload[3],
                col2: payload[4],
                keycodes: [wuqueU16(payload, 5), wuqueU16(payload, 7)],
                delay: wuqueU16(payload, 9),
            };
        }
        default:
            return null;
    }
}
// ---------------------------------------------------------------------------
// Keycode category table
//
// Values are the device usage codes the vendor configurator groups in
// `hub/js/keyboard-map-AIOA0HW1.js` (sha256 7a305100…).
// ---------------------------------------------------------------------------
/** Inclusive integer range as an array (table construction helper). */
function wuqueRange(from, to) {
    const values = [];
    for (let value = from; value <= to; value += 1)
        values.push(value);
    return values;
}
/**
 * Device keycode categories. `basic` 0x04-0xE7 (HID keyboard usages),
 * `special` 0x0000 / 0x0001 / 0xF100-0xF103 (0x0000 is the **unused slot**
 * marker the board returns for an empty position), `system` 0x1152-0x1815,
 * `media` 0x206F-0x2223, `mouse` 0x4000-0x4B01, `classHandle` 0xC001-0xD307,
 * `control` 0xF200-0xF208, `light` 0xF300-0xF318, `triMode` 0xF402-0xF407,
 * `macro` 0xF500-0xF50F, `decorativeLighting1..3` 0xF310-0xF338.
 *
 * `light` and `decorativeLighting1` overlap on 0xF310-0xF318 in the source
 * table; see {@link wuqueKeycodeCategory} for the resolution.
 */
export const WUQUE_KEYCODE_CATEGORIES = {
    special: [0x0, 0x1, ...wuqueRange(0xf100, 0xf103)],
    basic: [...wuqueRange(0x04, 0x73), ...wuqueRange(0xe0, 0xe7)],
    system: [0x1152, 0x1329, 0x1807, 0x1808, 0x1815],
    media: [0x206f, 0x2070, ...wuqueRange(0x20b5, 0x20b7), 0x20cd, 0x20e2, 0x20e9, 0x20ea, 0x2183, 0x218a, 0x2192, 0x2194, 0x2223],
    mouse: [0x4000, 0x4100, 0x4200, 0x4300, 0x4400, 0x4500, 0x4600, 0x4700, 0x4800, 0x4900, 0x4a01, 0x4b01],
    control: [...wuqueRange(0xf200, 0xf202), ...wuqueRange(0xf205, 0xf208)],
    light: [...wuqueRange(0xf300, 0xf308), ...wuqueRange(0xf310, 0xf318)],
    classHandle: [
        0xc001, 0xc002, 0xc004, 0xc008, 0xc010, 0xc020, 0xc040, 0xc080, 0xc101, 0xc102, 0xc104, 0xc108,
        0xd301, 0xd305, 0xd307, 0xd303, ...wuqueRange(0xcf00, 0xcf03), 0xce00, 0xc200, 0xc201, 0xc400,
        0xc401, 0xc600, 0xc601, 0xc800, 0xc801, 0xca00, 0xca01, 0xcc00, 0xcc01,
    ],
    triMode: [...wuqueRange(0xf402, 0xf405), 0xf407],
    macro: [...wuqueRange(0xf500, 0xf50f)],
    decorativeLighting1: [...wuqueRange(0xf310, 0xf318)],
    decorativeLighting2: [...wuqueRange(0xf320, 0xf328)],
    decorativeLighting3: [...wuqueRange(0xf330, 0xf338)],
};
/**
 * Lookup precedence: the first category, in this order, that contains a code
 * wins. `light` precedes `decorativeLighting1`, so the shared 0xF310-0xF318
 * block classifies as `light`.
 */
const WUQUE_KEYCODE_CATEGORY_ORDER = [
    "special",
    "basic",
    "system",
    "media",
    "mouse",
    "control",
    "light",
    "classHandle",
    "triMode",
    "macro",
    "decorativeLighting1",
    "decorativeLighting2",
    "decorativeLighting3",
];
/**
 * Short human label for a device keycode, keyed by 4-hex usage (`ksnakeMacroCodeLabel`
 * precedent in the OpenMouse app: a `Record<number, string>` with a per-code
 * fallback, never a guessed name).
 *
 * Every label is the trimming of the vendor's own `name` field in
 * `hub/js/keyboard-map-AIOA0HW1.js` (`name` up to the first space; `Enter`,
 * `Caps`, `Fn0`, `M0`, `Bri+`, `L-Ctrl`, `→`, `PrtScr`). The four bare
 * `Direction` gamepad entries (0x03, 0x5201/2/4) carry no distinguishable
 * name in the source and are intentionally absent — they decode through
 * {@link wuqueKeycodeCategory} exactly as before.
 */
export const WUQUE_KEYCODE_LABELS = {
    0x0001: "△",
    0x0004: "A",
    0x0005: "B",
    0x0006: "C",
    0x0007: "D",
    0x0008: "E",
    0x0009: "F",
    0x000a: "G",
    0x000b: "H",
    0x000c: "I",
    0x000d: "J",
    0x000e: "K",
    0x000f: "L",
    0x0010: "M",
    0x0011: "N",
    0x0012: "O",
    0x0013: "P",
    0x0014: "Q",
    0x0015: "R",
    0x0016: "S",
    0x0017: "T",
    0x0018: "U",
    0x0019: "V",
    0x001a: "W",
    0x001b: "X",
    0x001c: "Y",
    0x001d: "Z",
    0x001e: "1",
    0x001f: "2",
    0x0020: "3",
    0x0021: "4",
    0x0022: "5",
    0x0023: "6",
    0x0024: "7",
    0x0025: "8",
    0x0026: "9",
    0x0027: "0",
    0x0028: "Enter",
    0x0029: "Esc",
    0x002a: "Backspace",
    0x002b: "Tab",
    0x002c: "Space",
    0x002d: "-",
    0x002e: "=",
    0x002f: "[",
    0x0030: "]",
    0x0031: "\\\\",
    0x0032: "Nuhs",
    0x0033: ";",
    0x0035: "`",
    0x0036: ",",
    0x0037: ".",
    0x0038: "/",
    0x0039: "Caps",
    0x003a: "F1",
    0x003b: "F2",
    0x003c: "F3",
    0x003d: "F4",
    0x003e: "F5",
    0x003f: "F6",
    0x0040: "F7",
    0x0041: "F8",
    0x0042: "F9",
    0x0043: "F10",
    0x0044: "F11",
    0x0045: "F12",
    0x0046: "PrtScr",
    0x0047: "Scroll",
    0x0048: "Pause",
    0x0049: "Insert",
    0x004a: "Home",
    0x004b: "PgUp",
    0x004c: "Delete",
    0x004d: "End",
    0x004e: "PgDn",
    0x004f: "→",
    0x0050: "←",
    0x0051: "↓",
    0x0052: "↑",
    0x0053: "Num",
    0x0054: "/',",
    0x0055: "*',",
    0x0056: "-',",
    0x0057: "+',",
    0x0058: "PEnter",
    0x0059: "P1",
    0x005a: "P2",
    0x005b: "P3",
    0x005c: "P4",
    0x005d: "P5",
    0x005e: "P6",
    0x005f: "P7",
    0x0060: "P8",
    0x0061: "P9",
    0x0062: "P0",
    0x0063: ".",
    0x0064: "Nubs",
    0x0065: "App",
    0x0066: "Power",
    0x0067: "Peql",
    0x0068: "F13",
    0x0069: "F14",
    0x006a: "F15",
    0x006b: "F16",
    0x006c: "F17",
    0x006d: "F18",
    0x006e: "F19",
    0x006f: "F20",
    0x0070: "F21",
    0x0071: "F22",
    0x0072: "F23",
    0x0073: "F24",
    0x0087: "\\\\",
    0x008a: "変換",
    0x008b: "無変換",
    0x0090: "한영",
    0x0091: "漢字",
    0x0092: "かな",
    0x00e0: "L-Ctrl",
    0x00e1: "L-Shift",
    0x00e2: "L-Alt",
    0x00e3: "L-Gui",
    0x00e4: "R-Ctrl",
    0x00e5: "R-Shift",
    0x00e6: "R-Alt",
    0x00e7: "R-Gui",
    0x1152: "MCON",
    0x1329: "WTMG",
    0x1807: "WDSK",
    0x1808: "WFIL",
    0x1815: "WCMD",
    0x206f: "Bri+",
    0x2070: "Bri-",
    0x20b5: "Next",
    0x20b6: "Prev",
    0x20b7: "Stop",
    0x20cd: "Play",
    0x20e2: "Mute",
    0x20e9: "Vol+",
    0x20ea: "Vol-",
    0x2183: "Music",
    0x218a: "Vol-",
    0x2192: "Calc",
    0x2194: "Mute",
    0x2223: "Vol+",
    0x4000: "M-Free",
    0x4100: "M-Left",
    0x4200: "M-Right",
    0x4300: "M-Middle",
    0x4400: "M-FWD",
    0x4500: "M-BACK",
    0x4600: "M-MLX",
    0x4700: "M-MRX",
    0x4800: "M-MUY",
    0x4900: "M-MDY",
    0x4a01: "M-WHF",
    0x4b01: "M-WHB",
    0x5210: "Start",
    0x5220: "Select",
    0x5240: "Left",
    0x5280: "Right",
    0x5301: "Left",
    0x5302: "Right",
    0x5304: "Menu",
    0x5310: "A",
    0x5320: "B",
    0x5340: "X",
    0x5380: "Y",
    0x5400: "Left",
    0x5500: "Right",
    0x5601: "Left",
    0x5602: "Left",
    0x5801: "Left",
    0x5802: "Left",
    0x5a01: "Right",
    0x5a02: "Right",
    0x5c01: "Right",
    0x5c02: "Right",
    0xc001: "GP_1",
    0xc002: "GP_2",
    0xc004: "GP_3",
    0xc008: "GP_4",
    0xc010: "GP_5",
    0xc020: "GP_6",
    0xc040: "GP_7",
    0xc080: "GP_8",
    0xc101: "GP_9",
    0xc102: "GP_10",
    0xc104: "GP_11",
    0xc108: "GP_12",
    0xc200: "GP_XL",
    0xc201: "GP_XR",
    0xc400: "GP_YU",
    0xc401: "GP_YD",
    0xc600: "GP_ZU",
    0xc601: "GP_ZD",
    0xc800: "GP_ZFR",
    0xc801: "GP_ZRR",
    0xca00: "GP_XFR",
    0xca01: "GP_XRR",
    0xcc00: "GP_YFR",
    0xcc01: "GP_YRR",
    0xce00: "GP_TH",
    0xcf00: "GP_E",
    0xcf01: "GP_A",
    0xcf02: "GP_R",
    0xcf03: "GP_T",
    0xd301: "GP_DIR_UP",
    0xd303: "GP_DIR_RIGHT",
    0xd305: "GP_DIR_DOWN",
    0xd307: "GP_DIR_LEFT",
    0xf100: "Fn0",
    0xf101: "Fn1",
    0xf102: "Fn2",
    0xf103: "Fn3",
    0xf200: "Reset",
    0xf201: "Win",
    0xf202: "Mac",
    0xf203: "Adj",
    0xf205: "Config1",
    0xf206: "Config2",
    0xf207: "Config3",
    0xf208: "Config4",
    0xf209: "LockWin",
    0xf300: "Mode",
    0xf301: "Color",
    0xf302: "Bri+",
    0xf303: "Bri-",
    0xf304: "Spd+",
    0xf305: "Spd-",
    0xf306: "Prev",
    0xf307: "OnOff",
    0xf308: "Dir",
    0xf310: "D1_Mode",
    0xf311: "D1_Color",
    0xf312: "D1_Bri+",
    0xf313: "D1_Bri-",
    0xf314: "D1_Spd+",
    0xf315: "D1_Spd-",
    0xf316: "D1_Prev",
    0xf317: "D1_OnOff",
    0xf318: "D1_Dir",
    0xf320: "D2_Mode",
    0xf321: "D2_Color",
    0xf322: "D2_Bri+",
    0xf323: "D2_Bri-",
    0xf324: "D2_Spd+",
    0xf325: "D2_Spd-",
    0xf326: "D2_Prev",
    0xf327: "D2_OnOff",
    0xf328: "D2_Dir",
    0xf330: "D3_Mode",
    0xf331: "D3_Color",
    0xf332: "D3_Bri+",
    0xf333: "D3_Bri-",
    0xf334: "D3_Spd+",
    0xf335: "D3_Spd-",
    0xf336: "D3_Prev",
    0xf337: "D3_OnOff",
    0xf338: "D3_Dir",
    0xf401: "USB",
    0xf402: "24G",
    0xf403: "BLE1",
    0xf404: "BLE2",
    0xf405: "BLE3",
    0xf406: "Reset",
    0xf407: "Bat",
    0xf500: "M0",
    0xf501: "M1",
    0xf502: "M2",
    0xf503: "M3",
    0xf504: "M4",
    0xf505: "M5",
    0xf506: "M6",
    0xf507: "M7",
    0xf508: "M8",
    0xf509: "M9",
    0xf50a: "M10",
    0xf50b: "M11",
    0xf50c: "M12",
    0xf50d: "M13",
    0xf50e: "M14",
    0xf50f: "M15",
};
/**
 * Compact two-line button label for a keycode whose vendor label (`⌫`, `⏎`,
 * … are *not* in the source) would otherwise clip in a 60% matrix cell.
 * Entries here are shortening tiers of the matching `WUQUE_KEYCODE_LABELS`
 * value — same word, never a new name. Everything else renders the
 * vendor label verbatim.
 */
const WUQUE_KEYCODE_LABEL_TIERS = {
    0x0028: "Enter",
    0x0029: "Esc",
    0x002a: "Bksp",
    0x002b: "Tab",
    0x002c: "Space",
    0x0039: "Caps",
    0x0046: "PrtScr",
    0x0049: "Ins",
    0x004c: "Del",
};
/**
 * Label for a matrix key button. `WUQUE_KEYCODE_LABELS` is the source of
 * truth; the tier map only shortens labels that cannot fit a 60% cell.
 * Null when the vendor names nothing for the code.
 */
export function wuqueMatrixKeyLabel(code) {
    return WUQUE_KEYCODE_LABEL_TIERS[code] ?? wuqueKeycodeLabel(code);
}
/** Label for a device keycode, or null when the vendor names none for it. */
export function wuqueKeycodeLabel(code) {
    return WUQUE_KEYCODE_LABELS[code] ?? null;
}
/** Category of a device keycode, or null when it is not in the vendor table. */
export function wuqueKeycodeCategory(code) {
    for (const category of WUQUE_KEYCODE_CATEGORY_ORDER) {
        if (WUQUE_KEYCODE_CATEGORIES[category].includes(code))
            return category;
    }
    return null;
}
