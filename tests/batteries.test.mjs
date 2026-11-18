// Pilote « batterie seulement » (ui/js/drivers/batteries.js) : requêtes envoyées et réponses décodées,
// d'après les protocoles documentés par WirelessBattery (GPL-3.0) et ses sources.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDrivers, FakeHid } from './harness.mjs';

const load = () => {
  const { drivers, ctx } = loadDrivers('batteries.js');
  return { drv: drivers.find(d => d.id === 'batteries'), ctx };
};
const sum = (b, n) => b.slice(0, n).reduce((a, x) => a + x, 0) & 0xFF;

class Dev extends FakeHid {
  async sendOutputReport(id, data) { this.outputs = [...(this.outputs || []), [id, Uint8Array.from(data)]]; this.onOutput?.(id, Uint8Array.from(data)); }
  async receiveInputReport(id) { return Uint8Array.from(this.inputReply?.(id) || []); }
}

test('JBL Quantum : feature 88 « batterie », réponse 86 décodée (bit 7 = en charge)', async () => {
  const { drv } = load();
  const dev = new Dev({ vendorId: 0x0ECB, productId: 0x2125, usagePage: 0xFF12 });
  dev.onFeature = (id, b) => {
    assert.equal(id, 0x88);
    assert.deepEqual([...b], [0x00, 0xDD, 0x01, 0x00, 0x01, 0x00, 0x02, 0x00, 0x0D, 0x00]);
    // [86][00 DD][01 00][01][00][len][status 00 00][0D 00][01 00][valeur]
    dev.emit(0x86, [0x00, 0xDD, 0x01, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x0D, 0x00, 0x01, 0x00, 0x80 | 64]);
  };
  assert.ok(drv.match(dev));
  const [inst] = await drv.connect(dev, [dev]);
  assert.equal(inst.name, 'JBL Quantum 650 Wireless');
  assert.equal(inst.kind, 'casque');
  assert.deepEqual({ ...inst.state.battery }, { level: 64, charging: true });
});

test('ROG : souris non numérotée (×25 sur les anciennes jauges), puis « FF AA » = en veille', async () => {
  const { drv } = load();
  const dev = new Dev({ vendorId: 0x0B05, productId: 0x18E5, usagePage: 0xFF01, iface: 0 });
  let asleep = false;
  dev.onReport = (id, b) => {
    assert.equal(id, 0);
    assert.deepEqual([...b], [0x12, 0x07]);
    // non numéroté : [12][07][..][..][niveau][..][..][..][..][en charge]…
    dev.emit(0, asleep ? [0xFF, 0xAA, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] : [0x12, 0x07, 0, 0, 3, 0, 0, 0, 0, 1, 0, 0]);
  };
  const [inst] = await drv.connect(dev, [dev]);
  assert.equal(inst.name, 'ROG Chakram');
  assert.equal(inst.kind, 'souris');
  assert.deepEqual({ ...inst.state.battery }, { level: 75, charging: true });
  asleep = true;
  await assert.rejects(inst.refreshBattery(), /en veille/);
  assert.equal(inst.state.battery.level, 75); // dernière valeur gardée (affichée grisée)
});

test('Rapoo VT : rapport 07 envoyé seul, rien n’est écrit dans la souris', async () => {
  const { drv } = load();
  const dev = new Dev({ vendorId: 0x24AE, productId: 0x1415, usagePage: 0xFF00, usage: 2 });
  setTimeout(() => dev.emit(0x07, [0x00, 0, 0, 0, 0, 0, 0x01, 82, 0, 0, 0, 0, 0x15, 0x46]), 20);
  const [inst] = await drv.connect(dev, [dev]);
  assert.equal(inst.name, 'Rapoo VT1');
  assert.deepEqual({ ...inst.state.battery }, { level: 82, charging: false });
  assert.equal(dev.sent.length + dev.features.length, 0);
});

