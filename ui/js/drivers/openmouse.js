// PeriphHub — souris de dizaines de marques via les protocoles d'OpenMouse
// (@openmouse/protocol, AGPL-3.0-or-later, copiés tels quels dans ui/vendor/openmouse).
// Pulsar, Lamzu, WLMouse, Endgame Gear, Finalmouse, ATK, VGN, MCHOSE, Ninjutso, G-Wolves,
// VAXEE, Glorious, HyperX, Corsair, SteelSeries, ASUS, Cooler Master, Redragon…
//
// Module ES (le seul de l'interface) : il expose window.omApi, qu'utilisent devices.js
// (la page Scyrox laisse ces souris à OpenMouse) et shell.js (enregistrement du pilote).
// PeriphHub n'appelle que la lecture de l'état et les réglages courants : jamais de
// mise à jour de firmware, de remise à zéro d'usine ni d'appairage.
import { createSupportedClient, clientSupportScore, deviceBrand } from '../../vendor/openmouse/drivers/registry.js';
import * as kbReg from '../../vendor/openmouse-kb/drivers/registry.js';

const OM_VIDS = new Set([
  0x03EB, 0x03F0, 0x0483, 0x045E, 0x046D, 0x04D9, 0x04F3, 0x093A, 0x0951, 0x0B05, 0x0BDA,
  0x1038, 0x1532, 0x1915, 0x1A2C, 0x1B1C, 0x1CAA, 0x1D57, 0x2023, 0x22D4, 0x24AE, 0x2516,
  0x258A, 0x25A7, 0x260D, 0x2FE3, 0x3057, 0x3151, 0x31E3, 0x320F, 0x33E4, 0x3367, 0x3434,
  0x3554, 0x361D, 0x362D, 0x36A7, 0x3710, 0x372E, 0x373B, 0x373E, 0x3770, 0x3794, 0x37B0,
  0x3837, 0x3879, 0xA8A4, 0xA8A5,
]);
// Appareils qui ont leur page dédiée (js/devices.js), vérifiée sur le matériel
const OM_SKIP = new Set(['3554:F5F7', '3554:F5F6', '373B:1194', '1532:0565', '1532:056E', '048D:5702']);
const omHex = n => n.toString(16).toUpperCase().padStart(4, '0');
const omId = d => omHex(d.vendorId) + ':' + omHex(d.productId);

// ---------- Interface USB complète, comme WebHID la présente dans Chrome ----------
// Sous Windows, chaque « collection » d'une interface est un périphérique à part pour hidapi ;
// Chrome les réunit en un seul HIDDevice et envoie chaque rapport à la bonne collection.

class OmHIDDevice extends EventTarget {
  constructor(members) {
    super();
    this.members = members;
    const m0 = members[0];
    this.vendorId = m0.vendorId;
    this.productId = m0.productId;
    this.productName = m0.productName;
    this.info = m0.info;
    this.collections = members.flatMap(m => m.parsed?.length ? m.parsed : m.collections);
    this._relay = e => this.dispatchEvent(Object.assign(new Event('inputreport'),
      { device: this, reportId: e.reportId, data: e.data }));
  }
  get opened() { return this.members.some(m => m.opened); }
  async open() {
    let ok = 0, err = null;
    for (const m of this.members) {
      try {
        await m.open();
        m.removeEventListener('inputreport', this._relay);
        m.addEventListener('inputreport', this._relay);
        ok++;
      } catch (e) { err = e; }
    }
    if (!ok) throw err || new Error('ouverture impossible');
  }
  async close() {
    for (const m of this.members) {
      m.removeEventListener('inputreport', this._relay);
      await m.close().catch(() => {});
    }
  }
  owner(kind, id) {
    const has = m => hidAllCollections(m.parsed || m.collections).some(c => c[kind].some(r => r.reportId === id));
    return this.members.find(m => m.opened && has(m)) || this.members.find(has)
      || this.members.find(m => m.opened) || this.members[0];
  }
  sendReport(id, data) { return this.owner('outputReports', id).sendReport(id, data); }
  sendFeatureReport(id, data) { return this.owner('featureReports', id).sendFeatureReport(id, data); }
  // Comme Chrome sous Windows : l'ID du rapport est le 1er octet de la réponse (rapports numérotés)
  async receiveFeatureReport(id) {
    const m = this.owner('featureReports', id);
    const len = hidReportBytes(m.parsed || [], 'featureReports', id) || 64;
    const v = await m.receiveFeatureReport(id, len);
    const body = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    if (!id) return new DataView(body.slice().buffer);
    const out = new Uint8Array(body.length + 1);
    out[0] = id;
    out.set(body, 1);
    return new DataView(out.buffer);
  }
}

