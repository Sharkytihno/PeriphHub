// Claviers Rongyuan (Attack Shark X68HE…) contre le simulateur tests/sim/rongyuan.mjs : trames vérifiées
// octet par octet d'après le protocole du logiciel web officiel (qmk.top/v4).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadDrivers } from './harness.mjs';
import { RongyuanKeyboard } from './sim/rongyuan.mjs';

const eq = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b);
const load = () => loadDrivers('rongyuan-models.js', 'rongyuan.js');
const driver = () => load().drivers.find(d => d.id === 'rongyuan');

test('Rongyuan : table générée cohérente (X68HE, interfaces, éclairages)', () => {
  const { ctx } = load();
  const t = n => JSON.parse(JSON.stringify(require_(ctx, n)));
  const models = t('RY_MODELS'), filters = t('RY_FILTERS'), layouts = t('RY_LAYOUTS');
  assert.ok(Object.keys(models).length > 900);
  for (const id of [2270, 2472, 2902]) {
    assert.equal(models[id].n, 'X68HE');
    assert.equal(models[id].p, 0x502D);
    assert.equal(models[id].m, 1);
    assert.equal(models[id].l, 'K');
  }
  eq(filters.filter(f => f[1] === 0x502D), [[0x3151, 0x502D, 0xFFFF, 2, 2, 8000]]);
  // Aucune interface clavier standard, aucun récepteur sans fil
  assert.ok(filters.every(f => f[2] === 0xFFFF));
  assert.ok(!filters.some(f => f[0] === 0x3151 && f[1] === 20487));
  for (const l of Object.values(layouts)) for (const e of l) assert.match(e.type, /^Light[A-Za-z0-9]+$/);
  for (const m of Object.values(models)) {
    assert.ok(m.s > 0 && m.s <= 128, `${m.n} : ${m.s} emplacements`);
    assert.ok(BigInt('0x' + m.k) < 1n << BigInt(m.s));
    if (m.l) assert.ok(layouts[m.l], `${m.n} : éclairage ${m.l}`);
  }
});
// Les const de premier niveau d'un script vm ne sont pas des propriétés du contexte : lues par évaluation
const require_ = (ctx, name) => vm.runInContext(name, ctx);

test('Rongyuan : le X68HE est pris par son interface fabricant seulement, avant OpenMouse', () => {
  const ry = driver();
  assert.ok(ry.priority > 10);
  assert.ok(ry.match(new RongyuanKeyboard()));
  const kb = new RongyuanKeyboard();
  kb.collections = [{ usagePage: 1, usage: 6 }];
  kb.info = { interface: 0 };
  assert.ok(!ry.match(kb));
  const other = new RongyuanKeyboard();
  other.info = { interface: 1 };
  other.collections = [{ usagePage: 0xFFFF, usage: 1 }];
  assert.ok(!ry.match(other));
});

test('Rongyuan X68HE (firmware 5.00) : identité, fréquence jusqu’à 8 kHz, éclairage, course 0,005 mm', async () => {
  const dev = new RongyuanKeyboard({ id: 2472, usb: 0x0500 });
  const [inst] = await driver().connect(dev, [dev]);
  assert.equal(inst.name, 'Attack Shark X68HE');
  assert.equal(inst.kind, 'clavier');
  assert.match(inst.meta, /magnétique/);
  eq(inst.caps.rate, [125, 250, 500, 1000, 2000, 4000, 8000]);
  assert.equal(inst.state.rate, 1000);
  eq(inst.state.light, { effect: 'LightAlwaysOn', brightness: 4, speed: 2, option: 0, color: '#ff0000', dazzle: false });
  assert.ok(inst.caps.light.effects.includes('LightWave'));
  assert.ok(!inst.caps.light.effects.includes('LightUserPicture')); // besoin du logiciel du fabricant
  // Firmware >= 0x500 sans liste de fonctions : unité 0,005 mm (200 par mm)
  eq(inst.state.travel, { mm: 1, mixed: false });
  eq(inst.caps.travel, { min: 0.1, max: 3.3, step: 0.005 });
  assert.equal(inst.state.rt.on, false);
  assert.equal(dev.rejected.length, 0);
});

