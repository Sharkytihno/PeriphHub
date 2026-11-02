/**
 * Wuque Studio (BABAO / ZOOM) vendor HID protocol — Lighting (group 5) and the
 * CustomCommand (group 10) entries the BABAO60 HE uses, as a transport-independent
 * codec. Requests are 64-byte output reports; replies echo `[group, subCommand]`
 * and carry the payload from byte 2 (see `./framing.ts`).
 *
 * Lighting replies carry **no status byte** — byte 2 is the area index, so every
 * decoder here reads its fields at fixed absolute offsets, exactly like the
 * vendor's `lighting*Data` functions (`app.pretty.js:52449-52513`). Colour
 * channel order is **not** uniform across commands and is called out per builder:
 *
 * - base / palette / custom / direct-drive: **B, G, R** (`app.pretty.js:51815`
 *   `o.push(B,G,R,H)`, `:51841` `i.push(B,G,R,flag)`, `:51851` identical);
 * - colour correction: **R, G, B** (`app.pretty.js:51832` `[data.R,data.G,data.B]`);
 * - caps: **B, R, G** (`app.pretty.js:51877` `[e.B,e.R,e.G]`).
 *
 * Hardware anchor (BABAO60 HE, `0x1CA6:0x1B10`, protocol 1.2.1.0): the base
 * readback `[5,1,0,0]` answers `05 01 00 00 | 01 11 50 28 00 07 …` — area 0,
 * block 0, open 1, mode 0x11, luminance 0x50, speed 0x28, direction 0,
 * selectStaticColor 7; the custom page readback `[5,3,0,0]` answers
 * `05 03 00 00 | …` with 15 × (B,G,R,flag) from payload offset 2 (reply byte 4).
 */
import { WUQUE_ACCESS, WUQUE_CUSTOM_COMMAND, WUQUE_GROUP, WUQUE_LEDS_PER_FRAME, WUQUE_LIGHTING_AREA, WUQUE_LIGHTING_BLOCK, WUQUE_LIGHTING_COMMAND, encodeWuqueCommand, isWuqueReply, isWuqueUnsupported, } from "./framing.js";
/** Number of static-palette colours the 60 HE stores (`app.pretty.js:51815`). */
export const WUQUE_LIGHTING_PALETTE_COLORS = 8;
/** Sub-commands whose reply shares the base/palette/colour-correction layout. */
const BASE_BLOCK_REPLIES = [
    WUQUE_LIGHTING_COMMAND.getBase,
    WUQUE_LIGHTING_COMMAND.setBase,
];
/**
 * True when `reply` is long enough, answers `group` with one of `subCommands`,
 * and is not the board's unsupported answer (`subCommand` echoed as `0xFF`).
 */
function checkedReply(reply, group, subCommands, minLength) {
    if (reply.length < minLength)
        return false;
    if (isWuqueUnsupported(reply))
        return false;
    return subCommands.some((subCommand) => isWuqueReply(reply, group, subCommand));
}
// ---------------------------------------------------------------------------
// Lighting base block (getBase = 1 / setBase = 2, block `Wg.Base` = 0)
// ---------------------------------------------------------------------------
/**
 * `getLightingBase` request: `[5, 1, area, block]` (`mw("Read",t)`,
 * `app.pretty.js:51859`/`:52397`). Hardware: `[5,1,0,0]`.
 */
export function encodeWuqueGetLightingBase(area = WUQUE_LIGHTING_AREA.keyboard, block = WUQUE_LIGHTING_BLOCK.base) {
    return encodeWuqueCommand(WUQUE_GROUP.lighting, WUQUE_LIGHTING_COMMAND.getBase, [area, block]);
}
/**
 * `setLightingBase` request: `[5, 2, area, block, openByte, mode, luminance,
 * speed, direction, selectStaticColor]` (10 bytes; `RG`, `app.pretty.js:51802`,
 * `mw("Write",t)` `:52399`).
 */
export function encodeWuqueSetLightingBase(settings) {
    const openByte = typeof settings.open === "boolean" ? (settings.open ? 1 : 0) : settings.open;
    return encodeWuqueCommand(WUQUE_GROUP.lighting, WUQUE_LIGHTING_COMMAND.setBase, [
        settings.area,
        settings.block,
        openByte,
        settings.mode,
        settings.luminance,
        settings.speed,
        settings.direction,
        settings.selectStaticColor,
    ]);
}
/**
 * Decode a Lighting base reply. `subCommand` defaults to the read echo (`1`) and
 * may be set to `2` to accept a write echo — the vendor uses one decoder
 * (`lightingBaseData`, `app.pretty.js:52449`) for both. Returns null on a short
 * reply (< 10 bytes), a mismatched echo, or an unsupported answer.
 */
