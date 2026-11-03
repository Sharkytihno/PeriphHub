// Banc d'essai des pilotes : charge les scripts classiques de ui/js/drivers dans un contexte isolé
// (comme le ferait la page), avec le strict nécessaire de core.js remplacé par des bouchons.
// Aucun matériel : les appareils sont des simulateurs (tests/sim/*).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function loadDrivers(...files) {
  const drivers = [];
  const intervals = []; // minuteries des pilotes, déclenchées à la main par les tests
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, setInterval: f => (intervals.push(f), intervals.length), clearInterval: n => { intervals[n - 1] = null; }, performance, LOCALE: 'fr-FR', NATIVE: false, Promise, Uint8Array, DataView, ArrayBuffer, Map, Set, Math, JSON, Error, Number, String, Object, Array,
    registerDriver: d => drivers.push(d),
    hex4: n => n.toString(16).toUpperCase().padStart(4, '0'),
    devId: dev => [dev.vendorId, dev.productId].map(n => n.toString(16).toUpperCase().padStart(4, '0')).join(':'),
    drvReapply: async () => {},
    drvAdd: () => {},
    drvLive: new Map(),
    deviceName: async dev => dev.productName,
    toast: () => {},
  });
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(REPO, 'ui/js/drivers', f), 'utf8'), ctx, { filename: f });
  return { drivers, ctx, intervals };
}

// Appareil WebHID minimal : les sous-classes répondent dans onReport / onFeature
export class FakeHid {
  constructor({ vendorId, productId, productName = '', usagePage = 0xFF00, usage = 1, iface = 0 }) {
    Object.assign(this, { vendorId, productId, productName, opened: false });
    this.collections = [{ usagePage, usage }];
    this.info = { interface: iface };
    this.sent = [];      // [reportId, octets] envoyés par le pilote (rapports de sortie)
    this.features = [];  // idem pour les feature reports
    this.listeners = new Set();
  }
  addEventListener(t, f) { if (t === 'inputreport') this.listeners.add(f); }
  removeEventListener(t, f) { this.listeners.delete(f); }
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  emit(reportId, bytes) {
    const data = new DataView(Uint8Array.from(bytes).buffer);
    setTimeout(() => { for (const f of this.listeners) f({ reportId, data, device: this }); }, 1);
  }
  async sendReport(id, data) {
    const b = Uint8Array.from(data);
    this.sent.push([id, b]);
    this.onReport?.(id, b);
  }
  async sendFeatureReport(id, data) {
    const b = Uint8Array.from(data);
    this.features.push([id, b]);
    this.onFeature?.(id, b);
  }
  async receiveFeatureReport(id) {
    const b = this.featureReply?.(id) || new Uint8Array(90);
    return new DataView(Uint8Array.from(b).buffer);
  }
}
