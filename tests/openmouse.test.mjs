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
