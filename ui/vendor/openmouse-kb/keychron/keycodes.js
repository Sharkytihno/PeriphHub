/**
 * QMK keycodes for the Keychron Hall-effect boards: short legends for drawing
 * a keymap, and a catalog for choosing what a key should do.
 *
 * The basic keycodes (0x0000-0x00FF) mean the same on every firmware. The
 * layer keys and the custom (board-specific) range moved between QMK versions,
 * and Launcher picks its table from the VIA protocol version the board
 * reports, so everything here takes that version. Table values are from
 * Launcher's four keycode tables:
 *
 *   protocol >= 12   layer keys at 0x5200 (TO) / 0x5220 (MO) ...; custom at 0x7E00
 *   protocol == 11   same layer keys; custom at 0x7F00
 *   protocol <= 10   layer keys at 0x5000/0x5010 (TO), 0x5100 (MO) ...; custom at 0x5F80
 *
 * Anything not recognised is shown by its hex value and cannot be chosen, so
 * a key is never labelled as something it is not.
 */
import { keychronCustomKeycodes } from "./custom-keycodes.js";
/** Context for a board: its protocol version and its own custom keycodes. */
export function keychronKeycodeContext(productId, protocol) {
    return { protocol, custom: keychronCustomKeycodes(productId) };
}
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "1234567890";
const BASIC = {
    0x28: ["Enter", "Enter"], 0x29: ["Esc", "Escape"], 0x2a: ["Bksp", "Backspace"], 0x2b: ["Tab", "Tab"],
    0x2c: ["Space", "Space"], 0x2d: ["-", "Minus"], 0x2e: ["=", "Equal"], 0x2f: ["[", "Left bracket"],
    0x30: ["]", "Right bracket"], 0x31: ["\\", "Backslash"], 0x32: ["#", "Non-US hash"], 0x33: [";", "Semicolon"],
    0x34: ["'", "Quote"], 0x35: ["`", "Grave"], 0x36: [",", "Comma"], 0x37: [".", "Period"], 0x38: ["/", "Slash"],
    0x39: ["Caps", "Caps Lock"], 0x46: ["PrtSc", "Print Screen"], 0x47: ["ScrLk", "Scroll Lock"],
    0x48: ["Pause", "Pause"], 0x49: ["Ins", "Insert"], 0x4a: ["Home", "Home"], 0x4b: ["PgUp", "Page Up"],
    0x4c: ["Del", "Delete"], 0x4d: ["End", "End"], 0x4e: ["PgDn", "Page Down"], 0x4f: ["→", "Right arrow"],
    0x50: ["←", "Left arrow"], 0x51: ["↓", "Down arrow"], 0x52: ["↑", "Up arrow"], 0x53: ["Num", "Num Lock"],
    0x54: ["/", "Keypad slash"], 0x55: ["*", "Keypad asterisk"], 0x56: ["-", "Keypad minus"],
    0x57: ["+", "Keypad plus"], 0x58: ["Ent", "Keypad enter"], 0x62: ["0", "Keypad 0"], 0x63: [".", "Keypad period"],
    0x64: ["\\", "Non-US backslash"], 0x65: ["Menu", "Application"],
    0xe0: ["Ctrl", "Left Control"], 0xe1: ["Shift", "Left Shift"], 0xe2: ["Alt", "Left Alt"], 0xe3: ["Win", "Left GUI"],
    0xe4: ["Ctrl", "Right Control"], 0xe5: ["Shift", "Right Shift"], 0xe6: ["Alt", "Right Alt"], 0xe7: ["Win", "Right GUI"],
    0xa8: ["Mute", "Mute"], 0xa9: ["Vol+", "Volume up"], 0xaa: ["Vol-", "Volume down"], 0xab: ["Next", "Next track"],
    0xac: ["Prev", "Previous track"], 0xad: ["Stop", "Stop"], 0xae: ["Play", "Play/pause"],
};
const MOD_BITS = [["Ctrl", 0x01], ["Shift", 0x02], ["Alt", 0x04], ["Win", 0x08]];
/** Layer-key bases per protocol range, each covering 32 layers. */
const LAYER_BASES = {
    modern: { to: 0x5200, mo: 0x5220, df: 0x5240, tg: 0x5260, osl: 0x5280, tt: 0x52c0 },
    legacy: { to: 0x5010, mo: 0x5100, df: 0x5200, tg: 0x5300, osl: 0x5400, tt: 0x5800 },
};
const LAYER_NAMES = {
    to: ["TO", "Switch to layer"], mo: ["MO", "Momentary layer"], df: ["DF", "Default layer"],
    tg: ["TG", "Toggle layer"], osl: ["OS", "One-shot layer"], tt: ["TT", "Layer tap-toggle"],
};
const layerBases = (protocol) => (protocol >= 11 ? LAYER_BASES.modern : LAYER_BASES.legacy);
/** First custom keycode: 0x7E00 on protocol 12+, 0x7F00 on 11, 0x5F80 before. */
export function keychronCustomKeycodeBase(protocol) {
    return protocol >= 12 ? 0x7e00 : protocol === 11 ? 0x7f00 : 0x5f80;
}
/** How many custom keycodes the firmware can address (Launcher's table allows 16). */
export const KEYCHRON_CUSTOM_KEYCODE_SLOTS = 16;
function basic(code) {
    if (code >= 0x04 && code <= 0x1d)
        return [LETTERS[code - 0x04], `Key ${LETTERS[code - 0x04]}`];
    if (code >= 0x1e && code <= 0x27)
        return [DIGITS[code - 0x1e], `Key ${DIGITS[code - 0x1e]}`];
    if (code >= 0x3a && code <= 0x45)
        return [`F${code - 0x39}`, `F${code - 0x39}`];
    if (code >= 0x68 && code <= 0x73)
        return [`F${code - 0x5b}`, `F${code - 0x5b}`];
    if (code >= 0x59 && code <= 0x61)
        return [String(code - 0x58), `Keypad ${code - 0x58}`];
    return BASIC[code] ?? null;
}
function layerKey(code, protocol) {
    const bases = layerBases(protocol);
    for (const kind of Object.keys(bases)) {
        const base = bases[kind];
        if (code >= base && code < base + 0x20)
            return { kind, layer: code - base };
    }
    return null;
}
/** Legend for one keycode as read from the board. */
export function keychronKeycodeLegend(code, context = {}) {
    const protocol = context.protocol ?? 12;
    if (code === 0x0000)
        return { label: "", title: "No key", unknown: false };
    if (code === 0x0001)
        return { label: "▽", title: "Transparent (falls through to the layer below)", unknown: false };
    const direct = basic(code);
    if (direct)
        return { label: direct[0], title: direct[1], unknown: false };
    // Modifier combos: 0x0100-0x1FFF are a basic key plus mod bits.
    if (code >= 0x0100 && code <= 0x1fff) {
        const key = basic(code & 0xff);
        const mods = MOD_BITS.filter(([, bit]) => (code >> 8) & bit).map(([name]) => name);
        if (key && mods.length)
            return { label: key[0], title: `${mods.join("+")}+${key[1]}`, unknown: false };
    }
    // Mod-tap 0x2000-0x3FFF and layer-tap 0x4000-0x4FFF: the tap key is the legend.
    if (code >= 0x2000 && code <= 0x4fff) {
        const key = basic(code & 0xff);
        if (key)
            return { label: key[0], title: `${code >= 0x4000 ? "Layer-tap" : "Mod-tap"} ${key[1]}`, unknown: false };
    }
    const layer = layerKey(code, protocol);
    if (layer) {
        const [short, title] = LAYER_NAMES[layer.kind];
        return { label: `${short}${layer.layer}`, title: `${title} ${layer.layer}`, unknown: false };
    }
    const base = keychronCustomKeycodeBase(protocol);
    if (code >= base && code < base + KEYCHRON_CUSTOM_KEYCODE_SLOTS) {
        const entry = context.custom?.find((item) => item.index === code - base);
        if (entry)
            return { label: entry.shortName, title: entry.title, unknown: false };
    }
    const hex = `0x${code.toString(16).toUpperCase().padStart(4, "0")}`;
    return { label: hex, title: `Unrecognised keycode ${hex}`, unknown: true };
}
const range = (from, to, context) => Array.from({ length: to - from + 1 }, (_, i) => {
    const legend = keychronKeycodeLegend(from + i, context);
    return { code: from + i, label: legend.label, title: legend.title };
});
const list = (codes, context) => codes.map((code) => {
    const legend = keychronKeycodeLegend(code, context);
    return { code, label: legend.label, title: legend.title };
});
/**
 * Keycodes a key can be set to, grouped for a picker. Basic keys are offered
 * on every firmware; layer keys and the board's custom keys come from the
 * table for `context.protocol`. `layerCount` limits the layer keys.
 */