export function decodeWuqueLightingBase(reply, subCommand) {
    const accepted = subCommand === undefined ? BASE_BLOCK_REPLIES : [subCommand];
    if (!checkedReply(reply, WUQUE_GROUP.lighting, accepted, 10))
        return null;
    const openCode = reply[4];
    return {
        area: reply[2],
        openCode,
        open: openCode !== 0,
        mode: reply[5],
        luminance: reply[6],
        speed: reply[7],
        direction: reply[8],
        selectStaticColor: reply[9],
    };
}
// ---------------------------------------------------------------------------
// Static palette (getBase = 1 / setBase = 2, block `Wg.Palette` = 1)
// ---------------------------------------------------------------------------
/**
 * `getLightingPalette` request: `[5, 1, area, 1]` (`gw("Read",t)`,
 * `app.pretty.js:51863`/`:52403`). The controller's own GET is buggy (it sends
 * the base builder, `:56977`); this encoder issues the intended frame.
 */
export function encodeWuqueGetLightingPalette(area = WUQUE_LIGHTING_AREA.keyboard) {
    return encodeWuqueCommand(WUQUE_GROUP.lighting, WUQUE_LIGHTING_COMMAND.getBase, [
        area,
        WUQUE_LIGHTING_BLOCK.palette,
    ]);
}
/**
 * `setLightingPalette` request: `[5, 2, area, 1, ...8×(B,G,R,H)]` (36 bytes;
 * `TG`, `app.pretty.js:51815`, `gw("Write",t)` `:52406`). `colors` is clamped to
 * {@link WUQUE_LIGHTING_PALETTE_COLORS} entries.
 */
export function encodeWuqueSetLightingPalette(area, colors) {
    const params = [area, WUQUE_LIGHTING_BLOCK.palette];
    for (const color of colors.slice(0, WUQUE_LIGHTING_PALETTE_COLORS)) {
        params.push(color.b, color.g, color.r, color.h);
    }
    return encodeWuqueCommand(WUQUE_GROUP.lighting, WUQUE_LIGHTING_COMMAND.setBase, params);
}
/**
 * Decode a palette reply: 8 colours at `reply[4 + 4*i]` as `B, G, R, H`
 * (`lightingPaletteData`, `app.pretty.js:52471`). Returns null on a short reply
 * (< 36 bytes), a mismatched echo, or an unsupported answer.
 */
export function decodeWuqueLightingPalette(reply, subCommand) {
    const accepted = subCommand === undefined ? BASE_BLOCK_REPLIES : [subCommand];
    const minLength = 4 + WUQUE_LIGHTING_PALETTE_COLORS * 4;
    if (!checkedReply(reply, WUQUE_GROUP.lighting, accepted, minLength))
        return null;
    const colors = [];
    for (let i = 0; i < WUQUE_LIGHTING_PALETTE_COLORS; i += 1) {
        const at = 4 + i * 4;
        colors.push({ b: reply[at], g: reply[at + 1], r: reply[at + 2], h: reply[at + 3] });
    }
    return colors;
}
// ---------------------------------------------------------------------------
// Colour correction (getBase = 1 / setBase = 2, block `Wg.ColorCorrection` = 2)
// ---------------------------------------------------------------------------
/**
 * `getLightingColorCorrection` request: `[5, 1, area, 2]` (`vw("Read",t)`,
 * `app.pretty.js:51867`/`:52409`). As with the palette, the controller's GET is
 * buggy (`:56989`); this is the intended frame.
 */
export function encodeWuqueGetLightingColorCorrection(area = WUQUE_LIGHTING_AREA.keyboard) {
    return encodeWuqueCommand(WUQUE_GROUP.lighting, WUQUE_LIGHTING_COMMAND.getBase, [
        area,
        WUQUE_LIGHTING_BLOCK.colorCorrection,
    ]);
}
/**
 * `setLightingColorCorrection` request: `[5, 2, area, 2, R, G, B]` (7 bytes;
 * `DG`, `app.pretty.js:51832` — the one lighting block that is **R, G, B**,
 * `vw("Write",t)` `:52412`).
 */
