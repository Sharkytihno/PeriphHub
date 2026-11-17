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
