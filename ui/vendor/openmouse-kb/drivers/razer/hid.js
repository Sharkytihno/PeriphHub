import { RAZER_KEYBOARD_PRODUCTS, RAZER_CUSTOM_MATRIX_SUPPORT, RAZER_GAME_MODE_LED_SUPPORT, RAZER_FIRMWARE_ALL_KEYS, RAZER_FIRMWARE_RAPID_TRIGGER_PRODUCTS, RAZER_KEYBOARD_READ, RAZER_KEYBOARD_WRITE, RAZER_POLLING_RATES, RAZER_REPORT_ID, RAZER_STATUS, RAZER_TRANSACTION_IDS, RAZER_VENDOR_ID, decodeRazerBrightness, decodeRazerFirmware, decodeRazerPollingCode, decodeRazerResponse, decodeRazerSerial, decodeRazerAnalogBinding, decodeRazerStandardBinding, encodeRazerCustomMatrixEffect, encodeRazerCustomMatrixRow, encodeRazerGameModeLed, encodeRazerRapidTrigger, encodeRazerAnalogBinding, encodeRazerMatrixEffect, encodeRazerStandardBinding, encodeRazerStandardMatrixEffect, encodeRazerPollingCode, encodeRazerRequest, } from "../../razer/index.js";
const RESPONSE_TIMEOUT_MS = 600;
export class RazerKeyboardHidClient {
    device;
    transactionId = null;
    queue = Promise.resolve();
    listening = false;
    faulted = false;
    constructor(device) {
        this.device = device;
    }
    /**
     * Razer keyboards put the 90-byte control channel on an interface whose HID
     * protocol is Mouse (Generic Desktop / Mouse), exactly as OpenRazer's
     * `razerkbd` driver selects `USB_INTERFACE_PROTOCOL_MOUSE`. The product id
     * must be in the keyboard catalog so the same predicate cannot claim a mouse.
     */
    static isSupported(device) {
        if (device.vendorId !== RAZER_VENDOR_ID)
            return false;
        if (!RAZER_KEYBOARD_PRODUCTS.has(device.productId))
            return false;
        return RazerKeyboardHidClient.hasControlCollection(device.collections);
    }
    static hasControlCollection(collections) {
        for (const collection of collections) {
            if (collection.usagePage === 0x0001 && collection.usage === 0x0002)
                return true;
            if (RazerKeyboardHidClient.hasControlCollection(collection.children))
                return true;
        }
        return false;
    }
    static delay(ms) {
        const { promise, resolve } = Promise.withResolvers();
        setTimeout(resolve, ms);
        return promise;
    }
    async open() {
        if (!RazerKeyboardHidClient.isSupported(this.device))
            throw new Error("Not a supported Razer keyboard control interface.");
        if (this.faulted)
            throw new Error("Reconnect the Razer keyboard after a failed transaction.");
        if (!this.device.opened)
            await this.device.open();
        if (!this.listening) {
            // Replies arrive through receiveFeatureReport; the listener exists so
            // keypress chatter on the same interface is drained, never parsed.
            this.device.addEventListener("inputreport", this.onInputReport);
            this.listening = true;
        }
        if (this.transactionId === null)
            await this.resolveTransactionId();
    }
    async close() {
        this.faulted = true;
        if (this.listening)
            this.device.removeEventListener("inputreport", this.onInputReport);
        this.listening = false;
        if (this.device.opened)
            await this.device.close();
    }
    onInputReport = () => {
        // Razer replies to control commands via GET_REPORT (receiveFeatureReport),
        // not the interrupt endpoint. Nothing to match here.
    };
    serialized(operation) {
        const next = this.queue.then(operation);
        this.queue = next.catch(() => undefined);
        return next;
    }
    async exchange(command, transactionId) {
        if (this.transactionId === null)
            throw new Error("The Razer keyboard has not answered yet.");
        await this.open();
        const request = encodeRazerRequest(command, transactionId ?? this.transactionId);
        await this.device.sendFeatureReport(RAZER_REPORT_ID, request);
        const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
        let lastError = null;
        while (Date.now() < deadline) {
            try {
                const reply = await this.device.receiveFeatureReport(RAZER_REPORT_ID);
                const response = decodeRazerResponse(new Uint8Array(reply.buffer, reply.byteOffset, reply.byteLength));
                if (!response)
                    throw new Error("The Razer keyboard returned a malformed reply.");
                if (response.status === RAZER_STATUS.ok)
                    return response.args;
                if (response.status === RAZER_STATUS.busy) {
                    await RazerKeyboardHidClient.delay(20);
                    continue;
                }
                if (response.status === RAZER_STATUS.unsupported) {
                    throw Object.assign(new Error("The Razer keyboard does not implement that command."), { definitive: true });
                }
                throw Object.assign(new Error(`The Razer keyboard rejected the command (status 0x${response.status.toString(16)}).`), { definitive: true });
            }
            catch (error) {
                if (typeof error === "object" && error !== null && "definitive" in error)
                    throw error;
                lastError = error instanceof Error ? error : new Error(String(error));
                await RazerKeyboardHidClient.delay(20);
            }
        }
        throw lastError ?? new Error("The Razer keyboard did not answer.");
    }
    async resolveTransactionId() {
        for (const transactionId of RAZER_TRANSACTION_IDS) {
            this.transactionId = transactionId;
            try {
                const args = await this.exchange(RAZER_KEYBOARD_READ.firmware);
                if (decodeRazerFirmware(args) !== null)
                    return;
            }
            catch (error) {
                // A permission denial (Chrome blocking the Mouse-collection feature
                // report) is terminal: rethrow instead of probing the next id.
                const denied = typeof error === "object" && error !== null && "name" in error
                    && (error.name === "NotAllowedError" || error.name === "SecurityError");
                if (denied) {
                    this.transactionId = null;
                    this.faulted = true;
                    throw error;
                }
                // A mismatched transaction id is silent; try the next generation.
            }
        }
        this.transactionId = null;
        this.faulted = true;
        throw new Error("The Razer keyboard did not answer on any known transaction id. Reconnect it and try again.");
    }
    readFirmware() {
        return this.serialized(async () => {
            await this.open();
            return decodeRazerFirmware(await this.exchange(RAZER_KEYBOARD_READ.firmware));
        });
    }
    readSerial() {
        return this.serialized(async () => {
            await this.open();
            return decodeRazerSerial(await this.exchange(RAZER_KEYBOARD_READ.serial));
        });
    }
    async readIdentity() {
        const firmwareVersion = decodeRazerFirmware(await this.exchange(RAZER_KEYBOARD_READ.firmware));
        const serial = await this.exchange(RAZER_KEYBOARD_READ.serial)
            .then((args) => decodeRazerSerial(args))
            .catch(() => null);
        return { firmwareVersion, serial };
    }
    async readPollingRate() {
        for (const style of ["extended", "standard"]) {
            try {
                const args = await this.exchange(style === "extended" ? RAZER_KEYBOARD_READ.pollingRateExtended : RAZER_KEYBOARD_READ.pollingRate);
                const code = style === "extended" ? args[1] ?? args[0] : args[0];
                const hz = decodeRazerPollingCode(code ?? 0xff, style === "extended");
                if (hz !== null)
                    return { hz, style };
            }
            catch {
                // Fall through to the older command.
            }
        }
        return null;
    }
    async setPollingRate(hz) {
        return this.serialized(async () => {
            await this.open();
            if (!RAZER_POLLING_RATES.includes(hz))
                throw new RangeError(`Unsupported polling rate ${hz} Hz.`);
            const current = await this.readPollingRate();
            const styles = current ? [current.style] : ["extended", "standard"];
            let lastError = null;
            for (const style of styles) {
                const code = encodeRazerPollingCode(hz, style === "extended");
                if (code === null)
                    continue;
                try {
                    await this.exchange(style === "extended"
                        ? { ...RAZER_KEYBOARD_WRITE.pollingRateExtended, args: [0x00, code] }
                        : { ...RAZER_KEYBOARD_WRITE.pollingRate, args: [code] });
                    const confirmed = await this.readPollingRate();
                    if (confirmed?.hz === hz)
                        return confirmed.hz;
                    lastError = new Error("The Razer keyboard did not confirm the polling-rate change.");
                }
                catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error));
                }
            }
            throw lastError ?? new RangeError(`The Razer keyboard has no command for ${hz} Hz.`);
        });
    }
    async readBrightness() {
        for (const style of ["extended", "standard"]) {
            try {
                const args = await this.exchange(style === "extended" ? RAZER_KEYBOARD_READ.brightnessExtended : RAZER_KEYBOARD_READ.brightnessStandard);
                const value = decodeRazerBrightness(args);
                if (value !== null)
                    return { value, style };
            }
            catch {
                // Fall through to the older command.
            }
        }
        return null;
    }
    async setBrightness(value) {
        return this.serialized(async () => {
            await this.open();
            if (!Number.isInteger(value) || value < 0 || value > 255)
                throw new RangeError("Brightness must be a whole number from 0 to 255.");
            const current = await this.readBrightness();
            const styles = current ? [current.style] : ["extended", "standard"];
            let lastError = null;
            for (const style of styles) {
                try {
                    await this.exchange(style === "extended"
                        ? { ...RAZER_KEYBOARD_WRITE.brightnessExtended, args: [0x01, 0x05, value] }
                        : { ...RAZER_KEYBOARD_WRITE.brightnessStandard, args: [0x01, 0x05, value] });
                    const confirmed = await this.readBrightness();
                    if (confirmed?.value === value)
                        return confirmed.value;
                    lastError = new Error("The Razer keyboard did not confirm the brightness change.");
                }
                catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error));
                }
            }
            throw lastError ?? new Error("The Razer keyboard did not confirm the brightness change.");
        });
    }
    /**
     * Read one non-analog key binding. Razer's get direction is the write id with
     * bit 7 set (`0x0D` -> `0x8D`); this path is derived from that convention.
     */
    async readStandardBinding(key) {
        return this.serialized(async () => {
            await this.open();
            const args = await this.exchange({ ...RAZER_KEYBOARD_WRITE.bindingStandardRead, args: [0x01, key] });
            return decodeRazerStandardBinding(args);
        });
    }
    /**
     * Read one analog key binding, including raw actuation/release thresholds.
     * Razer's get direction is `0x12` -> `0x92`; derived from the same convention.
     */
    async readAnalogBinding(slot, key, fnLayer) {
        return this.serialized(async () => {
            await this.open();
            const args = await this.exchange({ ...RAZER_KEYBOARD_WRITE.bindingAnalogRead, args: [slot, key, fnLayer ? 1 : 0] });
            return decodeRazerAnalogBinding(args);
        });
    }
    /** Apply one matrix effect, trying the extended command before the standard fallback. Write-only. */
    async setMatrixEffect(effect) {
        return this.serialized(async () => {
            await this.open();
            try {
                await this.exchange(encodeRazerMatrixEffect(effect));
                return;
            }
            catch {
                await this.exchange(encodeRazerStandardMatrixEffect(effect));
            }
        });
    }
    /** Write physical matrix coordinates, not USB key usages; OpenRazer uses inclusive columns. */
    async setCustomMatrixRow(row, startColumn, colors) {
        return this.serialized(async () => {
            const support = RAZER_CUSTOM_MATRIX_SUPPORT.get(this.device.productId);
            if (!support)
                throw new Error("Custom matrix rows are not enabled for this Razer model.");
            const command = encodeRazerCustomMatrixRow(support.style, row, startColumn, colors);
            await this.open();
            await this.exchange(command, support.rowTransactionId ?? support.transactionId);
        });
    }
    /** Select the custom effect after sending the required matrix rows. */
    async activateCustomMatrix() {
        return this.serialized(async () => {
            const support = RAZER_CUSTOM_MATRIX_SUPPORT.get(this.device.productId);
            if (!support)
                throw new Error("Custom matrix mode is not enabled for this Razer model.");
            await this.open();
            await this.exchange(encodeRazerCustomMatrixEffect(support.style), support.transactionId);
        });
    }
    /** Game-mode indicator readback is supported only for OpenRazer-gated models. */
    async readGameModeLed() {
        return this.serialized(async () => {
            const support = RAZER_GAME_MODE_LED_SUPPORT.get(this.device.productId);
            if (!support)
                throw new Error("Game-mode LED is not enabled for this Razer model.");
            await this.open();
            const args = await this.exchange(encodeRazerGameModeLed(support.storage), support.transactionId);
            if (args.length < 3 || (args[2] !== 0 && args[2] !== 1)) {
                throw new Error("The Razer keyboard did not return a valid game-mode LED state.");
            }
            return args[2] === 1;
        });
    }
    /** Write and confirm the game-mode LED using the model-specific storage and transaction. */
    async setGameModeLed(enabled) {
        return this.serialized(async () => {
            const support = RAZER_GAME_MODE_LED_SUPPORT.get(this.device.productId);
            if (!support)
                throw new Error("Game-mode LED is not enabled for this Razer model.");
            await this.open();
            await this.exchange(encodeRazerGameModeLed(support.storage, enabled), support.transactionId);
            const args = await this.exchange(encodeRazerGameModeLed(support.storage), support.transactionId);
            if (args.length < 3 || args[2] !== (enabled ? 1 : 0)) {
                throw new Error("The Razer keyboard did not confirm the game-mode LED state.");
            }
            return enabled;
        });
    }
    /** Bind one key through the non-analog command (class 0x02 / id 0x0D). Write-only. */
    async setStandardBinding(key, binding) {
        return this.serialized(async () => {
            await this.open();
            await this.exchange(encodeRazerStandardBinding(key, binding));
        });
    }
    /**
     * Bind one analog key, including its raw actuation and release thresholds
     * (class 0x02 / id 0x12). Write-only; no read command is known.
     */
    async setAnalogBinding(slot, key, fnLayer, actuation, release, binding) {
        return this.serialized(async () => {
            await this.open();
            await this.exchange(encodeRazerAnalogBinding(slot, key, fnLayer, actuation, release, binding));
        });
    }
    /** Set V3 firmware rapid trigger for one firmware key ID in RAM profile 0. */
    async setRapidTrigger(key, enabled, upMm, downMm) {
        return this.serialized(async () => {
            if (!RAZER_FIRMWARE_RAPID_TRIGGER_PRODUCTS.has(this.device.productId)) {
                throw new Error("Firmware rapid trigger is not enabled for this Razer model.");
            }
            const command = encodeRazerRapidTrigger(key, enabled, upMm, downMm);
            await this.open();
            await this.exchange(command);
            const actual = await this.exchange({ commandClass: 0x02, commandId: 0x9a, dataSize: 3, args: [0, 0, key] });
            const expected = command.args ?? [];
            if (actual.length < 8 || expected.some((value, offset) => actual[offset] !== value)) {
                throw new Error("The Razer keyboard did not confirm the rapid-trigger settings.");
            }
        });
    }
    /**
     * Overwrite rapid trigger on every key at once (firmware key ID FF). This is
     * an all-keys override, not a reversible profile switch: per-key flags set
     * earlier are replaced and cannot be restored by toggling it back.
     */
    async setRapidTriggerAllKeys(enabled) {
        return this.serialized(async () => {
            if (!RAZER_FIRMWARE_RAPID_TRIGGER_PRODUCTS.has(this.device.productId)) {
                throw new Error("Firmware rapid trigger is not enabled for this Razer model.");
            }
            await this.open();
            await this.exchange({ commandClass: 0x02, commandId: 0x1a, dataSize: 8,
                args: [0, 0, RAZER_FIRMWARE_ALL_KEYS, enabled ? 1 : 0, 0, 0, 0, 0] });
            const actual = await this.exchange({ commandClass: 0x02, commandId: 0x9a, dataSize: 3,
                args: [0, 0, RAZER_FIRMWARE_ALL_KEYS] });
            if (actual.length < 4 || actual[2] !== RAZER_FIRMWARE_ALL_KEYS || actual[3] !== Number(enabled)) {
                throw new Error("The Razer keyboard did not confirm the rapid-trigger switch.");
            }
        });
    }
    readStatus() {
        return this.serialized(async () => {
            await this.open();
            const { firmwareVersion, serial } = await this.readIdentity();
            const polling = await this.readPollingRate();
            const brightness = await this.readBrightness();
            const product = RAZER_KEYBOARD_PRODUCTS.get(this.device.productId);
            const razer = {
                productId: this.device.productId,
                pollingRateHz: polling?.hz ?? null,
                pollingStyle: polling?.style ?? null,
                brightness: brightness?.value ?? null,
                brightnessStyle: brightness?.style ?? null,
                wireless: product.wireless,
                verified: product.verified,
            };
            const lines = [];
            if (firmwareVersion)
                lines.push(`Firmware: ${firmwareVersion}`);
            if (polling)
                lines.push(`Polling: ${polling.hz} Hz`);
            if (brightness)
                lines.push(`Brightness: ${brightness.value}/255`);
            return {
                brand: "Razer",
                name: product.name,
                ui: {
                    family: "razer",
                    settingsReady: false,
                    defaultDisplayName: product.name,
                    statusNote: product.verified ? undefined : "USB recognition and protocol support are transcribed from OpenRazer; this model has not been tested through OpenMouse.",
                },
                connectionType: product.wireless ? "Wireless" : "Wired",
                connectionDetail: product.wireless ? "2.4 GHz" : "USB",
                firmware: lines,
                firmwareVersion,
                layout: null,
                serial,
                activeProfile: null,
                profileCount: null,
                profileNames: [],
                razer,
            };
        });
    }
}
