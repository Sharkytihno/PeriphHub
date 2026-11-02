/**
 * The basic keycodes (one byte, the same in every QMK version). Mouse keys and
 * quantum keys are left out because their numbers depend on the QMK version.
 */
const ROWS = [];
const add = (code, title, names, label = title) => { ROWS.push({ code, title, label, names }); };
for (let index = 0; index < 26; index += 1) {
    const letter = String.fromCharCode(65 + index);
    add(0x04 + index, letter, [`KC_${letter}`]);
}
for (let index = 1; index <= 9; index += 1)
    add(0x1d + index, String(index), [`KC_${index}`]);
add(0x27, "0", ["KC_0"]);
add(0x28, "Enter", ["KC_ENT", "KC_ENTER"]);
add(0x29, "Esc", ["KC_ESC", "KC_ESCAPE"]);
add(0x2a, "Backspace", ["KC_BSPC", "KC_BACKSPACE"], "Bksp");
add(0x2b, "Tab", ["KC_TAB"]);
add(0x2c, "Space", ["KC_SPC", "KC_SPACE"]);
add(0x2d, "-", ["KC_MINS", "KC_MINUS"]);
add(0x2e, "=", ["KC_EQL", "KC_EQUAL"]);
add(0x2f, "[", ["KC_LBRC", "KC_LEFT_BRACKET"]);
add(0x30, "]", ["KC_RBRC", "KC_RIGHT_BRACKET"]);
add(0x31, "\\", ["KC_BSLS", "KC_BACKSLASH"]);
add(0x32, "# (ISO)", ["KC_NUHS", "KC_NONUS_HASH"]);
add(0x33, ";", ["KC_SCLN", "KC_SEMICOLON"]);
add(0x34, "'", ["KC_QUOT", "KC_QUOTE"]);
add(0x35, "`", ["KC_GRV", "KC_GRAVE"]);
add(0x36, ",", ["KC_COMM", "KC_COMMA"]);
add(0x37, ".", ["KC_DOT"]);
add(0x38, "/", ["KC_SLSH", "KC_SLASH"]);
add(0x39, "Caps Lock", ["KC_CAPS", "KC_CAPS_LOCK"], "Caps");
for (let index = 1; index <= 12; index += 1)
    add(0x39 + index, `F${index}`, [`KC_F${index}`]);
add(0x46, "Print Screen", ["KC_PSCR", "KC_PRINT_SCREEN"], "PrtSc");
add(0x47, "Scroll Lock", ["KC_SCRL", "KC_SCROLL_LOCK", "KC_SLCK", "KC_BRMD"], "ScrLk");
add(0x48, "Pause", ["KC_PAUS", "KC_PAUSE", "KC_BRK", "KC_BRMU"]);
add(0x49, "Insert", ["KC_INS", "KC_INSERT"], "Ins");
add(0x4a, "Home", ["KC_HOME"]);
add(0x4b, "Page Up", ["KC_PGUP", "KC_PAGE_UP"], "PgUp");
add(0x4c, "Delete", ["KC_DEL", "KC_DELETE"], "Del");
add(0x4d, "End", ["KC_END"]);
add(0x4e, "Page Down", ["KC_PGDN", "KC_PAGE_DOWN"], "PgDn");
add(0x4f, "Right", ["KC_RGHT", "KC_RIGHT"]);
add(0x50, "Left", ["KC_LEFT"]);
add(0x51, "Down", ["KC_DOWN"]);
add(0x52, "Up", ["KC_UP"]);
add(0x53, "Num Lock", ["KC_NUM", "KC_NUM_LOCK", "KC_NLCK"], "NumLk");
add(0x54, "KP /", ["KC_PSLS", "KC_KP_SLASH"]);
add(0x55, "KP *", ["KC_PAST", "KC_KP_ASTERISK"]);
add(0x56, "KP -", ["KC_PMNS", "KC_KP_MINUS"]);
add(0x57, "KP +", ["KC_PPLS", "KC_KP_PLUS"]);
add(0x58, "KP Enter", ["KC_PENT", "KC_KP_ENTER"], "KP Ent");
for (let index = 1; index <= 9; index += 1)
    add(0x58 + index, `KP ${index}`, [`KC_P${index}`, `KC_KP_${index}`]);
add(0x62, "KP 0", ["KC_P0", "KC_KP_0"]);
add(0x63, "KP .", ["KC_PDOT", "KC_KP_DOT"]);
add(0x64, "\\ (ISO)", ["KC_NUBS", "KC_NONUS_BACKSLASH"]);
add(0x65, "Menu", ["KC_APP", "KC_APPLICATION"]);
add(0x66, "Power (keyboard)", ["KC_KB_POWER"]);
add(0x67, "KP =", ["KC_PEQL", "KC_KP_EQUAL"]);
for (let index = 13; index <= 24; index += 1)
    add(0x5b + index, `F${index}`, [`KC_F${index}`]);
add(0x74, "Execute", ["KC_EXEC", "KC_EXECUTE"]);
add(0x75, "Help", ["KC_HELP"]);
add(0x76, "Menu key", ["KC_MENU"]);
add(0x77, "Select", ["KC_SLCT", "KC_SELECT"]);
add(0x78, "Stop", ["KC_STOP"]);
add(0x79, "Again", ["KC_AGIN", "KC_AGAIN"]);
add(0x7a, "Undo", ["KC_UNDO"]);
add(0x7b, "Cut", ["KC_CUT"]);
add(0x7c, "Copy", ["KC_COPY"]);
add(0x7d, "Paste", ["KC_PSTE", "KC_PASTE"]);
add(0x7e, "Find", ["KC_FIND"]);
add(0x7f, "Mute", ["KC_KB_MUTE"]);
add(0x80, "Volume up", ["KC_KB_VOLUME_UP"], "Vol+");
add(0x81, "Volume down", ["KC_KB_VOLUME_DOWN"], "Vol-");
add(0x82, "Locking Caps Lock", ["KC_LCAP", "KC_LOCKING_CAPS_LOCK"]);
add(0x83, "Locking Num Lock", ["KC_LNUM", "KC_LOCKING_NUM_LOCK"]);
add(0x84, "Locking Scroll Lock", ["KC_LSCR", "KC_LOCKING_SCROLL_LOCK"]);
add(0x85, "KP ,", ["KC_PCMM", "KC_KP_COMMA"]);
add(0x86, "KP = (AS/400)", ["KC_KP_EQUAL_AS400"]);
for (let index = 1; index <= 9; index += 1)
    add(0x86 + index, `International ${index}`, [`KC_INT${index}`, `KC_INTERNATIONAL_${index}`, ...[["KC_RO", "KC_KANA", "KC_JYEN", "KC_HENK", "KC_MHEN"][index - 1]].filter((alias) => alias !== undefined)]);
for (let index = 1; index <= 9; index += 1)
    add(0x8f + index, `Language ${index}`, [`KC_LNG${index}`, `KC_LANGUAGE_${index}`, `KC_LANG${index}`]);
