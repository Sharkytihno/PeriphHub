// Tests des pilotes contre des appareils simulés : vérifient octet par octet ce que PeriphHub
// envoie, d'après les protocoles documentés par les projets libres (Solaar, OpenRazer, OpenRGB).
//   node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDrivers, FakeHid } from './harness.mjs';
import { HidppMouse } from './sim/hidpp.mjs';
import { RazerSim } from './sim/razer.mjs';

// Les tableaux créés dans le contexte des pilotes ont un autre prototype : on compare leur contenu
const eq = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b);
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join(' ');

// ---------- Logitech HID++ 2.0 ----------
test('Logitech filaire : nom, DPI par plage, fréquence 8060, molette, batterie', async () => {
  const { drivers } = loadDrivers('logitech.js');
  const lg = drivers.find(d => d.id === 'logitech-hidpp');
  const dev = new HidppMouse({ name: 'G502 HERO', dpi: { min: 100, max: 25600, step: 50, cur: 1600 }, rateMask: 0x8B, wheel: 0x01, battery: 77 });
  assert.ok(lg.match(dev));
  const [inst] = await lg.connect(dev, [dev]);
  assert.equal(inst.name, 'Logitech G502 HERO');
  assert.equal(inst.kind, 'souris');
  assert.deepEqual({ ...inst.caps.dpi, presets: undefined }, { min: 100, max: 25600, step: 50, presets: undefined });
  eq(inst.caps.rate, [125, 250, 500, 1000]); // bit n = n+1 ms : masque 0x8B = 1, 2, 4 et 8 ms
  assert.equal(inst.state.dpi, 1600);
  assert.equal(inst.state.battery.level, 77);
  await inst.set('dpi', 3200);
  assert.equal(dev.state.dpi, 3200);
  await inst.set('rate', 500);
  assert.equal(dev.state.rate, 2);
  // La molette garde son bit 0 (détournement HID++) : sinon elle ne défilerait plus
  await inst.set('hires', true);
  assert.equal(dev.state.wheel, 0x03);
  await inst.set('invert', true);
  assert.equal(dev.state.wheel, 0x07);
});

test('Logitech : la fréquence 8060 ignore les périodes non entières (3 ms) et absentes (8 ms)', async () => {
  const { drivers } = loadDrivers('logitech.js');
  const dev = new HidppMouse({ dpi: { list: [400, 800, 1600], cur: 800 }, rateMask: 0x0F });
  const [inst] = await drivers[0].connect(dev, [dev]);
  eq(inst.caps.rate, [250, 500, 1000]); // masque 0x0F = 1, 2, 3, 4 ms
  eq(inst.caps.dpi.list, [400, 800, 1600]);
  await inst.set('dpi', 1000); // liste fermée : valeur la plus proche
  assert.equal(dev.state.dpi, 800);
});

test('Logitech derrière un récepteur : emplacement 2 trouvé, fréquence étendue 8061', async () => {
  const { drivers } = loadDrivers('logitech.js');
  const dev = new HidppMouse({ index: 2, name: 'PRO X SUPERLIGHT', dpi: { min: 100, max: 25600, step: 50 }, extRateMask: 0x7F });
  const [inst] = await drivers[0].connect(dev, [dev]);
  assert.match(inst.meta, /emplacement 2/);
  eq(inst.caps.rate, [125, 250, 500, 1000, 2000, 4000, 8000]);
  await inst.set('rate', 4000);
  assert.equal(dev.state.extRate, 5);
});

test('Logitech DPI étendu 0x2202 (Superlight 2) : liste paginée, écriture X=Y, refus hors liste', async () => {
  const { drivers } = loadDrivers('logitech.js');
  const values = []; for (let v = 100; v <= 32000; v += 50) values.push(v);
  // Liste compressée telle que l'envoie la souris : 100, puis « pas 50 jusqu'à 32000 »
  const dev = new HidppMouse({ name: 'PRO X 2', extDpi: { values: [100, 0xE000 | 50, 32000], cur: 800 } });
  // Le simulateur stocke la liste compressée mais valide sur les valeurs réelles
  dev.o.extDpi.values = values;
  dev.handle = (orig => function (feat, fn, p) {
    if (feat === 0x2202 && fn === 2) {
      const bytes = [0, 100, 0xE0, 50, 0x7D, 0x00, 0, 0];
      return [p[0], p[1], p[2], ...bytes.slice(p[2] * 13, p[2] * 13 + 13)];
    }
    return orig.call(this, feat, fn, p);
  })(dev.handle);
  const [inst] = await drivers[0].connect(dev, [dev]);
  assert.equal(inst.caps.dpi.min, 100);
  assert.equal(inst.caps.dpi.max, 32000);
  assert.equal(inst.caps.dpi.step, 50);
  assert.equal(inst.state.dpi, 800);
  await inst.set('dpi', 1234); // arrondi au pas
  assert.deepEqual(dev.writes.at(-1), [0x2202, 6, [0, 0x04, 0xE2, 0x04, 0xE2, 0]]); // 1250 sur X et Y
});

