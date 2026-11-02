import { LOGITECH_DIRECT_DEVICE_INDEX, LOGITECH_FEATURE, LOGITECH_HIDPP_BLUETOOTH_USAGE_PAGE, LOGITECH_HIDPP_ERRORS, LOGITECH_HIDPP_USAGE_PAGE, LOGITECH_KEYBOARD_PRODUCTS, LOGITECH_LONG_REPORT_ID, LOGITECH_RECEIVER_PRODUCTS, LOGITECH_SHORT_REPORT_ID, LOGITECH_VENDOR_ID, decodeLogitechBattery, decodeLogitechBrightness, decodeLogitechBrightnessInfo, decodeLogitechDeviceInformation, decodeLogitechFeatureInfo, decodeLogitechFirmwareInfo, decodeLogitechReportRate, decodeLogitechReportRates, decodeLogitechZonePresence, decodeLogitechLegacyLightingInfo, decodeLogitechLegacyZoneInfo, decodeLogitechLegacyEffectInfo, logitechRgbMode, buildLogitechControlRemap, decodeLogitechControlInfo, decodeLogitechControlReporting, logitechRemappableTargets, LOGITECH_KEY_FLAG, LOGITECH_REPROG_CONTROLS, decodeLogitechResponse, encodeLogitechReportRate, encodeLogitechRequest, } from "../../logitech/index.js";
const RESPONSE_TIMEOUT_MS = 900;
export class LogitechKeyboardHidClient {
    device;
    queue = Promise.resolve();
    listening = false;
    pending = null;
    deviceIndex = LOGITECH_DIRECT_DEVICE_INDEX;
    featureIndexes = new Map();
    longReports = false;
    keyboardProductId = null;
    receiver = false;
    indexResolved = false;
    constructor(device) {
        this.device = device;
    }
    /** Logitech vendor id, a catalogued keyboard or receiver product, and a HID++ collection. */
    static isSupported(device) {
        if (device.vendorId !== LOGITECH_VENDOR_ID)
            return false;
        if (!LOGITECH_KEYBOARD_PRODUCTS.has(device.productId) && !LOGITECH_RECEIVER_PRODUCTS.has(device.productId))
            return false;
        return LogitechKeyboardHidClient.hasHidppCollection(device.collections);
    }
    static hasHidppCollection(collections) {
        for (const collection of collections) {
            if (collection.usagePage === LOGITECH_HIDPP_BLUETOOTH_USAGE_PAGE)
                return true;
            if (collection.usagePage === LOGITECH_HIDPP_USAGE_PAGE && (collection.usage === 1 || collection.usage === 2))
                return true;
            if (LogitechKeyboardHidClient.hasHidppCollection(collection.children))
                return true;
        }
        return false;
    }
    onInputReport = (event) => {
        const pending = this.pending;
        if (!pending)
            return;
        if (event.reportId !== LOGITECH_SHORT_REPORT_ID && event.reportId !== LOGITECH_LONG_REPORT_ID)
            return;
        const data = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
        const response = decodeLogitechResponse(event.reportId, data);
        if (!response)
            return;
        if (response.deviceIndex !== this.deviceIndex)
            return;
        const isError = response.featureIndex === 0xff;
        if (isError) {
            if (response.requestFeatureIndex !== pending.featureIndex)
                return;
            if (response.requestFunctionByte !== ((pending.functionId << 4) | pending.softwareId))
                return;
        }
        else {
            if (response.featureIndex !== pending.featureIndex || response.functionId !== pending.functionId)
                return;
            if (response.softwareId !== pending.softwareId)
                return;
        }
        this.pending = null;
        clearTimeout(pending.timer);
        pending.resolve(response);
    };
    async open() {
        if (!LogitechKeyboardHidClient.isSupported(this.device))
            throw new Error("Not a supported Logitech HID++ keyboard.");
        if (!this.device.opened)
            await this.device.open();
        if (!this.listening) {
            this.device.addEventListener("inputreport", this.onInputReport);
            this.listening = true;
        }
        this.longReports = LogitechKeyboardHidClient.hasLongCollection(this.device.collections)
            || LogitechKeyboardHidClient.hasCollectionPage(this.device.collections, LOGITECH_HIDPP_BLUETOOTH_USAGE_PAGE);
        if (!this.indexResolved) {
            this.receiver = LOGITECH_RECEIVER_PRODUCTS.has(this.device.productId);
            if (this.receiver)
                await this.resolveReceiverKeyboard();
            else {
                this.keyboardProductId = this.device.productId;
                this.indexResolved = true;
            }
        }
    }
    static hasLongCollection(collections) {
        for (const collection of collections) {
            if (collection.usagePage === LOGITECH_HIDPP_USAGE_PAGE && collection.usage === 2)
                return true;
            if (LogitechKeyboardHidClient.hasLongCollection(collection.children))
                return true;
        }
        return false;
    }
    static hasCollectionPage(collections, page) {
        for (const collection of collections) {
            if (collection.usagePage === page)
                return true;
            if (LogitechKeyboardHidClient.hasCollectionPage(collection.children, page))
                return true;
        }
        return false;
    }
    /**
     * Fail early only when the collection explicitly declares output reports and
     * the needed id is absent. Empty or missing declarations stay permissive:
     * Chrome validates report ids itself and most fixtures carry no descriptors.
     */
    assertReportIdSupported(reportId) {
        const declared = [];
        const visit = (collections) => {
            for (const collection of collections) {
                declared.push(...collection.outputReports.map((report) => report.reportId));
                visit(collection.children);
            }
        };
        visit(this.device.collections);
        if (declared.length > 0 && !declared.includes(reportId)) {
            throw new Error(`The Logitech keyboard does not advertise output report 0x${reportId.toString(16)}.`);
        }
    }
    async close() {
        const pending = this.pending;
        this.pending = null;
        if (pending) {
            clearTimeout(pending.timer);
            pending.reject(new Error("Logitech keyboard disconnected."));
        }
        if (this.listening)
            this.device.removeEventListener("inputreport", this.onInputReport);
        this.listening = false;
        if (this.device.opened)
            await this.device.close();
    }
    serialized(operation) {
        const next = this.queue.then(operation);
        this.queue = next.catch(() => undefined);
        return next;
    }
    async rawRequest(featureIndex, functionId, params, timeoutMs = RESPONSE_TIMEOUT_MS, long = this.longReports) {
        const { reportId, data } = encodeLogitechRequest(this.deviceIndex, featureIndex, functionId, params, long);
        this.assertReportIdSupported(reportId);
        const response = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pending?.timer === timer)
                    this.pending = null;
                reject(new Error(`The Logitech keyboard did not answer feature 0x${featureIndex.toString(16)} function 0x${functionId.toString(16)}.`));
            }, timeoutMs);
            this.pending = { reportId, featureIndex, functionId, softwareId: (data[2] ?? 0) & 0x0f, resolve, reject, timer };
            void this.device.sendReport(reportId, data).catch((error) => {
                if (this.pending?.timer === timer)
                    this.pending = null;
                clearTimeout(timer);
                reject(error instanceof Error ? error : new Error(String(error)));
            });
        });
        if (response.errorCode !== null) {
            const reason = LOGITECH_HIDPP_ERRORS[response.errorCode] ?? `HID++ error 0x${response.errorCode.toString(16)}`;
            throw new Error(`The Logitech keyboard rejected that request (${reason}).`);
        }
        return response.params;
    }
    async request(featureIndex, functionId, params) {
        await this.open();
        return this.rawRequest(featureIndex, functionId, params);
    }
    async requestMode(featureIndex, functionId, params, long) {
        await this.open();
        return this.rawRequest(featureIndex, functionId, params, RESPONSE_TIMEOUT_MS, long);
    }
    /**
     * Find the keyboard's HID++ device index on a receiver. Each pairing slot is
     * asked for its device-information block; the first slot whose model ids name
     * a catalogued keyboard wins. A receiver that reports nothing supported is an
     * error rather than a client that silently invents a keyboard.
     */
    async resolveReceiverKeyboard() {
        for (const candidate of [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, LOGITECH_DIRECT_DEVICE_INDEX]) {
            this.deviceIndex = candidate;
            try {
                const rootParams = await this.rawRequest(0, 0, [LOGITECH_FEATURE.deviceInformation >> 8, LOGITECH_FEATURE.deviceInformation & 0xff, 0x00], 350);
                const root = decodeLogitechFeatureInfo(rootParams);
                if (!root)
                    continue;
                const deviceParams = await this.rawRequest(root.index, 0, [0x00, 0x00, 0x00], 350);
                const info = decodeLogitechDeviceInformation(deviceParams);
                const productId = info?.modelIds.find((id) => LOGITECH_KEYBOARD_PRODUCTS.has(id));
                if (productId === undefined)
                    continue;
                this.keyboardProductId = productId;
                this.featureIndexes.set(LOGITECH_FEATURE.deviceInformation, root.index);
                this.indexResolved = true;
                return;
            }
            catch {
                // Empty slot or a device that does not answer HID++.
            }
        }
        throw new Error("The Logitech receiver has no supported keyboard paired.");
    }
    async getFeature(featureId) {
        const cached = this.featureIndexes.get(featureId);
        if (cached !== undefined)
            return cached;
        if (featureId === LOGITECH_FEATURE.root)
            return 0;
        const params = await this.request(0, 0x00, [featureId >> 8, featureId & 0xff, 0x00]);
        const info = decodeLogitechFeatureInfo(params);
        const index = info?.index ?? 0;
        this.featureIndexes.set(featureId, index);
        return index;
    }
    async readDeviceInformation() {
        const index = await this.getFeature(LOGITECH_FEATURE.deviceInformation);
        if (!index)
            return { device: { entityCount: 0, unitId: "", transport: [], modelIds: [], extendedModelId: 0, serialNumber: false }, firmware: null, serial: null };
        const info = decodeLogitechDeviceInformation(await this.request(index, 0x00, [0x00, 0x00, 0x00]));
        if (!info)
            throw new Error("The Logitech keyboard returned an unreadable device-information block.");
        const firmware = await this.request(index, 0x01, [0x00, 0x00, 0x00])
            .then((params) => decodeLogitechFirmwareInfo(params)?.version ?? null)
            .catch(() => null);
        const serial = info.serialNumber
            ? await this.request(index, 0x02, [0x00, 0x00, 0x00])
                .then((params) => {
                const end = params.indexOf(0);
                const text = new TextDecoder().decode(end < 0 ? params : params.slice(0, end)).trim();
                return text.length ? text : null;
            })
                .catch(() => null)
            : null;
        return { device: info, firmware, serial };
    }
    async readBattery() {
        const index = await this.getFeature(LOGITECH_FEATURE.unifiedBattery);
        if (!index)
            return null;
        const capabilities = await this.request(index, 0x00, [0x00, 0x00, 0x00]);
        const info = await this.request(index, 0x01, [0x00, 0x00, 0x00]);
        return decodeLogitechBattery(info, ((capabilities[1] ?? 0) & 0x02) !== 0);
    }
    async readPollingRate() {
        const index = await this.getFeature(LOGITECH_FEATURE.extendedReportRate);
        if (!index)
            return { hz: null, supported: [] };
        const supported = decodeLogitechReportRates(await this.request(index, 0x01, [0x00, 0x00, 0x00]));
        const hz = decodeLogitechReportRate(await this.request(index, 0x02, [0x00, 0x00, 0x00]));
        return { hz, supported };
    }
    async setPollingRate(hz) {
        return this.serialized(async () => {
            const index = await this.getFeature(LOGITECH_FEATURE.extendedReportRate);
            if (!index)
                throw new Error("This Logitech keyboard does not expose a report-rate feature.");
            const { supported } = await this.readPollingRate();
            if (!supported.includes(hz))
                throw new RangeError(`This keyboard does not advertise ${hz} Hz.`);
            const code = encodeLogitechReportRate(hz);
            if (code === null)
                throw new RangeError(`HID++ cannot express ${hz} Hz.`);
            await this.request(index, 0x03, [code, 0x00, 0x00]);
            const confirmed = await this.readPollingRate();
            if (confirmed.hz !== hz)
                throw new Error("The Logitech keyboard did not confirm the report-rate change.");
            return confirmed.hz;
        });
    }
    async readBrightness() {
        const index = await this.getFeature(LOGITECH_FEATURE.brightnessControl);
        if (!index)
            return null;
        const info = decodeLogitechBrightnessInfo(await this.request(index, 0x00, [0x00, 0x00, 0x00]));
        const value = decodeLogitechBrightness(await this.request(index, 0x01, [0x00, 0x00, 0x00]));
        if (!info || value === null)
            return null;
        const illuminationEnabled = info.illumination
            ? await this.request(index, 0x03, [0x00, 0x00, 0x00])
                .then((params) => ((params[0] ?? 0) & 1) !== 0)
                .catch(() => null)
            : null;
        return { value, ...info, illuminationEnabled };
    }
    /** Toggle the backlight without changing its stored brightness. */
    async setIllumination(enabled) {
        return this.serialized(async () => {
            const index = await this.getFeature(LOGITECH_FEATURE.brightnessControl);
            if (!index)
                throw new Error("This Logitech keyboard does not expose brightness control.");
            const current = await this.readBrightness();
            if (!current?.illumination)
                throw new Error("This Logitech keyboard does not advertise illumination control.");
            await this.request(index, 0x04, [enabled ? 1 : 0, 0x00, 0x00]);
            const confirmed = await this.request(index, 0x03, [0x00, 0x00, 0x00]);
            if ((((confirmed[0] ?? 0) & 1) !== 0) !== enabled) {
                throw new Error("The Logitech keyboard did not confirm the illumination change.");
            }
            return enabled;
        });
    }
    async setBrightness(value) {
        return this.serialized(async () => {
            const index = await this.getFeature(LOGITECH_FEATURE.brightnessControl);
            if (!index)
                throw new Error("This Logitech keyboard does not expose brightness control.");
            const current = await this.readBrightness();
            if (!current)
                throw new Error("The Logitech keyboard did not report a brightness range.");
            if (!Number.isInteger(value) || value < current.min || value > current.max) {
                throw new RangeError(`Brightness must be a whole number from ${current.min} to ${current.max}.`);
            }
            await this.request(index, 0x02, [(value >> 8) & 0xff, value & 0xff, 0x00]);
            const confirmed = await this.readBrightness();
            if (confirmed?.value !== value)
                throw new Error("The Logitech keyboard did not confirm the brightness change.");
            return confirmed.value;
        });
    }
    async readControlsRaw() {
        const index = await this.getFeature(LOGITECH_FEATURE.reprogControls);
        if (!index)
            return null;
        const count = await this.requestMode(index, LOGITECH_REPROG_CONTROLS.count, [0x00, 0x00, 0x00], false)
            .then((params) => params[0] ?? 0)
            .catch(() => 0);
        const infos = [];
        for (let position = 0; position < count; position += 1) {
            try {
                const info = decodeLogitechControlInfo(await this.requestMode(index, LOGITECH_REPROG_CONTROLS.info, [position, 0x00, 0x00], true));
                if (info)
                    infos.push(info);
            }
            catch {
                // A control the keyboard will not describe is left out.
            }
        }
        const controls = [];
        for (const info of infos) {
            const reporting = await this.requestMode(index, LOGITECH_REPROG_CONTROLS.reporting, [info.controlId >> 8, info.controlId & 0xff, 0x00], true).then((params) => decodeLogitechControlReporting(params)).catch(() => null);
            controls.push({
                ...info,
                mappingFlags: reporting?.mappingFlags ?? 0,
                mappedTo: reporting?.mappedTo ?? info.controlId,
                diverted: reporting?.diverted ?? false,
                reprogrammable: ((info.flags & LOGITECH_KEY_FLAG.reprogrammable) !== 0),
                virtual: ((info.flags & LOGITECH_KEY_FLAG.virtual) !== 0),
                remappableTo: logitechRemappableTargets(info, infos),
            });
        }
        return controls;
    }
    /** Read every 0x1B04 control and its legal targets. Serialized and potentially slow on large keyboards. */
    async readControls() {
        return this.serialized(() => this.readControlsRaw());
    }
    /** Point one 0x1B04 control at another control the device says is legal. */
    async remapControl(controlId, targetControlId) {
        return this.serialized(async () => {
            const index = await this.getFeature(LOGITECH_FEATURE.reprogControls);
            if (!index)
                throw new Error("This Logitech keyboard does not expose 0x1B04 controls.");
            const controls = await this.readControlsRaw();
            const control = controls?.find((candidate) => candidate.controlId === controlId);
            if (!control)
                throw new Error(`Control 0x${controlId.toString(16)} is not present on this keyboard.`);
            if (!control.reprogrammable || !control.remappableTo.includes(targetControlId)) {
                throw new Error(`Control 0x${controlId.toString(16)} cannot be remapped to 0x${targetControlId.toString(16)}.`);
            }
            await this.requestMode(index, LOGITECH_REPROG_CONTROLS.setReporting, buildLogitechControlRemap(controlId, targetControlId), true);
            const after = await this.readControlsRaw();
            if (after?.find((candidate) => candidate.controlId === controlId)?.mappedTo !== targetControlId) {
                throw new Error("The Logitech keyboard did not confirm the control remap.");
            }
            return after;
        });
    }
    async readLegacyZonesRaw() {
        const index = await this.getFeature(LOGITECH_FEATURE.colorLedEffects);
        if (!index)
            return null;
        const info = decodeLogitechLegacyLightingInfo(await this.requestMode(index, 0x00, [0, 0, 0], false));
        if (!info)
            throw new Error("The Logitech keyboard returned an unreadable 0x8070 lighting header.");
        const zones = [];
        for (let zone = 0; zone < info.zoneCount; zone += 1) {
            const zoneInfo = decodeLogitechLegacyZoneInfo(await this.requestMode(index, 0x01, [zone, 0, 0], false), zone);
            if (!zoneInfo)
                throw new Error(`The Logitech keyboard returned an unreadable 0x8070 zone ${zone}.`);
            const effects = [];
            for (let ordinal = 0; ordinal < zoneInfo.effectCount; ordinal += 1) {
                const effect = decodeLogitechLegacyEffectInfo(await this.requestMode(index, 0x02, [zone, ordinal, 0], false), zone, ordinal);
                if (!effect)
                    throw new Error(`The Logitech keyboard returned an unreadable 0x8070 effect ${ordinal} in zone ${zone}.`);
                effects.push(effect);
            }
            zones.push({ index: zone, location: zoneInfo.location, effects });
        }
        return { zones, canReadEffect: info.canReadEffect };
    }
    /** Discover the 0x8070 LED zones and per-zone effect ordinals. */
    readLegacyZones() {
        return this.serialized(() => this.readLegacyZonesRaw());
    }
    async readLegacyZoneEffectRaw(zoneIndex, lighting) {
        if (!lighting.canReadEffect)
            throw new Error("This Logitech keyboard does not advertise 0x8070 effect read-back.");
        const zone = lighting.zones.find((candidate) => candidate.index === zoneIndex);
        if (!zone)
            throw new RangeError(`The Logitech keyboard does not advertise LED zone ${zoneIndex}.`);
        const index = await this.getFeature(LOGITECH_FEATURE.colorLedEffects);
        const actual = await this.requestMode(index, 0x0e, [zoneIndex, 0x00, 0x00], false);
        if (actual.length < 12 || actual[0] !== zoneIndex)
            throw new Error("The Logitech keyboard returned an unreadable 0x8070 RAM effect.");
        const effect = zone.effects.find((candidate) => candidate.index === actual[1]);
        if (!effect)
            throw new Error("The Logitech keyboard returned an unadvertised 0x8070 RAM effect.");
        return { zoneIndex, effectOrdinal: effect.index, effectId: effect.id, params: actual.slice(2, 12) };
    }
    /** Read the active 0x8070 RAM effect when the keyboard advertises fn 14. */
    readLegacyZoneEffect(zoneIndex) {
        return this.serialized(async () => {
            const lighting = await this.readLegacyZonesRaw();
            if (!lighting)
                throw new Error("This Logitech keyboard does not expose 0x8070 LED zones.");
            return this.readLegacyZoneEffectRaw(zoneIndex, lighting);
        });
    }
    /**
     * Apply a discovered 0x8070 effect with ten caller-supplied raw parameter bytes.
     * Effect-specific meanings beyond fixed colour are not specified here.
     * Persistence is always RAM-only; success requires a matching fn 14 read-back.
     */
    setLegacyZoneEffect(zoneIndex, effectId, params) {
        return this.serialized(async () => {
            if (params.length !== 10 || params.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
                throw new RangeError("A legacy zone effect requires exactly ten 8-bit parameter values.");
            }
            const lighting = await this.readLegacyZonesRaw();
            if (!lighting)
                throw new Error("This Logitech keyboard does not expose 0x8070 LED zones.");
            if (!lighting.canReadEffect)
                throw new Error("This Logitech keyboard does not advertise 0x8070 effect read-back.");
            const zone = lighting.zones.find((candidate) => candidate.index === zoneIndex);
            if (!zone)
                throw new RangeError(`The Logitech keyboard does not advertise LED zone ${zoneIndex}.`);
            const effect = zone.effects.find((candidate) => candidate.id === effectId);
            if (!effect)
                throw new Error(`LED zone ${zoneIndex} does not advertise ${effectId === 1 ? "a fixed-colour effect" : `effect 0x${effectId.toString(16)}`}.`);
            const index = await this.getFeature(LOGITECH_FEATURE.colorLedEffects);
            await this.requestMode(index, 0x03, [zoneIndex, effect.index, ...params, 0, 0, 0, 0], true);
            const actual = await this.readLegacyZoneEffectRaw(zoneIndex, lighting);
            if (actual.effectOrdinal !== effect.index || params.some((value, offset) => actual.params[offset] !== value)) {
                throw new Error("The Logitech keyboard did not confirm the 0x8070 RAM effect.");
            }
        });
    }
    /** Apply a volatile fixed colour to one discovered 0x8070 zone and verify the RAM effect. */
    setLegacyZoneColor(zoneIndex, red, green, blue) {
        return this.setLegacyZoneEffect(zoneIndex, 1, [red, green, blue, 0, 0, 0, 0, 0, 0, 0]);
    }
    async readRgbEffects() {
        const index = await this.getFeature(LOGITECH_FEATURE.rgbEffects);
        if (!index)
            return [];
        const info = await this.requestMode(index, 0x00, [0xff, 0xff, 0x00], false).catch(() => null);
        const clusterCount = info?.[2] ?? 0;
        const zones = [];
        for (let cluster = 0; cluster < clusterCount; cluster += 1) {
            const clusterInfo = await this.requestMode(index, 0x00, [cluster, 0xff, 0x00], false).catch(() => null);
            if (!clusterInfo)
                continue;
            const location = ((clusterInfo[2] ?? 0) << 8) | (clusterInfo[3] ?? 0);
            const effects = [];
            for (let effect = 0; effect < (clusterInfo[4] ?? 0); effect += 1) {
                const effectInfo = await this.requestMode(index, 0x00, [cluster, effect, 0x00], false).catch(() => null);
                if (!effectInfo)
                    continue;
                effects.push({
                    index: effect,
                    id: ((effectInfo[2] ?? 0) << 8) | (effectInfo[3] ?? 0),
                    period: ((effectInfo[6] ?? 0) << 8) | (effectInfo[7] ?? 0),
                });
            }
            if (effects.length)
                zones.push({ index: cluster, location, effects });
        }
        return zones;
    }
    /** Apply one 0x8071 effect to every cluster that advertises it. */
    async setRgbEffect(mode, color, speed = 5000) {
        return this.serialized(async () => {
            const index = await this.getFeature(LOGITECH_FEATURE.rgbEffects);
            if (!index)
                throw new Error("This Logitech keyboard does not expose 0x8071 RGB effects.");
            const zones = await this.readRgbEffects();
            if (!zones.length)
                throw new Error("The Logitech keyboard reported no RGB clusters.");
            for (const value of [color?.red ?? 0, color?.green ?? 0, color?.blue ?? 0]) {
                if (!Number.isInteger(value) || value < 0 || value > 255)
                    throw new RangeError("RGB channels must be whole numbers from 0 to 255.");
            }
            await this.requestMode(index, 0x05, [0x01, 0x01, 0x00], false).catch(() => undefined);
            let applied = 0;
            for (const zone of zones) {
                const effect = zone.effects.find((candidate) => logitechRgbMode(candidate.id) === mode);
                if (!effect)
                    continue;
                const params = new Array(10).fill(0);
                if (mode === "Static" || mode === "Breathing single") {
                    params[0] = color?.red ?? 0;
                    params[1] = color?.green ?? 0;
                    params[2] = color?.blue ?? 0;
                }
                if (mode === "Static")
                    params[3] = 0x02;
                if (mode === "Cycling") {
                    params[5] = (speed >> 8) & 0xff;
                    params[6] = speed & 0xff;
                    params[7] = 100;
                }
                if (mode === "Wave") {
                    params[6] = (speed >> 8) & 0xff;
                    params[7] = speed & 0xff;
                }
                if (mode === "Breathing single") {
                    params[3] = (speed >> 8) & 0xff;
                    params[4] = speed & 0xff;
                    params[6] = 100;
                }
                await this.requestMode(index, 0x01, [zone.index, effect.index, ...params, 0x01, 0x00, 0x00, 0x00], true);
                applied += 1;
            }
            if (!applied)
                throw new Error(`No Logitech RGB cluster advertises the ${mode} effect.`);
        });
    }
    async readLightingZones() {
        const index = await this.getFeature(LOGITECH_FEATURE.perKeyLightingV2);
        const legacy = await this.readLegacyZonesRaw().catch(() => null);
        if (!index && !legacy && !(await this.getFeature(LOGITECH_FEATURE.rgbEffects)))
            return null;
        const zones = [];
        if (index) {
            for (const page of [0, 1, 2]) {
                try {
                    const params = await this.requestMode(index, 0x00, [0x00, page, 0x00], true);
                    zones.push(...decodeLogitechZonePresence(params, page));
                }
                catch {
                    // A page the keyboard does not implement.
                }
            }
        }
        return {
            zones,
            rgbZones: await this.readRgbEffects().catch(() => []),
            legacyZones: legacy?.zones ?? [],
            legacyEffectReadback: legacy?.canReadEffect ?? false,
        };
    }
    /** Paint every present 0x8081 zone with one colour and commit the frame. */
    async setSolidColor(red, green, blue, persist = false) {
        return this.serialized(async () => {
            for (const value of [red, green, blue]) {
                if (!Number.isInteger(value) || value < 0 || value > 255)
                    throw new RangeError("RGB channels must be whole numbers from 0 to 255.");
            }
            const index = await this.getFeature(LOGITECH_FEATURE.perKeyLightingV2);
            if (!index)
                throw new Error("This Logitech keyboard does not expose 0x8081 per-key lighting.");
            const lighting = await this.readLightingZones();
            if (!lighting?.zones.length)
                throw new Error("The Logitech keyboard reported no addressable lighting zones.");
            const effects = await this.getFeature(LOGITECH_FEATURE.rgbEffects);
            if (effects)
                await this.requestMode(effects, 0x05, [0x01, 0x01, 0x00], false).catch(() => undefined);
            for (let offset = 0; offset < lighting.zones.length; offset += 13) {
                const chunk = lighting.zones.slice(offset, offset + 13);
                const response = await this.requestMode(index, 0x06, [red, green, blue, ...chunk], true);
                if ((response[3] ?? -1) !== chunk[0])
                    throw new Error("The Logitech keyboard did not acknowledge the per-key colour frame.");
            }
            await this.requestMode(index, 0x07, [persist ? 1 : 0, 0x00, 0x00, 0x00, 0x00, 0x00], true);
            return lighting;
        });
    }
    /** Stage distinct colours for advertised 0x8081 zones and commit one frame. */
    async setZoneColors(colors, persist = false) {
        return this.serialized(async () => {
            if (!colors.length)
                throw new RangeError("At least one zone colour is required.");
            const index = await this.getFeature(LOGITECH_FEATURE.perKeyLightingV2);
            if (!index)
                throw new Error("This Logitech keyboard does not expose 0x8081 per-key lighting.");
            const lighting = await this.readLightingZones();
            const available = new Set(lighting?.zones ?? []);
            const seen = new Set();
            for (const color of colors) {
                if (!Number.isInteger(color.zone) || color.zone <= 0 || color.zone >= 255 || !available.has(color.zone)) {
                    throw new RangeError(`The Logitech keyboard does not advertise lighting zone ${color.zone}.`);
                }
                if (seen.has(color.zone))
                    throw new RangeError(`Duplicate lighting zone ${color.zone}.`);
                seen.add(color.zone);
                for (const value of [color.red, color.green, color.blue]) {
                    if (!Number.isInteger(value) || value < 0 || value > 255)
                        throw new RangeError("RGB channels must be whole numbers from 0 to 255.");
                }
            }
            for (let offset = 0; offset < colors.length; offset += 4) {
                const chunk = colors.slice(offset, offset + 4);
                const frame = new Array(16).fill(0);
                chunk.forEach((color, slot) => frame.splice(slot * 4, 4, color.zone, color.red, color.green, color.blue));
                // fn 1 only acknowledges the setter; its reply carries no zone echo to compare.
                await this.requestMode(index, 0x01, frame, true);
            }
            await this.requestMode(index, 0x07, [persist ? 1 : 0, 0, 0, 0, 0], true);
        });
    }
    async readAnalog() {
        const index = await this.getFeature(LOGITECH_FEATURE.analogKeys);
        if (!index)
            return null;
        const capabilities = await this.requestMode(index, 0x00, [0x00, 0x00, 0x00], true).catch(() => null);
        const rapidTrigger = await this.requestMode(index, 0x01, [0x00, 0x00, 0x00], false)
            .then((params) => (params[0] ?? 0) !== 0)
            .catch(() => null);
        const keyPriority = await this.requestMode(index, 0x04, [0x00, 0x00, 0x00], false)
            .then((params) => (params[0] ?? 0) !== 0)
            .catch(() => null);
        return { rapidTrigger, keyPriority, capabilities };
    }
    /** Enable or disable the global rapid-trigger switch (0x1B08 function 2). */
    async setAnalogRapidTrigger(enabled) {
        return this.serialized(async () => {
            const index = await this.getFeature(LOGITECH_FEATURE.analogKeys);
            if (!index)
                throw new Error("This Logitech keyboard does not expose 0x1B08 analog keys.");
            await this.requestMode(index, 0x02, [enabled ? 1 : 0, 0x00, 0x00], false);
            const confirmed = await this.requestMode(index, 0x01, [0x00, 0x00, 0x00], false);
            if (((confirmed[0] ?? 0) !== 0) !== enabled)
                throw new Error("The Logitech keyboard did not confirm the rapid-trigger state.");
            return enabled;
        });
    }
    /** Enable or disable the global key-priority / Snap Tap switch (0x1B08 function 5). */
    async setAnalogKeyPriority(enabled) {
        return this.serialized(async () => {
            const index = await this.getFeature(LOGITECH_FEATURE.analogKeys);
            if (!index)
                throw new Error("This Logitech keyboard does not expose 0x1B08 analog keys.");
            await this.requestMode(index, 0x05, [enabled ? 1 : 0, 0x00, 0x00], false);
            const confirmed = await this.requestMode(index, 0x04, [0x00, 0x00, 0x00], false);
            if (((confirmed[0] ?? 0) !== 0) !== enabled)
                throw new Error("The Logitech keyboard did not confirm the key-priority state.");
            return enabled;
        });
    }
    /** Start or stop key-travel events (0x1B08 function 3). There is no read-back function. */
    async setKeyTravelEvents(enabled) {
        return this.serialized(async () => {
            const index = await this.getFeature(LOGITECH_FEATURE.analogKeys);
            if (!index)
                throw new Error("This Logitech keyboard does not expose 0x1B08 analog keys.");
            await this.requestMode(index, 0x03, [enabled ? 1 : 0, 0x00, 0x00], false);
            return enabled;
        });
    }
    readStatus() {
        return this.serialized(async () => {
            await this.open();
            const { device, firmware, serial } = await this.readDeviceInformation();
            const battery = await this.readBattery().catch(() => null);
            const polling = await this.readPollingRate().catch(() => ({ hz: null, supported: [] }));
            const brightness = await this.readBrightness().catch(() => null);
            const analog = await this.readAnalog().catch(() => null);
            const lighting = await this.readLightingZones().catch(() => null);
            const productId = this.keyboardProductId ?? this.device.productId;
            const product = LOGITECH_KEYBOARD_PRODUCTS.get(productId);
            if (!product)
                throw new Error("The Logitech device did not identify a catalogued keyboard.");
            const wireless = this.receiver || (device.transport.length ? !device.transport.includes("USB") : product.wireless);
            const lines = [];
            if (firmware)
                lines.push(`Firmware: ${firmware}`);
            if (serial)
                lines.push(`Serial: ${serial}`);
            if (device.transport.length)
                lines.push(`Transport: ${device.transport.join(", ")}`);
            if (this.receiver)
                lines.push(`Receiver: ${this.device.productName}`);
            const state = {
                productId,
                receiverProductId: this.receiver ? this.device.productId : null,
                unitId: device.unitId || null,
                serial,
                transport: device.transport,
                modelIds: device.modelIds,
                firmware,
                battery,
                pollingRateHz: polling.hz,
                supportedPollingRates: polling.supported,
                brightness,
                analog,
                lighting,
                controls: null,
                wireless,
                verified: product.verified,
            };
            return {
                brand: "Logitech",
                name: product.name,
                ui: {
                    family: "logitech",
                    settingsReady: false,
                    defaultDisplayName: product.name,
                    statusNote: product.verified ? undefined : "HID++ support is transcribed from Logitech's public documentation and G HUB's catalog; this model has not been tested through OpenMouse.",
                },
                connectionType: wireless ? "Wireless" : "Wired",
                connectionDetail: wireless ? "LIGHTSPEED / Bluetooth" : "USB",
                firmware: lines,
                firmwareVersion: firmware,
                layout: null,
                serial,
                activeProfile: null,
                profileCount: null,
                profileNames: [],
                logitech: state,
            };
        });
    }
}
