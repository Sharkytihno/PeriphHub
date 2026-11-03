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

test('Logitech HID++ 1.0 (trop ancien) : ignoré proprement', async () => {
  const { drivers } = loadDrivers('logitech.js');
  const dev = new HidppMouse({});
  dev.handle = (orig => function (feat, fn, p) { return feat === 0 && fn === 1 ? [1, 0, p[2]] : orig.call(this, feat, fn, p); })(dev.handle);
  assert.equal((await drivers[0].connect(dev, [dev])).length, 0);
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