test('Logitech éclairage 0x8070 (G502 HERO, 2 zones) : index par zone, contrôle logiciel, RAM seulement', async () => {
  const { drivers } = loadDrivers('logitech.js');
  // Zone 0 (logo) : éteint, fixe, cycle, respiration ; zone 1 (bande) : éteint, fixe seulement
  const dev = new HidppMouse({ dpi: { list: [800], cur: 800 }, led: [[0x00, 0x01, 0x03, 0x0A], [0x00, 0x01]] });
  const [inst] = await drivers[0].connect(dev, [dev]);
  eq(inst.caps.light.effects, ['off', 'static', 'breathing', 'spectrum']);
  await inst.set('light', { effect: 'static', color: '#ff8000' });
  const fx = dev.writes.filter(w => w[0] === 0x8070);
  eq(fx[0], [0x8070, 8, [1]]); // l'ordinateur prend la main avant le premier effet
  eq(fx[1], [0x8070, 3, [0, 1, 0xFF, 0x80, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]]); // octet 12 = 0 : pas d'écriture en flash
  eq(fx[2], [0x8070, 3, [1, 1, 0xFF, 0x80, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]]);
  await inst.set('light', { effect: 'breathing', color: '#00ff00' });
  const last = dev.writes.filter(w => w[0] === 0x8070);
  assert.equal(last.length, 4); // une seule prise de main ; la zone 1 sans respiration est sautée
  eq(last[3], [0x8070, 3, [0, 3, 0, 0xFF, 0, 0x13, 0x88, 0, 100, 0, 0, 0, 0]]);
  assert.equal(inst.state.light.effect, 'breathing');
});

test("Logitech sans 0x8070 : pas de réglage d'éclairage proposé", async () => {
  const { drivers } = loadDrivers('logitech.js');
  const dev = new HidppMouse({ dpi: { list: [800], cur: 800 } });
  const [inst] = await drivers[0].connect(dev, [dev]);
  assert.equal(inst.caps.light, undefined);
});

test('Logitech HID++ 1.0 (trop ancien) : ignoré proprement', async () => {
  const { drivers } = loadDrivers('logitech.js');
  const dev = new HidppMouse({});
  dev.handle = (orig => function (feat, fn, p) { return feat === 0 && fn === 1 ? [1, 0, p[2]] : orig.call(this, feat, fn, p); })(dev.handle);
  assert.equal((await drivers[0].connect(dev, [dev])).length, 0);
});

// Récepteur Lightspeed (046D:C54D) comme sous Windows : collection longue (usage 2) + courte (usage 1).
// Souris en veille au démarrage : le récepteur répond « injoignable » (0x8F) sur la collection courte.
function lightspeed({ asleep }) {
  const mouse = new HidppMouse({ pid: 0xC54D, index: 1, name: 'G PRO X SUPERLIGHT 2', dpi: { min: 100, max: 32000, step: 50 } });
  const short = new FakeHid({ vendorId: 0x046D, productId: 0xC54D, productName: 'USB Receiver', usagePage: 0xFF00, usage: 1 });
  const recv = { asleep, flags: [0, 0, 0], writes: [] };
  const onLong = mouse.onReport.bind(mouse);
  mouse.onReport = (id, b) => {
    if (b[0] === 0xFF || recv.asleep || b[0] !== mouse.index) return short.emit(0x10, [b[0], 0x8F, b[1], b[2], b[0] === 0xFF ? 0x01 : 0x09, 0]);
    onLong(id, b);
  };
  short.onReport = (id, b) => {
    assert.equal(id, 0x10); assert.equal(b.length, 6);
    const [idx, sub, addr, ...p] = b;
    if (idx !== 0xFF) return;
    if (sub === 0x81 && addr === 0x00) return short.emit(0x10, [0xFF, 0x81, 0x00, ...recv.flags]);
    if (sub === 0x80) {
      recv.writes.push([addr, ...p]);
      if (addr === 0x00) recv.flags = p;
      if (addr === 0x02 && !recv.asleep) short.emit(0x10, [1, 0x41, 0x04, 0x00, 0x01, 0x00]);
      return short.emit(0x10, [0xFF, 0x80, addr, 0, 0, 0]);
    }
    short.emit(0x10, [0xFF, 0x8F, sub, addr, 0x02, 0]);
  };
  return { mouse, short, recv };
}