export function keychronKeycodeCatalog(context = {}) {
    const protocol = context.protocol ?? 12;
    const layers = Math.min(context.layerCount ?? 4, 32);
    const bases = layerBases(protocol);
    const layerEntries = Object.keys(bases).flatMap((kind) => Array.from({ length: layers }, (_, layer) => {
        const code = bases[kind] + layer;
        const legend = keychronKeycodeLegend(code, context);
        return { code, label: legend.label, title: legend.title };
    }));
    const custom = (context.custom ?? [])
        .filter((item) => item.index < KEYCHRON_CUSTOM_KEYCODE_SLOTS)
        .map((item) => ({ code: keychronCustomKeycodeBase(protocol) + item.index, label: item.shortName, title: item.title }));
    const categories = [
        { id: "letters", label: "Letters", entries: range(0x04, 0x1d, context) },
        { id: "numbers", label: "Numbers", entries: range(0x1e, 0x27, context) },
        { id: "punctuation", label: "Punctuation", entries: list([0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38], context) },
        { id: "editing", label: "Editing", entries: list([0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x39, 0x49, 0x4c], context) },
        { id: "navigation", label: "Navigation", entries: list([0x4a, 0x4b, 0x4d, 0x4e, 0x4f, 0x50, 0x51, 0x52], context) },
        { id: "function", label: "Function keys", entries: [...range(0x3a, 0x45, context), ...range(0x68, 0x73, context)] },
        { id: "modifiers", label: "Modifiers", entries: range(0xe0, 0xe7, context) },
        { id: "keypad", label: "Keypad", entries: [...list([0x53, 0x54, 0x55, 0x56, 0x57, 0x58], context), ...range(0x59, 0x63, context)] },
        { id: "system", label: "System", entries: list([0x46, 0x47, 0x48, 0x65], context) },
        { id: "media", label: "Media", entries: range(0xa8, 0xae, context) },
        { id: "layers", label: "Layers", entries: layerEntries },
        { id: "special", label: "Special", entries: list([0x0000, 0x0001], context) },
    ];
    if (custom.length)
        categories.push({ id: "keychron", label: "Keychron", entries: custom });
    return categories.filter((category) => category.entries.length > 0);
}
/** True when `code` is one this module can name for the firmware's protocol. */
export function keychronKeycodeIsChoosable(code, context = {}) {
    if (!Number.isInteger(code) || code < 0 || code > 0xffff)
        return false;
    return !keychronKeycodeLegend(code, context).unknown;
}
/** True when `code` is a layer key (MO/TG/TO/DF/OSL/TT) on this firmware. */
export function keychronIsLayerKey(code, protocol = 12) {
    return layerKey(code, protocol) !== null;
}
