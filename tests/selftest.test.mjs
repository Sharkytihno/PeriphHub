// Auto-test guidé (ui/js/drivers/selftest.js) : écrit, relit, remet la valeur d'origine
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDrivers } from './harness.mjs';

function load() {
  const { ctx } = loadDrivers('selftest.js');
  ctx.structuredClone = structuredClone;
  ctx.sent = [];
  ctx.drvConfirm = (inst, cap, ok, note) => ctx.sent.push([cap, ok, note]);
  return ctx;
}

// Souris simulée : l'état relu est ce que l'appareil a vraiment pris
function mouse({ dpiRound = 0, rateFails = false } = {}) {
  const dev = { dpi: 800, rate: 1000, motionSync: true, lod: 'Low', light: { effect: 'static', color: '#ff0000', brightness: 80 }, macros: [1] };
  const inst = {
    key: 'drv-test', name: 'Souris test', kind: 'souris', dev: { vendorId: 0x3554, productId: 0xf517 },
    caps: { dpi: { min: 100, max: 26000, step: 50, options: [] }, rate: [125, 500, 1000, 8000], motionSync: true, lod: ['Low', 'High'],
      light: { effects: ['off', 'static', 'breathing'], brightness: true }, macros: true, battery: true },
    state: {}, writes: [],
    async set(cap, v) {
      this.writes.push([cap, v]);
      if (cap === 'rate' && rateFails) throw new Error('Command 0x07 failed');
      dev[cap] = cap === 'dpi' && dpiRound ? Math.round(v / dpiRound) * dpiRound : structuredClone(v);
    },
    async refresh() { this.state = structuredClone({ ...dev, battery: { level: 50 } }); },
  };
  inst.state = structuredClone({ ...dev, battery: { level: 50 } });
  return { inst, dev };
}

test('Auto-test : plan sans macros, batterie ni valeur impossible', () => {
  const ctx = load();
  const { inst } = mouse();
  const plan = ctx.selfTestPlan(inst);
  assert.deepEqual(plan.map(p => p.cap).join(','), 'dpi,rate,lod,motionSync,light');
  const v = Object.fromEntries(plan.map(p => [p.cap, p.test]));
  assert.equal(v.dpi, 850);
  assert.equal(v.rate, 8000);
  assert.equal(v.lod, 'High');
  assert.equal(v.motionSync, false);
  assert.equal(v.light.brightness, 60);
  assert.equal(v.light.color, '#ff0000'); // le reste de l'éclairage est gardé
  assert.equal(ctx.selfTestable(inst), true);
  assert.equal(ctx.selfTestable({ ...inst, system: true }), false);
  assert.equal(ctx.selfTestable({ ...inst, dev: null }), false);
});

test('Auto-test : tout marche, chaque réglage revient à sa valeur, confirmations envoyées', async () => {
  const ctx = load();
  const { inst, dev } = mouse();
  const out = await ctx.selfTestRun(inst, { pause: 0 });
  assert.ok(out.every(r => r.ok === true && r.back === true), JSON.stringify(out));
  assert.equal(dev.dpi, 800);
  assert.equal(dev.rate, 1000);
  assert.equal(dev.motionSync, true);
  assert.equal(dev.light.brightness, 80);
  assert.deepEqual(dev.macros, [1]);
  assert.ok(!inst.writes.some(([c]) => c === 'macros'));
  assert.equal(ctx.sent.length, 5);
  assert.ok(ctx.sent.every(([, ok]) => ok));
});

test('Auto-test : échec d’écriture signalé, valeur arrondie par la souris acceptée', async () => {
  const ctx = load();
  const { inst, dev } = mouse({ dpiRound: 100, rateFails: true });
  const out = await ctx.selfTestRun(inst, { pause: 0 });
  const r = Object.fromEntries(out.map(x => [x.cap, x]));
  assert.equal(r.dpi.ok, true); // 850 demandé, 800 ou 900 relu : 900 ≠ origine, au palier près
  assert.equal(r.rate.ok, false);
  assert.match(r.rate.note, /0x07/);
  assert.equal(r.rate.back, true); // rien n'a changé : la valeur d'origine est toujours là
  assert.equal(dev.rate, 1000);
  assert.ok(ctx.sent.some(([cap, ok, note]) => cap === 'rate' && !ok && /auto-test/.test(note)));
});

test('Auto-test : clavier à course par touche (objet) jamais réécrit en bloc', () => {
  const ctx = load();
  const inst = { dev: {}, kind: 'clavier', caps: { travel: { min: 0.1, max: 3.3, step: 0.1 }, rt: { min: 0.1, max: 2, step: 0.1 }, rate: [1000, 8000] },
    state: { travel: { mm: 1.5, mixed: true }, rt: { on: true }, rate: 1000 } };
  assert.deepEqual(ctx.selfTestPlan(inst).map(p => p.cap).join(','), 'rate');
});