test('Récepteur Lightspeed, souris en veille : attente, notifications activées, ajout au réveil (0x41)', async () => {
  const { drivers, ctx } = loadDrivers('logitech.js');
  const added = [];
  ctx.drvAdd = inst => added.push(inst);
  const { mouse, short, recv } = lightspeed({ asleep: true });
  const t0 = Date.now();
  await assert.rejects(drivers[0].connect(mouse, [short, mouse]), e => e.waiting === true);
  assert.ok(Date.now() - t0 < 1500, 'les erreurs 0x8F de la collection courte évitent d’attendre chaque emplacement');
  eq([...recv.flags], [0, 1, 0]);
  assert.ok(recv.writes.some(w => w[0] === 0x02 && w[1] === 0x02), 'demande aux appareils de s’annoncer');
  assert.ok(short.opened && mouse.opened, 'écoute gardée ouverte');
  // La souris se réveille : le récepteur l'annonce sur la collection courte
  recv.asleep = false;
  short.emit(0x10, [1, 0x41, 0x04, 0x00, 0x01, 0x00]);
  for (let i = 0; i < 40 && !added.length; i++) await new Promise(r => setTimeout(r, 50));
  assert.equal(added.length, 1);
  assert.equal(added[0].name, 'Logitech G PRO X SUPERLIGHT 2');
  assert.match(added[0].meta, /emplacement 1/);
  // Deuxième annonce : pas de doublon
  short.emit(0x10, [1, 0x41, 0x04, 0x00, 0x01, 0x00]);
  await new Promise(r => setTimeout(r, 500));
  assert.equal(added.length, 1);
});

test('Récepteur Lightspeed, souris allumée : trouvée tout de suite, rapports longs sur la collection longue seulement', async () => {
  const { drivers } = loadDrivers('logitech.js');
  const { mouse, short } = lightspeed({ asleep: false });
  const list = await drivers[0].connect(mouse, [short, mouse]);
  assert.equal(list.length, 1);
  assert.ok(mouse.sent.every(([id]) => id === 0x11));
  assert.ok(short.sent.every(([id]) => id === 0x10));
});

// ---------- Razer (OpenRazer) ----------
for (const tid of [0x1F, 0x3F, 0xFF]) {
  test(`Razer : id de transaction 0x${tid.toString(16)} trouvé, DPI / fréquence / éclairage`, async () => {
    const { drivers } = loadDrivers('razer-chroma.js');
    const rz = drivers[0];
    const dev = new RazerSim({ tid, dpi: 1600, rate: 2 });
    assert.ok(rz.match(dev));
    const [inst] = await rz.connect(dev, [dev]);
    assert.equal(inst.kind, 'souris');
    assert.equal(inst.meta, 'firmware 2.3');
    assert.equal(inst.state.dpi, 1600);
    assert.equal(inst.state.rate, 500);
    assert.equal(inst.caps.battery, false); // filaire : pas de batterie annoncée
    await inst.set('dpi', 3200);
    assert.deepEqual(dev.log.at(-1), [0x04, 0x05, [0x01, 0x0C, 0x80, 0x0C, 0x80, 0, 0]]);
    await inst.set('rate', 1000);
    assert.equal(dev.state.rate, 1);
    await inst.set('light', { effect: 'static', color: '#ff8000', brightness: 100 });
    assert.deepEqual(dev.log.at(-1), [0x0F, 0x02, [0x01, 0x00, 0x01, 0, 0, 0x01, 0xFF, 0x80, 0x00]]);
    await inst.set('light', { effect: 'static', color: '#ff8000', brightness: 50 });
    assert.equal(dev.state.brightness, 128);
  });
}

test('Razer clavier : LED 0x05 (rétroéclairage), pas de DPI', async () => {
  const { drivers } = loadDrivers('razer-chroma.js');
  const dev = new RazerSim({ kind: 'clavier', pid: 0x0203 });
  const [inst] = await drivers[0].connect(dev, [dev]);
  assert.equal(inst.kind, 'clavier');
  assert.equal(inst.caps.dpi, undefined);
  await inst.set('light', { effect: 'spectrum', color: '#ffffff', brightness: 100 });
  assert.deepEqual(dev.log.at(-1), [0x0F, 0x02, [0x01, 0x05, 0x03, 0, 0, 0]]);
});

test('Razer sans fil : batterie lue (0-255 → %)', async () => {
  const { drivers } = loadDrivers('razer-chroma.js');
  const dev = new RazerSim({ battery: 60 });
  const [inst] = await drivers[0].connect(dev, [dev]);
  assert.equal(inst.state.battery.level, 60);
});