const omComposite = new Map(); // « vid:pid:interface » + chemins → même objet d'un passage à l'autre

function omInterfaces(devices) {
  if (!window.__TAURI__) return devices; // vrai WebHID (navigateur) : déjà regroupé
  const byIf = new Map();
  for (const d of devices) {
    const k = omId(d) + ':' + (d.info?.interface ?? -1);
    if (!byIf.has(k)) byIf.set(k, []);
    byIf.get(k).push(d);
  }
  return [...byIf].map(([k, members]) => {
    const key = k + '|' + members.map(m => m.info?.path).sort().join('|');
    if (!omComposite.has(key)) omComposite.set(key, new OmHIDDevice(members));
    return omComposite.get(key);
  });
}

function omBest(devices) {
  let best = null, score = 0;
  for (const c of omInterfaces(devices)) {
    let s = 0;
    try { s = clientSupportScore(c); } catch {}
    if (s > score) { best = c; score = s; }
  }
  return best;
}

// ---------- Réglages ----------

const OM_LOD = { Low: 'Basse', Medium: 'Moyenne', High: 'Haute' };
const omSleep = s => s >= 60 ? (s % 60 ? (s / 60).toFixed(1) : s / 60) + ' min' : s + ' s';
const omNear = (list, v) => list.reduce((a, b) => Math.abs(b - v) < Math.abs(a - v) ? b : a, list[0]);
const omCall = (client, name, ...args) => typeof client[name] === 'function' ? client[name](...args) : undefined;

function omMap(inst, st) {
  const c = inst.client, ui = st.ui || {};
  inst.status = st;
  inst.name = [deviceBrandSafe(c), st.name].filter(Boolean).join(' ').replace(/^(\S+) \1 /, '$1 ') || inst.name;
  const s = inst.state = {};
  const caps = inst.caps = {};
  if (st.batteryPercent != null) s.battery = { level: Math.round(st.batteryPercent), charging: /^Charging/.test(st.batteryState) };
  if (st.dpi && typeof c.setDpi === 'function') {
    s.dpi = st.dpi;
    const opts = (omCall(c, 'getDpiOptions') || []).filter(Number.isFinite).sort((a, b) => a - b);
    const ed = ui.dpiStageEditor;
    const min = ed?.minDpi ?? opts[0] ?? 100, max = ed?.maxDpi ?? opts[opts.length - 1] ?? 26000;
    const step = ed?.stepDpi ?? (opts.length > 1 ? Math.max(1, opts[1] - opts[0]) : 50);
    caps.dpi = { min, max, step, presets: [400, 800, 1600, 3200, 6400].filter(p => p >= min && p <= max), options: opts };
  }
  if (st.pollingRateHz && typeof c.setPollingRate === 'function' && !ui.pollingReadOnly) {
    s.rate = st.pollingRateHz;
    caps.rate = (omCall(c, 'getSupportedPollingRates') || st.supportedPollingRates || [125, 250, 500, 1000]).slice().sort((a, b) => a - b);
  }
  if (st.liftOffDistance && typeof c.setLiftOffDistance === 'function') {
    s.lod = st.liftOffDistance;
    caps.lod = st.supportedLiftOffDistances || ['Low', 'Medium', 'High'].filter(v => !(ui.hideLodLow && v === 'Low'));
  }
  const flag = (cap, key, method, hidden) => {
    if (st[key] != null && typeof c[method] === 'function' && !hidden) { s[cap] = !!st[key]; caps[cap] = true; }
  };
  flag('motionSync', 'motionSync', 'setMotionSync', ui.hideProcessingCard || ui.hideMotionSync);
  flag('angleSnapping', 'angleSnapping', 'setAngleSnapping', ui.hideProcessingCard || ui.hideAngleSnapping);
  flag('ripple', 'rippleControl', 'setRippleControl', ui.hideProcessingCard || ui.hideRippleControl);
  flag('performance', 'performanceMode', 'setPerformanceMode', false);
  if (st.debounceMs != null && typeof c.setDebounceTime === 'function') {
    const opts = omCall(c, 'getDebounceOptions');
    const maxMs = omCall(c, 'getDebounceMaxMs');
    if (opts?.length || maxMs) { s.debounce = st.debounceMs; caps.debounce = { options: opts || null, max: maxMs || Math.max(...opts) }; }
  }
  if (st.sleepTimeout != null && typeof c.setSleepTimeout === 'function' && !ui.hideSleepCard) {
    const opts = omCall(c, 'getSleepOptions');
    if (opts?.length) { s.sleep = st.sleepTimeout; caps.sleep = opts; }
  }
  inst.meta = [st.connectionType === 'Wireless' ? 'Sans fil' : st.connectionType === 'Wired' ? 'Filaire' : null,
    st.firmware?.length ? 'firmware ' + st.firmware.join(' / ') : null].filter(Boolean).join(' · ');
}