test('Rongyuan : fréquence écrite [0x03, 0, code] avec somme Bit7', async () => {
  const dev = new RongyuanKeyboard();
  const [inst] = await driver().connect(dev, [dev]);
  dev.features.length = 0;
  await inst.set('rate', 8000);
  assert.equal(dev.state.rate, 0);
  const [, f] = dev.features.find(([, b]) => b[0] === 0x03);
  eq([...f.slice(0, 8)], [3, 0, 0, 0, 0, 0, 0, 252]);
  assert.equal(inst.state.rate, 8000);
  await inst.set('rate', 125);
  assert.equal(dev.state.rate, 6);
  await assert.rejects(inst.set('rate', 333));
  assert.equal(dev.rejected.length, 0);
});

test('Rongyuan : éclairage écrit comme le logiciel officiel (Bit8, vitesse inversée, blanc FAFFFA)', async () => {
  const dev = new RongyuanKeyboard();
  const [inst] = await driver().connect(dev, [dev]);
  await inst.set('light', { effect: 'LightWave', brightness: 3, speed: 4, option: 1, color: '#00ff00', dazzle: true });
  // [7, effet 4, 4 − vitesse, luminosité, option << 4 | 8, R, G, B]
  eq(dev.state.light, [7, 4, 0, 3, 0x18, 0, 255, 0]);
  eq(inst.state.light, { effect: 'LightWave', brightness: 3, speed: 4, option: 1, color: '#00ff00', dazzle: true });
  await inst.set('light', { effect: 'LightAlwaysOn', brightness: 4, speed: 2, option: 3, color: '#ffffff', dazzle: false });
  eq(dev.state.light, [7, 1, 2, 4, 7, 0xFA, 0xFF, 0xFA]); // option inconnue de l'effet : remise à 0
  assert.equal(inst.state.light.color, '#ffffff');
  const [, f] = dev.features.filter(([, b]) => b[0] === 0x07).at(-1);
  let s = 0; for (let i = 0; i < 8; i++) s += f[i];
  assert.equal(f[8], 255 - (s & 255));
  assert.equal(dev.rejected.length, 0);
});

test('Rongyuan : couleur préréglée relue (octet 4 = indice de couleur)', async () => {
  const dev = new RongyuanKeyboard({ light: [7, 2, 1, 2, 0x03, 1, 2, 3] });
  const [inst] = await driver().connect(dev, [dev]);
  eq(inst.state.light, { effect: 'LightBreath', brightness: 2, speed: 3, option: 0, color: '#00ff00', dazzle: false });
});

test('Rongyuan : point de déclenchement écrit sur toutes les touches, enregistré une seule fois', async () => {
  const { ctx, drivers } = load();
  const keys = vmModel(ctx, 2472);
  const dev = new RongyuanKeyboard();
  const [inst] = await drivers.find(d => d.id === 'rongyuan').connect(dev, [dev]);
  dev.features.length = 0;
  await inst.set('travel', { mm: 1.5 });
  for (let i = 0; i < 128; i++) assert.equal(dev.state.mag[0][i], keys.has(i) ? 300 : 200, `emplacement ${i}`);
  assert.equal(dev.state.saved, 1);
  // 128 valeurs de 2 octets = 256 octets = 5 pages de 56 ; seule la dernière porte l'indicateur
  const pages = dev.features.filter(([, b]) => b[0] === 0x65).map(([, b]) => [...b.slice(0, 5)]);
  eq(pages, [[101, 0, 1, 0, 0], [101, 0, 1, 1, 0], [101, 0, 1, 2, 0], [101, 0, 1, 3, 0], [101, 0, 1, 4, 1]]);
  eq(inst.state.travel, { mm: 1.5, mixed: false });
  // Bornes respectées et valeur ramenée au pas
  await inst.set('travel', { mm: 9 });
  assert.equal(dev.state.mag[0][[...keys][0]], 660);
  await inst.set('travel', { mm: 1.2345 });
  assert.equal(dev.state.mag[0][[...keys][0]], 247);
  assert.equal(dev.rejected.length, 0);
});