// ---------- SteelSeries Apex 3 / 3 TKL (OpenRGB) ----------
test('Apex 3 : luminosité puis 10 zones, rapports de 32 octets', async () => {
  const { drivers } = loadDrivers('steelseries-apex.js');
  const dev = new FakeHid({ vendorId: 0x1038, productId: 0x161A, iface: 3 });
  assert.ok(drivers[0].match(dev));
  const [inst] = await drivers[0].connect(dev);
  await inst.set('light', { effect: 'static', color: '#102030', brightness: 50 });
  assert.equal(dev.sent.length, 2);
  for (const [id, b] of dev.sent) { assert.equal(id, 0); assert.equal(b.length, 32); }
  assert.equal(hex(dev.sent[0][1].slice(0, 3)), '0a 00 32');
  assert.equal(hex(dev.sent[1][1].slice(0, 8)), '0b 00 10 20 30 10 20 30');
  assert.equal(hex(dev.sent[1][1].slice(29, 32)), '10 20 30'); // 10e zone
});

test('Apex 3 TKL : 8 zones (0x21 0xFF) puis luminosité 0-16, rapports de 64 octets', async () => {
  const { drivers } = loadDrivers('steelseries-apex.js');
  const dev = new FakeHid({ vendorId: 0x1038, productId: 0x1622, iface: 1, usagePage: 0xFFC0 });
  assert.ok(drivers[0].match(dev));
  const [inst] = await drivers[0].connect(dev);
  await inst.set('light', { effect: 'off', brightness: 100 });
  assert.equal(dev.sent[0][1].length, 64);
  assert.equal(hex(dev.sent[0][1].slice(0, 4)), '21 ff 00 00');
  assert.equal(hex(dev.sent[1][1].slice(0, 2)), '23 10');
});

test('Apex 3 : couleurs par zone et arc-en-ciel, chaque zone à sa place', async () => {
  const { drivers } = loadDrivers('steelseries-apex.js');
  const dev = new FakeHid({ vendorId: 0x1038, productId: 0x161A, iface: 3 });
  const [inst] = await drivers[0].connect(dev);
  const zones = Array.from({ length: 10 }, (_, i) => '#0000' + (i + 1).toString(16).padStart(2, '0'));
  await inst.set('light', { effect: 'zones', zones, brightness: 100 });
  const c = dev.sent[1][1];
  assert.equal(hex(c.slice(0, 5)), '0b 00 00 00 01');
  assert.equal(hex(c.slice(29, 32)), '00 00 0a');
  dev.sent.length = 0;
  await inst.set('light', { effect: 'rainbow', brightness: 100 });
  assert.equal(hex(dev.sent[1][1].slice(2, 5)), 'ff 00 00'); // 1re zone rouge
  assert.equal(hex(dev.sent[1][1].slice(29, 32)), 'ff 00 ff'); // 10e zone magenta (300°)
});

test('Apex 3 : effet animé envoyé à chaque image, arrêté par un effet fixe ou au débranchement', async () => {
  const { drivers, intervals } = loadDrivers('steelseries-apex.js');
  const dev = new FakeHid({ vendorId: 0x1038, productId: 0x161A, iface: 3 });
  const [inst] = await drivers[0].connect(dev);
  await inst.set('light', { effect: 'wave', speed: 3, brightness: 80 });
  assert.equal(intervals.filter(Boolean).length, 1);
  const n = dev.sent.length;
  await intervals.find(Boolean)();
  await intervals.find(Boolean)();
  assert.equal(dev.sent.length, n + 2);
  assert.equal(dev.sent.at(-1)[1][0], 0x0B); // couleurs seulement, pas la luminosité
  await inst.set('light', { effect: 'static', color: '#ffffff', brightness: 80 });
  assert.equal(intervals.filter(Boolean).length, 0);
  await inst.set('light', { effect: 'breathing', color: '#ff0000', brightness: 80 });
  inst.release();
  assert.equal(intervals.filter(Boolean).length, 0);
});

// ---------- Turtle Beach Vulcan II TKL Pro (OpenRGB RoccatVulcanKeyboardController) ----------
function vulcanDev(features = [0x11, 0x0E, 0x04, 0x09]) {
  const dev = new FakeHid({ vendorId: 0x10F5, productId: 0x5001, iface: 1, usagePage: 0x0001, usage: 0x80 });
  dev.collections = [{ usagePage: 0x0001, usage: 0x80, children: [], inputReports: [], outputReports: [],
    featureReports: features.map(reportId => ({ reportId, items: [] })) }];
  dev.featureReply = id => id === 0x04 ? [1, 0] : null;
  return dev;
}

test('Vulcan II TKL Pro : seule la collection qui porte le rapport 0x11 est prise', () => {
  const { drivers } = loadDrivers('steelseries-apex.js', 'turtle-vulcan.js');
  const vulcan = drivers.find(d => d.id === 'turtle-vulcan');
  assert.ok(vulcan.match(vulcanDev()));
  assert.equal(vulcan.match(vulcanDev([])), false);
  const other = vulcanDev(); other.info.interface = 4;
  assert.equal(vulcan.match(other), false);
});

