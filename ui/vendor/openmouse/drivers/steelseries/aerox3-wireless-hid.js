import { AEROX3_WIRELESS_DEFAULT_BUTTONS, AEROX3_WIRELESS_DEFAULT_DIM_TIMER_SECONDS, AEROX3_WIRELESS_DEFAULT_DPI_PRESETS, AEROX3_WIRELESS_DEFAULT_POLLING_RATE, AEROX3_WIRELESS_DEFAULT_SLEEP_TIMER_MINUTES, AEROX3_WIRELESS_DEFAULT_ZONE_COLORS, AEROX3_WIRELESS_DPI_MAX, AEROX3_WIRELESS_DPI_MIN, AEROX3_WIRELESS_DPI_STEP, AEROX3_WIRELESS_MAX_DPI_PRESETS, AEROX3_WIRELESS_MULTIMEDIA_KEYS, AEROX3_WIRELESS_POLLING_RATES, AEROX3_WIRELESS_REPORT_ID, AEROX3_WIRELESS_SLEEP_TIMER_MAX_MINUTES, AEROX3_WIRELESS_ZONES, STEELSERIES_PRODUCTS, STEELSERIES_VENDOR_ID, steelseriesAerox3WirelessBatteryQuery, steelseriesAerox3WirelessDecodeBattery, steelseriesAerox3WirelessDpiOptions, steelseriesAerox3WirelessEncodeButtonsMapping, steelseriesAerox3WirelessEncodeDefaultLighting, steelseriesAerox3WirelessEncodeDimTimer, steelseriesAerox3WirelessEncodeDpiPresets, steelseriesAerox3WirelessEncodePollingRate, steelseriesAerox3WirelessEncodeReactiveColor, steelseriesAerox3WirelessEncodeSleepTimer, steelseriesAerox3WirelessEncodeZoneColor, steelseriesAerox3WirelessSaveCommand, } from "../../steelseries/index.js";
/** rivalcfg's `command_approve_delay`. */
const COMMAND_DELAY_MS = 50;
const RESPONSE_TIMEOUT_MS = 500;
/** rivalcfg waits this long for the 2.4 ghz readback after every write. */
const WIRELESS_READBACK_TIMEOUT_MS = 200;
const CONFIG_USAGE_PAGE = 0xffc0;
const CONFIG_USAGE = 0x01;
/** the only collection with a 64-byte output report, the others refuse writes. */
function hasConfigCollection(collections) {
    return collections.some((collection) => (collection.usagePage === CONFIG_USAGE_PAGE && collection.usage === CONFIG_USAGE)
        || hasConfigCollection(collection.children ?? []));
}
/**
 * the dongle answers `40 FF 01` in place of the mouse while the mouse sleeps or
 * is out of range. it also sends it once right after a polling rate change.
 */