test('Rongyuan : Rapid Trigger (mode 0x80 + sensibilités), un seul enregistrement final', async () => {
  const { ctx, drivers } = load();
  const keys = vmModel(ctx, 2472);
  const dev = new RongyuanKeyboard();
  dev.state.mag[7][5] = 2; // une touche en mode DKS : le mode est gardé, seul le bit RT change
  keys.add(5);
  const [inst] = await drivers.find(d => d.id === 'rongyuan').connect(dev, [dev]);
  dev.features.length = 0;
  await inst.set('rt', { on: true, press: 0.1, lift: 0.15 });
  for (const i of keys) {
    assert.equal(dev.state.mag[7][i] & 0x80, 0x80);
    assert.equal(dev.state.mag[2][i], 20);
    assert.equal(dev.state.mag[3][i], 30);
  }
  assert.equal(dev.state.mag[7][5], 0x82);
  assert.equal(dev.state.saved, 1);
  // Modes d'abord (3 pages d'un octet), puis appui, puis relâchement (5 pages chacun)
  const ops = dev.features.filter(([, b]) => b[0] === 0x65).map(([, b]) => b[1]);
  eq(ops, [7, 7, 7, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3]);
  eq({ ...inst.state.rt }, { on: true, mixed: false, press: 0.1, lift: 0.15 });
  await inst.set('rt', { on: false, press: 0.1, lift: 0.15 });
  assert.equal(dev.state.mag[7][5], 2);
  assert.equal(inst.state.rt.on, false);
  assert.equal(dev.rejected.length, 0);
});

test('Rongyuan : précision annoncée par le firmware (0,001 mm) prioritaire sur la version', async () => {
  const dev = new RongyuanKeyboard({ usb: 0x0500, precision: 2, travel: 1800 });
  const [inst] = await driver().connect(dev, [dev]);
  eq(inst.state.travel, { mm: 1.8, mixed: false });
  await inst.set('travel', { mm: 2 });
  assert.ok(dev.state.mag[0].includes(2000));
});

test('Rongyuan : firmware ancien (< 1024, hors liste blanche) → pas de fréquence, unité 0,01 mm', async () => {
  const dev = new RongyuanKeyboard({ id: 2270, usb: 0x0300, travel: 150 });
  const [inst] = await driver().connect(dev, [dev]);
  assert.equal(inst.caps.rate, undefined);
  eq(inst.state.travel, { mm: 1.5, mixed: false });
});

test('Rongyuan : modèle inconnu → identité seulement, aucune écriture', async () => {
  const dev = new RongyuanKeyboard({ id: 999999 });
  const [inst] = await driver().connect(dev, [dev]);
  eq(Object.keys(inst.caps), []);
  assert.match(inst.meta, /inconnu/);
  assert.match(inst.note, /999999/);
  assert.ok(dev.features.every(([, b]) => b[0] >= 0x80));
  await assert.rejects(inst.set('rate', 1000));
  assert.ok(dev.features.every(([, b]) => b[0] >= 0x80));
});

test('Rongyuan : clavier muet → échec propre (un autre pilote peut essayer)', async () => {
  const dev = new RongyuanKeyboard();
  dev.featureReply = () => new Uint8Array(64);
  await assert.rejects(driver().connect(dev, [dev]), /identité/);
});

// Emplacements des touches présentes d'un modèle (table générée, lue dans le contexte des pilotes)
function vmModel(ctx, id) {
  const m = JSON.parse(JSON.stringify(require_(ctx, 'RY_MODELS')))[id];
  const mask = BigInt('0x' + m.k), out = new Set();
  for (let i = 0; i < m.s; i++) if ((mask >> BigInt(i)) & 1n) out.add(i);
  return out;
}

test('Rongyuan : la page de réglages se construit (éclairage, déclenchement, Rapid Trigger)', async () => {
  const { drivers, ctx } = load();
  const calls = [];
  Object.assign(ctx, {
    h: (tag, attrs, ...kids) => ({ tag, attrs, kids: kids.flat().filter(k => k != null) }),
    field: (label, ...kids) => ({ label, kids }),
    segmented: (opts, cur) => ({ opts, cur }),
    slider: (min, max, step, value) => ({ min, max, step, value }),
    toggle: (label, on) => ({ label, on }),
    SWATCHES: ['#ffffff'],
    drvSet: (...a) => calls.push(a),
  });
  const dev = new RongyuanKeyboard({ light: [7, 4, 2, 4, 0x17, 0, 0, 255] });
  const [inst] = await drivers.find(d => d.id === 'rongyuan').connect(dev, [dev]);
  let rows = inst.rows();
  eq(rows.map(r => r.label), ['Sens de l’effet', 'Luminosité', 'Vitesse', 'Couleur', 'Point de déclenchement', 'Rapid Trigger']);
  eq(rows[0].kids[0].opts.map(o => o.label), ['Vers la droite', 'Vers la gauche', 'Vers le bas', 'Vers le haut']);
  assert.equal(rows[0].kids[0].cur, 1);
  await inst.set('rt', { on: true, press: 0.3, lift: 0.3 });
  rows = inst.rows();
  assert.equal(rows.at(-1).kids.filter(k => k && 'min' in k).length, 2); // deux curseurs de sensibilité
});
