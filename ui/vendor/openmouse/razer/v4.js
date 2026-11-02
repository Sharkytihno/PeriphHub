export const RAZER_V4_REPORT_ID = 0;
export const RAZER_V4_REPORT_LENGTH = 90;
export const RAZER_V4_PRODUCTS = new Map([
    [0x00e5, { wireless: false }],
    [0x00e6, { wireless: true }],
]);
export const RAZER_V4_MAX_DPI_STAGES = 5;
export const RAZER_V4_POLLING_CODES = new Map([
    [125, 0x40], [500, 0x10], [1000, 0x08], [2000, 0x04], [4000, 0x02], [8000, 0x01],
]);
export function razerV4Crc(report) {
    let crc = 0;
    for (let index = 2; index <= 87; index += 1)
        crc ^= report[index] ?? 0;
    return crc;
}
export function buildRazerV4Report(commandClass, commandId, dataSize, args = new Uint8Array()) {
    if (args.length > 80)
        throw new Error("Razer command payload is too large.");
    if (!Number.isInteger(dataSize) || dataSize < 0 || dataSize > 80)
        throw new Error("Razer command data size is invalid.");
    const report = new Uint8Array(RAZER_V4_REPORT_LENGTH);
    report[1] = 0x1f;
    report[5] = dataSize;
    report[6] = commandClass;
    report[7] = commandId;
    report.set(args, 8);
    report[88] = razerV4Crc(report);
    return report;
}
export function decodeRazerV4DpiState(args) {
    const count = Math.min(args[2] ?? 0, RAZER_V4_MAX_DPI_STAGES);
    const stages = [];
    for (let index = 0; index < count; index += 1) {
        const offset = 3 + index * 7;
        stages.push({
            x: ((args[offset + 1] ?? 0) << 8) | (args[offset + 2] ?? 0),
            y: ((args[offset + 3] ?? 0) << 8) | (args[offset + 4] ?? 0),
        });
    }
    if (!stages.length)
        throw new Error("The Viper V4 Pro reported no DPI stages.");
    return { activeStage: Math.min(Math.max((args[1] ?? 1) - 1, 0), stages.length - 1), stages };
}
export function decodeRazerV4PollingCode(code) {
    const rate = [...RAZER_V4_POLLING_CODES].find(([, candidate]) => candidate === code)?.[0];
    if (!rate)
        throw new Error(`The Viper V4 Pro reported unknown polling code 0x${(code ?? 0).toString(16)}.`);
    return rate;
}