function isMouseUnreachableEvent(payload) {
    return payload[0] === 0x40 && payload[1] === 0xff;
}
/** the 2.4 ghz dongle pids, every other aerox 3 wireless pid is the usb cable. */
const WIRELESS_MODE_PRODUCT_IDS = new Set([0x1838, 0x1878]);
const ZONE_LABELS = { 1: "Top", 2: "Middle", 3: "Bottom" };
const REACTIVE_ZONE = "Click reaction";
const ZONE_MODES = ["Static", "Off"];
const REACTIVE_MODES = ["Reactive", "Off"];
const BUTTON_LABELS = {
    button1: "Left",
    button2: "Right",
    button3: "Middle",
    button4: "Back",
    button5: "Forward",
    button6: "DPI",
    scrollUp: "Scroll Up",
    scrollDown: "Scroll Down",
};
const ACTION_LABELS = [
    ["Left Click", { type: "button", target: "button1" }],
    ["Right Click", { type: "button", target: "button2" }],
    ["Middle Click", { type: "button", target: "button3" }],
    ["Back", { type: "button", target: "button4" }],
    ["Forward", { type: "button", target: "button5" }],
    ["Scroll Up", { type: "button", target: "scrollUp" }],
    ["Scroll Down", { type: "button", target: "scrollDown" }],
    ["DPI Cycle", { type: "dpiSwitch" }],
    ["Disabled", { type: "disabled" }],
    ["Mute", { type: "multimedia", code: AEROX3_WIRELESS_MULTIMEDIA_KEYS.mute }],
    ["Play/Pause", { type: "multimedia", code: AEROX3_WIRELESS_MULTIMEDIA_KEYS.playPause }],
    ["Next Track", { type: "multimedia", code: AEROX3_WIRELESS_MULTIMEDIA_KEYS.next }],
    ["Previous Track", { type: "multimedia", code: AEROX3_WIRELESS_MULTIMEDIA_KEYS.previous }],
    ["Volume Up", { type: "multimedia", code: AEROX3_WIRELESS_MULTIMEDIA_KEYS.volumeUp }],
    ["Volume Down", { type: "multimedia", code: AEROX3_WIRELESS_MULTIMEDIA_KEYS.volumeDown }],
    // keyboard codes are hid usage ids, as in rivalcfg `layout_qwerty.py`.
    ...Array.from({ length: 26 }, (_, i) => [`Key ${String.fromCharCode(65 + i)}`, { type: "keyboard", code: 0x04 + i }]),
    ...Array.from({ length: 10 }, (_, i) => [`Key ${(i + 1) % 10}`, { type: "keyboard", code: 0x1e + i }]),
    ["Key Enter", { type: "keyboard", code: 0x28 }],
    ["Key Escape", { type: "keyboard", code: 0x29 }],
    ["Key Tab", { type: "keyboard", code: 0x2b }],
    ["Key Space", { type: "keyboard", code: 0x2c }],
    ...Array.from({ length: 12 }, (_, i) => [`Key F${i + 1}`, { type: "keyboard", code: 0x3a + i }]),
    ...Array.from({ length: 12 }, (_, i) => [`Key F${i + 13}`, { type: "keyboard", code: 0x68 + i }]),
];
function actionKey(action) {
    if (action.type === "button")
        return `button:${action.target}`;
    if (action.type === "keyboard" || action.type === "multimedia")
        return `${action.type}:${action.code}`;
    return action.type;
}
function actionLabel(action) {
    const key = actionKey(action);
    return ACTION_LABELS.find(([, candidate]) => actionKey(candidate) === key)?.[0] ?? "Unknown";
}
function toHex({ r, g, b }) {
    return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}
function fromHex(color) {
    const match = /^#?([0-9a-f]{6})$/i.exec(color ?? "");
    if (!match)
        throw new Error("Choose a #rrggbb color first.");
    const value = Number.parseInt(match[1], 16);
    return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}
/**
 * steelseries aerox 3 wireless webhid control, over the usb cable or the 2.4 ghz dongle.
 *
 * both transports share one command set, the dongle pids get `0x40` ored into
 * every command byte. nothing but the battery can be read back, so dpi stages,
 * polling, lighting, timers and buttons come from a cache seeded with
 * rivalcfg's defaults and updated after each successful write. every write is
 * followed by the save command. dpi, polling, timers and buttons survive a
 * power cycle, zone colors do not: the mouse boots into its startup lighting.
 *
 * the config channel is the usage page `0xFFC0` collection, interface 3 over the
 * cable. chrome grants every collection of the mouse at once, so only that one
 * is claimed. the battery reply echoes the query byte, `92` over the cable and `D2`
 * over the dongle, which tells it apart from readbacks and the dongle's
 * unsolicited `40 FF 01` events.
 *
 * rivalcfg's runtime rainbow `22 FF` is acked by a `1038:183A` unit but leaves
 * the strip dark, so it is not offered. rainbow works as startup lighting.
 */