export function encodeWuqueSetLightingColorCorrection(area, color) {
    return encodeWuqueCommand(WUQUE_GROUP.lighting, WUQUE_LIGHTING_COMMAND.setBase, [
        area,
        WUQUE_LIGHTING_BLOCK.colorCorrection,
        color.r,
        color.g,
        color.b,
    ]);
}
/**
 * Decode a colour-correction reply: `R=reply[4], G=reply[5], B=reply[6]`
 * (`lightingColorCorrectionData`, `app.pretty.js:52491`). Returns null on a short
 * reply (< 7 bytes), a mismatched echo, or an unsupported answer.
 */
export function decodeWuqueLightingColorCorrection(reply, subCommand) {
    const accepted = subCommand === undefined ? BASE_BLOCK_REPLIES : [subCommand];
    if (!checkedReply(reply, WUQUE_GROUP.lighting, accepted, 7))
        return null;
    return { r: reply[4], g: reply[5], b: reply[6] };
}
// ---------------------------------------------------------------------------
// Custom pages (getCustom = 3 readback / setCustom = 4 write / directDrive = 5)
// ---------------------------------------------------------------------------
/**
 * Read back one custom LED page: `[5, 3, area, index]` (`bw`,
 * `app.pretty.js:51871`/`:52434`). Hardware: `[5,3,0,0]`. `getSaveLightingCustom`
 * emits byte-identical request bytes (`:52438`).
 */
export function encodeWuqueGetLightingCustom(area = WUQUE_LIGHTING_AREA.keyboard, index = 0) {
    return encodeWuqueCommand(WUQUE_GROUP.lighting, WUQUE_LIGHTING_COMMAND.getCustom, [area, index]);
}
/** Read `WUQUE_LEDS_PER_FRAME` LEDs as `B, G, R, flag` starting at `at`. */
function readLeds(bytes, at) {
    const leds = [];
    for (let i = 0; i < WUQUE_LEDS_PER_FRAME; i += 1) {
        const base = at + i * 4;
        leds.push({
            b: bytes[base],
            g: bytes[base + 1],
            r: bytes[base + 2],
            isCustom: bytes[base + 3] === 255,
        });
    }
    return leds;
}
/**
 * Decode a custom-page reply: 15 LEDs at `reply[4 + 4*i]` as `B, G, R, isCustom`
 * (`lightingCustomData`, `app.pretty.js:52498`; hardware readback `05 03 00 00 | …`
 * with the LEDs from payload offset 2). Returns null on a short reply (< 64
 * bytes), a mismatched echo, or an unsupported answer.
 */
export function decodeWuqueLightingCustom(reply, subCommand = WUQUE_LIGHTING_COMMAND.getCustom) {
    if (!checkedReply(reply, WUQUE_GROUP.lighting, [subCommand], 4 + WUQUE_LEDS_PER_FRAME * 4)) {
        return null;
    }
    return readLeds(reply, 4);
}
/** Build a `[5, subCommand, area, index, ...N×(B,G,R,flag)]` frame, N ≤ 15. */
function encodeLedFrame(subCommand, area, index, leds) {
    const params = [area, index];
    for (const led of leds.slice(0, WUQUE_LEDS_PER_FRAME)) {
        params.push(led.b, led.g, led.r, led.isCustom ? 255 : 0);
    }
    return encodeWuqueCommand(WUQUE_GROUP.lighting, subCommand, params);
}
/**
 * Write one custom LED page: `[5, 4, area, index, ...15×(B,G,R,flag)]`
 * (`EG`, `app.pretty.js:51841`; `getLightingCustomProtocol` with
 * `protocol:"Custom"` at `:52415`, driven by `setLightingCustom` `:57078`).
 * `leds` is clamped to {@link WUQUE_LEDS_PER_FRAME}; shorter pages leave the
 * remaining LED slots zero (frame padding).
 */
export function encodeWuqueSetLightingCustom(area, index, leds) {
    return encodeLedFrame(WUQUE_LIGHTING_COMMAND.setCustom, area, index, leds);
}
/**
 * Direct-drive chunk: `[5, 5, area, index, ...N×(B,G,R,flag)]` with N ≤ 15
 * (`IG`, `app.pretty.js:51851`/`:52442`; `setLightingDirectDrive` `:57101`).
 * The vendor sends this **fire-and-forget** (`sendDataNoResponse`, `:57119`) —
 * no reply is expected, so there is no matching decoder.
 */
