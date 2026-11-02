/**
 * Logitech HID++ 2.0 feature 0x1B04 (REPROG CONTROLS V4).
 *
 * The device reports which controls it has, what each one does, and which
 * groups it may be remapped into. This module decodes those records and builds
 * the remap write; it does not decide keyboard layout or legality beyond the
 * device's own group mask.
 */
export const LOGITECH_REPROG_CONTROLS = {
    count: 0x00,
    info: 0x01,
    reporting: 0x02,
    setReporting: 0x03,
};
export const LOGITECH_KEY_FLAG = {
    mouseButton: 0x01,
    fKey: 0x02,
    hotkey: 0x04,
    fnToggle: 0x08,
    reprogrammable: 0x10,
    divertable: 0x20,
    persistentlyDivertable: 0x40,
    virtual: 0x80,
};
/** Decode `getControlIdInfo` (function 1). */
export function decodeLogitechControlInfo(params) {
    if (params.length < 8)
        return null;
    return {
        controlId: ((params[0] ?? 0) << 8) | (params[1] ?? 0),
        taskId: ((params[2] ?? 0) << 8) | (params[3] ?? 0),
        flags: params[4] ?? 0,
        group: params[6] ?? 0,
        groupMask: params[7] ?? 0,
    };
}
/** Decode `getControlIdReporting` (function 2). The mapping flags straddle the remap target. */
export function decodeLogitechControlReporting(params) {
    if (params.length < 6)
        return null;
    const mappingFlags = (params[2] ?? 0) | ((params[5] ?? 0) << 8);
    return {
        controlId: ((params[0] ?? 0) << 8) | (params[1] ?? 0),
        mappingFlags,
        mappedTo: ((params[3] ?? 0) << 8) | (params[4] ?? 0),
        diverted: (mappingFlags & 0x0005) !== 0,
    };
}
/** Build the pure-remap payload for `setControlIdReporting` (function 3, long report). */
export function buildLogitechControlRemap(controlId, targetControlId) {
    return [controlId >> 8, controlId & 0xff, 0x00, targetControlId >> 8, targetControlId & 0xff];
}
/** Resolve a control's legal targets from the device-reported group mask. */
export function logitechRemappableTargets(control, all) {
    return all
        .filter((candidate) => candidate.group > 0 && (control.groupMask & (1 << (candidate.group - 1))) !== 0)
        .map((candidate) => candidate.controlId);
}