add(0x99, "Alternate Erase", ["KC_ERAS", "KC_ALTERNATE_ERASE"]);
add(0x9a, "SysReq", ["KC_SYRQ", "KC_SYSTEM_REQUEST"]);
add(0x9b, "Cancel", ["KC_CNCL", "KC_CANCEL"]);
add(0x9c, "Clear", ["KC_CLR", "KC_CLEAR"]);
add(0x9d, "Prior", ["KC_PRIR", "KC_PRIOR"]);
add(0x9e, "Return", ["KC_RETN", "KC_RETURN"]);
add(0x9f, "Separator", ["KC_SEPR", "KC_SEPARATOR"]);
add(0xa0, "Out", ["KC_OUT"]);
add(0xa1, "Oper", ["KC_OPER"]);
add(0xa2, "Clear/Again", ["KC_CLAG", "KC_CLEAR_AGAIN"]);
add(0xa3, "CrSel", ["KC_CRSL", "KC_CRSEL"]);
add(0xa4, "ExSel", ["KC_EXSL", "KC_EXSEL"]);
add(0xa5, "Power", ["KC_PWR", "KC_SYSTEM_POWER"]);
add(0xa6, "Sleep", ["KC_SLEP", "KC_SYSTEM_SLEEP"]);
add(0xa7, "Wake", ["KC_WAKE", "KC_SYSTEM_WAKE"]);
add(0xa8, "Mute", ["KC_MUTE", "KC_AUDIO_MUTE"]);
add(0xa9, "Volume up", ["KC_VOLU", "KC_AUDIO_VOL_UP"], "Vol+");
add(0xaa, "Volume down", ["KC_VOLD", "KC_AUDIO_VOL_DOWN"], "Vol-");
add(0xab, "Next track", ["KC_MNXT", "KC_MEDIA_NEXT_TRACK"], "Next");
add(0xac, "Previous track", ["KC_MPRV", "KC_MEDIA_PREV_TRACK"], "Prev");
add(0xad, "Stop", ["KC_MSTP", "KC_MEDIA_STOP"]);
add(0xae, "Play/pause", ["KC_MPLY", "KC_MEDIA_PLAY_PAUSE"], "Play");
add(0xaf, "Media select", ["KC_MSEL", "KC_MEDIA_SELECT"]);
add(0xb0, "Eject", ["KC_EJCT", "KC_MEDIA_EJECT"]);
add(0xb1, "Mail", ["KC_MAIL"]);
add(0xb2, "Calculator", ["KC_CALC", "KC_CALCULATOR"]);
add(0xb3, "My computer", ["KC_MYCM", "KC_MY_COMPUTER"]);
add(0xb4, "Browser search", ["KC_WSCH", "KC_WWW_SEARCH"]);
add(0xb5, "Browser home", ["KC_WHOM", "KC_WWW_HOME"]);
add(0xb6, "Browser back", ["KC_WBAK", "KC_WWW_BACK"]);
add(0xb7, "Browser forward", ["KC_WFWD", "KC_WWW_FORWARD"]);
add(0xb8, "Browser stop", ["KC_WSTP", "KC_WWW_STOP"]);
add(0xb9, "Browser refresh", ["KC_WREF", "KC_WWW_REFRESH"]);
add(0xba, "Browser favorites", ["KC_WFAV", "KC_WWW_FAVORITES"]);
add(0xbb, "Fast forward", ["KC_MFFD", "KC_MEDIA_FAST_FORWARD"]);
add(0xbc, "Rewind", ["KC_MRWD", "KC_MEDIA_REWIND"]);
add(0xbd, "Brightness up", ["KC_BRIU", "KC_BRIGHTNESS_UP"]);
add(0xbe, "Brightness down", ["KC_BRID", "KC_BRIGHTNESS_DOWN"]);
add(0xbf, "Control panel", ["KC_CPNL", "KC_CONTROL_PANEL"]);
add(0xc0, "Assistant", ["KC_ASST", "KC_ASSISTANT"]);
add(0xc1, "Mission Control", ["KC_MCTL", "KC_MISSION_CONTROL"]);
add(0xc2, "Launchpad", ["KC_LPAD", "KC_LAUNCHPAD"]);
add(0xe0, "Left Ctrl", ["KC_LCTL", "KC_LEFT_CTRL"], "LCtrl");
add(0xe1, "Left Shift", ["KC_LSFT", "KC_LEFT_SHIFT"], "LShift");
add(0xe2, "Left Alt", ["KC_LALT", "KC_LEFT_ALT", "KC_LOPT"], "LAlt");
add(0xe3, "Left Win", ["KC_LGUI", "KC_LEFT_GUI", "KC_LCMD", "KC_LWIN"], "LWin");
add(0xe4, "Right Ctrl", ["KC_RCTL", "KC_RIGHT_CTRL"], "RCtrl");
add(0xe5, "Right Shift", ["KC_RSFT", "KC_RIGHT_SHIFT"], "RShift");
add(0xe6, "Right Alt", ["KC_RALT", "KC_RIGHT_ALT", "KC_ROPT", "KC_ALGR"], "RAlt");
add(0xe7, "Right Win", ["KC_RGUI", "KC_RIGHT_GUI", "KC_RCMD", "KC_RWIN"], "RWin");
export const VIA_BASIC_KEYCODES = ROWS;
const BY_CODE = new Map(ROWS.map((row) => [row.code, row]));
const BY_NAME = new Map(ROWS.flatMap((row) => row.names.map((name) => [name, row.code])));
/** The table row for a basic keycode, or null when it has none. */
export function viaBasicKeycode(code) {
    return BY_CODE.get(code) ?? null;
}
/** The short QMK name of a basic keycode, or null when it has none. */
export function viaKeycodeName(code) {
    return BY_CODE.get(code)?.names[0] ?? null;
}
/** The keycode for a QMK name or alias (any letter case), or null when the name is unknown. */
export function viaKeycodeFromName(name) {
    return BY_NAME.get(name.trim().toUpperCase()) ?? null;
}
const MACRO_KEYS = 16;
const LEGACY_BASES = {
    modTap: 0x6000, to: 0x5010, momentary: 0x5100, defaultLayer: 0x5200, toggle: 0x5300,
    oneShotLayer: 0x5400, oneShotMod: 0x5500, layerTapToggle: 0x5800, macro: 0x5f12,
};
const MODERN_BASES = {
    modTap: 0x2000, to: 0x5200, momentary: 0x5220, defaultLayer: 0x5240, toggle: 0x5260,
    oneShotLayer: 0x5280, oneShotMod: 0x52a0, layerTapToggle: 0x52c0, macro: 0x7702,
};
const MODERN_BASES_12 = { ...MODERN_BASES, macro: 0x7700 };
/** QMK renumbered its quantum keycodes at VIA protocol 11; protocol 10 only moved the TO range; protocol 12 moved the macro keys to 0x7700. */
/** TO only has 16 slots (0x5010 to 0x501f) before protocol 10 moved it; every other layer action holds 32. */
const layerSlots = (base, known, protocolVersion) => (base === known.to && protocolVersion < 10 ? 16 : 32);
function bases(protocolVersion) {
    if (protocolVersion >= 12)
        return MODERN_BASES_12;
    if (protocolVersion >= 11)
        return MODERN_BASES;
    return protocolVersion === 10 ? { ...LEGACY_BASES, to: 0x5000 } : LEGACY_BASES;
}
const LAYER_TAP = 0x4000;
const MODS_MIN = 0x0100;
const MODS_MAX = 0x1fff;
function modifierNames(mask) {
    const right = (mask & 0x10) !== 0;
    const names = [[0x01, "Ctrl"], [0x02, "Shift"], [0x04, "Alt"], [0x08, "Win"]];
    return names.filter(([bit]) => mask & bit).map(([, label]) => `${right ? "R" : ""}${label}`).join("+");
}
const SPECIAL = {
    0x0000: { label: "None", title: "No key" },
    0x0001: { label: "▽", title: "Transparent: falls through to the layer below" },
};
function basic(code) {
    const known = SPECIAL[code] ?? viaBasicKeycode(code);
    return known && { label: known.label, title: known.title };
}
const hex = (code) => `0x${code.toString(16).toUpperCase().padStart(4, "0")}`;
/** Names a 16-bit VIA keycode. Anything unrecognised comes back as hex rather than a guess. */
export function describeViaKeycode(code, protocolVersion, custom = []) {
    if (code <= 0xff)
        return basic(code) ?? { label: hex(code), title: `Keycode ${hex(code)}` };
    const known = bases(protocolVersion);
    if (code >= MODS_MIN && code <= MODS_MAX) {
        const key = basic(code & 0xff);
        const mods = modifierNames((code >> 8) & 0x1f);
        if (key && mods)
            return { label: `${mods}+${key.label}`, title: `${mods} + ${key.title}` };
    }
    else if (code >= known.modTap && code <= known.modTap + 0x1fff) {
        const key = basic(code & 0xff);
        const mods = modifierNames((code >> 8) & 0x1f);
        if (key && mods)
            return { label: `${key.label} · ${mods}`, title: `Mod-tap: tap ${key.title}, hold ${mods}` };
    }
    else if (code >= LAYER_TAP && code <= 0x4fff) {
        const key = basic(code & 0xff);
        const layer = (code >> 8) & 0x0f;
        if (key)
            return { label: `LT(${layer}) ${key.label}`, title: `Layer-tap: tap ${key.title}, hold layer ${layer}` };
    }
    else {
        const layered = [
            [known.to, "TO", "Switch to layer"], [known.momentary, "MO", "Hold for layer"],
            [known.defaultLayer, "DF", "Set default layer"], [known.toggle, "TG", "Toggle layer"],
            [known.oneShotLayer, "OSL", "One-shot layer"], [known.layerTapToggle, "TT", "Tap-toggle layer"],
        ];
        for (const [base, abbreviation, description] of layered) {
            if (code >= base && code < base + layerSlots(base, known, protocolVersion)) {
                const layer = code - base;
                return { label: `${abbreviation}(${layer})`, title: `${description} ${layer}` };
            }
        }
        if (code >= known.macro && code < known.macro + macroKeyLimit(protocolVersion)) {
            return { label: `M${code - known.macro}`, title: `Macro ${code - known.macro}` };
        }
        if (code >= known.oneShotMod && code <= known.oneShotMod + (protocolVersion >= 11 ? 0x1f : 0xff)) {
            const mods = modifierNames(code - known.oneShotMod);
            if (mods)
                return { label: `OSM ${mods}`, title: `One-shot modifier ${mods}` };
        }
    }
    const lighting = lightingRows(protocolVersion).find((row) => row.code === code);
    if (lighting)
        return { label: lighting.name.replace(/^(BL|RGB|UG|RM)_/, "$1 "), title: lighting.title };
    const base = customKeycodeBase(protocolVersion);
    const own = code >= base ? custom[code - base] : undefined;
    if (own)
        return { label: own.shortName ?? own.name, title: own.title ?? own.name };
    return { label: hex(code), title: `Keycode ${hex(code)}` };
}
// Names and titles in code order for the legacy numbering; the modern backlight list reorders the first five (see `lightingRows`).
const BACKLIGHT_KEYS = [
    ["BL_ON", "Backlight on"], ["BL_OFF", "Backlight off"], ["BL_DEC", "Backlight down"], ["BL_INC", "Backlight up"],
    ["BL_TOGG", "Backlight toggle"], ["BL_STEP", "Backlight step"], ["BL_BRTG", "Backlight breathing"],
];
const RGB_KEYS = [
    ["RGB_TOG", "RGB toggle"], ["RGB_MOD", "RGB next mode"], ["RGB_RMOD", "RGB previous mode"], ["RGB_HUI", "RGB hue up"],
    ["RGB_HUD", "RGB hue down"], ["RGB_SAI", "RGB saturation up"], ["RGB_SAD", "RGB saturation down"], ["RGB_VAI", "RGB brightness up"],
    ["RGB_VAD", "RGB brightness down"], ["RGB_SPI", "RGB speed up"], ["RGB_SPD", "RGB speed down"], ["RGB_M_P", "RGB plain"],
    ["RGB_M_B", "RGB breathe"], ["RGB_M_R", "RGB rainbow"], ["RGB_M_SW", "RGB swirl"], ["RGB_M_SN", "RGB snake"],
    ["RGB_M_K", "RGB knight"], ["RGB_M_X", "RGB Xmas"], ["RGB_M_G", "RGB gradient"],
];
const UNDERGLOW_KEYS = [
    ["UG_TOGG", "Underglow toggle"], ["UG_NEXT", "Underglow next"], ["UG_PREV", "Underglow previous"], ["UG_HUEU", "Underglow hue up"],
    ["UG_HUED", "Underglow hue down"], ["UG_SATU", "Underglow saturation up"], ["UG_SATD", "Underglow saturation down"],
    ["UG_VALU", "Underglow brightness up"], ["UG_VALD", "Underglow brightness down"], ["UG_SPDU", "Underglow speed up"], ["UG_SPDD", "Underglow speed down"],
];
const MATRIX_KEYS = [
    ["RM_ON", "Matrix on"], ["RM_OFF", "Matrix off"], ["RM_TOGG", "Matrix toggle"], ["RM_NEXT", "Matrix next effect"], ["RM_PREV", "Matrix previous effect"],
    ["RM_HUEU", "Matrix hue up"], ["RM_HUED", "Matrix hue down"], ["RM_SATU", "Matrix saturation up"], ["RM_SATD", "Matrix saturation down"],
    ["RM_VALU", "Matrix brightness up"], ["RM_VALD", "Matrix brightness down"], ["RM_SPDU", "Matrix speed up"], ["RM_SPDD", "Matrix speed down"],
];
const lightingCache = new Map();
/** The lighting keycodes of a protocol generation: legacy (to 10), 11, 12 (adds RM_), 13 (RGB_ becomes UG_). */
function lightingRows(protocolVersion) {
    const generation = protocolVersion >= 13 ? 13 : protocolVersion >= 12 ? 12 : protocolVersion >= 11 ? 11 : 0;
    const cached = lightingCache.get(generation);
    if (cached)
        return cached;
    const rows = [];
    const push = (family, base, list) => list.forEach(([name, title], index) => rows.push({ code: base + index, name, title, family }));
    const [on, off, dec, inc, toggle, step, breathing] = BACKLIGHT_KEYS;
    push("backlight", generation ? 0x7800 : 0x5cbb, generation ? [on, off, toggle, dec, inc, step, breathing] : BACKLIGHT_KEYS);
    if (generation === 13) {
        push("rgblight", 0x7820, UNDERGLOW_KEYS);
    }
    else {
        push("rgblight", generation ? 0x7820 : 0x5cc2, generation ? [...RGB_KEYS, ["RGB_MODE_RGBTEST", "RGB test"]] : RGB_KEYS);
    }
    if (generation >= 12)
        push("matrix", 0x7840, MATRIX_KEYS);
    lightingCache.set(generation, rows);
    return rows;
}
/** Lighting keycodes worth offering for the keycode modules a definition lists. */
export function viaLightingKeycodes(protocolVersion, modules) {
    const has = (...names) => names.some((name) => modules.includes(name));
    const families = new Set();
    if (has("qmk_lighting", "qmk_backlight_keycodes", "qmk_backlight_rgblight_keycodes"))
        families.add("backlight");
    if (has("qmk_lighting", "qmk_rgblight_keycodes", "qmk_backlight_rgblight_keycodes"))
        families.add("rgblight");
    // VIA offers the shared RGB_ codes for matrix boards up to protocol 12; the RM_ family is its own only from 13.
    if (has("qmk_rgb_matrix_keycodes"))
        families.add(protocolVersion >= 13 ? "matrix" : "rgblight");
    return lightingRows(protocolVersion).filter((row) => families.has(row.family)).map((row) => row.code);
}
/** Where a keyboard's own custom keycodes start. */
/** How many macro keycodes the protocol generation reserves (the board's own count may be smaller). */
const macroKeyLimit = (protocolVersion) => (protocolVersion >= 12 ? 0x80 : MACRO_KEYS);
/** How many custom keycodes the protocol generation reserves. */
const customKeycodeLimit = (protocolVersion) => (protocolVersion >= 11 ? 0x100 : 0x80);
const customKeycodeBase = (protocolVersion) => (protocolVersion >= 12 ? 0x7e00 : protocolVersion === 11 ? 0x7f00 : 0x5f80);
/** Modifier bits for `viaComposeKeycode`; `right` selects the right-hand set. */
export const VIA_MOD = { ctrl: 0x01, shift: 0x02, alt: 0x04, gui: 0x08, right: 0x10 };
/** Builds a layer-tap, mod-tap or modifier+key keycode, which the picker cannot list one by one. */
export function viaComposeKeycode(compose, protocolVersion) {
    if (!Number.isInteger(compose.key) || compose.key < 1 || compose.key > 0xff)
        throw new RangeError("The key must be a basic keycode (1 to 255).");
    if (compose.kind === "layerTap") {
        if (!Number.isInteger(compose.layer) || compose.layer < 0 || compose.layer > 15)
            throw new RangeError("A layer-tap layer must be 0 to 15.");
        return LAYER_TAP | (compose.layer << 8) | compose.key;
    }
    if (!Number.isInteger(compose.mods) || (compose.mods & 0x0f) === 0 || compose.mods > 0x1f)
        throw new RangeError("Pick at least one modifier.");
    return (compose.kind === "modTap" ? bases(protocolVersion).modTap : 0) | (compose.mods << 8) | compose.key;
}
// KeyboardEvent.code values for the basic keycodes, so a host keystroke can become a keycode and a keycode can borrow the OS layout's legend.
const EVENT_CODES = {
    Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c, Minus: 0x2d, Equal: 0x2e, BracketLeft: 0x2f, BracketRight: 0x30,
    Backslash: 0x31, Semicolon: 0x33, Quote: 0x34, Backquote: 0x35, Comma: 0x36, Period: 0x37, Slash: 0x38, CapsLock: 0x39,
    PrintScreen: 0x46, ScrollLock: 0x47, Pause: 0x48, Insert: 0x49, Home: 0x4a, PageUp: 0x4b, Delete: 0x4c, End: 0x4d, PageDown: 0x4e,
    ArrowRight: 0x4f, ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52, NumLock: 0x53, NumpadDivide: 0x54, NumpadMultiply: 0x55,
    NumpadSubtract: 0x56, NumpadAdd: 0x57, NumpadEnter: 0x58, NumpadDecimal: 0x63, IntlBackslash: 0x64, ContextMenu: 0x65,
    ControlLeft: 0xe0, ShiftLeft: 0xe1, AltLeft: 0xe2, MetaLeft: 0xe3, ControlRight: 0xe4, ShiftRight: 0xe5, AltRight: 0xe6, MetaRight: 0xe7,
};
for (let i = 0; i < 26; i++)
    EVENT_CODES[`Key${String.fromCharCode(65 + i)}`] = 0x04 + i;