function deviceBrandSafe(client) {
  try { return deviceBrand(client); } catch { return ''; }
}

const OM_SETTERS = {
  dpi: (c, v, inst) => c.setDpi(inst.caps.dpi.options?.length > 1 && inst.caps.dpi.options.length < 200 ? omNear(inst.caps.dpi.options, v) : v),
  rate: (c, v) => c.setPollingRate(v),
  lod: (c, v) => c.setLiftOffDistance(v),
  motionSync: (c, v) => c.setMotionSync(v),
  angleSnapping: (c, v) => c.setAngleSnapping(v),
  ripple: (c, v) => c.setRippleControl(v),
  performance: (c, v) => c.setPerformanceMode(v),
  debounce: (c, v) => c.setDebounceTime(v),
  sleep: (c, v) => c.setSleepTimeout(v),
};

function omRows(inst) {
  const s = inst.state, c = inst.caps, rows = [];
  if (c.lod) rows.push(field('Distance de décollage (LOD)',
    segmented(c.lod.map(v => ({ v, label: OM_LOD[v] || v })), s.lod, v => drvSet(inst, 'Distance de décollage', 'lod', v)),
    h('div', { class: 'muted small' }, 'Hauteur à partir de laquelle le capteur arrête de suivre quand on soulève la souris.')));
  const t = [];
  if (c.motionSync) t.push(toggle('Motion Sync', s.motionSync, on => drvSet(inst, 'Motion Sync', 'motionSync', on), false,
    'Aligne les mesures du capteur sur l’envoi au PC : mouvement plus régulier, très léger délai en plus.'));
  if (c.angleSnapping) t.push(toggle('Correction d’angle', s.angleSnapping, on => drvSet(inst, 'Correction d’angle', 'angleSnapping', on), false,
    'Redresse les lignes presque droites. À couper pour viser.'));
  if (c.ripple) t.push(toggle('Lissage (ripple control)', s.ripple, on => drvSet(inst, 'Lissage', 'ripple', on), false,
    'Atténue les petites variations du capteur à haut DPI.'));
  if (c.performance) t.push(toggle('Mode performance', s.performance, on => drvSet(inst, 'Mode performance', 'performance', on), false,
    'Capteur toujours à pleine vitesse (la batterie s’use plus vite).'));
  if (t.length) rows.push(field('Capteur', h('div', { class: 'toggles' }, t)));
  if (c.debounce) rows.push(field('Anti-rebond des clics',
    c.debounce.options?.length && c.debounce.options.length <= 10
      ? segmented(c.debounce.options.map(v => ({ v, label: v + ' ms' })), s.debounce, v => drvSet(inst, 'Anti-rebond', 'debounce', v))
      : slider(0, c.debounce.max, 1, s.debounce, ' ms', v => drvSet(inst, 'Anti-rebond', 'debounce', v)),
    h('div', { class: 'muted small' }, 'Délai qui évite les doubles clics involontaires. Plus bas = plus réactif.')));
  if (c.sleep) rows.push(field('Mise en veille',
    segmented(c.sleep.map(v => ({ v, label: omSleep(v) })), s.sleep, v => drvSet(inst, 'Mise en veille', 'sleep', v))));
  return rows;
}

