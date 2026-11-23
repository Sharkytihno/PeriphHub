// Souris ajoutées par les protocoles d'OpenMouse déjà embarqués (ui/vendor/openmouse) : Redgear X13 Pro
// (1B80:B412) et AJAZZ AJ200 / AJ200P AI (363C). Aucune n'a été essayée sur le matériel dans PeriphHub :
// ces tests rejouent leurs échanges HID comme l'appli les fait passer (mode Tauri : une collection par
// appareil hidapi, réunies par OmHIDDevice), sans souris branchée.
//   node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { X13_NATIVE_STATUS_HEX } from '../ui/vendor/openmouse/drivers/redgear/status-fixture.js';
import { AJ200P_PRODUCTS } from '../ui/vendor/openmouse/ajazz/aj200p-products.js';

globalThis.window = {};
await import('../ui/js/drivers/openmouse.js');
const om = window.omApi;

// Fonctions de js/hid-descriptor.js dont se sert OmHIDDevice (mêmes calculs)
function tauri(t) {
  window.__TAURI__ = {};
  globalThis.hidAllCollections = cols => {
    const out = [];
    const walk = list => list.forEach(c => { out.push(c); walk(c.children || []); });
    walk(cols);
    return out;
  };
  globalThis.hidReportBytes = (cols, kind, id) => Math.ceil(globalThis.hidAllCollections(cols)
    .flatMap(c => c[kind]).filter(r => r.reportId === id).flatMap(r => r.items)
    .reduce((bits, it) => bits + it.reportSize * it.reportCount, 0) / 8);
  t.after(() => {
    delete window.__TAURI__;
    delete globalThis.hidAllCollections;
    delete globalThis.hidReportBytes;
  });
}

// Une collection telle que native-hid.js la décrit à partir du descripteur réel
let seq = 0;
const report = (reportId, bytes) => ({ reportId, items: [{ reportSize: 8, reportCount: bytes }] });
const member = (vid, pid, collection, name = 'Gaming Mouse') => {
  seq++;
  return Object.assign(new EventTarget(), {
    vendorId: vid, productId: pid, productName: name,
    parsed: [{ children: [], inputReports: [], outputReports: [], featureReports: [], ...collection }],
    info: { interface: 1, usage_page: collection.usagePage, usage: collection.usage, path: 'chemin-' + seq, unit: 'appareil-' + seq },
    async open() { this.opened = true; },
    async close() { this.opened = false; },
  });
};
const hexBytes = hex => Uint8Array.from(hex.match(/../g), x => parseInt(x, 16));

// ---------- Redgear X13 Pro : rapport de fonction 3 (39 octets de réglages) ----------

// Rapport lu sur une vraie X13 Pro par OpenMouse (ID 3 en tête) : 4000 DPI (code 5), 1000 Hz (code 3)
const X13_STATUS = hexBytes(X13_NATIVE_STATUS_HEX);

function x13Mouse({ keepWrites = true } = {}) {
  const dev = member(0x1B80, 0xB412, { usagePage: 0xFF00, usage: 1, featureReports: [report(3, 39)] }, 'X13 Pro');
  const sim = { payload: X13_STATUS.slice(1), writes: [] };
  dev.receiveFeatureReport = async (id, len) => {
    assert.equal(id, 3);
    assert.equal(len, 39, 'taille lue dans le descripteur, sans l’octet d’ID');
    return new DataView(sim.payload.slice().buffer);
  };
  dev.sendFeatureReport = async (id, data) => {
    assert.equal(id, 3);
    const bytes = new Uint8Array(data).slice();
    assert.equal(bytes.length, 39);
    sim.writes.push(bytes);
    if (keepWrites) sim.payload = bytes;
  };
  return { dev, sim };
}

test('Redgear X13 Pro : reconnu seulement avec son rapport de fonction 3 de 39 octets', t => {
  tauri(t);
  const { dev } = x13Mouse();
  assert.equal(om.driver.match(dev), true);
  assert.equal(om.claims(dev, [dev]), true);
  assert.equal(om.driver.match(member(0x1B80, 0xB412, { usagePage: 0xFF00, usage: 1, featureReports: [report(3, 64)] })), false);
  assert.equal(om.driver.match(member(0x1B80, 0xB412, { usagePage: 1, usage: 2 })), false);
  assert.equal(om.driver.match(member(0x1B80, 0xB413, { usagePage: 0xFF00, usage: 1, featureReports: [report(3, 39)] })), false);
});

