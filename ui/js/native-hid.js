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
    // Pages 0xFF00 / 0xFF43 : la table est celle de Logitech HID++. Les autres marques les utilisent
    // aussi (HyperX, SteelSeries, Turtle Beach…) avec leurs propres rapports : descripteur réel pour elles.
    const table = (info.usage_page === 0xff00 || info.usage_page === 0xff43) && info.vid !== 0x046d ? null : NATIVE_REPORTS[info.usage_page];
    let r = table || { input: [], output: [], feature: [] };
    // Récepteurs et souris Logitech filaires : la collection usage 1 ne porte que le rapport court 0x10,
    // l'usage 2 que le long 0x11. Annoncer les deux sur chacune faisait envoyer un rapport long à la
    // collection courte (refusé par Windows) quand le descripteur n'était pas lu.
    if (info.vid === 0x046d && info.usage_page === 0xff00 && (info.usage === 1 || info.usage === 2)) {
      const id = info.usage === 1 ? 0x10 : 0x11;
      r = { input: [id], output: [id], feature: [] };
    }
    const rep = ids => ids.map(reportId => ({ reportId, items: [] }));
    this.collections = [{ usagePage: info.usage_page, usage: info.usage, children: [],
      inputReports: rep(r.input), outputReports: rep(r.output), featureReports: rep(r.feature) }];
    // Collections réelles, lues dans le descripteur (pilotes OpenMouse : voir drivers/openmouse.js).
    // Les modules historiques gardent la table ci-dessus, avec laquelle ils ont été vérifiés.
    this.parsed = info.descriptor?.length ? hidParseDescriptor(info.descriptor) : null;
    this.known = !!table;
    if (!this.known && this.parsed?.length) this.collections = this.parsed;
    // Pages Logitech : les collections réelles du descripteur, quand il a été lu, valent mieux que la table
    else if ((info.usage_page === 0xff00 || info.usage_page === 0xff43) && info.vid === 0x046d
      && this.parsed?.some(c => c.usagePage === info.usage_page)) this.collections = this.parsed;
  }
  get opened() { return this.handle !== 0; }
  async open() {
    const unnumbered = !this.known && this.parsed ? !hidHasReportIds(this.parsed)
      : this.collections[0].inputReports.some(r => r.reportId === 0);
    if (!this.handle) {
      try { this.handle = await nativeInvoke('hid_open', { path: this.info.path, unnumbered }); }
      catch (e) { hidTrace(this, 'open', null, null, e); throw e; }
      hidTrace(this, 'open', null, null);
    }
    nativeHid.byHandle.set(this.handle, this);
  }
  async close() {
    if (!this.handle) return;
    nativeHid.byHandle.delete(this.handle);
    hidTrace(this, 'close', null, null);
    await nativeInvoke('hid_close', { handle: this.handle });
    this.handle = 0;
  }
  async sendReport(reportId, data) {
    await hidCall(this, 'out', reportId, toBytes(data), b => nativeInvoke('hid_send', { handle: this.handle, reportId, data: Array.from(b) }));
  }
  async sendFeatureReport(reportId, data) {
    await hidCall(this, 'set', reportId, toBytes(data), b => nativeInvoke('hid_send_feature', { handle: this.handle, reportId, data: Array.from(b) }));
  }
  // `len` : extension de PeriphHub (WebHID connaît la taille par le descripteur, hidapi non)
  async receiveFeatureReport(reportId, len = 64) {
    let bytes;
    try { bytes = Uint8Array.from(await nativeInvoke('hid_get_feature', { handle: this.handle, reportId, len })); }
    catch (e) { hidTrace(this, 'get', reportId, null, e); throw e; }
    hidTrace(this, 'get', reportId, bytes);
    return new DataView(bytes.buffer);
  }
}

async function hidCall(dev, what, reportId, bytes, call) {
  try { await call(bytes); } catch (e) { hidTrace(dev, what, reportId, bytes, e); throw e; }
  hidTrace(dev, what, reportId, bytes);
}