for (let i = 1; i <= 9; i++) {
    EVENT_CODES[`Digit${i}`] = 0x1d + i;
    EVENT_CODES[`Numpad${i}`] = 0x58 + i;
}
EVENT_CODES.Digit0 = 0x27;
EVENT_CODES.Numpad0 = 0x62;
for (let i = 1; i <= 12; i++)
    EVENT_CODES[`F${i}`] = 0x39 + i;
for (let i = 13; i <= 24; i++)
    EVENT_CODES[`F${i}`] = 0x5b + i;
const EVENT_CODE_BY_KEYCODE = new Map(Object.entries(EVENT_CODES).map(([event, keycode]) => [keycode, event]));
/** The basic keycode for a `KeyboardEvent.code`, or null for keys VIA has no basic keycode for. */
export const viaKeycodeFromEventCode = (eventCode) => EVENT_CODES[eventCode] ?? null;
/** The `KeyboardEvent.code` of a basic keycode, which `navigator.keyboard.getLayoutMap()` can turn into the user's legend. */
export const viaEventCodeFromKeycode = (keycode) => EVENT_CODE_BY_KEYCODE.get(keycode) ?? null;
const HAND_MODS = [["CTL", 0x01], ["SFT", 0x02], ["ALT", 0x04], ["GUI", 0x08]];
/** A keycode as VIA writes it in a `.layout.json` file: KC_A, MO(1), LT(1,KC_A), LCTL(KC_A), MT(MOD_LCTL,KC_A), or hex when VIA has no name. */
export function viaKeycodeToLayoutName(code, protocolVersion) {
    const known = bases(protocolVersion);
    if (code === 0)
        return "KC_NO";
    if (code === 1)
        return "KC_TRNS";
    const basicName = code <= 0xff ? viaKeycodeName(code) : null;
    if (basicName)
        return basicName;
    if (code >= known.macro && code < known.macro + macroKeyLimit(protocolVersion))
        return `MACRO(${code - known.macro})`;
    const key = viaKeycodeName(code & 0xff);
    const mods = (code >> 8) & 0x1f;
    if (key && code >= MODS_MIN && code <= MODS_MAX && mods) {
        const side = mods & 0x10 ? "R" : "L";
        return HAND_MODS.filter(([, bit]) => mods & bit).reduceRight((inner, [name]) => `${side}${name}(${inner})`, key);
    }
    if (key && code >= known.modTap && code <= known.modTap + 0x1fff && mods) {
        const side = mods & 0x10 ? "R" : "L";
        return `MT(${HAND_MODS.filter(([, bit]) => mods & bit).map(([name]) => `MOD_${side}${name}`).join(" | ")},${key})`;
    }
    if (key && code >= LAYER_TAP && code <= 0x4fff)
        return `LT(${(code >> 8) & 0x0f},${key})`;
    if (code >= known.oneShotMod && code <= known.oneShotMod + 0x1f && (code & 0x0f) !== 0)
        return `OSM(${modMaskName(code & 0x1f)})`;
    for (const [base, name] of layerFunctions(known))
        if (code >= base && code < base + layerSlots(base, known, protocolVersion))
            return `${name}(${code - base})`;
    const lighting = lightingRows(protocolVersion).find((row) => row.code === code);
    return lighting ? lighting.name : `0x${code.toString(16)}`;
}
/** `MOD_LCTL | MOD_LSFT` for a 5-bit modifier mask (bit 4 is the right-hand side). */
function modMaskName(mods) {
    const side = mods & 0x10 ? "R" : "L";
    return HAND_MODS.filter(([, bit]) => mods & bit).map(([name]) => `MOD_${side}${name}`).join(" | ");
}
/** The inverse of `modMaskName`; null when a part is not a MOD_ name. */
function parseModMask(text) {
    const mask = text.split("|").reduce((sum, part) => {
        const match = /^MOD_([LR])(CTL|SFT|ALT|GUI)$/.exec(part.trim().toUpperCase());
        const bit = HAND_MODS.find(([hand]) => hand === match?.[2])?.[1];
        return sum === null || !match || bit === undefined ? null : sum | bit | (match[1] === "R" ? 0x10 : 0);
    }, 0);
    return mask === null || mask === 0 ? null : mask;
}
const layerFunctions = (known) => [
    [known.to, "TO"], [known.momentary, "MO"], [known.defaultLayer, "DF"], [known.toggle, "TG"], [known.oneShotLayer, "OSL"], [known.layerTapToggle, "TT"],
];
/** The inverse of `viaKeycodeToLayoutName`; null when the name is not understood. */
export function viaKeycodeFromLayoutName(name, protocolVersion) {
    const text = name.trim();
    const upper = text.toUpperCase();
    if (upper === "KC_NO" || upper === "XXXXXXX")
        return 0;
    if (upper === "KC_TRNS" || upper === "KC_TRANSPARENT" || upper === "_______")
        return 1;
    const direct = viaKeycodeFromName(text);
    if (direct !== null)
        return direct;
    const numbered = /^(MACRO|CUSTOM)\((\d+)\)$/.exec(upper);
    if (numbered) {
        const n = Number(numbered[2]);
        if (numbered[1] === "MACRO")
            return n < macroKeyLimit(protocolVersion) ? bases(protocolVersion).macro + n : null;
        return n < customKeycodeLimit(protocolVersion) ? customKeycodeBase(protocolVersion) + n : null;
    }
    const hexMatch = /^0x([0-9a-f]{1,4})$/i.exec(text);
    if (hexMatch)
        return Number.parseInt(hexMatch[1], 16);
    const lighting = lightingRows(protocolVersion).find((row) => row.name === text.toUpperCase());
    if (lighting)
        return lighting.code;
    const known = bases(protocolVersion);
    const layered = /^([A-Z]+)\((\d+)\)$/.exec(text.toUpperCase());
    if (layered) {
        const base = layerFunctions(known).find(([, functionName]) => functionName === layered[1])?.[0];
        const layer = Number(layered[2]);
        return base !== undefined && layer < layerSlots(base, known, protocolVersion) ? base + layer : null;
    }
    const layerTap = /^LT\(\s*(\d+)\s*,\s*([^)]+)\)$/i.exec(text);
    if (layerTap) {
        const key = viaKeycodeFromName(layerTap[2]);
        return key !== null && key <= 0xff && Number(layerTap[1]) < 16 ? LAYER_TAP | (Number(layerTap[1]) << 8) | key : null;
    }
    const modTap = /^MT\(\s*([^,]+),\s*([^)]+)\)$/i.exec(text);
    if (modTap) {
        const key = viaKeycodeFromName(modTap[2]);
        const mods = modTap[1].split("|").reduce((sum, part) => {
            const match = /^MOD_([LR])(CTL|SFT|ALT|GUI)$/.exec(part.trim().toUpperCase());
            const bit = HAND_MODS.find(([hand]) => hand === match?.[2])?.[1];
            return sum === null || !match || bit === undefined ? null : sum | bit | (match[1] === "R" ? 0x10 : 0);
        }, 0);
        return key !== null && key <= 0xff && mods ? known.modTap | (mods << 8) | key : null;
    }
    const oneShot = /^OSM\(\s*([^)]+)\)$/i.exec(text);
    if (oneShot) {
        const mods = parseModMask(oneShot[1]);
        return mods === null ? null : known.oneShotMod | mods;
    }
    // LCTL(..) style wrappers plus QMK's short forms: C S A G (left hand), MEH (ctrl shift alt) and HYPR (all four).
    const wrapped = /^((?:[LR](?:CTL|SFT|ALT|GUI))|C|S|A|G|MEH|HYPR)\((.+)\)$/i.exec(text);
    if (wrapped) {
        const inner = viaKeycodeFromLayoutName(wrapped[2], protocolVersion);
        const modifier = wrapped[1].toUpperCase();
        const long = /^([LR])(CTL|SFT|ALT|GUI)$/.exec(modifier);
        const bit = long
            ? HAND_MODS.find(([hand]) => hand === long[2])?.[1]
            : { C: 0x01, S: 0x02, A: 0x04, G: 0x08, MEH: 0x07, HYPR: 0x0f }[modifier];
        if (inner === null || bit === undefined || inner > 0x1fff || (inner >= 0x100 && inner < MODS_MIN))
            return null;
        return inner | ((bit | (long?.[1] === "R" ? 0x10 : 0)) << 8);
    }
    return null;
}
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
/** Keycodes the editor offers, grouped. Layer keys are generated for the board's real layer count. */
export function viaKeycodePicker(protocolVersion, layerCount, macroCount = 0, options = {}) {
    const known = bases(protocolVersion);
    const layers = range(0, Math.min(Math.max(layerCount, 0), 32) - 1);
    const macros = range(0, Math.min(Math.max(macroCount, 0), macroKeyLimit(protocolVersion)) - 1);
    const groups = [
        { id: "letters", keycodes: range(0x04, 0x1d) },
        { id: "numbers", keycodes: range(0x1e, 0x27) },
        { id: "symbols", keycodes: [...range(0x28, 0x39), 0x64, 0x65] },
        { id: "function", keycodes: [...range(0x3a, 0x45), ...range(0x68, 0x73)] },
        { id: "navigation", keycodes: range(0x46, 0x52) },
        { id: "keypad", keycodes: range(0x53, 0x63) },
        { id: "modifiers", keycodes: range(0xe0, 0xe7) },
        { id: "media", keycodes: [...range(0xa8, 0xbe), 0x7f, 0x80, 0x81] },
        { id: "special", keycodes: [0x0000, 0x0001] },
        {
            id: "layers",
            keycodes: layers.flatMap((layer) => [known.momentary, known.toggle, known.to, known.layerTapToggle, known.oneShotLayer].filter((base) => layer < layerSlots(base, known, protocolVersion)).map((base) => base + layer)),
        },
        { id: "macros", keycodes: macros.map((macro) => known.macro + macro) },
        { id: "lighting", keycodes: viaLightingKeycodes(protocolVersion, options.modules ?? []) },
        { id: "custom", keycodes: (options.custom ?? []).map((_, index) => customKeycodeBase(protocolVersion) + index) },
    ];
    return groups.filter((group) => group.keycodes.length > 0 || (group.id !== "lighting" && group.id !== "custom"));
}
/** Delays arrived with VIA protocol 11. */
export const VIA_MACRO_DELAY_PROTOCOL = 11;
export const VIA_MACRO_MAX_DELAY_MS = 9999;
const PREFIX = 0x01;
const TAP = 0x01;
const DOWN = 0x02;
const UP = 0x03;
const DELAY = 0x04;
const DELAY_END = 0x7c;
const KEY_ACTION = { [TAP]: "tap", [DOWN]: "down", [UP]: "up" };
const isTextByte = (byte) => byte === 0x09 || byte === 0x0a || (byte >= 0x20 && byte <= 0x7e);
/** Protocol 10 and older have no prefix byte: a key action is `01|02|03 keycode`, and there are no delays. */
function decodeLegacyMacro(bytes) {
    const actions = [];
    let text = "";
    const flush = () => {
        if (text)
            actions.push({ type: "text", text });
        text = "";
    };
    let index = 0;
    while (index < bytes.length) {
        const byte = bytes[index];
        const argument = bytes[index + 1];
        if ((byte === TAP || byte === DOWN || byte === UP) && argument !== undefined && argument !== 0) {
            flush();
            actions.push({ type: KEY_ACTION[byte], keycode: argument });
            index += 2;
        }
        else if (isTextByte(byte)) {
            text += String.fromCharCode(byte);
            index += 1;
        }
        else {
            flush();
            actions.push({ type: "raw", bytes: bytes.slice(index) });
            return actions;
        }
    }
    flush();
    return actions;
}
/**
 * One macro's bytes (without the 0x00 that ends it) as editable actions. Text is
 * plain ASCII, key actions are `01 01|02|03 keycode`, and a delay is
 * `01 04 <decimal digits> |`. Anything else is returned as `raw`, so
 * `encodeViaMacro(decodeViaMacro(bytes))` gives back exactly `bytes`.
 */