test('Redgear X13 Pro : lecture puis DPI et fréquence écrits et relus', async t => {
  tauri(t);
  const { dev, sim } = x13Mouse();
  const [mouse] = await om.driver.connect(dev, [dev]);
  assert.equal(mouse.key, 'om-1B80B412');
  assert.equal(mouse.name, 'Redgear X13 Pro');
  assert.equal(mouse.kind, 'souris');
  assert.equal(mouse.meta, 'Filaire');
  assert.match(mouse.source, /pas encore confirmé sur ce modèle/);
  assert.deepEqual(mouse.state, { dpi: 4000, rate: 1000 });
  assert.deepEqual(Object.keys(mouse.caps), ['dpi', 'rate']);
  assert.deepEqual(mouse.caps.dpi, { min: 400, max: 4800, step: 400, presets: [400, 800, 1600, 3200], options: [400, 800, 1200, 2400, 3200, 4000, 4800] });
  assert.deepEqual(mouse.caps.rate, [125, 250, 500, 1000]);
  assert.equal(sim.writes.length, 0, 'rien n’est écrit à la connexion');

  // 1600 n'existe pas sur cette souris : la valeur la plus proche (1200, code 2)
  await mouse.set('dpi', 1600);
  await mouse.set('rate', 500);
  const expected = X13_STATUS.slice(1);
  expected[0] = 2;
  assert.deepEqual([...sim.writes[0]], [...expected], 'seul l’octet du DPI change');
  expected[1] = 2;
  assert.deepEqual([...sim.writes[1]], [...expected], 'puis seul celui de la fréquence');
  await mouse.refresh();
  assert.deepEqual(mouse.state, { dpi: 1200, rate: 500 });
});

test('Redgear X13 Pro : un réglage que la souris ne garde pas est signalé', async t => {
  tauri(t);
  const { dev, sim } = x13Mouse({ keepWrites: false });
  const [mouse] = await om.driver.connect(dev, [dev]);
  await assert.rejects(mouse.set('dpi', 800), /read-back mismatch/);
  assert.equal(sim.writes.length, 1);
});

// ---------- AJAZZ AJ200 / AJ200P AI : sortie 0x0B [cmd, longueur, données], réponses 0x0A / 0x0B ----------

const AJ = { info: 0x13, keys: 0x15, setKeys: 0x16, settings: 0x17, setSettings: 0x18, dpi: 0x19, setDpi: 0x1A };

function ajMouse(pid, blocks) {
  const dev = member(0x363C, pid, {
    usagePage: 0xFFA0, usage: 2,
    inputReports: [report(0x0A, 127), report(0x0B, 127)], outputReports: [report(0x0B, 127)],
  });
  const sim = { ...blocks, log: [], keepWrites: true };
  const reply = (reportId, bytes) => setTimeout(() => dev.dispatchEvent(Object.assign(new Event('inputreport'),
    { reportId, data: new DataView(bytes.buffer) })), 1);
  dev.sendReport = async (id, data) => {
    assert.equal(id, 0x0B);
    const body = new Uint8Array(data);
    assert.equal(body.length, 127);
    const [cmd, len] = body;
    assert.ok(body.subarray(2 + len).every(b => b === 0), 'fin du rapport à zéro');
    sim.log.push(cmd);
    const reads = { [AJ.info]: 'info', [AJ.keys]: 'keys', [AJ.settings]: 'settings', [AJ.dpi]: 'dpi' };
    const writes = { [AJ.setKeys]: 'keys', [AJ.setSettings]: 'settings', [AJ.setDpi]: 'dpi' };
    let out;
    if (reads[cmd]) out = sim[reads[cmd]];
    else if (writes[cmd]) {
      if (sim.keepWrites) sim[writes[cmd]] = body.slice(2, 2 + len);
      out = new Uint8Array(0);
    } else assert.fail('commande inattendue 0x' + cmd.toString(16));
    // Un rapport d'une autre commande arrive d'abord : il doit être ignoré
    reply(0x0A, new Uint8Array(127).fill(0x55));
    const r = new Uint8Array(127);
    // Longueur : données seules pour la table DPI, données + octet d'état pour le reste
    r.set([cmd, cmd === AJ.dpi ? out.length : out.length + 1, 0]);
    r.set(out, 3);
    reply(0x0B, r);
  };
  return { dev, sim };
}

