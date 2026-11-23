// Échanges de 64 octets d'après les protocoles embarqués d'OpenMouse, sans matériel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeHid } from './harness.mjs';

globalThis.window = { __TAURI__: {} };
globalThis.devId = dev => [dev.vendorId, dev.productId].map(n => n.toString(16).padStart(4, '0')).join(':');
await import('../ui/js/drivers/openmouse.js');
const driver = window.omApi.keyboardDrivers.find(d => d.id === 'openmouse-kb-extra');

function keyboard(vendorId, productId, usagePage, usage = 1, unit = 'clavier') {
  const dev = new FakeHid({ vendorId, productId, usagePage, usage });
  dev.collections[0].children = [];
  Object.assign(dev.info, { usage_page: usagePage, usage, unit, path: `${unit}-${usagePage}-${usage}` });
  return dev;
}

const report = bytes => [...bytes, ...Array(64 - bytes.length).fill(0)];
const wuqueModels = [[0x1CA6, 0x1B10], [0x1CA6, 0x1B0A], [0x36B5, 0x75D4], [0x36B5, 0x75D2], [0x1CA6, 0x1B09]];
const arbiterModels = [
  [0x1A81, 0x2072, 0xFF01], [0x1A81, 0x2072, 0xFF02], [0x1A81, 0x208E, 0xFF02],
  [0x1A81, 0x2077, 0xFF01], [0x371C, 0xA005, 0xFF02], [0x371C, 0xA006, 0xFF01],
  [0x371C, 0xA003, 0xFF02], [0x371C, 0xA009, 0xFF02], [0x371C, 0xA001, 0xFF02],
];
const kochiModel = [0x1CA2, 0x0901, 0xFFA0];

test('Claviers OpenMouse supplémentaires : chaque identifiant testé est déclaré expérimental', () => {
  const data = JSON.parse(readFileSync(new URL('../data/devices.json', import.meta.url), 'utf8'));
  const entries = data.filter(d => d.plugin === driver.id);
  const tested = new Set([...wuqueModels, ...arbiterModels, kochiModel].map(([vendorId, productId]) => devId({ vendorId, productId })));
  assert.equal(entries.length, tested.size);
  for (const entry of entries) {
    assert.ok(tested.delete(`${entry.vid}:${entry.pid}`.toLowerCase()));
    assert.equal(entry.kind, 'clavier');
    assert.equal(entry.status, 'experimental');
  }
});

function wuqueReply(dev, { ignoresWrite = false, rates = [0, 1, 2, 3, 4, 5] } = {}) {
  let current = 3;
  dev.onReport = (id, bytes) => {
    const [, , access, rate] = bytes;
    assert.equal(id, 0);
    assert.deepEqual([...bytes], report(access === 2 ? [2, 5, 2, rate] : [2, 5, access]));
    if (access === 0) dev.emit(0, report([2, 5, 0, rates.length, ...rates]));
    else if (access === 1) dev.emit(0, report([2, 5, 1, current]));
    else {
      assert.equal(access, 2);
      assert.ok(rates.includes(rate));
      if (!ignoresWrite) current = rate;
      dev.emit(0, report([2, 5, 2, rate]));
    }
  };
  return rate => { current = rate; };
}

for (const [vid, pid] of wuqueModels) for (const page of [0xFF80, 0xFFB0]) {
  test(`Wuque USB ${vid.toString(16)}:${pid.toString(16)} / ${page.toString(16)} : fréquences annoncées, changement et restauration`, async () => {
    const dev = keyboard(vid, pid, page);
    wuqueReply(dev);
    assert.equal(driver.match(dev), true);
    const [inst] = await driver.connect(dev, [dev]);
    assert.deepEqual(inst.caps, { rate: [250, 500, 1000, 2000, 4000, 8000] });
    assert.equal(inst.state.rate, 1000);
    assert.deepEqual(dev.sent.map(([, bytes]) => bytes[2]), [0, 1]);
    await assert.rejects(inst.set('rate', 125), /non proposé/);
    assert.equal(dev.sent.length, 2);

    const original = inst.state.rate;
    await inst.set('rate', 8000);
    assert.equal(inst.state.rate, 8000);
    await inst.set('rate', original);
    assert.equal(inst.state.rate, original);
    assert.deepEqual(dev.sent.slice(2).map(([, bytes]) => [...bytes.slice(2, 4)]), [[2, 0], [1, 0], [2, 3], [1, 0]]);
    inst.release();
    assert.equal(dev.opened, false);
    assert.equal(dev.listeners.size, 0);
  });
}