export class SteelSeriesAerox3WirelessHidClient {
    device;
    wireless;
    queue = Promise.resolve();
    listenerAttached = false;
    inputWaiters = new Set();
    dpiStages = [...AEROX3_WIRELESS_DEFAULT_DPI_PRESETS];
    activeDpiStage = 0;
    pollingRateHz = AEROX3_WIRELESS_DEFAULT_POLLING_RATE;
    sleepTimerMinutes = AEROX3_WIRELESS_DEFAULT_SLEEP_TIMER_MINUTES;
    dimTimerSeconds = AEROX3_WIRELESS_DEFAULT_DIM_TIMER_SECONDS;
    zones = new Map(AEROX3_WIRELESS_ZONES.map((zone) => [zone, { mode: "Static", color: { ...AEROX3_WIRELESS_DEFAULT_ZONE_COLORS[zone] } }]));
    reactiveColor = null;
    buttons = { ...AEROX3_WIRELESS_DEFAULT_BUTTONS };
    onInputReport = (event) => {
        const payload = new Uint8Array(event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength));
        for (const finish of [...this.inputWaiters])
            finish(payload);
    };
    constructor(device) {
        this.device = device;
        this.wireless = WIRELESS_MODE_PRODUCT_IDS.has(device.productId);
    }
    static isSupported(device) {
        if (device.vendorId !== STEELSERIES_VENDOR_ID)
            return false;
        return STEELSERIES_PRODUCTS.get(device.productId)?.family === "aerox3-wireless"
            && hasConfigCollection(device.collections);
    }
    get pollIntervalMs() { return 30_000; }
    get supportedPollingRates() { return [...AEROX3_WIRELESS_POLLING_RATES]; }
    getDpiOptions() { return steelseriesAerox3WirelessDpiOptions(); }
    async open() {
        if (!this.device.opened)
            await this.device.open();
        if (!this.listenerAttached) {
            this.device.addEventListener("inputreport", this.onInputReport);
            this.listenerAttached = true;
        }
    }
    async close() {
        if (this.listenerAttached) {
            this.device.removeEventListener("inputreport", this.onInputReport);
            this.listenerAttached = false;
        }
        if (this.device.opened)
            await this.device.close();
    }
    async readStatus() {
        return await this.run(async () => {
            await this.open();
            const battery = await this.probeBattery();
            const product = STEELSERIES_PRODUCTS.get(this.device.productId);
            const lightingZones = this.lightingZones();
            return {
                brand: "SteelSeries",
                name: this.device.productName?.trim() || `SteelSeries ${product?.model ?? "Aerox 3 Wireless"}`,
                ui: {
                    family: "steelseries-aerox3-wireless",
                    settingsReady: true,
                    valuesVerified: false,
                    hideUnsupportedPollingRates: true,
                    hideProcessingCard: true,
                    hideSignalCard: true,
                    showAdvancedSection: true,
                    pollingNote: "The Aerox 3 Wireless cannot report its settings; values shown are the last written by this app, or SteelSeries defaults.",
                    defaultDisplayName: "SteelSeries Aerox 3 Wireless",
                    dpiStageEditor: {
                        maxStages: AEROX3_WIRELESS_MAX_DPI_PRESETS,
                        countEditable: true,
                        minDpi: AEROX3_WIRELESS_DPI_MIN,
                        maxDpi: AEROX3_WIRELESS_DPI_MAX,
                        stepDpi: AEROX3_WIRELESS_DPI_STEP,
                    },
                },
                batteryPercent: battery.level,
                batteryState: battery.isCharging ? "Charging" : "Discharging",
                dpi: this.dpiStages[this.activeDpiStage],
                dpiStages: [...this.dpiStages],
                activeDpiStage: this.activeDpiStage,
                pollingRateHz: this.pollingRateHz,
                supportedPollingRates: this.supportedPollingRates,
                sleepTimeout: this.sleepTimerMinutes * 60,
                activeProfile: null,
                buttonMappings: Object.fromEntries(Object.keys(BUTTON_LABELS).map((name) => [BUTTON_LABELS[name], actionLabel(this.buttons[name])])),
                buttonOptions: ACTION_LABELS.map(([label]) => label),
                lighting: lightingZones[0],
                lightingZones,
                connectionType: this.wireless ? "Wireless" : "Wired",
                connectionDetail: this.wireless ? "2.4 GHz dongle" : "USB cable",
                liftOffDistance: null,
                firmware: [],
            };
        });
    }
    /** writes `dpi` into the active stage. */
    async setDpi(dpi) {
        return await this.setDpiStageValue(this.activeDpiStage, dpi);
    }
    async setDpiStageValue(stage, dpi) {
        this.requireStage(stage);
        const stages = this.dpiStages.map((value, index) => (index === stage ? dpi : value));
        await this.writePresets(stages, this.activeDpiStage);
        return dpi;
    }
    async setActiveDpiStage(stage) {
        this.requireStage(stage);
        await this.writePresets(this.dpiStages, stage);
        return stage;
    }
    /** new stages repeat the last one, the user then edits them. */
    async setDpiStageCount(count) {
        if (!Number.isInteger(count) || count < 1 || count > AEROX3_WIRELESS_MAX_DPI_PRESETS) {
            throw new Error(`The Aerox 3 Wireless holds between 1 and ${AEROX3_WIRELESS_MAX_DPI_PRESETS} DPI stages.`);
        }
        const stages = Array.from({ length: count }, (_, index) => this.dpiStages[index] ?? this.dpiStages.at(-1));
        await this.writePresets(stages, Math.min(this.activeDpiStage, count - 1));
        return count;
    }
    async setDpiStages(stages, activeStage = 0) {
        await this.writePresets(stages, activeStage);
    }
    async setPollingRate(pollingRateHz) {
        await this.commit(steelseriesAerox3WirelessEncodePollingRate(pollingRateHz, this.wireless));
        this.pollingRateHz = pollingRateHz;
        return pollingRateHz;
    }
    /** the firmware counts whole minutes, 0 disables sleep. */
    async setSleepTimeout(seconds) {
        if (!Number.isInteger(seconds) || seconds % 60 !== 0 || seconds < 0 || seconds > AEROX3_WIRELESS_SLEEP_TIMER_MAX_MINUTES * 60) {
            throw new Error(`The Aerox 3 Wireless sleep timeout must be whole minutes up to ${AEROX3_WIRELESS_SLEEP_TIMER_MAX_MINUTES} minutes, or 0 to disable it.`);
        }
        await this.setSleepTimer(seconds / 60);
        return seconds;
    }
    async setSleepTimer(minutes) {
        await this.commit(steelseriesAerox3WirelessEncodeSleepTimer(minutes, this.wireless));
        this.sleepTimerMinutes = minutes;
    }
    async setDimTimer(seconds) {
        await this.commit(steelseriesAerox3WirelessEncodeDimTimer(seconds, this.wireless));
        this.dimTimerSeconds = seconds;
    }
    get dimTimer() { return this.dimTimerSeconds; }
    async setZoneColor(zone, color) {
        await this.commit(steelseriesAerox3WirelessEncodeZoneColor(zone, color, this.wireless));
        this.zones.set(zone, { mode: "Static", color: { ...color } });
    }
    async setReactiveColor(color) {
        await this.commit(steelseriesAerox3WirelessEncodeReactiveColor(color, this.wireless));
        this.reactiveColor = color && { ...color };
    }
    /** the lighting the mouse boots into, the only lighting that persists. */
    async setDefaultLighting(mode) {
        await this.commit(steelseriesAerox3WirelessEncodeDefaultLighting(mode, this.wireless));
    }
    async setLighting(lighting) {
        if (lighting.zone === REACTIVE_ZONE) {
            if (lighting.mode !== "Reactive" && lighting.mode !== "Off")
                throw new Error("Choose Reactive or Off.");
            await this.setReactiveColor(lighting.mode === "Off" ? null : fromHex(lighting.color));
            return this.lightingZones().find(({ zone }) => zone === REACTIVE_ZONE);
        }
        const zone = AEROX3_WIRELESS_ZONES.find((candidate) => ZONE_LABELS[candidate] === lighting.zone);
        if (zone === undefined)
            throw new Error(`The Aerox 3 Wireless has no "${lighting.zone}" lighting zone.`);
        switch (lighting.mode) {
            case "Static":
                await this.setZoneColor(zone, fromHex(lighting.color));
                break;
            case "Off": {
                // setZoneColor caches the colour it writes, so read the previous one first:
                // the zone must report (and later restore) its colour, not the black it is off at.
                const previous = this.zones.get(zone).color;
                await this.setZoneColor(zone, { r: 0, g: 0, b: 0 });
                this.zones.set(zone, { mode: "Off", color: { ...previous } });
                break;
            }
            default:
                throw new Error(`The Aerox 3 Wireless does not support ${lighting.mode ?? "that"} lighting.`);
        }
        return this.lightingZones().find(({ zone: label }) => label === lighting.zone);
    }
    async setButtonMapping(button, action) {
        const name = Object.keys(BUTTON_LABELS).find((candidate) => BUTTON_LABELS[candidate] === button);
        if (!name)
            throw new Error(`The Aerox 3 Wireless has no "${button}" button.`);
        const resolved = action === "Default"
            ? AEROX3_WIRELESS_DEFAULT_BUTTONS[name]
            : ACTION_LABELS.find(([label]) => label === action)?.[1];
        if (!resolved)
            throw new Error(`Unknown button action "${action}".`);
        const next = { ...this.buttons, [name]: resolved };
        if (!Object.values(next).some((candidate) => candidate.type === "button" && candidate.target === "button1")) {
            throw new Error("Keep at least one button as Left Click.");
        }
        await this.setButtonsMapping(next);
    }
    async setButtonsMapping(mapping) {
        const next = { ...AEROX3_WIRELESS_DEFAULT_BUTTONS, ...mapping };
        await this.commit(steelseriesAerox3WirelessEncodeButtonsMapping(next, this.wireless));
        this.buttons = next;
    }
    lightingZones() {
        const base = {
            color2: null,
            dualColorModes: [],
            reactiveModes: [],
            speeds: [],
            speed: null,
            writeOnly: true,
        };
        return [
            ...AEROX3_WIRELESS_ZONES.map((zone) => {
                const state = this.zones.get(zone);
                return {
                    ...base,
                    zone: ZONE_LABELS[zone],
                    group: "Strip",
                    modes: ZONE_MODES,
                    mode: state.mode,
                    color: toHex(state.color),
                    colorModes: ["Static"],
                };
            }),
            {
                ...base,
                zone: REACTIVE_ZONE,
                modes: REACTIVE_MODES,
                mode: this.reactiveColor ? "Reactive" : "Off",
                color: this.reactiveColor ? toHex(this.reactiveColor) : "#ffffff",
                colorModes: ["Reactive"],
            },
        ];
    }
    requireStage(stage) {
        if (!Number.isInteger(stage) || stage < 0 || stage >= this.dpiStages.length) {
            throw new Error(`The Aerox 3 Wireless has DPI stages 1 to ${this.dpiStages.length}.`);
        }
    }
    async writePresets(stages, activeStage) {
        await this.commit(steelseriesAerox3WirelessEncodeDpiPresets(stages, activeStage, this.wireless));
        this.dpiStages = [...stages];
        this.activeDpiStage = activeStage;
    }
    /** sends one setting, then the save command, as a single queued transaction. */
    async commit(report) {
        await this.run(async () => {
            await this.open();
            await this.send(report);
            await this.delay(COMMAND_DELAY_MS);
            await this.send(steelseriesAerox3WirelessSaveCommand(this.wireless));
        });
    }
    /** over the dongle rivalcfg drains a readback after each write, a missing one is not an error. */
    async send(report) {
        if (!this.wireless) {
            await this.write(report);
            return;
        }
        await this.awaitResponse(report, () => true, WIRELESS_READBACK_TIMEOUT_MS);
    }
    /** `92` doubles as the connectivity probe. */
    async probeBattery() {
        const query = steelseriesAerox3WirelessBatteryQuery(this.wireless);
        let unreachable = false;
        const payload = await this.awaitResponse(query, (reply) => {
            if (isMouseUnreachableEvent(reply))
                unreachable = true;
            return reply[0] === query[0];
        }, RESPONSE_TIMEOUT_MS);
        if (!payload && unreachable) {
            throw new Error("The Aerox 3 Wireless is asleep or out of range of its dongle. Move or click it to wake it, then try again.");
        }
        if (!payload) {
            throw new Error("The Aerox 3 Wireless did not answer on this interface. Close SteelSeries GG (and the SteelSeriesEngine service); if it still does not answer, add the device again and choose another entry.");
        }
        return steelseriesAerox3WirelessDecodeBattery(payload);
    }
    async awaitResponse(query, accepts, timeoutMs) {
        const response = new Promise((resolve) => {
            let timer;
            const finish = (payload) => {
                if (payload && !accepts(payload))
                    return;
                clearTimeout(timer);
                this.inputWaiters.delete(finish);
                resolve(payload);
            };
            timer = setTimeout(() => finish(null), timeoutMs);
            this.inputWaiters.add(finish);
        });
        try {
            await this.write(query);
        }
        catch (error) {
            this.inputWaiters.clear();
            throw error;
        }
        return await response;
    }
    async write(payload) {
        await this.device.sendReport(AEROX3_WIRELESS_REPORT_ID, payload.buffer);
    }
    delay(milliseconds) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }
    async run(operation) {
        const result = this.queue.then(operation, operation);
        this.queue = result.then(() => undefined, () => undefined);
        return await result;
    }
}