export function decodeViaMacro(bytes, protocolVersion = VIA_MACRO_DELAY_PROTOCOL) {
    if (protocolVersion < VIA_MACRO_DELAY_PROTOCOL)
        return decodeLegacyMacro(bytes);
    const actions = [];
    let text = "";
    const flush = () => {
        if (text)
            actions.push({ type: "text", text });
        text = "";
    };
    let index = 0;
    while (index < bytes.length) {
        const byte = bytes[index];
        if (byte === PREFIX) {
            const kind = bytes[index + 1];
            const argument = bytes[index + 2];
            if ((kind === TAP || kind === DOWN || kind === UP) && argument !== undefined && argument !== 0) {
                flush();
                actions.push({ type: KEY_ACTION[kind], keycode: argument });
                index += 3;
                continue;
            }
            if (kind === DELAY) {
                const end = bytes.indexOf(DELAY_END, index + 2);
                const digits = end > index + 2 ? String.fromCharCode(...bytes.slice(index + 2, end)) : "";
                if (/^(?:0|[1-9]\d{0,3})$/.test(digits)) {
                    flush();
                    actions.push({ type: "delay", ms: Number(digits) });
                    index = end + 1;
                    continue;
                }
            }
            flush();
            actions.push({ type: "raw", bytes: bytes.slice(index) });
            return actions;
        }
        if (isTextByte(byte)) {
            text += String.fromCharCode(byte);
            index += 1;
            continue;
        }
        flush();
        let end = index;
        while (end < bytes.length && bytes[end] !== PREFIX && !isTextByte(bytes[end]))
            end += 1;
        actions.push({ type: "raw", bytes: bytes.slice(index, end) });
        index = end;
    }
    flush();
    return actions;
}
/** The inverse of `decodeViaMacro`; throws a RangeError for anything the board could not store. */
export function encodeViaMacro(actions, protocolVersion) {
    return actions.flatMap((action) => {
        switch (action.type) {
            case "text": {
                const codes = [...action.text].map((character) => character.charCodeAt(0));
                if (codes.some((code) => !isTextByte(code)))
                    throw new RangeError("Macro text can only hold plain ASCII characters.");
                return codes;
            }
            case "tap":
            case "down":
            case "up": {
                if (!Number.isInteger(action.keycode) || action.keycode < 1 || action.keycode > 0xff)
                    throw new RangeError("A macro key must be a basic keycode (1 to 255).");
                const kind = { tap: TAP, down: DOWN, up: UP }[action.type];
                return protocolVersion < VIA_MACRO_DELAY_PROTOCOL ? [kind, action.keycode] : [PREFIX, kind, action.keycode];
            }
            case "delay": {
                if (protocolVersion < VIA_MACRO_DELAY_PROTOCOL)
                    throw new RangeError("Delays need VIA protocol 11 or newer.");
                if (!Number.isInteger(action.ms) || action.ms < 0 || action.ms > VIA_MACRO_MAX_DELAY_MS)
                    throw new RangeError(`A delay must be 0 to ${VIA_MACRO_MAX_DELAY_MS} ms.`);
                return [PREFIX, DELAY, ...[...String(action.ms)].map((digit) => digit.charCodeAt(0)), DELAY_END];
            }
            case "raw": {
                if (action.bytes.some((byte) => !Number.isInteger(byte) || byte < 1 || byte > 0xff))
                    throw new RangeError("Raw macro bytes must be 1 to 255.");
                return [...action.bytes];
            }
        }
    });
}
/**
 * VIA's macro text syntax. Plain text is typed as written. A block in braces is
 * one action: `{KC_A}` presses a key, `{KC_LCTL,KC_C}` presses a chord (hold in
 * order, release in reverse), `{+KC_LSFT}` holds a key, `{-KC_LSFT}` releases it
 * and `{500}` waits 500 ms. `\{` types a brace and `\\` a backslash. A block
 * `{raw:1,5,4}` keeps bytes this editor does not understand.
 */