async function omConnect(group) {
  const dev = omBest(group);
  if (!dev) throw new Error('modèle non reconnu par OpenMouse');
  const client = createSupportedClient(dev);
  if (!client) throw new Error('modèle non reconnu par OpenMouse');
  await client.open();
  const inst = {
    key: 'om-' + omHex(dev.vendorId) + omHex(dev.productId),
    name: dev.productName || 'Souris',
    kind: /keyboard|clavier/i.test(dev.productName || '') ? 'clavier' : 'souris',
    dev: group[0], devs: group, client, state: {}, caps: {},
    restoreCaps: Object.keys(OM_SETTERS).filter(k => !['dpi', 'rate'].includes(k)),
    source: 'Protocole d’OpenMouse (projet libre, AGPL-3.0), pas encore confirmé sur ce modèle dans PeriphHub. ' +
      'Les réglages sont écrits dans la souris ; ceux d’origine sont gardés avant la première modification.',
  };
  inst.refresh = async () => omMap(inst, await client.readStatus());
  inst.refreshBattery = inst.refresh;
  inst.set = async (cap, v) => {
    const f = OM_SETTERS[cap];
    if (!f) throw new Error('réglage inconnu : ' + cap);
    await f(client, v, inst);
  };
  inst.rows = () => omRows(inst);
  // Souris sans fil endormie : on lui laisse quelques secondes pour répondre
  let err = null;
  for (let i = 0; i < 3; i++) {
    try { await inst.refresh(); err = null; break; } catch (e) { err = e; await new Promise(r => setTimeout(r, 1000)); }
  }
  if (err) { await client.close?.().catch(() => {}); throw err; }
  return [inst];
}

// ---------- Claviers (@openmouse/keyboard-protocol) ----------
// Réglages globaux seulement (pas touche par touche) : Wooting (actuation, rapid trigger),
// SteelSeries Apex (actuation), Razer et Logitech (fréquence, luminosité, rapid trigger).
// Keychron à effet Hall : point d'activation et rapid trigger communs à toutes les touches, seulement
// quand toutes les touches ont déjà le même réglage (sinon on n'écrase pas un réglage touche par touche :
// le clavier retombe sur le pilote VIA, éclairage seul).
// Wuque, Kochi, Arbiter : protocoles encore trop partiels pour être exposés sans risque.
const KB_FAMILIES = new Set(['Wooting', 'SteelSeries', 'Razer', 'Logitech', 'Keychron']);
const KB_FIRST = new Set(['Wooting', 'SteelSeries']); // aucun autre pilote dans PeriphHub
const WOOT_ZERO = 16384, WOOT_PER_MM = 4096;

function kbFind(group) {
  for (const c of omInterfaces(group)) {
    try {
      const drv = kbReg.DEVICE_DRIVERS.find(d => d.supports(c));
      if (drv && KB_FAMILIES.has(drv.brand)) return { dev: c, brand: drv.brand, drv };
    } catch {}
  }
  return null;
}