test('Vulcan II TKL Pro : mode fixe (en-tête, 91 LED par canal, somme de contrôle) puis sortie du mode direct', async () => {
  const { drivers } = loadDrivers('steelseries-apex.js', 'turtle-vulcan.js');
  const dev = vulcanDev();
  const [inst] = await drivers.find(d => d.id === 'turtle-vulcan').connect(dev);
  await inst.set('light', { effect: 'static', color: '#102030', brightness: 100 });
  const [id, b] = dev.features[0];
  assert.equal(id, 0x11);
  assert.equal(b.length, 283); // 284 octets avec l'ID
  assert.equal(hex(b.slice(0, 8)), '1c 01 03 01 06 45 0b 01');
  assert.equal(b[8], 0x10); assert.equal(b[8 + 90], 0x10);          // R, touches 0 et 90
  assert.equal(b[8 + 91], 0x20); assert.equal(b[8 + 91 + 90], 0x20); // G
  assert.equal(b[8 + 182], 0x30); assert.equal(b[8 + 182 + 90], 0x30); // B
  const full = [0x11, ...b];
  const sum = full.slice(0, 282).reduce((a, x) => a + x, 0);
  assert.equal(full[282], sum & 0xFF);
  assert.equal(full[283], sum >> 8);
  assert.deepEqual(dev.features[1], [0x0E, Uint8Array.of(5, 0, 0, 0)]);
});

test('Vulcan II TKL Pro : vague arc-en-ciel avec vitesse, sans couleurs', async () => {
  const { drivers } = loadDrivers('steelseries-apex.js', 'turtle-vulcan.js');
  const dev = vulcanDev();
  const [inst] = await drivers.find(d => d.id === 'turtle-vulcan').connect(dev);
  await inst.set('light', { effect: 'wave', speed: 3, brightness: 50 });
  const b = dev.features[0][1];
  assert.equal(hex(b.slice(2, 6)), '03 0a 0a 23');
  assert.equal(b.slice(8, 281).every(x => x === 0), true);
});

// ---------- Casques en direct (protocoles HeadsetControl) ----------
test('HyperX Cloud Alpha Wireless : batterie lue sans HeadsetControl, retour micro en 2 commandes', async () => {
  const { drivers, ctx } = loadDrivers('headsets.js', 'headsets-native.js');
  Object.assign(ctx, { drvRender: () => {}, drvRelease: () => {}, document: { hidden: false }, lsGet: () => null, wantKey: () => '' });
  const dev = new FakeHid({ vendorId: 0x03F0, productId: 0x098D, iface: 3, usagePage: 0xFF43, usage: 0x0202 });
  const answers = { 0x03: 0, 0x0C: 0, 0x0B: 77 };
  dev.onReport = (id, b) => { if (b[1] in answers) dev.emit(0x21, [0xBB, b[1], answers[b[1]]]); };
  const drv = drivers.find(d => d.id === 'headset-native');
  assert.ok(drv.match(dev));
  const [inst] = await drv.connect(dev);
  assert.deepEqual({ ...inst.state.battery }, { level: 77, charging: false });
  assert.ok(ctx.hsNativeIds.has('03F0:098D'));
  assert.equal(dev.sent[0][1].length, 30);
  dev.sent.length = 0;
  await inst.set('sidetone', 50);
  assert.deepEqual(dev.sent.map(([id, b]) => [id, hex(b.slice(0, 3))]), [[0x21, 'bb 10 01'], [0x21, 'bb 11 40']]);
  inst.release();
  assert.equal(ctx.hsNativeIds.has('03F0:098D'), false);
});

test('Apex : mauvaise interface refusée (le clavier a plusieurs interfaces)', () => {
  const { drivers } = loadDrivers('steelseries-apex.js');
  assert.equal(drivers[0].match(new FakeHid({ vendorId: 0x1038, productId: 0x161A, iface: 0 })), false);
  assert.equal(drivers[0].match(new FakeHid({ vendorId: 0x1038, productId: 0x1622, iface: 1, usagePage: 0x0001 })), false);
});