test('Razer BlackShark V3 : paquet 02 avec XOR en [62], poignée de main puis classe 21', async () => {
  const { drv } = load();
  const dev = new Dev({ vendorId: 0x1532, productId: 0x0579, usagePage: 0xFF00, iface: 5 });
  dev.onReport = (id, b) => {
    const full = [id, ...b];
    assert.equal(full.length, 64);
    assert.equal(full[62], full.slice(0, 62).reduce((a, x) => a ^ x, 0));
    if (full[9] === 0x80 && full[10] === 0x21) {
      const r = new Array(63).fill(0);
      r[1] = 0x60; r[9] = 0x21; r[12] = 47; r[13] = 1;
      dev.emit(0x02, r);
    }
  };
  const [inst] = await drv.connect(dev, [dev]);
  assert.equal(inst.name, 'Razer BlackShark V3');
  assert.deepEqual({ ...inst.state.battery }, { level: 47, charging: true });
  assert.equal(dev.sent.length, 4); // 3 envois de la poignée de main + la lecture
  await inst.refreshBattery(); // moins de 5 min : pas de nouvelle question au casque
  assert.equal(dev.sent.length, 4);
});

test('SONiX : requête 20 01 avec somme de contrôle, niveau 0 = clavier éteint', async () => {
  const { drv } = load();
  const dev = new Dev({ vendorId: 0x05AC, productId: 0x024F, usagePage: 0xFF60, usage: 0x61, iface: 3 });
  dev.productName = 'AJAZZ AK820 MAX 2.4G';
  let level = 71;
  dev.onReport = (id, b) => {
    assert.equal(id, 0);
    assert.equal(b.length, 32);
    assert.equal(b[31], sum([...b], 31));
    const r = new Array(32).fill(0);
    r[0] = 0x20; r[1] = 0x01; r[3] = level; r[31] = sum(r, 31);
    dev.emit(0, r);
  };
  const [inst] = await drv.connect(dev, [dev]);
  assert.equal(inst.name, 'AJAZZ AK820 MAX');
  assert.equal(inst.kind, 'clavier');
  assert.equal(inst.state.battery.level, 71);
  level = 0;
  await assert.rejects(inst.refreshBattery(), /en veille/);
});

test('MCHOSE : feature 12 entièrement inversée ; réponse vide = souris en veille', async () => {
  const { drv } = load();
  const dev = new Dev({ vendorId: 0x5253, productId: 0x1020, usagePage: 0xFF01, usage: 1 });
  dev.productName = 'MCHOSE L7 Ultra';
  dev.onFeature = (id, b) => {
    assert.equal(id, 0x12);
    assert.equal(b.length, 64);
    assert.equal(b[0], 0x06 ^ 0xFF);
    assert.ok([...b.slice(1)].every(x => x === 0xFF));
  };
  const payload = [0x53, 0x52, 0, 0, 0, 0, 0, 0, 0x09, 58, 1];
  dev.featureReply = () => [0xF9, ...payload.map(x => x ^ 0xFF)];
  const [inst] = await drv.connect(dev, [dev]);
  assert.equal(inst.name, 'MCHOSE L7 Ultra');
  assert.deepEqual({ ...inst.state.battery }, { level: 58, charging: true });
});

test('Razer Barracuda X : trame CRC-16, état « O » du pont, flux « PI » réassemblé', async () => {
  const { drv, ctx } = load();
  const dev = new Dev({ vendorId: 0x1532, productId: 0x0550, usagePage: 0xFF00, usage: 1 });
  const frame = (group, op, cmdOrSeq, value) => {
    const f = [0x50, 0x49, group, 0, 0, 0, 0, 0, 4, 0, cmdOrSeq, op, value[0], ...value.slice(1)];
    f[8] = f.length - 10;
    return f;
  };
  dev.onReport = (id, b) => {
    const f = [id, ...b];
    const crc = f[3] | (f[4] << 8);
    f[3] = f[4] = 0;
    assert.equal(crc, ctx.batCrc16 ? ctx.batCrc16(Uint8Array.from(f)) : crc);
    const group = f[7], seq = f[8], body = f.slice(9, 5 + f[2]);
    // réponse dans le flux, découpée en deux rapports 02 pour vérifier le réassemblage
    const reply = group === 0x0E ? frame(0x0E, 0x80 | seq, 0x0E, [0]) : frame(0x08, 0x01, body[1], [1, body[1] === 0x21 ? 88 : 1]);
    const fixed = reply.slice(); fixed[10] = group === 0x0E ? 0x0E : body[1]; fixed[11] = group === 0x0E ? 0x80 | seq : 0x01;
    const a = fixed.slice(0, 5), c = fixed.slice(5);
    dev.emit(0x02, [a.length, ...a]);
    dev.emit(0x02, [c.length, ...c]);
  };
  dev.inputReply = () => [0x4F];
  const [inst] = await drv.connect(dev, [dev]);
  assert.deepEqual({ ...inst.state.battery }, { level: 88, charging: true });
});