function kbMap(inst, st) {
  const s = inst.state = {}, caps = inst.caps = {};
  inst.status = st;
  inst.name = [inst.brand, st.name].filter(Boolean).join(' ').replace(/^(\S+) \1 /, '$1 ');
  // Wooting à puce AVR (anciens modèles) : la bibliothèque ne sait pas encore y écrire
  if (inst.brand === 'Wooting' && inst.client.multiReport?.() !== false) {
    const a = st.analogProfile?.actuationMm;
    if (Number.isFinite(a)) { s.actuation = Math.round(a * 10) / 10; caps.actuation = { min: 0.1, max: 4, step: 0.1 }; }
    const rt = st.rapidTrigger;
    if (rt?.enabled != null) {
      s.rt = !!rt.enabled; caps.rt = true;
      const raw = rt.pressSensitivityRaw;
      if (Number.isFinite(raw) && raw >= WOOT_ZERO) {
        s.rtSens = Math.round((raw - WOOT_ZERO) / WOOT_PER_MM * 10) / 10;
        caps.rtSens = { min: 0.1, max: 2, step: 0.1 };
      }
    }
  } else if (inst.brand === 'SteelSeries') {
    const keys = (st.steelseries?.profile?.keys || []).filter(k => Number.isFinite(k.tenthsMm));
    if (keys.length) {
      const count = new Map();
      for (const k of keys) count.set(k.tenthsMm, (count.get(k.tenthsMm) || 0) + 1);
      s.actuation = [...count].sort((a, b) => b[1] - a[1])[0][0] / 10;
      caps.actuation = { min: 0.1, max: 4, step: 0.1 };
      inst.usages = keys.map(k => k.usage);
    }
  } else if (inst.brand === 'Keychron') {
    const t = kcUniform(st.keychronProfile);
    const kc = st.keychron || {};
    inst.kc = null;
    if (t && kc.unit > 0) {
      const mm = x => Math.round(x * kc.unit * 100) / 100;
      const step = kc.unit >= 0.1 ? 0.1 : 0.05;
      inst.kc = { unit: kc.unit, step };
      s.actuation = mm(t.distance);
      caps.actuation = { min: kc.travel?.min ?? 0.1, max: kc.travel?.max ?? 3.3, step };
      s.rt = t.mode === KC_QUICK; caps.rt = true;
      s.rtSens = mm(t.advancePress);
      caps.rtSens = { min: 0.1, max: 2, step };
    }
  } else if (inst.brand === 'Razer') {
    const r = st.razer;
    if (r?.pollingRateHz) {
      s.rate = r.pollingRateHz;
      caps.rate = r.pollingStyle === 'extended' ? [125, 250, 500, 1000, 2000, 4000, 8000] : [125, 500, 1000];
    }
    if (r?.brightness != null) { s.brightness = r.brightness; caps.brightness = { min: 0, max: 255 }; }
  } else if (inst.brand === 'Logitech') {
    const l = st.logitech;
    if (l?.pollingRateHz && l.supportedPollingRates?.length) { s.rate = l.pollingRateHz; caps.rate = l.supportedPollingRates.slice().sort((a, b) => a - b); }
    if (l?.brightness) { s.brightness = l.brightness.value; caps.brightness = { min: l.brightness.min, max: l.brightness.max }; }
    if (l?.analog?.rapidTrigger != null) { s.rt = !!l.analog.rapidTrigger; caps.rt = true; }
    if (l?.battery?.percent != null) s.battery = { level: l.battery.percent, charging: /^charging/.test(l.battery.status || '') };
  }
  inst.meta = [st.connectionType === 'Wireless' ? 'Sans fil' : st.connectionType === 'Wired' ? 'Filaire' : null,
    st.firmwareVersion ? 'firmware ' + st.firmwareVersion : null].filter(Boolean).join(' · ');
}

// ----- Keychron : modes de course du Launcher (Static 1, QuickTrigger 2), en pas de `unit` mm
const KC_STATIC = 1, KC_QUICK = 2, KC_ALL_KEYS = 1;