export class ViaMacroExpressionError extends Error {
    index;
    constructor(message, index) {
        super(message);
        this.name = "ViaMacroExpressionError";
        this.index = index;
    }
}
const isTextCharacter = (code) => code === 0x09 || code === 0x0a || (code >= 0x20 && code <= 0x7e);
const KEY_KIND = { tap: 1, down: 2, up: 3 };
function lookup(name, index) {
    const code = viaKeycodeFromName(name);
    if (code === null)
        throw new ViaMacroExpressionError(`Unknown keycode "${name}". Use QMK names such as KC_A or KC_ENT.`, index);
    return code;
}
function block(body, index, protocolVersion) {
    if (/^\d+$/.test(body)) {
        const ms = Number(body);
        if (protocolVersion < VIA_MACRO_DELAY_PROTOCOL)
            throw new ViaMacroExpressionError("Waits need VIA protocol 11 or newer.", index);
        if (ms > VIA_MACRO_MAX_DELAY_MS)
            throw new ViaMacroExpressionError(`A wait must be 0 to ${VIA_MACRO_MAX_DELAY_MS} ms.`, index);
        return [{ type: "delay", ms }];
    }
    if (/^raw:/i.test(body)) {
        const bytes = body.slice(4).split(",").map(Number);
        if (bytes.some((byte) => !Number.isInteger(byte) || byte < 1 || byte > 0xff))
            throw new ViaMacroExpressionError("Raw bytes must be whole numbers from 1 to 255.", index);
        return [{ type: "raw", bytes }];
    }
    if (body.startsWith("+"))
        return [{ type: "down", keycode: lookup(body.slice(1), index) }];
    if (body.startsWith("-"))
        return [{ type: "up", keycode: lookup(body.slice(1), index) }];
    const codes = body.split(",").map((name) => lookup(name, index));
    if (codes.length === 1)
        return [{ type: "tap", keycode: codes[0] }];
    return [
        ...codes.map((keycode) => ({ type: "down", keycode })),
        ...[...codes].reverse().map((keycode) => ({ type: "up", keycode })),
    ];
}
/** Reads a macro written in VIA's text syntax; throws a `ViaMacroExpressionError` that says where it went wrong. */
export function parseViaMacroExpression(expression, protocolVersion) {
    const actions = [];
    let text = "";
    let textStart = 0;
    const flush = () => {
        if (!text)
            return;
        const bad = [...text].findIndex((character) => !isTextCharacter(character.charCodeAt(0)));
        if (bad !== -1)
            throw new ViaMacroExpressionError("Macro text can only hold plain ASCII characters.", textStart + bad);
        actions.push({ type: "text", text });
        text = "";
    };
    let index = 0;
    while (index < expression.length) {
        const character = expression[index];
        if (character === "\\" && (expression[index + 1] === "{" || expression[index + 1] === "\\")) {
            if (!text)
                textStart = index;
            text += expression[index + 1];
            index += 2;
            continue;
        }
        if (character === "{") {
            const end = expression.indexOf("}", index + 1);
            if (end === -1)
                throw new ViaMacroExpressionError("This { has no closing }.", index);
            const body = expression.slice(index + 1, end).replace(/\s+/g, "");
            if (!body)
                throw new ViaMacroExpressionError("An empty {} does nothing. Put a key inside, or write \\{ for a literal brace.", index);
            flush();
            actions.push(...block(body, index, protocolVersion));
            index = end + 1;
            continue;
        }
        if (!text)
            textStart = index;
        text += character;
        index += 1;
    }
    flush();
    return actions;
}
const escapeText = (text) => text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{");
/** Writes actions in VIA's text syntax; a key with no QMK name is kept as a `{raw:...}` block. */
export function viaMacroToExpression(actions, protocolVersion = VIA_MACRO_DELAY_PROTOCOL) {
    const rawKey = (type, keycode) => `{raw:${protocolVersion < VIA_MACRO_DELAY_PROTOCOL ? "" : "1,"}${KEY_KIND[type]},${keycode}}`;
    const parts = [];
    let index = 0;
    while (index < actions.length) {
        const action = actions[index];
        if (action.type === "text")
            parts.push(escapeText(action.text));
        else if (action.type === "delay")
            parts.push(`{${action.ms}}`);
        else if (action.type === "raw")
            parts.push(`{raw:${action.bytes.join(",")}}`);
        else if (action.type === "tap") {
            const name = viaKeycodeName(action.keycode);
            parts.push(name ? `{${name}}` : rawKey("tap", action.keycode));
        }
        else if (action.type === "up") {
            const name = viaKeycodeName(action.keycode);
            parts.push(name ? `{-${name}}` : rawKey("up", action.keycode));
        }
        else {
            let downs = 0;
            while (actions[index + downs]?.type === "down")
                downs += 1;
            const pressed = actions.slice(index, index + downs).map((entry) => entry.keycode);
            const released = actions.slice(index + downs, index + 2 * downs);
            const chord = released.length === downs
                && released.every((entry, at) => entry.type === "up" && entry.keycode === pressed[downs - 1 - at])
                && pressed.every((code) => viaKeycodeName(code) !== null);
            if (chord) {
                parts.push(`{${pressed.map((code) => viaKeycodeName(code)).join(",")}}`);
                index += 2 * downs;
                continue;
            }
            const name = viaKeycodeName(action.keycode);
            parts.push(name ? `{+${name}}` : rawKey("down", action.keycode));
        }
        index += 1;
    }
    return parts.join("");
}
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value) => (typeof value === "string" ? value : undefined);
const join = (outer, inner) => (outer && inner ? `(${outer}) && (${inner})` : outer ?? inner);
/** A toggle's off/on value: a number, or a byte array such as [0, 1] packed big-endian. */
const toggleValue = (value, fallback) => Array.isArray(value) && value.length > 1 && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 0xff)
    ? value.reduce((sum, byte) => sum * 256 + byte, 0)
    : firstNumber(value, fallback);