export function encodeWuqueLightingDirectDrive(area, index, leds) {
    return encodeLedFrame(WUQUE_LIGHTING_COMMAND.directDrive, area, index, leds);
}
/**
 * Caps indicator colour: `[5, 6, B, R, G]` (`FG`, `app.pretty.js:51877` — the
 * only **B, R, G** order; `setLightingCapsProtocol` `:52516`). Raw frame, no
 * reply.
 */
export function encodeWuqueLightingCaps(color) {
    return encodeWuqueCommand(WUQUE_GROUP.lighting, WUQUE_LIGHTING_COMMAND.caps, [
        color.b,
        color.r,
        color.g,
    ]);
}
// ---------------------------------------------------------------------------
// CustomCommand (group 10) — blackout + keyboard shell colour
// ---------------------------------------------------------------------------
/**
 * Blackout status query: `[10, 1, 0]` (`getBlackoutProtocol` 52527; `Ri.Close`
 * = 0). Hardware: `[10,1,0]` → `0a 01 00 00 …`.
 */
export function encodeWuqueBlackoutGet() {
    return encodeWuqueCommand(WUQUE_GROUP.customCommand, WUQUE_CUSTOM_COMMAND.blackout, [0]);
}
/**
 * Decode a blackout reply: `reply[3] === 255` means open (`app.pretty.js:52531`;
 * hardware `0a 01 00 00` → byte 3 = 0). Returns null on a short reply (< 4
 * bytes), a mismatched echo, or an unsupported answer.
 */
export function decodeWuqueBlackout(reply, subCommand = WUQUE_CUSTOM_COMMAND.blackout) {
    if (!checkedReply(reply, WUQUE_GROUP.customCommand, [subCommand], 4))
        return null;
    return { open: reply[3] === 255 };
}
/**
 * Set blackout: `[10, 1, 1, 255|0]` (`openBlackout`/`closeBlackout` 52534/52538;
 * `Ri.Open` = 255, `Ri.Close` = 0). Fire-and-forget.
 */
export function encodeWuqueBlackoutSet(open) {
    return encodeWuqueCommand(WUQUE_GROUP.customCommand, WUQUE_CUSTOM_COMMAND.blackout, [
        1,
        open ? 255 : 0,
    ]);
}
/**
 * Keyboard shell colour query: `[10, 1, 1]` (`GFSKeyboardColorGet`,
 * deployed `:4390`, `us.Read` = 1). Note this shares group 10 sub-command 1
 * with blackout; the two are distinguished by the selector byte at byte 2.
 */
export function encodeWuqueKeyboardColorGet() {
    return encodeWuqueCommand(WUQUE_GROUP.customCommand, WUQUE_CUSTOM_COMMAND.blackout, [
        WUQUE_ACCESS.read,
    ]);
}
/**
 * Set the keyboard shell colour: `[10, 1, 2, 255, B, G, R]`
 * (`GFSKeyboardColorSet`, deployed `:4395` — a literal `255` at byte 3 and
 * **B, G, R** order). Distinct from the older `setDeviceShellColor`.
 */
export function encodeWuqueKeyboardColorSet(color) {
    return encodeWuqueCommand(WUQUE_GROUP.customCommand, WUQUE_CUSTOM_COMMAND.blackout, [
        WUQUE_ACCESS.write,
        255,
        color.b,
        color.g,
        color.r,
    ]);
}
/**
 * Decode a keyboard shell-colour reply: `r=reply[6], g=reply[5], b=reply[4]`
 * (the deployed `rg` helper at `:3138`, used by both the get and set
 * decoders). `subCommand` defaults to accepting both the read (`1`) and write
 * (`2`) echoes. Returns null on a short reply (< 7 bytes), a mismatched echo, or
 * an unsupported answer.
 */
export function decodeWuqueKeyboardColor(reply, subCommand) {
    const accepted = subCommand === undefined ? [WUQUE_ACCESS.read, WUQUE_ACCESS.write] : [subCommand];
    if (!checkedReply(reply, WUQUE_GROUP.customCommand, accepted, 7))
        return null;
    return { r: reply[6], g: reply[5], b: reply[4] };
}