// Réglage commun à toutes les touches, ou null si une touche a son propre réglage
// (une touche en mode 0 suit le réglage global du profil).
function kcUniform(p) {
  if (!p?.global) return null;
  let ref = null;
  for (const row of p.keys) for (const k of row) {
    const e = k.mode === 0 ? p.global : k;
    const t = { mode: e.mode, distance: e.distance, advancePress: e.advancePress, advanceRelease: e.advanceRelease };
    if (!ref) ref = t;
    else if (t.mode !== ref.mode || t.distance !== ref.distance || t.advancePress !== ref.advancePress
      || t.advanceRelease !== ref.advanceRelease) return null;
  }
  // Seuls les deux modes connus ; relâchement = appui (le seul cas qu'on sait remettre à l'identique)
  if (!ref || (ref.mode !== KC_STATIC && ref.mode !== KC_QUICK) || ref.advancePress !== ref.advanceRelease || ref.distance < 1) return null;
  if (ref.mode === KC_QUICK && ref.advancePress < 1) return null;
  return ref;
}

// Écrit le réglage complet (mode, activation, sensibilité) sur toutes les touches puis l'enregistre,
// comme le Launcher. Les valeurs non modifiées viennent de l'état courant.
async function kcWrite(inst, cap, v) {
  const c = inst.caps[cap];
  if (!inst.kc || !c) throw new Error('réglage inconnu : ' + cap);
  // rtSens à 0 : valeur d'origine possible en mode fixe (sensibilité inutilisée), remise telle quelle
  const zeroOk = cap === 'rtSens' && v === 0 && !inst.state.rt;
  if (cap !== 'rt' && !zeroOk && !(Number.isFinite(v) && v >= c.min && v <= c.max)) throw new Error('valeur hors limites');
  const s = { ...inst.state, [cap]: cap === 'rt' ? !!v : v };
  const steps = mm => Math.max(1, Math.round(mm / inst.kc.unit));
  const sens = s.rtSens > 0 ? steps(s.rtSens) : s.rt ? steps(0.3) : 0;
  await inst.client.setTravel({
    workMode: s.rt ? KC_QUICK : KC_STATIC, press: steps(s.actuation),
    sensitivePress: sens, sensitiveRelease: sens, keyMode: KC_ALL_KEYS,
  });
  await inst.client.saveProfile();
  Object.assign(inst.state, s); // la restauration enchaîne plusieurs réglages sans relire entre deux
}

const KB_SETTERS = {
  rate: (c, v) => c.setPollingRate(v),
  brightness: (c, v) => c.setBrightness(Math.round(v)),
  actuation: (c, v, inst) => inst.brand === 'Wooting'
    ? c.writeActuationDefault(v, true)
    : c.setActuation(inst.usages, Math.round(v * 10)),
  rt: (c, v, inst) => inst.brand === 'Wooting'
    ? c.writeRapidTriggerDefault(v, inst.state.rtSens ?? 0.5, true)
    : c.setAnalogRapidTrigger(v),
  rtSens: (c, v, inst) => c.writeRapidTriggerDefault(inst.state.rt ?? true, v, true),
};

function kbRows(inst) {
  const s = inst.state, c = inst.caps, rows = [];
  if (c.actuation) rows.push(field('Point d’activation (toutes les touches)',
    slider(c.actuation.min, c.actuation.max, c.actuation.step, s.actuation, ' mm', v => drvSet(inst, 'Point d’activation', 'actuation', v)),
    h('div', { class: 'muted small' }, 'Profondeur à laquelle une touche est prise en compte. Plus haut = plus réactif, plus bas = moins de fautes de frappe.')));
  if (c.rt) rows.push(field('Rapid trigger', h('div', { class: 'toggles' },
    toggle('Rapid trigger (toutes les touches)', s.rt, on => drvSet(inst, 'Rapid trigger', 'rt', on), false,
      'La touche se relâche dès qu’elle remonte un peu, sans attendre le point d’activation : contre-strafes plus rapides.'))));
  if (c.rtSens && s.rt) rows.push(field('Sensibilité du rapid trigger',
    slider(c.rtSens.min, c.rtSens.max, c.rtSens.step, s.rtSens, ' mm', v => drvSet(inst, 'Sensibilité du rapid trigger', 'rtSens', v)),
    h('div', { class: 'muted small' }, 'Distance de remontée qui relâche la touche. Plus petit = plus réactif.')));
  if (c.brightness) rows.push(field('Luminosité',
    slider(c.brightness.min, c.brightness.max, 1, s.brightness, '', v => drvSet(inst, 'Luminosité', 'brightness', v))));
  return rows;
}

