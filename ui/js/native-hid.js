// Dans l'appli (Tauri), remplace navigator.hid par la passerelle HID native :
// la WebView n'a pas le sélecteur WebHID de Chrome. Chaque interface (collection)
// devient un objet qui imite HIDDevice : les modules js/protocols/* sont écrits pour
// WebHID et fonctionnent tels quels. Seuls les appareils de data/devices.json sont visibles.
const NATIVE = !!window.__TAURI__;

// Rapports connus par page d'usage (hidapi ne fournit pas le descripteur HID)
const NATIVE_REPORTS = {
  0xff60: { input: [0], output: [0], feature: [] },   // REKT (VIA raw HID)
  0xff14: { input: [2], output: [2], feature: [2] },  // Razer : configuration
  0xff13: { input: [7], output: [6], feature: [] },   // Razer : autre interface fabricant
  0xff02: { input: [8], output: [8], feature: [] },   // Scyrox : configuration
  0xff06: { input: [9], output: [9], feature: [] },   // Scyrox
  0xff04: { input: [], output: [], feature: [6] },    // Scyrox
  0xff89: { input: [], output: [], feature: [0xcc] }, // Gigabyte RGB Fusion 2
  0xff00: { input: [0x10, 0x11], output: [0x10, 0x11], feature: [] }, // Logitech HID++ (récepteurs, filaire)
  0xff43: { input: [0x10, 0x11], output: [0x10, 0x11], feature: [] }, // Logitech HID++ (souris récentes)
};

class NativeHIDDevice extends EventTarget {
  constructor(info) {
    super();
    this.info = info;
    this.vendorId = info.vid;
    this.productId = info.pid;
    this.productName = info.product;
    this.handle = 0;
    const r = NATIVE_REPORTS[info.usage_page] || { input: [], output: [], feature: [] };
    const rep = ids => ids.map(reportId => ({ reportId, items: [] }));
    this.collections = [{ usagePage: info.usage_page, usage: info.usage,
      inputReports: rep(r.input), outputReports: rep(r.output), featureReports: rep(r.feature) }];
  }
  get opened() { return this.handle !== 0; }
  async open() {
    const unnumbered = this.collections[0].inputReports.some(r => r.reportId === 0);
    if (!this.handle) this.handle = await nativeInvoke('hid_open', { path: this.info.path, unnumbered });
    nativeHid.byHandle.set(this.handle, this);
  }
  async close() {
    if (!this.handle) return;
    nativeHid.byHandle.delete(this.handle);
    await nativeInvoke('hid_close', { handle: this.handle });
    this.handle = 0;
  }
  async sendReport(reportId, data) {
    await nativeInvoke('hid_send', { handle: this.handle, reportId, data: Array.from(toBytes(data)) });
  }
  async sendFeatureReport(reportId, data) {
    await nativeInvoke('hid_send_feature', { handle: this.handle, reportId, data: Array.from(toBytes(data)) });
  }
  // `len` : extension de PeriphHub (WebHID connaît la taille par le descripteur, hidapi non)
  async receiveFeatureReport(reportId, len = 64) {
    const bytes = await nativeInvoke('hid_get_feature', { handle: this.handle, reportId, len });
    return new DataView(Uint8Array.from(bytes).buffer);
  }
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data);
}

function nativeInvoke(cmd, args) { return window.__TAURI__.core.invoke(cmd, args); }

const nativeHid = {
  byHandle: new Map(),
  known: new Map(), // chemin → NativeHIDDevice (même objet d'un appel à l'autre)
  events: new EventTarget(),
};

if (NATIVE) {
  // Messages de la console recopiés dans la sortie du processus natif (diagnostic)
  for (const level of ['log', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...a) => {
      orig(...a);
      const text = a.map(x => x instanceof Error ? x.stack || x.message : typeof x === 'string' ? x : JSON.stringify(x)).join(' ');
      nativeInvoke('ui_log', { level, text }).catch(() => {});
    };
  }
  window.addEventListener('error', e => console.error('[page]', e.message, e.filename + ':' + e.lineno));
  window.addEventListener('unhandledrejection', e => console.error('[promesse]', e.reason));

  const matches = (d, filters) => !filters?.length || filters.some(f =>
    (f.vendorId == null || f.vendorId === d.vendorId) &&
    (f.productId == null || f.productId === d.productId) &&
    (f.usagePage == null || f.usagePage === d.collections[0].usagePage) &&
    (f.usage == null || f.usage === d.collections[0].usage));

  const list = async () => {
    const infos = await nativeInvoke('hid_devices');
    const seen = new Set();
    const out = infos.map(info => {
      seen.add(info.path);
      if (!nativeHid.known.has(info.path)) nativeHid.known.set(info.path, new NativeHIDDevice(info));
      return nativeHid.known.get(info.path);
    });
    // Débranchés depuis le dernier passage → événement « disconnect »
    for (const [path, dev] of nativeHid.known) {
      if (seen.has(path)) continue;
      nativeHid.known.delete(path);
      if (dev.handle) nativeHid.byHandle.delete(dev.handle);
      dev.handle = 0;
      nativeHid.events.dispatchEvent(Object.assign(new Event('disconnect'), { device: dev }));
    }
    return out;
  };

  window.__TAURI__.event.listen('hid-input', ({ payload }) => {
    const dev = nativeHid.byHandle.get(payload.handle);
    if (!dev) return;
    const bytes = Uint8Array.from(payload.data);
    dev.dispatchEvent(Object.assign(new Event('inputreport'),
      { device: dev, reportId: payload.report_id, data: new DataView(bytes.buffer) }));
  });

  Object.defineProperty(navigator, 'hid', { configurable: true, value: {
    getDevices: list,
    requestDevice: async ({ filters } = {}) => (await list()).filter(d => matches(d, filters)),
    addEventListener: (t, f) => nativeHid.events.addEventListener(t, f),
    removeEventListener: (t, f) => nativeHid.events.removeEventListener(t, f),
  } });

  // Branchements / débranchements : on relit la liste toutes les 2 s, fenêtre visible seulement
  // (chaque relecture ouvre tous les périphériques HID : inutile en arrière-plan)
  let count = -1;
  setInterval(async () => {
    if (document.hidden) return;
    const n = (await list()).length;
    if (count !== -1 && n > count) nativeHid.events.dispatchEvent(new Event('connect'));
    count = n;
  }, 2000);
}