test('Wuque : l’accusé de réception ne suffit pas et la sortie de veille relit la valeur réelle', async () => {
  const dev = keyboard(0x1CA6, 0x1B10, 0xFFB0);
  const changeOnDevice = wuqueReply(dev, { ignoresWrite: true, rates: [0, 3, 99, 3] });
  const [inst] = await driver.connect(dev, [dev]);
  assert.deepEqual(inst.caps.rate, [1000, 8000]);
  await assert.rejects(inst.set('rate', 8000), /n’a pas confirmé/);
  assert.equal(inst.state.rate, 1000);
  changeOnDevice(0);
  await inst.reapply();
  assert.equal(inst.state.rate, 8000);
  assert.deepEqual(dev.sent.map(([, bytes]) => bytes[2]), [0, 1, 2, 1, 1]);
  inst.release();
});

function kochiReply(dev, { name = 'KOCHI68', ack = 1 } = {}) {
  const ascii = [...name].map(c => c.charCodeAt(0));
  let mac = false;
  dev.onReport = (id, bytes) => {
    const command = bytes[4];
    assert.equal(id, 0);
    assert.deepEqual([...bytes], report([0x5C, 3, 0, 0x93, command, 0xFF, 0xFF]));
    let payload;
    if (command === 0x26) payload = [0, command, ...ascii, ...Array(32 - ascii.length).fill(0)];
    else if (command === 0x21 || command === 0x22) payload = [0, command, Number(mac === (command === 0x22)), 0xFF];
    else {
      assert.ok(command === 0x30 || command === 0x31);
      if (ack) mac = command === 0x31;
      payload = [0, command, ack, 0xFF];
    }
    const checksum = (0x35 + 0x5C + payload.length + 0x80 + payload.at(-1)) & 0xFF;
    dev.emit(0, report([0x5C, payload.length, 0x80, checksum, ...payload]));
  };
}

test('Kochi Hummingbird 68 : identification, mode macOS confirmé, restauration Windows', async () => {
  const dev = keyboard(...kochiModel);
  kochiReply(dev);
  assert.equal(driver.match(dev), true);
  const [inst] = await driver.connect(dev, [dev]);
  assert.equal(inst.name, 'Kochi Hummingbird 68');
  assert.deepEqual(inst.restoreCaps, ['systemMode']);
  const original = inst.state.systemMode;
  assert.equal(original, 'win');
  await inst.set('systemMode', 'mac');
  assert.equal(inst.state.systemMode, 'mac');
  await inst.set('systemMode', original);
  await inst.refresh();
  assert.equal(inst.state.systemMode, 'win');
  assert.deepEqual(dev.sent.map(([, bytes]) => bytes[4]), [0x26, 0x21, 0x22, 0x31, 0x21, 0x22, 0x30, 0x21, 0x22, 0x21, 0x22]);
  inst.release();
  assert.equal(dev.opened, false);
  assert.equal(dev.listeners.size, 0);
});

test('Kochi : l’identité doit correspondre et une écriture refusée laisse l’état intact', async () => {
  const other = keyboard(...kochiModel);
  kochiReply(other, { name: 'Autre' });
  await assert.rejects(driver.connect(other, [other]), /KOCHI68/);
  assert.equal(other.opened, false);
  assert.equal(other.listeners.size, 0);
  assert.equal(other.sent.length, 1);

  const dev = keyboard(...kochiModel);
  kochiReply(dev, { ack: 0 });
  const [inst] = await driver.connect(dev, [dev]);
  await assert.rejects(inst.set('systemMode', 'mac'), /acknowledge/);
  await inst.refresh();
  assert.equal(inst.state.systemMode, 'win');
  inst.release();
});