async function kbConnect(group) {
  const found = kbFind(group);
  if (!found) throw new Error('clavier non reconnu par OpenMouse');
  const client = found.drv.create(found.dev);
  if (!client) throw new Error('clavier non reconnu par OpenMouse');
  await client.open();
  const inst = {
    key: 'omk-' + omHex(found.dev.vendorId) + omHex(found.dev.productId),
    name: found.dev.productName || 'Clavier', brand: found.brand, kind: 'clavier',
    dev: group[0], devs: group, client, state: {}, caps: {},
    restoreCaps: ['brightness', 'actuation', 'rt', 'rtSens'],
    source: 'Protocole d’OpenMouse (projet libre, AGPL-3.0), pas encore confirmé sur ce modèle dans PeriphHub. ' +
      'Les réglages sont écrits dans le clavier ; ceux d’origine sont gardés avant la première modification.',
  };
  inst.refresh = async () => {
    const st = await client.readStatus();
    if (found.brand === 'Keychron') st.keychronProfile = await client.readProfile();
    kbMap(inst, st);
  };
  inst.set = async (cap, v) => {
    if (found.brand === 'Keychron') return kcWrite(inst, cap, v);
    const f = KB_SETTERS[cap];
    if (!f) throw new Error('réglage inconnu : ' + cap);
    await f(client, v, inst);
  };
  inst.rows = () => kbRows(inst);
  try { await inst.refresh(); } catch (e) { await client.close?.().catch(() => {}); throw e; }
  if (!Object.keys(inst.caps).length) { await client.close?.().catch(() => {}); throw new Error('aucun réglage lisible'); }
  return [inst];
}

// first = true : Wooting / SteelSeries ; false : Razer / Logitech (en secours)
const kbMatch = first => d => {
  if (OM_SKIP.has(omId(d)) || ![0x31E3, 0x03EB, 0x1038, 0x1532, 0x046D].includes(d.vendorId)) return false;
  try {
    const found = kbFind([d]);
    return !!found && KB_FIRST.has(found.brand) === first;
  } catch { return false; }
};

const kcMatch = d => {
  if (d.vendorId !== 0x3434 || OM_SKIP.has(omId(d))) return false;
  try { return kbFind([d])?.brand === 'Keychron'; } catch { return false; }
};

window.omApi = {
  vids: OM_VIDS,
  // La page Scyrox (CompX) laisse à OpenMouse les souris qu'il reconnaît
  claims(dev, all) {
    if (!OM_VIDS.has(dev.vendorId) || OM_SKIP.has(omId(dev))) return false;
    const peers = all.filter(d => omId(d) === omId(dev));
    try { return !!omBest(peers); } catch { return false; }
  },
  driver: {
    id: 'openmouse',
    priority: 10,
    match: d => OM_VIDS.has(d.vendorId) && !OM_SKIP.has(omId(d)),
    connect: (_dev, group) => omConnect(group),
  },
  keyboardDrivers: [
    // Wooting, SteelSeries Apex : passent avant tout le reste
    { id: 'openmouse-kb', priority: 15, match: kbMatch(true), connect: (_dev, group) => kbConnect(group) },
    // Keychron à effet Hall : avant le pilote VIA (priorité 20), qui reprend la main si on ne peut rien régler
    { id: 'openmouse-kb-keychron', priority: 25, match: kcMatch, connect: (_dev, group) => kbConnect(group) },
    // Razer, Logitech : nos pilotes d'abord ; OpenMouse en secours (claviers analogiques…)
    { id: 'openmouse-kb2', priority: -5, match: kbMatch(false), connect: (_dev, group) => kbConnect(group) },
  ],
};