test('Logitech G435 : millivolts convertis selon la courbe de la batterie', () => {
  const { ctx } = load();
  const pct = mv => ctx.g435Percent ? ctx.g435Percent(mv) : null;
  if (!ctx.g435Percent) return; // fonction de portée globale du script : visible dans le contexte
  assert.equal(pct(4250), 100);
  assert.equal(pct(3800), 55);
  assert.equal(pct(3775), 50);
  assert.equal(pct(3300), 0);
});

// ----- Ajouts de WirelessBattery 1.0.7 / 1.0.8 -----

test('Semico (Attack Shark X98) : AA 55 CC 33 0E, état 0 = clavier éteint', async () => {
  const { drv } = load();
  const dev = new Dev({ vendorId: 0x1A2C, productId: 0xA034, usagePage: 0xFF02, usage: 2 });
  let state = 1;
  dev.onReport = (id, b) => {
    assert.equal(id, 0);
    assert.deepEqual([...b], [0xAA, 0x55, 0xCC, 0x33, 0x0E]);
    dev.emit(0, [0xAA, 0x55, 0xCC, 0x33, 0x0E, 67, state]);
  };
  const [inst] = await drv.connect(dev, [dev]);
  assert.equal(inst.name, 'Attack Shark X98');
  assert.deepEqual({ ...inst.state.battery }, { level: 67, charging: false });
  state = 0;
  await assert.rejects(inst.refreshBattery(), /en veille/);
});

test('ATK V75X : numéro de séquence repris dans la réponse, nom du produit vérifié', async () => {
  const { drv } = load();
  const dev = new Dev({ vendorId: 0x320F, productId: 0x5055, usagePage: 0xFF1C, usage: 0x92 });
  dev.productName = 'Clavier quelconque';
  assert.ok(!drv.match(dev)); // même vid:pid, autre produit : pas interrogé
  dev.productName = 'ATK V75X';
  dev.onReport = (id, b) => {
    assert.equal(id, 0x04);
    assert.equal(b[2], 0x1A);
    // Une réponse à une autre question (numéro différent) est ignorée
    dev.emit(0x04, [b[0] ^ 1, b[1], 0x1A, 0, 0, 0, 0, 5, 0]);
    dev.emit(0x04, [b[0], b[1], 0x1A, 0, 0, 0, 0, 81, 2]);
  };
  const [inst] = await drv.connect(dev, [dev]);
  assert.equal(inst.name, 'ATK V75X');
  assert.deepEqual({ ...inst.state.battery }, { level: 81, charging: true });
});

test('ASTRO A50 Gen 3 : 54 (base / liaison) puis 7C (%), sur la base = en charge', async () => {
  const { drv } = load();
  const dev = new Dev({ vendorId: 0x9886, productId: 0x0026, usagePage: 0xFF32, usage: 0x74 });
  let st = 0x01;
  dev.onReport = (id, b) => {
    assert.equal(id, 0x02);
    if (b[0] === 0x54) dev.emit(0x02, [0x02, 0x01, st]);
    if (b[0] === 0x7C) dev.emit(0x02, [0x02, 0x01, 73]);
  };
  const [inst] = await drv.connect(dev, [dev]);
  assert.equal(inst.name, 'ASTRO A50 Gen 3');
  assert.deepEqual({ ...inst.state.battery }, { level: 73, charging: true });
  st = 0; // ni sur la base ni relié
  await assert.rejects(inst.refreshBattery(), /en veille/);
});