// Identité (54 octets) : récepteur 1.0.5, souris 3.3.13, batterie, liaison, profil 1
const ajInfo = (wireless, battery) => {
  const d = new Uint8Array(54);
  d.set([0x05, 1, 0x3D, 3], 7);
  d[14] = battery;
  d[16] = wireless ? 1 : 0;
  return d;
};
// Réglages : [0] fréquence sans fil, [1] filaire, [2] paliers, [3] palier actif, [6] LOD, [7] anti-rebond,
// [8] Motion Sync, [10] correction d'angle, [15] économie d'énergie, [21..23] couleur, [25] veille ×10 s
const ajSettings = (length, values) => {
  const s = new Uint8Array(length);
  for (const [i, v] of Object.entries(values)) s[i] = v;
  return s;
};
// Table DPI à 6 octets par palier (PAW3311 / 3395 / 3950) : code = DPI / 50 - 1
const ajDpi6 = dpis => Uint8Array.from(dpis.flatMap((v, i) => [v / 50 - 1, v / 50 - 1, 0, 0xFF, i * 16, 0]));
// Table DPI à 8 octets par palier (PAW3955) : X et Y sur 20 bits
const ajDpi8 = dpis => Uint8Array.from(dpis.flatMap(v => [((v >> 16) << 4) | (v >> 16), v & 255, (v >> 8) & 255, v & 255, (v >> 8) & 255, 0, 0xFF, 0]));
const AJ_KEYS = [1, 1, 0, 1, 4, 0, 1, 2, 0, 1, 8, 0, 1, 16, 0, 2, 1, 0, 0, 0, 0];
const AJ_KEYS_WHEEL = [...AJ_KEYS, 9, 1, 0, 9, 2, 0, 3, 1, 0, 3, 2, 0];

test('AJAZZ AJ200 AI : tous les modèles d’OpenMouse déclarés, expérimentaux, sur la seule collection 0xFFA0/2', t => {
  tauri(t);
  const devices = JSON.parse(fs.readFileSync(new URL('../data/devices.json', import.meta.url), 'utf8'));
  const added = devices.filter(d => d.vid === '363C' || d.vid === '1B80');
  const pid = n => n.toString(16).toUpperCase().padStart(4, '0');
  assert.deepEqual(added.filter(d => d.vid === '363C').map(d => d.pid).sort(), [...AJ200P_PRODUCTS.keys()].map(pid).sort());
  assert.deepEqual(added.filter(d => d.vid === '1B80').map(d => d.pid), ['B412']);
  for (const d of added) {
    assert.equal(d.status, 'experimental', d.name);
    assert.equal(d.plugin, 'openmouse', d.name);
    assert.equal(d.kind, 'souris', d.name);
  }
  for (const id of AJ200P_PRODUCTS.keys()) {
    const dev = ajMouse(id, {}).dev;
    assert.equal(om.driver.match(dev), true, pid(id));
    assert.equal(om.claims(dev, [dev]), true, pid(id));
    assert.equal(om.driver.match(member(0x363C, id, { usagePage: 1, usage: 2 })), false, pid(id) + ' souris standard');
  }
  assert.equal(om.driver.match(ajMouse(0xED99, {}).dev), false, 'modèle inconnu');
});

