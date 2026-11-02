import { WLMOUSE_MAX_POLLING_HZ, WLMOUSE_PRODUCTS } from "../vendors.js";
import { COMPX_HEADER_LENGTH as HEADER_LENGTH, COMPX_PACKET_LENGTH as PACKET_LENGTH, COMPX_REPORT_ID as REPORT_ID, COMPX_STATUS as STATUS, compaxDecodeDpiStages, compaxDecodeFirmware, compaxDecodeLiftOff, compaxDecodePollingRate, compaxDecodeSleep, compaxEncodeRequest, WLMOUSE_POLLING_RATES as POLLING_RATES, WLMOUSE_VENDOR_ID, } from "../../wlmouse/index.js";
export { WLMOUSE_VENDOR_ID };
// Beast X 4K (0xa887) exposes the same HID descriptor shape as the other Beast X
// variants (including a feature report at COMPX_REPORT_ID), so isSupported() below
// would otherwise match it — but its firmware never answers the compx page/command
// protocol: every request times out on all interface splits. Confirmed via community
// report (Windows + Fedora, product 36a7:a887). It speaks a report-4 protocol instead,
// handled by WLMouseBeastX4kHidClient (beast-x-4k-hid.ts).
const DESKTOP_SOFTWARE_ONLY_PRODUCTS = new Set([0xa887]);
const RESPONSE_ATTEMPTS = 12;
const RESPONSE_DELAY_MS = 30;
const WAKE_DELAY_MS = 300;
const QUICK_ATTEMPTS = 3;
const FRAME_OFFSETS = [0, 1];
const SLEEP_DISABLED = 0xffff;
const SLEEP_DISABLED_MIN = 0xff00;
const DPI_STEP = 50;
const DPI_MAX = 30000;
const TARGET = {
    dongle: 0x00,
    // The receiver answers for the mouse it is paired with on its own target,
    // separate from the pass-through that reaches the mouse itself.
    pairing: 0x01,
    mouse: 0x02,
};
const PAGE = {
    device: 0x00,
    profile: 0x01,
    buttons: 0x03,
};
const LIFT_OFF_DISTANCES = [
    [0x87, "Low"],
    [0x01, "Medium"],
    [0x02, "High"],
];
const READ = {
    firmware: { target: TARGET.mouse, page: PAGE.device, command: 0x81, length: 0x10, args: [] },
    dongleFirmware: { target: TARGET.dongle, page: PAGE.device, command: 0x81, length: 0x10, args: [], attempts: 2 },
    serial: { target: TARGET.mouse, page: PAGE.device, command: 0x82, length: 0x02, args: [] },
    battery: { target: TARGET.mouse, page: PAGE.device, command: 0x83, length: 0x02, args: [] },
    activeProfile: { target: TARGET.mouse, page: PAGE.device, command: 0x85, length: 0x01, args: [] },
    // Product id of the mouse currently paired to the receiver, big-endian in the
    // last two payload bytes. The shared 1K dongle enumerates under one product
    // id whatever it is paired with, so this is the only way to know the model.
    pairedProduct: { target: TARGET.pairing, page: PAGE.device, command: 0x8b, length: 0x06, args: [0x02], attempts: 2 },
};
const PROFILE_READ = {
    sleepTimeout: (profile) => ({ target: TARGET.mouse, page: PAGE.device, command: 0x87, length: 0x03, args: [profile] }),
    debounce: (profile) => ({ target: TARGET.mouse, page: PAGE.device, command: 0x88, length: 0x02, args: [profile] }),
    dpiStages: (profile) => ({ target: TARGET.mouse, page: PAGE.profile, command: 0x81, length: 0x0a, args: [profile, DPI_STAGE_MAX] }),
    activeStage: (profile) => ({ target: TARGET.mouse, page: PAGE.profile, command: 0x82, length: 0x02, args: [profile] }),
    pollingRate: (profile) => ({ target: TARGET.mouse, page: PAGE.profile, command: 0x80, length: 0x02, args: [profile] }),
    liftOffDistance: (profile) => ({ target: TARGET.mouse, page: PAGE.profile, command: 0x88, length: 0x02, args: [profile] }),
    separateAxes: (profile) => ({ target: TARGET.mouse, page: PAGE.profile, command: 0x8d, length: 0x02, args: [profile] }),
    angleSnapping: (profile) => ({ target: TARGET.mouse, page: PAGE.profile, command: 0x84, length: 0x02, args: [profile] }),
    motionSync: (profile) => ({ target: TARGET.mouse, page: PAGE.profile, command: 0x89, length: 0x02, args: [profile] }),
    rippleControl: (profile) => ({ target: TARGET.mouse, page: PAGE.profile, command: 0x8a, length: 0x02, args: [profile] }),
    hyperMode: (profile) => ({ target: TARGET.mouse, page: PAGE.profile, command: 0x8b, length: 0x02, args: [profile] }),
    turboMode: (profile) => ({ target: TARGET.mouse, page: PAGE.profile, command: 0x93, length: 0x02, args: [profile] }),
    angleTuning: (profile) => ({ target: TARGET.mouse, page: PAGE.profile, command: 0x94, length: 0x02, args: [profile] }),
    buttonCombination: (profile) => ({ target: TARGET.mouse, page: PAGE.buttons, command: 0x81, length: 0x02, args: [profile] }),
};
const WRITE = {
    dpiStages: 0x01,
    activeStage: 0x02,
    pollingRate: 0x00,
    liftOffDistance: 0x08,
    sleepTimeout: 0x07,
    debounce: 0x08,
    angleSnapping: 0x04,
    motionSync: 0x09,
    rippleControl: 0x0a,
    hyperMode: 0x0b,
    turboMode: 0x13,
    angleTuning: 0x14,
    buttonCombination: 0x01,
};
const DPI_STAGE_MAX = 6;
const ANGLE_TUNING_LIMIT = 30;
const DEBOUNCE_MAX_MS = 15;
const SLEEP_SECONDS = [30, 60, 120, 300, 600, 1800];
const NOTIFY_REPORT_ID = 4;
const NOTIFY_DEBOUNCE_MS = 200;
const NOTIFY_KINDS = new Set([0x03, 0x06, 0x08]);
export class WLMouseHidClient {
    canDisableSleep = true;
    queue = Promise.resolve();
    staticReads = new Map();
    lastStatus = null;
    notifier = null;
    notifyListener = null;
    activeProfile = 1;
    pairedProductId = null;
    device;
    constructor(device) {
        this.device = device;
    }
    static isSupported(device) {
        return device.vendorId === WLMOUSE_VENDOR_ID
            && !DESKTOP_SOFTWARE_ONLY_PRODUCTS.has(device.productId)
            && device.collections.some((collection) => this.hasConfigReport(collection));
    }
    static hasConfigReport(collection) {
        return collection.featureReports.some((report) => report.reportId === REPORT_ID)
            || collection.children.some((child) => this.hasConfigReport(child));
    }
    async open() {
        if (!this.device.opened)
            await this.device.open();
    }
    async close() {
        this.staticReads.clear();
        this.lastStatus = null;
        if (this.notifier && this.notifyListener) {
            this.notifier.removeEventListener("inputreport", this.notifyListener);
            if (this.notifier.opened)
                await this.notifier.close();
        }
        this.notifier = null;
        this.notifyListener = null;
        if (this.device.opened)
            await this.device.close();
    }
    async startNotifications(onChange) {
        if (this.notifier)
            return true;
        const devices = await navigator.hid?.getDevices() ?? [];
        const sibling = devices.find((candidate) => candidate !== this.device
            && candidate.vendorId === this.device.vendorId
            && candidate.productId === this.device.productId
            && candidate.collections.some((collection) => collection.inputReports.some((report) => report.reportId === NOTIFY_REPORT_ID)));
        if (!sibling)
            return false;
        if (!sibling.opened)
            await sibling.open();
        let timer = null;
        this.notifyListener = (event) => {
            if (event.reportId !== NOTIFY_REPORT_ID || !NOTIFY_KINDS.has(event.data.getUint8(0)))
                return;
            if (timer !== null)
                window.clearTimeout(timer);
            timer = window.setTimeout(() => {
                timer = null;
                onChange();
            }, NOTIFY_DEBOUNCE_MS);
        };
        sibling.addEventListener("inputreport", this.notifyListener);
        this.notifier = sibling;
        return true;
    }
    once(key, read) {
        const pending = this.staticReads.get(key);
        if (pending)
            return pending;
        const started = read();
        this.staticReads.set(key, started);
        started.catch(() => this.staticReads.delete(key));
        return started;
    }
    displayName() {
        const known = WLMOUSE_PRODUCTS.get(this.pairedProductId ?? this.device.productId);
        if (!known)
            return this.device.productName || "WLmouse";
        // The shared-receiver entries already carry the brand in their name.
        return known.name.startsWith("WLmouse") ? known.name : `WLmouse ${known.name}`;
    }
    getSleepOptions() {
        return SLEEP_SECONDS;
    }
    getDebounceMaxMs() {
        return DEBOUNCE_MAX_MS;
    }
    maxPollingRateHz() {
        const known = WLMOUSE_MAX_POLLING_HZ.get(this.device.productId);
        if (known !== undefined)
            return known;
        const marker = /(\d+)\s*K\b/i.exec(this.device.productName || "");
        return marker ? Number(marker[1]) * 1000 : null;
    }
    getSupportedPollingRates() {
        const rates = [...new Set(POLLING_RATES.map(([, hertz]) => hertz))].sort((left, right) => left - right);
        const max = this.maxPollingRateHz();
        return max === null ? rates : rates.filter((rate) => rate <= max);
    }
    getDpiOptions() {
        const options = [];
        for (let dpi = DPI_STEP; dpi <= DPI_MAX; dpi += DPI_STEP)
            options.push(dpi);
        return options;
    }
    isWireless() {
        const known = WLMOUSE_PRODUCTS.get(this.device.productId);
        if (known)
            return known.wireless;
        return /receiver|dongle/i.test(this.device.productName || "");
    }
    async readStatus(live = false) {
        await this.open();
        if (live && this.lastStatus)
            return await this.readLiveStatus(this.lastStatus);
        const wireless = this.isWireless();
        const firmware = await this.once("firmware", () => this.request(READ.firmware));
        if (!firmware)
            throw new Error("The mouse did not report a firmware version.");
        const dongleFirmware = await this.once("dongleFirmware", () => wireless ? this.request(READ.dongleFirmware).catch(() => null) : Promise.resolve(null));
        const serial = await this.once("serial", () => this.request(READ.serial).catch(() => null));
        const battery = await this.request(READ.battery);
        // Profile-page commands must address the profile the mouse is actually
        // running, not a fixed slot: writing to profile 1 is silently ignored when
        // a different onboard profile is active.
        const activeProfileReply = await this.request(READ.activeProfile).catch(() => null);
        const profile = activeProfileReply ? Math.max(1, activeProfileReply[0]) : 1;
        this.activeProfile = profile;
        const sleepTimeout = await this.request(PROFILE_READ.sleepTimeout(profile)).catch(() => null);
        const debounce = await this.request(PROFILE_READ.debounce(profile)).catch(() => null);
        const stages = this.decodeDpiStages(await this.request(PROFILE_READ.dpiStages(profile)));
        const activeStage = this.stageIndex((await this.request(PROFILE_READ.activeStage(profile)))[1], stages.length);
        const pollingRate = await this.request(PROFILE_READ.pollingRate(profile));
        const liftOffDistance = await this.request(PROFILE_READ.liftOffDistance(profile));
        const separateAxes = await this.request(PROFILE_READ.separateAxes(profile)).catch(() => null);
        const angleSnapping = await this.request(PROFILE_READ.angleSnapping(profile)).catch(() => null);
        const motionSync = await this.request(PROFILE_READ.motionSync(profile)).catch(() => null);
        const rippleControl = await this.request(PROFILE_READ.rippleControl(profile)).catch(() => null);
        // Not every model has these, and one that does not answers `unsupported`
        // rather than failing the read, so null here means "no such control".
        const hyperMode = await this.request(PROFILE_READ.hyperMode(profile)).catch(() => null);
        const turboMode = await this.request(PROFILE_READ.turboMode(profile)).catch(() => null);
        const angleTuning = await this.request(PROFILE_READ.angleTuning(profile)).catch(() => null);
        const buttonCombination = await this.request(PROFILE_READ.buttonCombination(profile)).catch(() => null);
        if (wireless)
            await this.readPairedProduct();
        const stage = stages[activeStage];
        if (!stage)
            throw new Error("The mouse did not report any DPI stages.");
        return this.lastStatus = {
            brand: "WLMouse",
            name: this.displayName(),
            ui: {
                family: "wlmouse",
                hideUnsupportedPollingRates: true,
                forceShowBattery: true,
                dpiStageEditor: {
                    maxStages: DPI_STAGE_MAX,
                    countEditable: true,
                    minDpi: DPI_STEP,
                    maxDpi: DPI_MAX,
                    stepDpi: DPI_STEP,
                },
            },
            batteryPercent: battery[1] <= 100 ? battery[1] : null,
            batteryState: battery[0] === 1 ? "Charging" : "Discharging",
            dpi: stage.x,
            dpiY: stage.y,
            dpiStages: stages.map((entry) => entry.x),
            activeDpiStage: activeStage,
            supportsSeparateDpiAxes: separateAxes ? separateAxes[1] === 1 : false,
            pollingRateHz: this.decodePollingRate(pollingRate[1]),
            supportedPollingRates: this.getSupportedPollingRates(),
            activeProfile: activeProfileReply ? activeProfileReply[0] : null,
            angleSnapping: angleSnapping ? angleSnapping[1] === 1 : null,
            motionSync: motionSync ? motionSync[1] === 1 : null,
            rippleControl: rippleControl ? rippleControl[1] === 1 : null,
            hyperMode: hyperMode ? hyperMode[1] === 1 : null,
            turboMode: turboMode ? turboMode[1] === 1 : null,
            buttonCombination: buttonCombination ? buttonCombination[1] === 1 : null,
            angleTuning: angleTuning ? this.decodeAngleTuning(angleTuning[1]) : null,
            connectionType: wireless ? "Wireless" : "Wired",
            connectionDetail: wireless ? "2.4 GHz receiver" : "Wired USB",
            unitId: this.decodeText(serial),
            debounceMs: debounce ? debounce[1] : null,
            sleepTimeout: this.decodeSleepTimeout(sleepTimeout),
            liftOffDistance: this.decodeLiftOffDistance(liftOffDistance[1]),
            firmware: dongleFirmware
                ? [this.decodeFirmware("Mouse", firmware), this.decodeFirmware("Dongle", dongleFirmware)]
                : [this.decodeFirmware("Mouse", firmware)],
        };
    }
    async readLiveStatus(previous) {
        const battery = await this.request(READ.battery);
        const pollingRate = await this.request(PROFILE_READ.pollingRate(this.activeProfile));
        return this.lastStatus = {
            ...previous,
            batteryPercent: battery[1] <= 100 ? battery[1] : null,
            batteryState: battery[0] === 1 ? "Charging" : "Discharging",
            pollingRateHz: this.decodePollingRate(pollingRate[1]),
        };
    }
    async setPollingRate(pollingRateHz) {
        const encoded = POLLING_RATES.find(([, hertz]) => hertz === pollingRateHz);
        if (!encoded || !this.getSupportedPollingRates().includes(pollingRateHz)) {
            throw new Error(`This mouse does not support ${pollingRateHz} Hz.`);
        }
        const profile = await this.currentProfile();
        await this.write(PAGE.profile, WRITE.pollingRate, profile, [encoded[0]]);
        const confirmed = this.decodePollingRate((await this.request(PROFILE_READ.pollingRate(profile)))[1]);
        if (confirmed !== pollingRateHz) {
            throw new Error(`The mouse kept ${confirmed} Hz instead of ${pollingRateHz} Hz.`);
        }
        this.patch({ pollingRateHz: confirmed });
        return confirmed;
    }
    async setLiftOffDistance(value) {
        const encoded = LIFT_OFF_DISTANCES.find(([, name]) => name === value);
        if (!encoded)
            throw new Error(`This mouse does not support a ${value.toLowerCase()} lift-off distance.`);
        const profile = await this.currentProfile();
        await this.write(PAGE.profile, WRITE.liftOffDistance, profile, [encoded[0]]);
        const confirmed = this.decodeLiftOffDistance((await this.request(PROFILE_READ.liftOffDistance(profile)))[1]);
        if (confirmed !== value) {
            throw new Error(`The mouse kept a ${String(confirmed).toLowerCase()} lift-off distance instead of ${value.toLowerCase()}.`);
        }
        this.patch({ liftOffDistance: confirmed });
        return confirmed;
    }
    async setAngleSnapping(enabled) {
        return await this.setFlag(WRITE.angleSnapping, PROFILE_READ.angleSnapping, enabled, "angleSnapping", "angle snapping");
    }
    async setMotionSync(enabled) {
        return await this.setFlag(WRITE.motionSync, PROFILE_READ.motionSync, enabled, "motionSync", "Motion Sync");
    }
    async setRippleControl(enabled) {
        return await this.setFlag(WRITE.rippleControl, PROFILE_READ.rippleControl, enabled, "rippleControl", "ripple control");
    }
    async setHyperMode(enabled) {
        return await this.setFlag(WRITE.hyperMode, PROFILE_READ.hyperMode, enabled, "hyperMode", "high-speed mode");
    }
    /**
     * Turbo mode pins the sensor at 20K FPS. The mouse only runs it with
     * high-speed mode on, so a turbo write can read back off until that is set.
     */
    async setTurboMode(enabled) {
        return await this.setFlag(WRITE.turboMode, PROFILE_READ.turboMode, enabled, "turboMode", "turbo mode");
    }
    async setButtonCombination(enabled) {
        return await this.setFlag(WRITE.buttonCombination, PROFILE_READ.buttonCombination, enabled, "buttonCombination", "button combinations", PAGE.buttons);
    }
    async setAngleTuning(degrees) {
        if (!Number.isInteger(degrees) || Math.abs(degrees) > ANGLE_TUNING_LIMIT) {
            throw new Error(`The sensor angle must be a whole number of degrees between -${ANGLE_TUNING_LIMIT} and ${ANGLE_TUNING_LIMIT}.`);
        }
        const profile = await this.currentProfile();
        // A negative angle goes on the wire as two's complement in one byte.
        await this.write(PAGE.profile, WRITE.angleTuning, profile, [degrees & 0xff]);
        const confirmed = this.decodeAngleTuning((await this.request(PROFILE_READ.angleTuning(profile)))[1]);
        if (confirmed !== degrees) {
            throw new Error(`The mouse kept a ${confirmed}° sensor angle instead of ${degrees}°.`);
        }
        this.patch({ angleTuning: confirmed });
        return confirmed;
    }
    async setFlag(command, read, enabled, field, label, page = PAGE.profile) {
        const profile = await this.currentProfile();
        await this.write(page, command, profile, [enabled ? 1 : 0]);
        const confirmed = (await this.request(read(profile)))[1] === 1;
        if (confirmed !== enabled) {
            throw new Error(`The mouse left ${label} ${confirmed ? "on" : "off"}.`);
        }
        this.patch({ [field]: confirmed });
        return confirmed;
    }
    async setDebounceTime(milliseconds) {
        if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > DEBOUNCE_MAX_MS) {
            throw new Error(`Debounce must be a whole number of milliseconds between 0 and ${DEBOUNCE_MAX_MS}.`);
        }
        const profile = await this.currentProfile();
        await this.write(PAGE.device, WRITE.debounce, profile, [milliseconds]);
        const confirmed = (await this.request(PROFILE_READ.debounce(profile)))[1];
        if (confirmed !== milliseconds) {
            throw new Error(`The mouse kept ${confirmed} ms of debounce instead of ${milliseconds} ms.`);
        }
        this.patch({ debounceMs: confirmed });
        return confirmed;
    }
    async setSleepTimeout(seconds) {
        if (!Number.isInteger(seconds) || seconds < 0 || seconds > SLEEP_DISABLED) {
            throw new Error(`The sleep timeout must be a whole number of seconds between 0 and ${SLEEP_DISABLED}.`);
        }
        const profile = await this.currentProfile();
        await this.write(PAGE.device, WRITE.sleepTimeout, profile, [seconds >> 8 & 0xff, seconds & 0xff]);
        const reply = await this.request(PROFILE_READ.sleepTimeout(profile));
        const confirmed = (reply[1] << 8) | reply[2];
        if (confirmed !== seconds) {
            throw new Error(`The mouse kept a ${confirmed} second sleep timeout instead of ${seconds} seconds.`);
        }
        this.patch({ sleepTimeout: this.decodeSleepTimeout(reply) });
        return confirmed;
    }
    async setDpi(dpi, dpiY = dpi) {
        this.assertDpi(dpi);
        this.assertDpi(dpiY);
        const profile = await this.currentProfile();
        const stages = await this.readStages(profile);
        const active = this.stageIndex((await this.request(PROFILE_READ.activeStage(profile)))[1], stages.length);
        if (!stages[active])
            throw new Error("The mouse did not report any DPI stages.");
        stages[active] = { x: dpi, y: dpiY };
        const confirmed = (await this.writeStages(profile, stages))[active];
        if (!confirmed || confirmed.x !== dpi || confirmed.y !== dpiY) {
            throw new Error(`The mouse kept ${confirmed ? confirmed.x.toLocaleString() : "an unknown"} DPI instead of ${dpi.toLocaleString()}.`);
        }
        return confirmed.x;
    }
    async setDpiStageValue(stage, dpi) {
        this.assertDpi(dpi);
        const profile = await this.currentProfile();
        const stages = await this.readStages(profile);
        const entry = stages[stage];
        if (!entry)
            throw new Error(`This mouse does not have a DPI stage ${stage + 1}.`);
        // A Y that already differs is the mouse's separate-axis setting, and the
        // shared stage editor only shows one value per stage: changing X must not
        // silently flatten it.
        stages[stage] = { x: dpi, y: entry.y === entry.x ? dpi : entry.y };
        const confirmed = (await this.writeStages(profile, stages))[stage];
        if (!confirmed || confirmed.x !== dpi) {
            throw new Error(`The mouse kept ${confirmed ? confirmed.x.toLocaleString() : "an unknown"} DPI on stage ${stage + 1} instead of ${dpi.toLocaleString()}.`);
        }
        return confirmed.x;
    }
    async setDpiStageCount(count) {
        if (!Number.isInteger(count) || count < 1 || count > DPI_STAGE_MAX) {
            throw new Error(`This mouse holds between 1 and ${DPI_STAGE_MAX} DPI stages.`);
        }
        const profile = await this.currentProfile();
        const stages = await this.readStages(profile);
        const last = stages[stages.length - 1];
        if (!last)
            throw new Error("The mouse did not report any DPI stages.");
        const next = stages.slice(0, count);
        while (next.length < count)
            next.push({ ...last });
        const confirmed = await this.writeStages(profile, next);
        if (confirmed.length !== count) {
            throw new Error(`The mouse kept ${confirmed.length} DPI stages instead of ${count}.`);
        }
        return count;
    }
    async setActiveDpiStage(stage) {
        const profile = await this.currentProfile();
        const stages = await this.readStages(profile);
        if (!stages[stage])
            throw new Error(`This mouse does not have a DPI stage ${stage + 1}.`);
        await this.write(PAGE.profile, WRITE.activeStage, profile, [stage + 1]);
        const reply = await this.request(PROFILE_READ.activeStage(profile));
        const confirmed = this.stageIndex(reply[1], stages.length);
        if (confirmed !== stage) {
            throw new Error(`The mouse stayed on DPI stage ${confirmed + 1} instead of ${stage + 1}.`);
        }
        this.patchStages(stages, confirmed);
        return confirmed;
    }
    assertDpi(value) {
        if (!Number.isInteger(value) || value < DPI_STEP || value > DPI_MAX || value % DPI_STEP !== 0) {
            throw new Error(`${value.toLocaleString()} is not a supported DPI value.`);
        }
    }
    async readStages(profile) {
        return this.decodeDpiStages(await this.request(PROFILE_READ.dpiStages(profile)));
    }
    /** Writes the whole table back, since the mouse takes count and stages as one packet. */
    async writeStages(profile, stages) {
        await this.write(PAGE.profile, WRITE.dpiStages, profile, [
            stages.length,
            ...stages.flatMap((stage) => [stage.x >> 8 & 0xff, stage.x & 0xff, stage.y >> 8 & 0xff, stage.y & 0xff]),
        ]);
        const confirmed = await this.readStages(profile);
        this.patchStages(confirmed);
        return confirmed;
    }
    patchStages(stages, activeStage) {
        const active = Math.min(activeStage ?? this.lastStatus?.activeDpiStage ?? 0, stages.length - 1);
        const entry = stages[active];
        this.patch({
            dpiStages: stages.map((stage) => stage.x),
            activeDpiStage: Math.max(active, 0),
            ...(entry ? { dpi: entry.x, dpiY: entry.y } : {}),
        });
    }
    async currentProfile() {
        const reply = await this.request(READ.activeProfile);
        this.activeProfile = Math.max(1, reply[0]);
        return this.activeProfile;
    }
    async write(page, command, profile, values) {
        const args = [profile, ...values];
        await this.request({ target: TARGET.mouse, page, command, length: args.length, args });
    }
    patch(changes) {
        if (this.lastStatus)
            this.lastStatus = { ...this.lastStatus, ...changes };
    }
    stageIndex(reported, count) {
        return Math.min(Math.max(reported, 1), Math.max(count, 1)) - 1;
    }
    async request(spec) {
        const run = this.queue.then(() => this.exchange(spec), () => this.exchange(spec));
        this.queue = run.catch(() => undefined);
        return await run;
    }
    async exchange(spec) {
        await this.open();
        const packet = compaxEncodeRequest(spec);
        const attempts = spec.attempts ?? RESPONSE_ATTEMPTS;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            await this.device.sendFeatureReport(REPORT_ID, packet);
            await this.delay(RESPONSE_DELAY_MS);
            const reply = this.copyDataView(await this.device.receiveFeatureReport(REPORT_ID));
            for (const offset of FRAME_OFFSETS) {
                if (reply[4 + offset] !== spec.page || reply[5 + offset] !== spec.command)
                    continue;
                if (reply[offset] === STATUS.unsupported)
                    throw new Error(this.describe(spec, "is not supported by this mouse"));
                if (reply[offset] !== STATUS.ok)
                    continue;
                const start = HEADER_LENGTH + offset;
                return reply.slice(start, start + Math.min(reply[3 + offset], PACKET_LENGTH - start));
            }
            await this.delay(attempt < QUICK_ATTEMPTS ? RESPONSE_DELAY_MS : WAKE_DELAY_MS);
        }
        throw new Error(this.describe(spec, "got no answer, the mouse may be asleep or out of range"));
    }
    describe(spec, problem) {
        const hex = (value) => `0x${value.toString(16).padStart(2, "0")}`;
        return `Page ${hex(spec.page)} command ${hex(spec.command)} ${problem}.`;
    }
    decodeDpiStages(payload) {
        return compaxDecodeDpiStages(payload);
    }
    decodePollingRate(value) {
        return compaxDecodePollingRate(POLLING_RATES, value);
    }
    decodeLiftOffDistance(value) {
        return compaxDecodeLiftOff(value);
    }
    /** Sensor angle in degrees, sent as a signed byte. */
    decodeAngleTuning(value) {
        return value > 0x7f ? value - 0x100 : value;
    }
    /**
     * Names the mouse behind a receiver. The 1K dongle enumerates under a single
     * product id whichever model it is paired with, so without this every mouse
     * on it reports as "WLmouse 1K receiver".
     */
    async readPairedProduct() {
        const reply = await this.once("pairedProduct", () => this.request(READ.pairedProduct).catch(() => null));
        if (!reply || reply.length < 6)
            return;
        const productId = (reply[4] << 8) | reply[5];
        if (WLMOUSE_PRODUCTS.has(productId))
            this.pairedProductId = productId;
    }
    decodeSleepTimeout(payload) {
        return compaxDecodeSleep(payload, SLEEP_DISABLED_MIN);
    }
    decodeFirmware(label, payload) {
        return compaxDecodeFirmware(label, payload);
    }
    decodeText(payload) {
        if (!payload)
            return null;
        const text = [...payload]
            .filter((byte) => byte >= 0x20 && byte <= 0x7e)
            .map((byte) => String.fromCharCode(byte))
            .join("")
            .trim();
        return text || null;
    }
    copyDataView(view) {
        return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    }
    delay(milliseconds) {
        return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
    }
}