const firstNumber = (value, fallback) => {
    const candidate = Array.isArray(value) ? value[0] : value;
    return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : fallback;
};
function toControl(entry) {
    const options = entry.options;
    switch (entry.type) {
        case "range": {
            if (!Array.isArray(options) || typeof options[0] !== "number" || typeof options[1] !== "number")
                return null;
            const unit = text(entry.unit);
            return { type: "range", min: options[0], max: options[1], ...(unit ? { unit } : {}) };
        }
        case "toggle":
            return { type: "toggle", off: toggleValue(Array.isArray(options) ? options[0] : undefined, 0), on: toggleValue(Array.isArray(options) ? options[1] : undefined, 1) };
        case "dropdown": {
            if (!Array.isArray(options))
                return null;
            const choices = options.flatMap((option, index) => {
                if (typeof option === "string")
                    return [{ label: option, value: index }];
                if (Array.isArray(option) && typeof option[0] === "string")
                    return [{ label: option[0], value: firstNumber(option[1], index) }];
                return [];
            });
            return choices.length > 0 ? { type: "dropdown", options: choices } : null;
        }
        case "color": return { type: "color" };
        case "button": return { type: "button", value: firstNumber(options, 1) };
        default: return null;
    }
}
function toItem(entry, showIf) {
    const content = entry.content;
    if (!Array.isArray(content) || typeof content[0] !== "string")
        return null;
    const ids = content.slice(1);
    if (ids.length < 2 || ids.some((id) => !Number.isInteger(id) || id < 0 || id > 0xff))
        return null;
    const control = toControl(entry);
    if (!control)
        return null;
    // Without an explicit width, size the value to the largest number the control can carry.
    const largest = control.type === "range" ? control.max : control.type === "button" ? control.value : control.type === "toggle" ? Math.max(control.off, control.on) : 0;
    const arrayWidth = control.type === "toggle" && Array.isArray(entry.options) ? Math.max(1, ...entry.options.map((option) => (Array.isArray(option) ? option.length : 1))) : 1;
    const inferred = Math.min(4, Math.max(arrayWidth, largest > 0xffffff ? 4 : largest > 0xffff ? 3 : largest > 0xff ? 2 : 1));
    const bytes = typeof entry.bytes === "number" && entry.bytes >= 1 && entry.bytes <= 4 ? Math.floor(entry.bytes) : inferred;
    const legacyId = Number.isInteger(entry.legacyId) && entry.legacyId >= 0 && entry.legacyId <= 0xff ? entry.legacyId : undefined;
    return { label: text(entry.label) ?? "", token: content[0], ids: ids, ...(legacyId !== undefined ? { legacyId } : {}), bytes, ...(showIf ? { showIf } : {}), control };
}
function collectItems(content, inherited) {
    if (!Array.isArray(content))
        return [];
    return content.flatMap((entry) => {
        if (!isRecord(entry))
            return [];
        const showIf = join(inherited, text(entry.showIf));
        if (typeof entry.type === "string") {
            const item = toItem(entry, showIf);
            return item ? [item] : [];
        }
        return collectItems(entry.content, showIf);
    });
}
/**
 * Normalises a definition's `menus` into controls the app can draw. Items the
 * app cannot drive (static text, keycode pickers, palettes) are dropped, and
 * groups are flattened with their `showIf` folded into each item.
 */
export function parseViaMenus(menus) {
    return menus.flatMap((menu) => {
        if (!isRecord(menu) || !Array.isArray(menu.content))
            return [];
        const menuCondition = text(menu.showIf);
        const loose = collectItems(menu.content.filter((entry) => isRecord(entry) && typeof entry.type === "string"), menuCondition);
        const sections = [
            ...(loose.length > 0 ? [{ label: "", items: loose }] : []),
            ...menu.content.flatMap((entry) => {
                if (!isRecord(entry) || typeof entry.type === "string")
                    return [];
                const items = collectItems(entry.content, join(menuCondition, text(entry.showIf)));
                return items.length > 0 ? [{ label: text(entry.label) ?? "", items }] : [];
            }),
        ];
        return sections.length > 0 ? [{ label: text(menu.label) ?? "", ...(menuCondition ? { showIf: menuCondition } : {}), sections }] : [];
    });
}
/** Unsigned big-endian value of a custom-menu reply. */
export function viaValueToNumber(bytes) {
    return bytes.reduce((total, byte) => total * 256 + byte, 0);
}
export function viaNumberToBytes(value, length) {
    if (!Number.isInteger(value) || value < 0 || value >= 256 ** length)
        throw new RangeError("VIA value does not fit its byte width.");
    return Array.from({ length }, (_, index) => Math.floor(value / 256 ** (length - 1 - index)) % 256);
}
const TOKEN = /\s*(\{[^}]+\}|\d+(?:\.\d+)?|==|!=|<=|>=|&&|\|\||[<>()!])/y;
/**
 * Evaluates a `showIf` expression such as `{id_effect} != 0 && {id_effect} != 24`.
 * `lookup` maps a token to its current value. An expression that cannot be
 * parsed shows the control rather than hiding it.
 */
export function evaluateViaCondition(expression, lookup) {
    const tokens = [];
    TOKEN.lastIndex = 0;
    let consumed = 0;
    for (let match = TOKEN.exec(expression); match; match = TOKEN.exec(expression)) {
        tokens.push(match[1]);
        consumed = TOKEN.lastIndex;
    }
    if (expression.slice(consumed).trim() !== "")
        return true;
    let position = 0;
    const peek = () => tokens[position];
    const take = () => tokens[position++];
    function primary() {
        const token = take();
        if (token === undefined)
            throw new Error("unexpected end");
        if (token === "(") {
            const inner = or();
            if (take() !== ")")
                throw new Error("missing )");
            return inner;
        }
        if (token === "!")
            return primary() === 0 ? 1 : 0;
        if (token.startsWith("{"))
            return lookup(token.slice(1, -1).trim()) ?? 0;
        const number = Number(token);
        if (Number.isNaN(number))
            throw new Error("unexpected token");
        return number;
    }
    function comparison() {
        const left = primary();
        const operator = peek();
        if (operator !== "==" && operator !== "!=" && operator !== "<" && operator !== "<=" && operator !== ">" && operator !== ">=")
            return left;
        take();
        const right = primary();
        const result = { "==": left === right, "!=": left !== right, "<": left < right, "<=": left <= right, ">": left > right, ">=": left >= right }[operator];
        return result ? 1 : 0;
    }
    function and() {
        let value = comparison();
        while (peek() === "&&") {
            take();
            const right = comparison();
            value = value !== 0 && right !== 0 ? 1 : 0;
        }
        return value;
    }
    function or() {
        let value = and();
        while (peek() === "||") {
            take();
            const right = and();
            value = value !== 0 || right !== 0 ? 1 : 0;
        }
        return value;
    }
    try {
        const result = or();
        return position === tokens.length ? result !== 0 : true;
    }
    catch {
        return true;
    }
}
export function viaVendorProductId(vendorId, productId) {
    return vendorId * 65536 + productId;
}
function rotate(x, y, ox, oy, degrees) {
    const rad = (degrees * Math.PI) / 180;
    const dx = x - ox;
    const dy = y - oy;
    return { x: ox + dx * Math.cos(rad) - dy * Math.sin(rad), y: oy + dx * Math.sin(rad) + dy * Math.cos(rad) };
}
function bounds(key) {
    const x2 = key.x2 ?? 0;
    const y2 = key.y2 ?? 0;
    const w2 = key.w2 ?? key.w;
    const h2 = key.h2 ?? key.h;
    const x0 = Math.min(key.x, key.x + x2);
    const y0 = Math.min(key.y, key.y + y2);
    const x1 = Math.max(key.x + key.w, key.x + x2 + w2);
    const y1 = Math.max(key.y + key.h, key.y + y2 + h2);
    const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => rotate(x, y, key.rx, key.ry, key.r));
    return {
        x0: Math.min(...corners.map((c) => c.x)),
        y0: Math.min(...corners.map((c) => c.y)),
        x1: Math.max(...corners.map((c) => c.x)),
        y1: Math.max(...corners.map((c) => c.y)),
    };
}
function finite(value, fallback = 0) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function servedKey(raw, matrix) {
    if (typeof raw !== "object" || raw === null)
        return null;
    const k = raw;
    if (k.d === true)
        return null;
    const key = {
        row: finite(k.row, -1), col: finite(k.col, -1),
        x: finite(k.x), y: finite(k.y), w: finite(k.w, 1), h: finite(k.h, 1),
        r: finite(k.r), rx: finite(k.rx), ry: finite(k.ry),
    };
    for (const name of ["x2", "y2", "w2", "h2"])
        if (typeof k[name] === "number")
            key[name] = k[name];
    if (typeof k.ei === "number")
        key.encoder = k.ei;
    if (typeof k.li === "number")
        key.led = k.li;
    if (key.row < 0 && key.col < 0)
        return key.encoder === undefined ? null : key;
    if (key.row >= matrix.rows || key.col >= matrix.cols || key.row < 0 || key.col < 0) {
        throw new Error(`VIA definition key ${key.row},${key.col} is outside the ${matrix.rows}x${matrix.cols} matrix.`);
    }
    return key;
}
const RGBLIGHT_EFFECTS = ["All Off", "Solid Color", "Breathing 1", "Breathing 2", "Breathing 3", "Breathing 4", "Rainbow Mood 1", "Rainbow Mood 2", "Rainbow Mood 3", "Rainbow Swirl 1", "Rainbow Swirl 2", "Rainbow Swirl 3", "Rainbow Swirl 4", "Rainbow Swirl 5", "Rainbow Swirl 6", "Snake 1", "Snake 2", "Snake 3", "Snake 4", "Snake 5", "Snake 6", "Knight 1", "Knight 2", "Knight 3", "Christmas", "Gradient 1", "Gradient 2", "Gradient 3", "Gradient 4", "Gradient 5", "Gradient 6", "Gradient 7", "Gradient 8", "Gradient 9", "Gradient 10", "RGB Test", "Alternating", "Twinkle 1", "Twinkle 2", "Twinkle 3", "Twinkle 4", "Twinkle 5", "Twinkle 6"];
const BACKLIGHT_ITEMS = [
    { label: "Backlight Brightness", type: "range", options: [0, 255], content: ["id_qmk_backlight_brightness", 1, 1], legacyId: 0x09 },
    { label: "Backlight Effect", type: "dropdown", options: [["Off", 0], ["Breathing", 1]], content: ["id_qmk_backlight_effect", 1, 2], legacyId: 0x0a },
];
const UNDERGLOW_ITEMS = [
    { label: "Brightness", type: "range", options: [0, 255], content: ["id_qmk_rgblight_brightness", 2, 1], legacyId: 0x80 },
    { label: "Effect", type: "dropdown", options: RGBLIGHT_EFFECTS, content: ["id_qmk_rgblight_effect", 2, 2], legacyId: 0x81 },
    { showIf: "{id_qmk_rgblight_effect} != 0", label: "Effect Speed", type: "range", options: [0, 255], content: ["id_qmk_rgblight_effect_speed", 2, 3], legacyId: 0x82 },
    { showIf: "{id_qmk_rgblight_effect} != 0 && {id_qmk_rgblight_effect} != 35", label: "Color", type: "color", content: ["id_qmk_rgblight_color", 2, 4], legacyId: 0x83 },
];
/** The menus behind the `lighting` name a VIA v2 definition gives instead of a menu list (the QMK ones; Wilba Tech lighting uses other commands). */
const LEGACY_LIGHTING = {
    qmk_backlight: [{ label: "Lighting", content: [{ label: "Backlight", content: BACKLIGHT_ITEMS }] }],
    qmk_rgblight: [{ label: "Lighting", content: [{ label: "Underglow", content: UNDERGLOW_ITEMS }] }],
    qmk_backlight_rgblight: [{ label: "Lighting", content: [{ label: "Backlight", content: BACKLIGHT_ITEMS }, { label: "Underglow", content: UNDERGLOW_ITEMS }] }],
};
const effectNames = (list) => Array.isArray(list) ? list.flatMap((entry) => (Array.isArray(entry) && typeof entry[0] === "string" ? [entry[0]] : [])) : null;
/**
 * Lighting menus for a v2 definition: a preset name, or an object that `extends` a preset and may replace its
 * effect lists and the lighting values it supports (the same overrides VIA's own reader applies).
 */