test('AJAZZ AJ200P NL AI ULTRA (dongle) : lecture complète puis DPI, fréquence et Motion Sync relus', async t => {
  tauri(t);
  const settings = ajSettings(31, { 0: 32, 1: 64, 2: 4, 3: 1, 6: 1, 7: 4, 8: 1, 21: 0xFF, 25: 6, 26: 12, 27: 1, 28: 255, 29: 3 });
  const dpi = ajDpi6([400, 800, 1600, 3200, 6400, 6400, 6400, 6400]);
  const { dev, sim } = ajMouse(0xED0A, { info: ajInfo(true, 76), settings, dpi, keys: Uint8Array.from(AJ_KEYS) });
  const [mouse] = await om.driver.connect(dev, [dev]);
  assert.deepEqual(sim.log, [AJ.info, AJ.settings, AJ.dpi, AJ.keys, AJ.info], 'lecture seule à la connexion');
  assert.equal(mouse.key, 'om-363CED0A');
  assert.equal(mouse.name, 'AJAZZ AJ200P NL AI ULTRA');
  assert.equal(mouse.kind, 'souris');
  assert.equal(mouse.meta, 'Sans fil · firmware Mouse 3.3.13 / Receiver 1.0.5');
  assert.deepEqual(mouse.state, {
    battery: { level: 76, charging: false }, dpi: 800, rate: 4000, lod: 'Medium',
    motionSync: true, angleSnapping: false, performance: true, debounce: 4, sleep: 60,
  });
  assert.deepEqual({ ...mouse.caps.dpi, options: mouse.caps.dpi.options.length },
    { min: 50, max: 42000, step: 50, presets: [400, 800, 1600, 3200, 6400], options: 840 });
  assert.deepEqual(mouse.caps.rate, [125, 250, 500, 1000, 2000, 4000]);
  assert.deepEqual(mouse.caps.lod, ['Low', 'Medium', 'High']);
  assert.equal(mouse.caps.debounce.max, 20);
  assert.deepEqual(mouse.caps.sleep, [10, 30, 60, 120, 180, 300, 900, 1800]);

  // DPI du palier actif (le 2e) : X et Y, rien d'autre dans la table
  sim.log = [];
  await mouse.set('dpi', 1650);
  assert.deepEqual(sim.log, [AJ.info, AJ.settings, AJ.dpi, AJ.info, AJ.setDpi, AJ.info, AJ.dpi, AJ.info]);
  const dpiAfter = dpi.slice();
  dpiAfter.set([32, 32, 0], 6);
  assert.deepEqual([...sim.dpi], [...dpiAfter]);

  // Fréquence sans fil ([0] = 1 pour 1000 Hz), puis Motion Sync ([8]) : le reste des réglages est gardé
  sim.log = [];
  await mouse.set('rate', 1000);
  assert.deepEqual(sim.log, [AJ.info, AJ.settings, AJ.info, AJ.info, AJ.setSettings, AJ.info, AJ.settings, AJ.info]);
  await mouse.set('motionSync', false);
  const settingsAfter = settings.slice();
  settingsAfter[0] = 1;
  settingsAfter[8] = 0;
  assert.deepEqual([...sim.settings], [...settingsAfter]);

  await mouse.refresh();
  assert.equal(mouse.state.dpi, 1650);
  assert.equal(mouse.state.rate, 1000);
  assert.equal(mouse.state.motionSync, false);
});

test('AJAZZ AJ200P AI MASTER (PAW3955, molette) : DPI au point près jusqu’à 80 000, écriture non gardée refusée', async t => {
  tauri(t);
  const settings = ajSettings(39, { 0: 64, 1: 64, 2: 2, 3: 1, 6: 2, 10: 1, 15: 1, 25: 30, 26: 36 });
  const dpi = ajDpi8([800, 26000, 800, 800, 800, 800, 800, 800]);
  const { dev, sim } = ajMouse(0xED1C, { info: ajInfo(true, 100), settings, dpi, keys: Uint8Array.from(AJ_KEYS_WHEEL) });
  const [mouse] = await om.driver.connect(dev, [dev]);
  assert.equal(mouse.name, 'AJAZZ AJ200P AI MASTER');
  assert.deepEqual(mouse.state, {
    battery: { level: 100, charging: false }, dpi: 26000, rate: 8000, lod: 'High',
    motionSync: false, angleSnapping: true, performance: false, debounce: 0, sleep: 300,
  });
  assert.equal(mouse.caps.dpi.min, 1);
  assert.equal(mouse.caps.dpi.max, 80000);
  assert.equal(mouse.caps.dpi.step, 1);
  assert.deepEqual(mouse.caps.rate, [125, 250, 500, 1000, 2000, 4000, 8000]);

  await mouse.set('dpi', 80000);
  const dpiAfter = dpi.slice();
  dpiAfter.set([0x11, 0x80, 0x38, 0x80, 0x38], 8);
  assert.deepEqual([...sim.dpi], [...dpiAfter], 'palier 2 seulement, bits hauts de X et Y');
  await mouse.refresh();
  assert.equal(mouse.state.dpi, 80000);

  // La souris ignore l'écriture : la relecture le voit, l'erreur remonte, la table n'a pas bougé
  sim.keepWrites = false;
  await assert.rejects(mouse.set('dpi', 12345), /read-back differed/);
  assert.deepEqual([...sim.dpi], [...dpiAfter]);
});