// ---------- Razer Kraken filaires (OpenRazer razerkraken_driver.c) ----------
test('Kraken V2 : lecture du mode et de la couleur, écriture couleur puis mode en RAM (0x40)', async () => {
  const { drivers } = loadDrivers('razer-kraken.js');
  const dev = new FakeHid({ vendorId: 0x1532, productId: 0x0510, iface: 3 });
  const mem = { 0x172D: [0x01], 0x1741: [0x00, 0xFF, 0x00] };
  dev.onReport = (id, b) => {
    assert.equal(id, 4); assert.equal(b.length, 36);
    const addr = (b[2] << 8) | b[3];
    if (b[0] === 0x00) dev.emit(5, [...(mem[addr] || [0]), ...new Array(35).fill(0)]);
    else if (b[0] === 0x40) mem[addr] = [...b.slice(4, 4 + b[1])];
  };
  assert.ok(drivers[0].match(dev));
  const [inst] = await drivers[0].connect(dev, [dev]);
  assert.equal(inst.state.light.effect, 'static');
  assert.equal(inst.state.light.color, '#00ff00');
  await inst.set('light', { effect: 'breathing', color: '#0000ff' });
  assert.deepEqual(mem[0x1741], [0, 0, 0xFF]);
  assert.deepEqual(mem[0x172D], [0x0B]);
  const writes = dev.sent.filter(([, b]) => b[0] === 0x40).map(([, b]) => (b[2] << 8) | b[3]);
  assert.deepEqual(writes, [0x1741, 0x172D]); // jamais d'autre adresse
});

// ---------- Corsair (ckb-next) ----------
import { CorsairNxpSim, CorsairBragiSim } from './sim/corsair.mjs';

for (const bigEndian of [false, true]) {
  test(`Corsair NXP (M65 PRO) : DPI de l'étage actif, relu ${bigEndian ? 'gros' : 'petit'}-boutiste, fréquence`, async () => {
    const { drivers } = loadDrivers('corsair.js');
    const dev = new CorsairNxpSim({ bigEndian, stage: 2, poll: 2 });
    assert.ok(drivers[0].match(dev));
    const [inst] = await drivers[0].connect(dev);
    assert.equal(inst.name, 'Corsair M65 PRO RGB');
    assert.equal(inst.state.dpi, 1600);
    assert.equal(inst.state.rate, 500);
    assert.equal(inst.meta, 'firmware 3.05');
    await inst.set('dpi', 2400);
    assert.equal(dev.dpi[2], 2400);  // étage actif seulement
    assert.equal(dev.dpi[1], 800);
    await inst.refresh();
    assert.equal(inst.state.dpi, 2400);
    await inst.set('rate', 1000);
    assert.equal(dev.poll, 1);
  });
}

test('Corsair NXP : réglage ignoré par la souris → erreur claire, pas de faux succès', async () => {
  const { drivers } = loadDrivers('corsair.js');
  const dev = new CorsairNxpSim({ ignoreWrites: true });
  const [inst] = await drivers[0].connect(dev);
  await assert.rejects(inst.set('dpi', 2000), /pas pris/);
});

test('Corsair NXP : mauvaise collection (clavier HID, page 0x01) refusée', () => {
  const { drivers } = loadDrivers('corsair.js');
  assert.equal(drivers[0].match(new FakeHid({ vendorId: 0x1B1C, productId: 0x1B2E, usagePage: 0x01, usage: 2 })), false);
  assert.equal(drivers[0].match(new FakeHid({ vendorId: 0x1B1C, productId: 0x1B5C, usagePage: 0xFFC2, usage: 4 })), false); // Nightsword : OpenMouse
});

test('Corsair Bragi filaire (Katar PRO) : DPI X et Y, fréquence', async () => {
  const { drivers } = loadDrivers('corsair.js');
  const dev = new CorsairBragiSim({ dpi: 1200, rate: 3 });
  assert.ok(drivers[0].match(dev));
  const [inst] = await drivers[0].connect(dev);
  assert.equal(inst.state.dpi, 1200);
  assert.equal(inst.state.rate, 500);
  assert.equal(inst.caps.battery, undefined);
  await inst.set('dpi', 3200);
  assert.equal(dev.props[0x21], 3200);
  assert.equal(dev.props[0x22], 3200);
  await inst.set('rate', 1000);
  assert.equal(dev.props[0x01], 4);
});

test('Corsair Bragi derrière le récepteur (Dark Core RGB PRO) : emplacement 1, batterie', async () => {
  const { drivers } = loadDrivers('corsair.js');
  const dev = new CorsairBragiSim({ pid: 0x1B81, slot: 1, battery: 735 });
  const [inst] = await drivers[0].connect(dev);
  assert.equal(inst.caps.battery, true);
  assert.equal(inst.state.battery.level, 74);
});

test('Corsair Bragi : DPI ignoré (mémoire intégrée) → erreur claire', async () => {
  const { drivers } = loadDrivers('corsair.js');
  const dev = new CorsairBragiSim({ ignoreWrites: true });
  const [inst] = await drivers[0].connect(dev);
  await assert.rejects(inst.set('dpi', 1600), /pas pris/);
});

