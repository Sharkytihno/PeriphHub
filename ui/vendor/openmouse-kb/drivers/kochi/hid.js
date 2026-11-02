import { KOCHI_COMMAND, KOCHI_CONFIG_USAGE, KOCHI_CONFIG_USAGE_PAGE, KOCHI_HB68_PRODUCT_ID, KOCHI_REPORT_ID, KOCHI_VENDOR_ID, assertKochiMode, decodeKochiModeAck, decodeKochiModeQuery, decodeKochiName, encodeKochiCommand, kochiReplyPayload, } from "../../kochi/index.js";
/** USB HB68 configuration only; boot-keyboard/stream collections are not claimed. */
export class KochiHidClient {
    device;
    queue = Promise.resolve();
    listening = false;
    faulted = false;
    pending = null;
    constructor(device) { this.device = device; }
    /** Exact 1CA2:0901 identity plus a command-capable config collection. */
    static isSupported(device) {
        return device.vendorId === KOCHI_VENDOR_ID && device.productId === KOCHI_HB68_PRODUCT_ID
            && KochiHidClient.configCollection(device.collections) !== null;
    }
    /**
     * The command-capable config collection, if this device exposes one. WebHID
     * permits nested collections, so search children as well: a matching HB68
     * collection can sit below a top-level application collection.
     */
    static configCollection(collections) {
        for (const collection of collections) {
            if (collection.usagePage === KOCHI_CONFIG_USAGE_PAGE && collection.usage === KOCHI_CONFIG_USAGE) {
                return collection;
            }
            const nested = KochiHidClient.configCollection(collection.children);
            if (nested)
                return nested;
        }
        return null;
    }
    async open() {
        if (!KochiHidClient.isSupported(this.device))
            throw new Error("Not an HB68 configuration interface.");
        if (this.faulted)
            throw new Error("Reconnect the HB68 after a failed transaction.");
        if (!this.device.opened)
            await this.device.open();
        // close() can land while device.open() is pending and cannot see the
        // device yet, so recheck after the await: release it instead of installing
        // a listener or letting a command reach an already-closed session.
        if (this.faulted) {
            if (this.device.opened)
                await this.device.close();
            throw new Error("Reconnect the HB68 after a failed transaction.");
        }
        if (!this.listening) {
            this.device.addEventListener("inputreport", this.onReport);
            this.listening = true;
        }
    }
    async close() {
        this.faulted = true;
        this.pending?.reject(new Error("HB68 disconnected."));
        if (this.listening)
            this.device.removeEventListener("inputreport", this.onReport);
        this.listening = false;
        if (this.device.opened)
            await this.device.close();
    }
    onReport = (event) => {
        if (event.device !== this.device || event.reportId !== KOCHI_REPORT_ID || !this.pending)
            return;
        const frame = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
        if (kochiReplyPayload(frame, this.pending.command))
            this.pending.resolve(frame.slice());
    };
    serialized(operation) {
        const next = this.queue.then(operation);
        this.queue = next.catch(() => undefined);
        return next;
    }
    async exchange(command) {
        await this.open();
        let timer;
        const reply = new Promise((resolve, reject) => {
            this.pending = { command, resolve, reject };
            timer = setTimeout(() => reject(new Error(`HB68 did not answer command 0x${command.toString(16)}.`)), 1500);
        });
        try {
            const [frame] = await Promise.all([reply, this.device.sendReport(KOCHI_REPORT_ID, encodeKochiCommand(command))]);
            return frame;
        }
        catch (error) {
            // No transaction id exists on the wire. Do not reuse this session after
            // a timeout: a delayed reply could otherwise confirm a later command.
            this.faulted = true;
            throw error;
        }
        finally {
            clearTimeout(timer);
            this.pending = null;
        }
    }
    async readMode() {
        const win = decodeKochiModeQuery(await this.exchange(KOCHI_COMMAND.queryWin), "win");
        const mac = decodeKochiModeQuery(await this.exchange(KOCHI_COMMAND.queryMac), "mac");
        if (win === null || mac === null || win === mac)
            throw new Error("HB68 did not report a consistent Windows/Mac mode.");
        return mac ? "mac" : "win";
    }
    readSystemMode() {
        return this.serialized(() => this.readMode());
    }
    setSystemMode(mode) {
        assertKochiMode(mode);
        return this.serialized(async () => {
            const frame = await this.exchange(mode === "win" ? KOCHI_COMMAND.setWin : KOCHI_COMMAND.setMac);
            if (!decodeKochiModeAck(frame, mode))
                throw new Error("HB68 did not acknowledge the system-mode change.");
            const confirmed = await this.readMode();
            if (confirmed !== mode)
                throw new Error("HB68 system-mode read-back did not match the request.");
            return confirmed;
        });
    }
    readStatus() {
        return this.serialized(async () => {
            const name = decodeKochiName(await this.exchange(KOCHI_COMMAND.name));
            if (name !== "KOCHI68")
                throw new Error("The connected keyboard did not identify as KOCHI68.");
            const systemMode = await this.readMode();
            return {
                brand: "Kochi", name: "Hummingbird 68", connectionType: "Wired", connectionDetail: "USB",
                firmware: [], firmwareVersion: null, layout: null, serial: null,
                activeProfile: null, profileCount: null, profileNames: [],
                ui: { family: "kochi", defaultDisplayName: "Hummingbird 68" },
                kochi: { systemMode },
            };
        });
    }
}
