// Garde-fous autour des protocoles d'OpenMouse (ui/js/drivers/openmouse.js, module ES) :
// un clavier sur le VID partagé 0x3151 ne doit jamais être pris par un pilote de souris.
//   node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {}; // WebHID du navigateur (pas de __TAURI__) : appareils déjà regroupés
await import('../ui/js/drivers/openmouse.js');
const om = window.omApi;

// Interface comme la donne PeriphHub (native-hid.js) : une collection par appareil, avec son numéro d'interface
const iface = (pid, mi, usagePage, usage, name = 'X68HE') => ({
  vendorId: 0x3151, productId: pid, productName: name,
  collections: [{ usagePage, usage, children: [], inputReports: [], outputReports: [], featureReports: [] }],
  info: { interface: mi, usage_page: usagePage, usage },
});

// Clavier X68HE (diagnostic #15) : clavier sur MI_00, souris des macros et 0xFFFF/0x02 sur MI_01/MI_02
const x68 = [iface(0x502D, 0, 1, 6), iface(0x502D, 1, 1, 2), iface(0x502D, 1, 0xFFFF, 1), iface(0x502D, 2, 0xFFFF, 2)];
// Souris du même fabricant : souris sur MI_00, interface de réglage 0xFFFF/0x02
const mouse = [iface(0x1234, 0, 1, 2, 'Mouse'), iface(0x1234, 1, 1, 6, 'Mouse'), iface(0x1234, 2, 0xFFFF, 2, 'Mouse')];

test('OpenMouse : clavier 3151 refusé par les pilotes de souris (analyse déjà faite)', () => {
  globalThis.report = { devices: [{ vid: '3151', pid: '502D', kind: 'clavier' }] };
  assert.equal(om.driver.match(x68[3]), false);
  assert.equal(om.claims(x68[3], x68), false);
  delete globalThis.report;
});

test('OpenMouse : clavier 3151 refusé à la connexion même sans analyse (interface principale)', async () => {
  assert.equal(om.claims(x68[3], x68), false);
  await assert.rejects(om.driver.connect(x68[3], x68), /clavier/);
});

test('OpenMouse : souris 3151 toujours reconnue', () => {
  assert.equal(om.driver.match(mouse[2]), true);
  assert.equal(om.claims(mouse[2], mouse), true);
});

test('OpenMouse : clavier et souris du même VID:PID sont isolés par conteneur Windows', t => {
  window.__TAURI__ = {};
  t.after(() => delete window.__TAURI__);
  const tag = (devices, unit) => devices.map((d, i) => ({
    ...d,
    productId: 0x502D,
    info: { ...d.info, path: unit + i, unit },
  }));
  const keyboard = tag(x68, 'clavier');
  const pointer = tag(mouse, 'souris');
  const all = [...keyboard, ...pointer];
  assert.equal(om.claims(keyboard[3], all), false);
  assert.equal(om.claims(pointer[2], all), true);

  const unrelated = { ...pointer[0], info: { ...pointer[0].info, unit: undefined, path: 'autre' } };
  assert.equal(om.claims(unrelated, [unrelated, ...pointer]), false);
});

const reader = om.readOnlyDriver;
const mockReader = (vid, pid, page, usage, mi, featureReports = []) => Object.assign(new EventTarget(), {
  vendorId: vid, productId: pid,
  parsed: [{ usagePage: page, usage, children: [], inputReports: [], outputReports: [], featureReports }],
  info: { interface: mi, usage_page: page, usage },
  async open() { this.opened = true; },
  async close() { this.opened = false; },
});

test('OpenMouse : ROCCAT lit les paliers sur la collection Windows documentée', async t => {
  window.__TAURI__ = {};
  t.after(() => delete window.__TAURI__);
  globalThis.hidAllCollections = collections => collections;
  t.after(() => delete globalThis.hidAllCollections);
  assert.equal(reader.match(mockReader(0x1E7D, 0x2C8E, 0xFF00, 1, 1)), false);
  assert.equal(reader.match(mockReader(0x1E7D, 0x2C8F, 0xFF00, 1, 2)), false);

  const mouse = mockReader(0x1E7D, 0x2C8E, 0xFF00, 1, 2);
  mouse.sendReport = async (id, data) => {
    assert.equal(id, 0);
    assert.deepEqual([...data], [0x10, 0x50, 0x14, ...Array(61).fill(0)]);
    const reply = new Uint8Array(data);
    reply.set([8, 9, 16, 16, 24, 24, 32, 32, 40, 40], 8);
    mouse.dispatchEvent(Object.assign(new Event('inputreport'), { reportId: id, data: new DataView(reply.buffer) }));
  };
  const [device] = await reader.connect(mouse);
  assert.deepEqual(device.state.stages, [400, 800, 1200, 1600, 2000]);
  assert.equal(device.state.stagesY[0], 450);
  assert.equal(device.state.dpi, null);
  assert.deepEqual(device.caps, {});
  assert.equal(device.set, undefined);
  device.release();
  assert.equal(mouse.opened, false);
});

test('OpenMouse : AULA valide le modèle puis lit les rapports de 519 octets', async t => {
  window.__TAURI__ = {};
  t.after(() => delete window.__TAURI__);
  globalThis.hidAllCollections = collections => collections;
  t.after(() => delete globalThis.hidAllCollections);
  assert.equal(reader.match(mockReader(0x258A, 0x0138, 0xFF02, 2, 1)), false);

  const mouse = mockReader(0x258A, 0x0138, 0xFF02, 2, 1, [{ reportId: 9 }]);
  assert.equal(om.driver.match(mouse), false);
  const requests = [];
  let request;
  mouse.sendFeatureReport = async (id, data) => {
    assert.equal(id, 9);
    assert.equal(data.length, 519);
    request = data;
    requests.push(data[1]);
  };
  mouse.receiveFeatureReport = async (id, len) => {
    assert.equal(id, 9);
    assert.equal(len, 519);
    const reply = new Uint8Array(request);
    const settings = new Uint8Array(400);
    settings.set([0x64, 0x18, 4, 0x12]);
    settings.set([3, 0, 7, 0], 7);
    settings.set([5, 0, 7, 0], 27);
    const body = { 0x05: [4, 0, 0, 0, 0, 0x2E], 0x07: [1], 0x44: settings, 0x09: [73] }[request[1]];
    assert.ok(body, 'requête de lecture connue');
    reply.set(body, 7);
    reply[0] = reply.subarray(1).reduce((sum, byte) => (sum + byte) & 0xff, 0);
    return new DataView(reply.buffer);
  };
  const [device] = await reader.connect(mouse);
  assert.deepEqual(requests, [0x05, 0x07, 0x44, 0x09]);
  assert.deepEqual(device.state.stages, [400, 800]);
  assert.deepEqual(device.state.stagesY, [600, 800]);
  assert.equal(device.state.rate, 1000);
  assert.deepEqual(device.state.battery, { level: 73, charging: false });
  assert.equal(device.set, undefined);
  device.release();
});