function arbiterFrame(command, data = [], status = 0) {
  const bytes = report([0, command, status, data.length, ...data]);
  bytes[63] = (85 - bytes.reduce((sum, value) => sum + value, 0)) & 0xFF;
  return bytes;
}

function arbiterReply(dev, { refusesRead = false, ignoresWrite = false } = {}) {
  let light = [1, 3, 66, 40, 2, ...Array.from({ length: 21 }, (_, i) => i + 10)];
  dev.onReport = (id, bytes) => {
    assert.equal(id, 0);
    if (bytes[1] === 25) {
      assert.deepEqual([...bytes], arbiterFrame(25));
      dev.emit(0, refusesRead ? arbiterFrame(25, [], 3) : arbiterFrame(25, light));
    } else {
      assert.equal(bytes[1], 24);
      assert.deepEqual([...bytes], arbiterFrame(24, [1 - light[0], ...light.slice(1)]));
      if (!ignoresWrite) light[0] = bytes[4];
      dev.emit(0, arbiterFrame(24, [1, 0, 0, 0]));
    }
  };
  return brightness => { light[2] = brightness; };
}

for (const model of arbiterModels) {
  test(`Arbiter USB ${model.map(n => n.toString(16)).join(':')} : éteint puis restaure le rétroéclairage en préservant l’effet`, async () => {
    const dev = keyboard(...model);
    const changeOnDevice = arbiterReply(dev);
    assert.equal(driver.match(dev), true);
    const [inst] = await driver.connect(dev, [dev]);
    const original = inst.state.backlight;
    assert.equal(original, true);
    assert.equal(dev.sent.length, 1);
    assert.deepEqual(inst.restoreCaps, ['backlight']);
    changeOnDevice(52); // Effet modifié depuis l'extérieur après la connexion.
    await inst.set('backlight', false);
    assert.equal(inst.state.backlight, false);
    await inst.set('backlight', original);
    assert.equal(inst.state.backlight, true);
    assert.deepEqual(dev.sent.map(([, bytes]) => bytes[1]), [25, 25, 24, 25, 25, 24, 25]);
    assert.equal(dev.sent[2][1][6], 52);
    inst.release();
    assert.equal(dev.opened, false);
    assert.equal(dev.listeners.size, 0);
  });
}

test('Arbiter : le pilote essaie l’autre collection du même clavier après un refus et vérifie l’écriture', async () => {
  const first = keyboard(0x1A81, 0x2072, 0xFF01);
  const second = keyboard(0x1A81, 0x2072, 0xFF02);
  arbiterReply(first, { refusesRead: true });
  arbiterReply(second, { ignoresWrite: true });
  const [inst] = await driver.connect(first, [first, second]);
  assert.equal(inst.dev, second);
  assert.equal(first.opened, false);
  assert.equal(first.listeners.size, 0);
  await assert.rejects(inst.set('backlight', false), /did not retain/);
  assert.equal(inst.state.backlight, true);
  inst.release();
});

test('Claviers OpenMouse supplémentaires : seuls les usages connus du même appareil sont ouverts', async () => {
  for (const dev of [keyboard(0x1CA6, 0x1B10, 1, 6), keyboard(0x1CA6, 0x1B10, 0xFFB0, 2),
    keyboard(0x1CA6, 0x75D4, 0xFFB0), keyboard(0x36B5, 0x1B0A, 0xFF80), keyboard(0x1CA2, 0x0902, 0xFFA0),
    keyboard(0x1CA2, 0x0901, 0xF1D0), keyboard(0x371C, 0xA009, 0xFF01), keyboard(0x1A81, 0x2077, 0xFF02)]) {
    assert.equal(driver.match(dev), false);
    assert.deepEqual(await driver.connect(dev, [dev]), []);
    assert.equal(dev.opened, false);
  }
  const first = keyboard(0x1A81, 0x2072, 0xFF01);
  const other = keyboard(0x1A81, 0x2072, 0xFF02, 1, 'autre clavier');
  arbiterReply(first, { refusesRead: true });
  await assert.rejects(driver.connect(first, [first, other]), /NoSupport/);
  assert.equal(other.opened, false);
});