function lightingMenus(lighting) {
    if (typeof lighting === "string")
        return [...(LEGACY_LIGHTING[lighting] ?? [])];
    if (!isRecord(lighting) || typeof lighting.extends !== "string" || !LEGACY_LIGHTING[lighting.extends])
        return [];
    const supported = Array.isArray(lighting.supportedLightingValues) ? lighting.supportedLightingValues.filter((value) => typeof value === "number") : null;
    const keep = (item) => supported === null || supported.includes(item.legacyId);
    const backlightEffects = effectNames(lighting.effects);
    const underglowEffects = effectNames(lighting.underglowEffects);
    const dark = Array.isArray(lighting.underglowEffects)
        ? [0, ...lighting.underglowEffects.flatMap((entry, index) => (Array.isArray(entry) && entry[1] === 0 ? [index] : []))]
        : null;
    const backlight = BACKLIGHT_ITEMS.filter(keep).map((item) => (backlightEffects && item.legacyId === 0x0a ? { ...item, options: backlightEffects } : item));
    const underglow = UNDERGLOW_ITEMS.filter(keep).map((item) => {
        if (underglowEffects && item.legacyId === 0x81)
            return { ...item, options: underglowEffects };
        if (dark && item.legacyId === 0x83)
            return { ...item, showIf: [...new Set(dark)].map((index) => `{id_qmk_rgblight_effect} != ${index}`).join(" && ") };
        return item;
    });
    const sections = [
        ...(lighting.extends.includes("backlight") && backlight.length > 0 ? [{ label: "Backlight", content: backlight }] : []),
        ...(lighting.extends.includes("rgblight") && underglow.length > 0 ? [{ label: "Underglow", content: underglow }] : []),
    ];
    return sections.length > 0 ? [{ label: "Lighting", content: sections }] : [];
}
function parseServedDefinition(def, matrix) {
    const layouts = def.layouts;
    const keys = layouts.keys.flatMap((raw) => servedKey(raw, matrix) ?? []);
    const optionKeys = {};
    for (const [group, options] of Object.entries((layouts.optionKeys ?? {}))) {
        optionKeys[Number(group)] = {};
        for (const [option, members] of Object.entries(options ?? {})) {
            optionKeys[Number(group)][Number(option)] = (members ?? []).flatMap((raw) => servedKey(raw, matrix) ?? []);
        }
    }
    // A board whose only keys sit in layout options still has a keymap, drawn from those keys.
    const optionMembers = Object.values(optionKeys).flatMap((options) => Object.values(options).flat());
    if (keys.length === 0 && optionMembers.length === 0)
        throw new Error("VIA definition keymap has no keys.");
    const boxes = [...keys, ...optionMembers].map(bounds);
    const vendorProductId = finite(def.vendorProductId, Number.NaN);
    if (!Number.isInteger(vendorProductId) || vendorProductId < 0)
        throw new Error("VIA definition vendorProductId must be a number.");
    const firmware = def.firmwareVersion;
    return {
        name: typeof def.name === "string" ? def.name : "VIA keyboard",
        vendorId: Math.floor(vendorProductId / 65536),
        productId: vendorProductId % 65536,
        firmwareVersion: typeof firmware === "number" ? firmware : null,
        matrix,
        keys,
        optionKeys,
        width: finite(layouts.width, Math.max(...boxes.map((b) => b.x1))),
        height: finite(layouts.height, Math.max(...boxes.map((b) => b.y1))),
        labels: Array.isArray(layouts.labels) ? layouts.labels : [],
        menus: Array.isArray(def.menus) ? def.menus : [...lightingMenus(def.lighting), ...(Array.isArray(def.customMenus) ? def.customMenus : [])],
        keycodeModules: Array.isArray(def.keycodes) ? def.keycodes.filter((id) => typeof id === "string") : [],
        customKeycodes: Array.isArray(def.customKeycodes)
            ? def.customKeycodes.map((entry) => ({
                name: String(entry?.name ?? ""),
                ...(typeof entry?.title === "string" ? { title: entry.title } : {}),
                ...(typeof entry?.shortName === "string" ? { shortName: entry.shortName } : {}),
            }))
            : [],
    };
}
function choiceCount(label) {
    return Array.isArray(label) ? Math.max(1, label.length - 1) : 2;
}
function choiceBits(count) {
    return Math.max(1, Math.ceil(Math.log2(count)));
}
/** The choice VIA stored for each layout-option label, unpacked from the board's 32-bit value. */
export function viaLayoutChoices(labels, bitfield) {
    const choices = [];
    let bits = bitfield >>> 0;
    for (let index = labels.length - 1; index >= 0; index -= 1) {
        const count = choiceCount(labels[index]);
        const size = choiceBits(count);
        const choice = bits & ((1 << size) - 1);
        bits >>>= size;
        choices.unshift(choice < count ? choice : 0);
    }
    return choices;
}
/** The inverse of `viaLayoutChoices`: one choice per label packed into the 32-bit value the board stores. */
export function viaPackLayoutChoices(labels, choices) {
    let bits = 0;
    labels.forEach((label, index) => {
        const count = choiceCount(label);
        const choice = Math.min(Math.max(Math.trunc(choices[index] ?? 0), 0), count - 1);
        bits = (bits << choiceBits(count)) | choice;
    });
    return bits >>> 0;
}
/** The keys on screen for a layout-option selection: always-present keys plus the chosen option groups. */
export function viaActiveKeys(definition, choices) {
    return [
        ...definition.keys,
        ...Object.entries(definition.optionKeys).flatMap(([group, options]) => options[choices[Number(group)] ?? 0] ?? []),
    ];
}
export function parseViaDefinition(source) {
    if (typeof source !== "object" || source === null)
        throw new Error("VIA definition must be an object.");
    const def = source;
    const matrix = def.matrix;
    if (!matrix || !Number.isInteger(matrix.rows) || !Number.isInteger(matrix.cols) || matrix.rows < 1 || matrix.cols < 1) {
        throw new Error("VIA definition matrix needs positive integer rows and cols.");
    }
    if (!Array.isArray(def.layouts?.keys))
        throw new Error("VIA definition layouts.keys must be an array.");
    return parseServedDefinition(def, { rows: matrix.rows, cols: matrix.cols });
}
export const VIA_USAGE_PAGE = 0xff60;
export const VIA_USAGE = 0x61;
export const VIA_REPORT_ID = 0;
export const VIA_REPORT_LENGTH = 32;
export const VIA_UNHANDLED = 0xff;
export const VIA_PROTOCOL_ALPHA = 7;
export const VIA_PROTOCOL_BETA = 8;
export const VIA_BUFFER_CHUNK = 28;
export const VIA_LEGACY_LAYER_COUNT = 4;
/**
 * Commands the codec can build. EEPROM reset (0x0A), bootloader jump (0x0B)
 * and macro reset (0x10) exist in the protocol but are never encoded here.
 */