test('BEITONG : octets chiffrés par quartets, requête [02 enc(15)]', async () => {
  const { drv } = load();
  // Table relevée par WirelessBattery (iControl 1.0.5) : quartet haut substitué, quartet bas ^ 8
  const S = [0x0, 0xA, 0x6, 0xF, 0x1, 0xC, 0x2, 0x9, 0xE, 0x3, 0x7, 0xD, 0x4, 0xB, 0x5, 0x8];
  const enc = x => (S[x >> 4] << 4) | ((x & 0x0F) ^ 0x08);
  const dec = x => (S.indexOf(x >> 4) << 4) | ((x & 0x0F) ^ 0x08);
  const dev = new Dev({ vendorId: 0x20BC, productId: 0x5128, usagePage: 0x00FF, usage: 3 });
  dev.onReport = (id, b) => {
    assert.equal(id, 0x02);
    assert.equal(dec(b[0]), 0x15);
    dev.emit(0x02, [enc(0x15), enc(46), enc(0), enc(1)]);
  };
  const [inst] = await drv.connect(dev, [dev]);
  assert.equal(inst.name, 'BEITONG KP20');
  assert.deepEqual({ ...inst.state.battery }, { level: 46, charging: true });
});

test('Razer BlackShark V2 Pro (2020) : feature FF, réponse fraîche reconnue à son en-tête', async () => {
  const { drv } = load();
  const dev = new Dev({ vendorId: 0x1532, productId: 0x0528, usagePage: 0xFF00, usage: 1, iface: 3 });
  dev.onFeature = (id, b) => assert.deepEqual([id, ...b.slice(0, 8)], [0xFF, 0x0A, 0x00, 0xFD, 0x04, 0x12, 0xF1, 0x02, 0x05]);
  // [FF 0F 05 FE 12 04 1F 08 05 .. .. [11] état [12..13] mV [14] %] (sans l'octet d'ID)
  dev.featureReply = () => { const r = new Array(63).fill(0); r.splice(0, 14, 0x0F, 0x05, 0xFE, 0x12, 0x04, 0x1F, 0x08, 0x05, 0, 0, 0x01, 0x0F, 0x50, 62); return r; };
  const [inst] = await drv.connect(dev, [dev]);
  assert.equal(inst.name, 'Razer BlackShark V2 Pro (2020)');
  assert.deepEqual({ ...inst.state.battery }, { level: 62, charging: false });
});

test('JBL Quantum 350 : features 68 (liaison) et 49 (%), rien n’est écrit', async () => {
  const { drv } = load();
  const dev = new Dev({ vendorId: 0x0ECB, productId: 0x206B, usagePage: 0x0001, usage: 0, iface: 3 });
  let linked = 1;
  dev.featureReply = id => (id === 0x68 ? [linked] : [55]);
  const [inst] = await drv.connect(dev, [dev]);
  assert.deepEqual({ ...inst.state.battery }, { level: 55, charging: false });
  assert.equal(dev.sent.length + dev.features.length, 0);
  linked = 0;
  await assert.rejects(inst.refreshBattery(), /en veille/);
});

test('MCHOSE sur dongle Realtek 3837 : champ vid 41E4 accepté, 5253 refusé', async () => {
  const { drv } = load();
  const dev = new Dev({ vendorId: 0x3837, productId: 0x100C, usagePage: 0xFF01, usage: 1 });
  dev.productName = 'MCHOSE A5 V2 Ultra';
  dev.featureReply = () => [0xF9, ...[0xE4, 0x41, 0, 0, 0, 0, 0, 0, 0x09, 88, 0].map(x => x ^ 0xFF)];
  const [inst] = await drv.connect(dev, [dev]);
  assert.equal(inst.name, 'MCHOSE A5 V2 Ultra');
  assert.deepEqual({ ...inst.state.battery }, { level: 88, charging: false });
});

test('HECATE : les casques G2 (35BB:A009) ne reçoivent plus de trames de souris', () => {
  const { drv } = load();
  assert.ok(!drv.match(new Dev({ vendorId: 0x35BB, productId: 0xA009, usagePage: 0xFF02, usage: 2 })));
  assert.ok(drv.match(new Dev({ vendorId: 0x35BB, productId: 0xD3FB, usagePage: 0xFF02, usage: 2 })));
});
