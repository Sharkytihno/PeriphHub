import { VIA_REPORT_LENGTH, VIA_KEYBOARD_VALUE, VIA_LEGACY_LAYER_COUNT, VIA_PROTOCOL_BETA, VIA_REPORT_ID, VIA_USAGE, VIA_USAGE_PAGE, decodeViaBuffer, decodeViaCustomValue, decodeViaEncoder, decodeViaKeyboardValue, decodeViaKeycode, decodeViaKeymap, decodeViaLayerCount, decodeViaMacroBufferSize, decodeViaMacroCount, decodeViaProtocolVersion, encodeViaCustomGet, encodeViaCustomSave, encodeViaCustomSet, encodeViaGetEncoder, encodeViaGetKeyboardValue, encodeViaGetKeycode, encodeViaGetKeymapBuffer, encodeViaGetLayerCount, encodeViaGetProtocolVersion, encodeViaKeymap, encodeViaMacroGetBuffer, encodeViaMacroGetBufferSize, encodeViaMacroGetCount, encodeViaMacroSetBuffer, encodeViaSetEncoder, encodeViaSetKeyboardValue, encodeViaSetKeycode, encodeViaSetKeymapBuffer, joinViaMacros, splitViaMacros, viaBufferChunks, viaIsUnhandled, viaKeymapByteLength, viaReplyMatches, viaUint32, viaUint32Bytes, } from "../../via/index.js";
const REPLY_TIMEOUT_MS = 1500;
export class ViaUnhandledError extends Error {
    constructor(command) {
        super(`The keyboard does not implement VIA command 0x${command.toString(16)}.`);
        this.name = "ViaUnhandledError";
    }
}
/**
 * Any board running VIA/QMK raw HID (usage page 0xFF60, usage 0x61). Key
 * layout and custom-menu meaning come from a VIA definition, not the board, so
 * matrix sizes are passed in by the caller. EEPROM reset, bootloader jump and
 * macro reset are deliberately not exposed.
 */