export const VIA_COMMAND = {
    getProtocolVersion: 0x01,
    getKeyboardValue: 0x02,
    setKeyboardValue: 0x03,
    getKeycode: 0x04,
    setKeycode: 0x05,
    customMenuSet: 0x07,
    customMenuGet: 0x08,
    customMenuSave: 0x09,
    macroGetCount: 0x0c,
    macroGetBufferSize: 0x0d,
    macroGetBuffer: 0x0e,
    macroSetBuffer: 0x0f,
    getLayerCount: 0x11,
    getKeymapBuffer: 0x12,
    setKeymapBuffer: 0x13,
    getEncoder: 0x14,
    setEncoder: 0x15,
};
export const VIA_KEYBOARD_VALUE = {
    uptime: 0x01,
    layoutOptions: 0x02,
    switchMatrixState: 0x03,
    firmwareVersion: 0x04,
    deviceIndication: 0x05,
    keycodesVersion: 0x06,
};
function byteArray(values, what) {
    for (const value of values) {
        if (!Number.isInteger(value) || value < 0 || value > 0xff) {
            throw new RangeError(`VIA ${what} byte out of range: ${value}`);
        }
    }
    return [...values];
}
export function encodeViaCommand(command, args = []) {
    if (args.length > VIA_REPORT_LENGTH - 1)
        throw new RangeError("VIA command arguments exceed one report.");
    const frame = new Uint8Array(VIA_REPORT_LENGTH);
    frame[0] = command;
    frame.set(byteArray(args, "argument"), 1);
    return frame;
}
export function viaIsUnhandled(reply) {
    return reply[0] === VIA_UNHANDLED;
}
/**
 * True when `reply` answers `request`: same command id and the same
 * addressing bytes. VIA has no transaction id, so this echo is the only
 * pairing the wire offers. `headerLength` is how many bytes after the command
 * the firmware echoes back (layer/row/col, buffer offset and size, value ids).
 */
export function viaReplyMatches(reply, request, headerLength) {
    if (reply.length < 1 + headerLength || reply[0] !== request[0])
        return false;
    for (let index = 1; index <= headerLength; index += 1) {
        if (reply[index] !== request[index])
            return false;
    }
    return true;
}
export const shiftViaTo16Bit = (hi, lo) => ((hi & 0xff) << 8) | (lo & 0xff);
export function viaUint32(bytes) {
    if (bytes.length < 4)
        throw new RangeError("VIA value is shorter than 4 bytes.");
    return ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
}
export function encodeViaGetProtocolVersion() {
    return encodeViaCommand(VIA_COMMAND.getProtocolVersion);
}
export function decodeViaProtocolVersion(reply) {
    return shiftViaTo16Bit(reply[1] ?? 0, reply[2] ?? 0);
}
export function viaUint32Bytes(value) {
    return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
export function encodeViaSetKeyboardValue(id, bytes) {
    return encodeViaCommand(VIA_COMMAND.setKeyboardValue, [id, ...bytes]);
}
export function encodeViaGetKeyboardValue(id, params = []) {
    return encodeViaCommand(VIA_COMMAND.getKeyboardValue, [id, ...params]);
}
export function decodeViaKeyboardValue(reply, paramsLength, resultLength) {
    const start = 2 + paramsLength;
    return [...reply.slice(start, start + resultLength)];
}
function assertKeycode(keycode) {
    if (!Number.isInteger(keycode) || keycode < 0 || keycode > 0xffff) {
        throw new RangeError(`VIA keycode out of range: ${keycode}`);
    }
}
export function encodeViaGetKeycode(layer, row, col) {
    return encodeViaCommand(VIA_COMMAND.getKeycode, [layer, row, col]);
}
export function decodeViaKeycode(reply) {
    return shiftViaTo16Bit(reply[4] ?? 0, reply[5] ?? 0);
}
export function encodeViaSetKeycode(layer, row, col, keycode) {
    assertKeycode(keycode);
    return encodeViaCommand(VIA_COMMAND.setKeycode, [layer, row, col, keycode >> 8, keycode & 0xff]);
}
export function encodeViaGetLayerCount() {
    return encodeViaCommand(VIA_COMMAND.getLayerCount);
}
export function decodeViaLayerCount(reply) {
    return reply[1] ?? 0;
}
function assertBufferRange(offset, size) {
    if (!Number.isInteger(offset) || offset < 0 || offset > 0xffff)
        throw new RangeError("VIA buffer offset out of range.");
    if (!Number.isInteger(size) || size < 0 || size > VIA_BUFFER_CHUNK) {
        throw new RangeError(`VIA buffer transfers are at most ${VIA_BUFFER_CHUNK} bytes.`);
    }
}
export function encodeViaGetKeymapBuffer(offset, size) {
    assertBufferRange(offset, size);
    return encodeViaCommand(VIA_COMMAND.getKeymapBuffer, [offset >> 8, offset & 0xff, size]);
}
export function encodeViaSetKeymapBuffer(offset, data) {
    assertBufferRange(offset, data.length);
    return encodeViaCommand(VIA_COMMAND.setKeymapBuffer, [offset >> 8, offset & 0xff, data.length, ...data]);
}
export function decodeViaBuffer(reply, size) {
    return [...reply.slice(4, 4 + size)];
}
export function encodeViaGetEncoder(layer, id, clockwise) {
    return encodeViaCommand(VIA_COMMAND.getEncoder, [layer, id, clockwise ? 1 : 0]);
}
export function decodeViaEncoder(reply) {
    return shiftViaTo16Bit(reply[4] ?? 0, reply[5] ?? 0);
}
export function encodeViaSetEncoder(layer, id, clockwise, keycode) {
    assertKeycode(keycode);
    return encodeViaCommand(VIA_COMMAND.setEncoder, [layer, id, clockwise ? 1 : 0, keycode >> 8, keycode & 0xff]);
}
export function encodeViaMacroGetCount() {
    return encodeViaCommand(VIA_COMMAND.macroGetCount);
}
export function decodeViaMacroCount(reply) {
    return reply[1] ?? 0;
}
export function encodeViaMacroGetBufferSize() {
    return encodeViaCommand(VIA_COMMAND.macroGetBufferSize);
}
export function decodeViaMacroBufferSize(reply) {
    return shiftViaTo16Bit(reply[1] ?? 0, reply[2] ?? 0);
}
export function encodeViaMacroGetBuffer(offset, size) {
    assertBufferRange(offset, size);
    return encodeViaCommand(VIA_COMMAND.macroGetBuffer, [offset >> 8, offset & 0xff, size]);
}
export function encodeViaMacroSetBuffer(offset, data) {
    assertBufferRange(offset, data.length);
    return encodeViaCommand(VIA_COMMAND.macroSetBuffer, [offset >> 8, offset & 0xff, data.length, ...data]);
}
export function encodeViaCustomGet(ids) {
    return encodeViaCommand(VIA_COMMAND.customMenuGet, ids);
}
export function encodeViaCustomSet(ids, value) {
    return encodeViaCommand(VIA_COMMAND.customMenuSet, [...ids, ...value]);
}
/** Saves a custom-menu channel; `null` is the old argument-less save of protocol 10 and older lighting. */
export function encodeViaCustomSave(channel) {
    return encodeViaCommand(VIA_COMMAND.customMenuSave, channel === null ? [] : [channel]);
}
export function decodeViaCustomValue(reply, idsLength, resultLength) {
    const start = 1 + idsLength;
    return [...reply.slice(start, start + resultLength)];
}
export function viaKeymapByteLength(layers, rows, cols) {
    return layers * rows * cols * 2;
}
export function viaBufferChunks(total) {
    const chunks = [];
    for (let offset = 0; offset < total; offset += VIA_BUFFER_CHUNK) {
        chunks.push({ offset, size: Math.min(VIA_BUFFER_CHUNK, total - offset) });
    }
    return chunks;
}
export function decodeViaKeymap(bytes, layers, rows, cols) {
    const perLayer = rows * cols;
    if (bytes.length < viaKeymapByteLength(layers, rows, cols))
        throw new RangeError("VIA keymap buffer is too short.");
    return Array.from({ length: layers }, (_, layer) => Array.from({ length: perLayer }, (_, index) => {
        const at = (layer * perLayer + index) * 2;
        return shiftViaTo16Bit(bytes[at], bytes[at + 1]);
    }));
}
export function encodeViaKeymap(layers) {
    return layers.flatMap((layer) => layer.flatMap((keycode) => {
        assertKeycode(keycode);
        return [keycode >> 8, keycode & 0xff];
    }));
}
/**
 * Splits the macro buffer into its macros (each ends in a 0x00 byte). The
 * action encoding inside a macro differs by protocol version, so the bytes are
 * kept raw; this only finds the boundaries. Missing macros come back empty.
 */
export function splitViaMacros(buffer, count) {
    const macros = Array.from({ length: count }, () => []);
    let current = 0;
    for (const byte of buffer) {
        if (current >= count)
            break;
        if (byte === 0)
            current += 1;
        else
            macros[current].push(byte);
    }
    return macros;
}
export function joinViaMacros(macros, bufferSize) {
    const joined = macros.flatMap((macro) => {
        if (macro.includes(0))
            throw new RangeError("A VIA macro cannot contain a 0x00 byte.");
        return [...macro, 0];
    });
    if (joined.length > bufferSize)
        throw new RangeError("VIA macros do not fit the board's macro buffer.");
    return [...joined, ...new Array(bufferSize - joined.length).fill(0)];
}