// Trace des derniers échanges de chaque interface, pour le diagnostic : ce que PeriphHub envoie et
// ce que l'appareil répond (de quoi corriger un pilote sans avoir le matériel). Rapports reçus gardés
// seulement dans la seconde qui suit un envoi, 4 au plus (les réponses) : ni flot continu de manette,
// ni frappe au clavier. 24 premiers octets de chaque rapport, 40 dernières lignes.
function hidTrace(dev, what, reportId, bytes, err) {
  const now = performance.now();
  if (what === 'in') {
    if (now - (dev.traceAt ?? -1e9) > 1000 || ++dev.traceIn > 4) return;
  } else { dev.traceAt = now; dev.traceIn = 0; }
  const hex = bytes ? ' ' + Array.from(bytes.subarray(0, 24), b => b.toString(16).padStart(2, '0')).join(' ') + (bytes.length > 24 ? ` …(${bytes.length} o)` : '') : '';
  const id = reportId == null ? '' : ' ' + reportId.toString(16).padStart(2, '0');
  const t = dev.trace || (dev.trace = []);
  t.push(`${(now / 1000).toFixed(3)} ${what}${id}${hex}${err ? ' ✗ ' + String(err?.message || err).slice(0, 100) : ''}`);
  if (t.length > 40) t.shift();
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
  blocked: false,    // un périphérique ne répond pas à Windows : la liste ne peut pas être lue
  listed: false,     // première liste lue (avant : pas d'événement « connect », tout est nouveau)
  log: [],           // derniers avertissements et erreurs (diagnostic)
};

if (NATIVE) {
  // Messages de la console recopiés dans la sortie du processus natif (diagnostic)
  for (const level of ['log', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...a) => {
      orig(...a);
      const text = a.map(x => x instanceof Error ? x.stack || x.message : typeof x === 'string' ? x : JSON.stringify(x)).join(' ');
      nativeInvoke('ui_log', { level, text }).catch(() => {});
      // Journal gardé pour « Copier le diagnostic » : avertissements et erreurs seulement,
      // sans chemins de périphériques (ils peuvent contenir un numéro de série)
      if (level !== 'log') {
        const t = new Date().toTimeString().slice(0, 8);
        nativeHid.log.push(`${t} ${level === 'error' ? 'ERREUR ' : ''}${text.replace(/\\\\\?\\[^\s'"]+/gi, '<chemin>').slice(0, 300)}`);
        if (nativeHid.log.length > 60) nativeHid.log.shift();
      }
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
    let infos;
    try {
      infos = await nativeInvoke('hid_devices');
    } catch (e) {
      // Ne surtout pas conclure que tout est débranché : la liste est seulement illisible
      if (!nativeHid.blocked) { nativeHid.blocked = true; nativeHid.events.dispatchEvent(new Event('blocked')); }
      throw e;
    }
    if (nativeHid.blocked) { nativeHid.blocked = false; nativeHid.events.dispatchEvent(new Event('blocked')); }
    const seen = new Set();
    let added = 0;
    const out = infos.map(info => {
      seen.add(info.path);
      if (!nativeHid.known.has(info.path)) { nativeHid.known.set(info.path, new NativeHIDDevice(info)); added++; }
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
    // Nouvelle interface (même si une autre a disparu au même moment, ex. récepteur rebranché ailleurs)
    if (added && nativeHid.listed) nativeHid.events.dispatchEvent(new Event('connect'));
    nativeHid.listed = true;
    return out;
  };

  window.__TAURI__.event.listen('hid-input', ({ payload }) => {
    const dev = nativeHid.byHandle.get(payload.handle);
    if (!dev) return;
    const bytes = Uint8Array.from(payload.data);
    hidTrace(dev, 'in', payload.report_id, bytes);
    dev.dispatchEvent(Object.assign(new Event('inputreport'),
      { device: dev, reportId: payload.report_id, data: new DataView(bytes.buffer) }));
  });

  Object.defineProperty(navigator, 'hid', { configurable: true, value: {
    getDevices: list,
    requestDevice: async ({ filters } = {}) => (await list()).filter(d => matches(d, filters)),
    addEventListener: (t, f) => nativeHid.events.addEventListener(t, f),
    removeEventListener: (t, f) => nativeHid.events.removeEventListener(t, f),
  } });

  // Branchements / débranchements : Windows prévient PeriphHub (notify.rs, « hid-changed »), même
  // fenêtre cachée. Relecture de secours toutes les 5 s fenêtre visible, toutes les 60 s cachée
  // (avis de Windows indisponibles) ; toutes les 30 s si un appareil bloque Windows.
  let relist = 0, tick = 0;
  const refreshSoon = (ms = 400) => {
    clearTimeout(relist);
    relist = setTimeout(() => list().catch(() => {}), ms); // une rafale d'avis = une seule relecture
  };
  window.__TAURI__.event.listen('hid-changed', () => refreshSoon()).catch(() => {});
  // Sortie de veille : les appareils se réinitialisent souvent ; les pilotes réappliquent les réglages
  window.__TAURI__.event.listen('power-resume', () => setTimeout(() => {
    list().catch(() => {}).finally(() => nativeHid.events.dispatchEvent(new Event('resume')));
  }, 4000)).catch(() => {});
  setInterval(() => {
    tick++;
    if (nativeHid.blocked ? tick % 6 : document.hidden ? tick % 12 : 0) return;
    list().catch(() => {});
  }, 5000);
}