export class ViaHidClient {
    device;
    queue = Promise.resolve();
    listening = false;
    faulted = false;
    protocol = null;
    pending = null;
    constructor(device) { this.device = device; }
    static isSupported(device) {
        return ViaHidClient.configCollection(device.collections ?? []) !== null;
    }
    static configCollection(collections) {
        for (const collection of collections) {
            if (collection.usagePage === VIA_USAGE_PAGE && collection.usage === VIA_USAGE)
                return collection;
            const nested = ViaHidClient.configCollection(collection.children ?? []);
            if (nested)
                return nested;
        }
        return null;
    }
    async open() {
        if (!ViaHidClient.isSupported(this.device))
            throw new Error("Not a VIA raw HID interface.");
        if (this.faulted)
            throw new Error("Reconnect the keyboard after a failed transaction.");
        if (!this.device.opened)
            await this.device.open();
        if (this.faulted) {
            if (this.device.opened)
                await this.device.close();
            throw new Error("Reconnect the keyboard after a failed transaction.");
        }
        if (!this.listening) {
            this.device.addEventListener("inputreport", this.onReport);
            this.listening = true;
        }
    }
    async close() {
        this.faulted = true;
        this.pending?.reject(new Error("Keyboard disconnected."));
        if (this.listening)
            this.device.removeEventListener("inputreport", this.onReport);
        this.listening = false;
        if (this.device.opened)
            await this.device.close();
    }
    onReport = (event) => {
        if (event.device !== this.device || !this.pending)
            return;
        const frame = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength).slice();
        const { request, headerLength, resolve, reject } = this.pending;
        if (viaIsUnhandled(frame))
            reject(new ViaUnhandledError(request[0]));
        else if (viaReplyMatches(frame, request, headerLength))
            resolve(frame);
    };
    serialized(operation) {
        const next = this.queue.then(operation);
        this.queue = next.catch(() => undefined);
        return next;
    }
    async call(request, headerLength) {
        await this.open();
        let timer;
        const reply = new Promise((resolve, reject) => {
            this.pending = { request, headerLength, resolve, reject };
            timer = setTimeout(() => reject(new Error(`Keyboard did not answer VIA command 0x${request[0].toString(16)}.`)), REPLY_TIMEOUT_MS);
        });
        try {
            const [frame] = await Promise.all([reply, this.device.sendReport(VIA_REPORT_ID, request)]);
            return frame;
        }
        catch (error) {
            if (!(error instanceof ViaUnhandledError))
                this.faulted = true;
            throw error;
        }
        finally {
            clearTimeout(timer);
            this.pending = null;
        }
    }
    async optional(read) {
        try {
            return await read();
        }
        catch (error) {
            if (error instanceof ViaUnhandledError)
                return null;
            throw error;
        }
    }
    async protocolVersion() {
        this.protocol ??= decodeViaProtocolVersion(await this.call(encodeViaGetProtocolVersion(), 0));
        return this.protocol;
    }
    async keyboardValue(id, resultLength) {
        return decodeViaKeyboardValue(await this.call(encodeViaGetKeyboardValue(id), 1), 0, resultLength);
    }
    async layerCount() {
        if ((await this.protocolVersion()) < VIA_PROTOCOL_BETA)
            return VIA_LEGACY_LAYER_COUNT;
        return decodeViaLayerCount(await this.call(encodeViaGetLayerCount(), 0));
    }
    async readBuffer(total, encode) {
        const bytes = [];
        for (const { offset, size } of viaBufferChunks(total)) {
            bytes.push(...decodeViaBuffer(await this.call(encode(offset, size), 3), size));
        }
        return bytes;
    }
    async keymapBytes(layers, matrix) {
        return this.readBuffer(viaKeymapByteLength(layers, matrix.rows, matrix.cols), encodeViaGetKeymapBuffer);
    }
    async readKeymapNow(matrix, layers) {
        if ((await this.protocolVersion()) >= VIA_PROTOCOL_BETA) {
            return decodeViaKeymap(await this.keymapBytes(layers, matrix), layers, matrix.rows, matrix.cols);
        }
        const keymap = [];
        for (let layer = 0; layer < layers; layer += 1) {
            const keycodes = [];
            for (let row = 0; row < matrix.rows; row += 1) {
                for (let col = 0; col < matrix.cols; col += 1) {
                    keycodes.push(decodeViaKeycode(await this.call(encodeViaGetKeycode(layer, row, col), 3)));
                }
            }
            keymap.push(keycodes);
        }
        return keymap;
    }
    readStatus() {
        return this.serialized(async () => {
            const protocolVersion = await this.protocolVersion();
            const layerCount = await this.optional(() => this.layerCount());
            const firmwareVersion = await this.optional(async () => viaUint32(await this.keyboardValue(VIA_KEYBOARD_VALUE.firmwareVersion, 4)));
            const keycodesVersion = await this.optional(async () => viaUint32(await this.keyboardValue(VIA_KEYBOARD_VALUE.keycodesVersion, 4)));
            const layoutOptions = await this.optional(async () => viaUint32(await this.keyboardValue(VIA_KEYBOARD_VALUE.layoutOptions, 4)));
            const uptimeMs = await this.optional(async () => viaUint32(await this.keyboardValue(VIA_KEYBOARD_VALUE.uptime, 4)));
            const macroCount = await this.optional(async () => decodeViaMacroCount(await this.call(encodeViaMacroGetCount(), 0)));
            const macroBufferSize = await this.optional(async () => decodeViaMacroBufferSize(await this.call(encodeViaMacroGetBufferSize(), 0)));
            const via = {
                protocolVersion, layerCount, firmwareVersion, keycodesVersion, layoutOptions, uptimeMs, macroCount, macroBufferSize,
            };
            const name = this.device.productName || "VIA keyboard";
            return {
                brand: "VIA",
                name,
                connectionType: "Unknown",
                connectionDetail: "VIA raw HID",
                firmware: [`VIA protocol ${protocolVersion}`, ...(firmwareVersion ? [`Firmware ${firmwareVersion}`] : [])],
                firmwareVersion: firmwareVersion ? String(firmwareVersion) : null,
                layout: null,
                serial: null,
                activeProfile: null,
                profileCount: null,
                profileNames: [],
                ui: {
                    family: "via",
                    settingsReady: false,
                    defaultDisplayName: name,
                    statusNote: "VIA support is written from the public protocol; this board has not been tested through OpenMouse.",
                },
                via,
            };
        });
    }
    readKeymap(matrix, layers) {
        return this.serialized(async () => this.readKeymapNow(matrix, layers ?? (await this.layerCount())));
    }
    writeKeymap(keymap, matrix) {
        return this.serialized(async () => {
            const perLayer = matrix.rows * matrix.cols;
            if (keymap.some((layer) => layer.length !== perLayer))
                throw new RangeError("Every layer must hold rows * cols keycodes.");
            if (keymap.length > (await this.layerCount()))
                throw new RangeError("The keymap has more layers than the board.");
            const bytes = encodeViaKeymap(keymap);
            if ((await this.protocolVersion()) >= VIA_PROTOCOL_BETA) {
                for (const { offset, size } of viaBufferChunks(bytes.length)) {
                    await this.call(encodeViaSetKeymapBuffer(offset, bytes.slice(offset, offset + size)), 3);
                }
            }
            else {
                for (const [layer, keycodes] of keymap.entries()) {
                    for (const [index, keycode] of keycodes.entries()) {
                        await this.call(encodeViaSetKeycode(layer, Math.floor(index / matrix.cols), index % matrix.cols, keycode), 3);
                    }
                }
            }
            const confirmed = await this.readKeymapNow(matrix, keymap.length);
            if (confirmed.some((layer, index) => layer.some((keycode, key) => keycode !== keymap[index][key]))) {
                throw new Error("Keymap read-back did not match what was written.");
            }
        });
    }
    /** Writes the packed layout options and returns what the board reports afterwards. */
    setLayoutOptions(bitfield) {
        return this.serialized(async () => {
            await this.call(encodeViaSetKeyboardValue(VIA_KEYBOARD_VALUE.layoutOptions, viaUint32Bytes(bitfield)), 1);
            return viaUint32(await this.keyboardValue(VIA_KEYBOARD_VALUE.layoutOptions, 4));
        });
    }
    readKeycode(layer, row, col) {
        return this.serialized(async () => decodeViaKeycode(await this.call(encodeViaGetKeycode(layer, row, col), 3)));
    }
    setKeycode(layer, row, col, keycode) {
        return this.serialized(async () => {
            await this.call(encodeViaSetKeycode(layer, row, col, keycode), 5);
            const confirmed = decodeViaKeycode(await this.call(encodeViaGetKeycode(layer, row, col), 3));
            if (confirmed !== keycode)
                throw new Error("Key read-back did not match the request.");
            return confirmed;
        });
    }
    /** Which switches are down, as one bit mask per matrix row (bit 0 is column 0). Fits one report: at most 30 bytes. */
    readSwitchMatrix(rows, cols) {
        const bytesPerRow = Math.ceil(cols / 8);
        // Protocol 13 pages the matrix: the request names the first row and the reply echoes it before up to 28 bytes of rows.
        const pageRows = Math.floor((VIA_REPORT_LENGTH - 4) / bytesPerRow);
        if (rows < 1 || bytesPerRow < 1 || pageRows < 1)
            throw new RangeError("This matrix is too large to read.");
        return this.serialized(async () => {
            const paged = (await this.protocolVersion()) >= 13;
            if (!paged && rows * bytesPerRow > VIA_REPORT_LENGTH - 2)
                throw new RangeError("This matrix is too large to read in one report.");
            const bytes = [];
            for (let first = 0; first < rows; first += paged ? pageRows : rows) {
                const count = paged ? Math.min(pageRows, rows - first) : rows;
                bytes.push(...(paged
                    ? decodeViaKeyboardValue(await this.call(encodeViaGetKeyboardValue(VIA_KEYBOARD_VALUE.switchMatrixState, [first]), 2), 1, count * bytesPerRow)
                    : await this.keyboardValue(VIA_KEYBOARD_VALUE.switchMatrixState, count * bytesPerRow)));
            }
            // Each row is big-endian: its first byte holds the highest columns.
            return Array.from({ length: rows }, (_, row) => bytes.slice(row * bytesPerRow, (row + 1) * bytesPerRow).reduce((mask, byte) => mask * 256 + byte, 0));
        });
    }
    readEncoder(layer, id, clockwise) {
        return this.serialized(async () => decodeViaEncoder(await this.call(encodeViaGetEncoder(layer, id, clockwise), 3)));
    }
    setEncoder(layer, id, clockwise, keycode) {
        return this.serialized(async () => {
            await this.call(encodeViaSetEncoder(layer, id, clockwise, keycode), 5);
            const confirmed = decodeViaEncoder(await this.call(encodeViaGetEncoder(layer, id, clockwise), 3));
            if (confirmed !== keycode)
                throw new Error("Encoder read-back did not match the request.");
            return confirmed;
        });
    }
    async macroLayout() {
        const count = decodeViaMacroCount(await this.call(encodeViaMacroGetCount(), 0));
        const bufferSize = decodeViaMacroBufferSize(await this.call(encodeViaMacroGetBufferSize(), 0));
        return { count, bufferSize };
    }
    readMacros() {
        return this.serialized(async () => {
            const { count, bufferSize } = await this.macroLayout();
            const buffer = await this.readBuffer(bufferSize, encodeViaMacroGetBuffer);
            return { count, bufferSize, macros: splitViaMacros(buffer, count) };
        });
    }
    writeMacros(macros) {
        return this.serialized(async () => {
            const { count, bufferSize } = await this.macroLayout();
            if (macros.length !== count)
                throw new RangeError(`The board holds ${count} macros; got ${macros.length}.`);
            const bytes = joinViaMacros(macros, bufferSize);
            // QMK will not play a macro while the buffer's last byte is non-zero, so mark it for the whole upload and
            // clear it only once every chunk is in. A failed upload leaves macros paused instead of half old, half new.
            const last = bytes.length - 1;
            await this.call(encodeViaMacroSetBuffer(last, [0xff]), 3);
            for (const { offset, size } of viaBufferChunks(last)) {
                await this.call(encodeViaMacroSetBuffer(offset, bytes.slice(offset, offset + size)), 3);
            }
            await this.call(encodeViaMacroSetBuffer(last, [bytes[last]]), 3);
            const confirmed = await this.readBuffer(bufferSize, encodeViaMacroGetBuffer);
            if (confirmed.some((byte, index) => byte !== bytes[index]))
                throw new Error("Macro read-back did not match what was written.");
        });
    }
    readCustomValue(ids, resultLength) {
        return this.serialized(async () => decodeViaCustomValue(await this.call(encodeViaCustomGet(ids), ids.length), ids.length, resultLength));
    }
    setCustomValue(ids, value, verify = true) {
        return this.serialized(async () => {
            await this.call(encodeViaCustomSet(ids, value), ids.length);
            if (!verify)
                return [...value];
            return decodeViaCustomValue(await this.call(encodeViaCustomGet(ids), ids.length), ids.length, value.length);
        });
    }
    /** `legacy` is the old lighting save, which takes no channel. */
    saveCustomChannel(channel, legacy = false) {
        return this.serialized(async () => { await this.call(encodeViaCustomSave(legacy ? null : channel), legacy ? 0 : 1); });
    }
}