// ---------- Manettes PlayStation ----------
import { PsSim } from './sim/playstation.mjs';

for (const bt of [false, true]) {
  test(`DualSense ${bt ? 'Bluetooth (CRC32, séquence)' : 'USB'} : batterie, mise en place puis couleur, voyants joueur`, async () => {
    const { drivers } = loadDrivers('playstation.js');
    const dev = new PsSim({ bt, status: 0x17 }); // en charge, palier 7
    const ps = drivers.find(d => d.id === 'playstation');
    assert.ok(ps.match(dev));
    const [inst] = await ps.connect(dev, [dev]);
    assert.equal(inst.name, 'Sony DualSense');
    eq(inst.state.battery, { level: 75, charging: true });
    assert.equal(dev.opened, false, 'la manette doit être refermée après lecture');
    await inst.set('light', { effect: 'static', color: '#ff8000', brightness: 50 });
    assert.equal(dev.setup, 1);
    eq([...dev.light], [128, 64, 0]);
    await inst.set('players', 0x15);
    assert.equal(dev.players, 0x15);
    eq([...dev.light], [128, 64, 0]); // la couleur est renvoyée avec les voyants
    assert.equal(dev.setup, 1, 'la mise en place ne se fait qu’une fois');
    await inst.set('light', { effect: 'off', color: '#ff8000', brightness: 50 });
    eq([...dev.light], [0, 0, 0]);
    assert.equal(dev.opened, false);
  });
}

test('DualSense pleine (état 0x2_) puis erreur de charge : pas de faux pourcentage', async () => {
  const { drivers } = loadDrivers('playstation.js');
  const dev = new PsSim({ status: 0x20 });
  const [inst] = await drivers[0].connect(dev, [dev]);
  eq(inst.state.battery, { level: 100, charging: false, label: 'Batterie pleine' });
  dev.o.status = 0xF0;
  await inst.refreshBattery();
  assert.equal(inst.state.battery, undefined);
});

for (const bt of [false, true]) {
  test(`DualShock 4 ${bt ? 'Bluetooth' : 'USB'} : batterie, couleur, clignotement`, async () => {
    const { drivers } = loadDrivers('playstation.js');
    const dev = new PsSim({ pid: 0x09CC, bt, status: 0x04 }); // sur batterie, palier 4
    const [inst] = await drivers[0].connect(dev, [dev]);
    eq(inst.state.battery, { level: 45, charging: false });
    await inst.set('light', { effect: 'static', color: '#00ff00', brightness: 100 });
    eq([...dev.light], [0, 255, 0]);
    eq(dev.blink, [0, 0]);
    await inst.set('light', { effect: 'blink', color: '#00ff00', brightness: 100 });
    eq(dev.blink, [50, 50]);
  });
}

test('Adaptateur sans fil DualShock 4 sans manette : signalé, pas de batterie', async () => {
  const { drivers } = loadDrivers('playstation.js');
  const dev = new PsSim({ pid: 0x0BA0, status: 0x00, status1: 0x04 });
  const [inst] = await drivers[0].connect(dev, [dev]);
  assert.equal(inst.off, true);
  assert.match(inst.meta, /Aucune manette/);
  assert.equal(inst.state.battery, undefined);
});

test('Sony : autre appareil (télécommande, page HID non manette) refusé', () => {
  const { drivers } = loadDrivers('playstation.js');
  assert.equal(drivers[0].match({ vendorId: 0x054C, productId: 0x0306, collections: [{ usagePage: 1, usage: 5 }] }), false);
  assert.equal(drivers[0].match({ vendorId: 0x054C, productId: 0x0CE6, collections: [{ usagePage: 0xFF00, usage: 1 }] }), false);
});

// ---------- Son Windows : regroupement par appareil ----------
test('Son : points de terminaison regroupés par appareil (USB, carte mère, écrans HDMI)', () => {
  const { ctx } = loadDrivers('media.js');
  // Relevé réel (PC de développement) : Realtek, casque Razer USB (sortie + micro), deux écrans HDMI
  const list = [
    { id: 'a', flow: 'render', adapter: 'Realtek(R) Audio', form: 1, vid: null, name: 'Haut-parleurs (Realtek(R) Audio)' },
    { id: 'b', flow: 'render', adapter: 'Razer BlackShark V2 HS 2.4', form: 1, vid: 0x1532, pid: 0x0565 },
    { id: 'c', flow: 'render', adapter: '2- AMD High Definition Audio Device', form: 9, vid: null, name: '4 - VG249QM1A' },
    { id: 'd', flow: 'render', adapter: '2- AMD High Definition Audio Device', form: 9, vid: null, name: '2 - GO27Q24G' },
    { id: 'e', flow: 'capture', adapter: 'Razer BlackShark V2 HS 2.4', form: 4, vid: 0x1532, pid: 0x0565 },
    { id: 'f', flow: 'capture', adapter: 'HyperX QuadCast S', form: 4, vid: 0x0951, pid: 0x171F },
    { id: 'g', flow: 'render', adapter: 'HyperX QuadCast S', form: 1, vid: 0x0951, pid: 0x171F }, // prise casque du micro
  ];
  const g = JSON.parse(JSON.stringify(ctx.audioGroups(list)));
  const by = Object.fromEntries(g.map(x => [x.name, x]));
  assert.equal(g.length, 4);
  eq(by['HyperX QuadCast S'].eps.map(e => e.id), ['g', 'f']);
  eq(by['Razer BlackShark V2 HS 2.4'].eps.map(e => e.id), ['b', 'e']);
  assert.equal(by['Razer BlackShark V2 HS 2.4'].kind, 'casque'); // sortie + micro USB : casque, sauf nom de micro connu
  assert.equal(by['HyperX QuadCast S'].kind, 'micro');
  assert.equal(by['Realtek(R) Audio'].kind, 'audio');
  eq(by['Son des écrans (AMD)'].eps.map(e => e.id), ['c', 'd']);
});

test('Son Bluetooth : sortie stéréo et mains libres d’un même casque = un seul appareil', () => {
  const { ctx } = loadDrivers('media.js');
  const list = [
    { id: 'a', flow: 'render', adapter: 'WH-1000XM4 Stereo', form: 3, vid: null, bus: 'bluetooth' },
    { id: 'b', flow: 'render', adapter: 'WH-1000XM4 Hands-Free AG Audio', form: 3, vid: null, bus: 'bluetooth' },
    { id: 'c', flow: 'capture', adapter: 'WH-1000XM4 Hands-Free AG Audio', form: 5, vid: null, bus: 'bluetooth' },
    // Hors Bluetooth, le nom n'est pas retouché
    { id: 'd', flow: 'render', adapter: 'Enceintes Stereo', form: 1, vid: null, bus: 'carte mère' },
  ];
  const g = JSON.parse(JSON.stringify(ctx.audioGroups(list)));
  assert.equal(g.length, 2);
  const bt = g.find(x => x.name === 'WH-1000XM4');
  eq(bt.eps.map(e => e.id), ['a', 'b', 'c']);
  assert.equal(bt.kind, 'casque');
  assert.ok(g.some(x => x.name === 'Enceintes Stereo'));
});

test('Batteries Bluetooth : type deviné par le nom, même appareil reconnu malgré la ponctuation', () => {
  const { ctx } = loadDrivers('media.js');
  const kinds = Object.fromEntries(['MX Master 3S', 'MX Keys Mini', 'Xbox Wireless Controller', 'DualSense Wireless Controller', 'WH-1000XM4',
    'Galaxy Buds2 Pro', 'AirPods Pro', 'JBL Flip 6', 'Bose QC45', 'Capteur 1234'].map(n => [n, ctx.btKind(n)]));
  eq(kinds, { 'MX Master 3S': 'souris', 'MX Keys Mini': 'clavier', 'Xbox Wireless Controller': 'manette', 'DualSense Wireless Controller': 'manette',
    'WH-1000XM4': 'casque', 'Galaxy Buds2 Pro': 'casque', 'AirPods Pro': 'casque', 'JBL Flip 6': 'audio', 'Bose QC45': 'casque', 'Capteur 1234': 'autre' });
  assert.equal(ctx.btSame('WH-1000XM4', 'wh1000xm4 Stereo'), true);
  assert.equal(ctx.btSame('Galaxy Buds2 Pro', 'Casque (Galaxy Buds2 Pro)'), true);
  assert.equal(ctx.btSame('MX Master 3S', 'MX Keys'), false);
  assert.equal(ctx.btSame('JBL', 'JBL Flip 6'), false); // nom trop court : pas de rapprochement hasardeux
});

test('OpenRGB : vitesse en %, bornes croissantes ou inversées', () => {
  const { ctx } = loadDrivers('openrgb.js');
  assert.equal(ctx.orgbPct({ min: 0, max: 4, value: 2 }), 50);
  assert.equal(ctx.orgbSpeed({ min: 0, max: 4 }, 100), 4);
  // Inversées : 0x0A = la plus lente, 0x00 = la plus rapide
  assert.equal(ctx.orgbPct({ min: 10, max: 0, value: 0 }), 100);
  assert.equal(ctx.orgbSpeed({ min: 10, max: 0 }, 0), 10);
  assert.equal(ctx.orgbSpeed({ min: 10, max: 0 }, 50), 5);
  eq(ctx.hexRgb('#ff8000'), [255, 128, 0]);
});
