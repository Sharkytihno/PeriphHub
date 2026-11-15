// Sondes du diagnostic (ui/js/drivers/probes.js) : lecture seule, résultat gardé 10 min.
//   node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { REPO, FakeHid } from './harness.mjs';

function load() {
  const ctx = vm.createContext({ globalThis: {}, performance, Date, Uint8Array, DataView, Map, String, Array, Math });
  for (const f of ['ui/js/hid-descriptor.js', 'ui/js/drivers/probes.js'])
    vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx, { filename: f });
  return ctx;
}
const featureDev = () => {
  const d = new FakeHid({ vendorId: 0x1234, productId: 0x5678, usagePage: 0xFF00 });
  d.parsed = [{ usagePage: 0xFF00, usage: 1, children: [], inputReports: [], outputReports: [],
    featureReports: [{ reportId: 5, items: [{ reportSize: 8, reportCount: 7 }] }] }];
  d.gets = 0;
  d.featureReply = id => (d.gets++, Uint8Array.from([id, 1, 2, 3, 0, 0, 0, 0]));
  return d;
};

test('Sonde « fonction » : lit les rapports déclarés, n’écrit rien, referme l’appareil', async () => {
  const ctx = load();
  const d = featureDev();
  const lines = await vm.runInContext('runProbes', ctx)('1234:5678', [d]);
  assert.match(lines[0], /^Sonde feature .* lecture seule/);
  assert.ok(lines.some(l => /fonction 0x05 \(8 o\)/.test(l)));
  assert.ok(lines.some(l => /▸ 0000 0501020300000000/.test(l)));
  assert.deepEqual([d.sent, d.features], [[], []]);
  assert.equal(d.opened, false);
});

test('Sondes : résultat gardé 10 min (l’aperçu du diagnostic ne relit pas l’appareil)', async () => {
  const ctx = load();
  const d = featureDev();
  const run = vm.runInContext('runProbes', ctx);
  await run('1234:5678', [d]);
  await run('1234:5678', [d]);
  assert.equal(d.gets, 1);
});

test('Sonde « fonction » : rien sur une interface standard (souris, clavier)', async () => {
  const ctx = load();
  const d = featureDev();
  d.parsed[0].usagePage = 0x0001;
  assert.equal((await vm.runInContext('runProbes', ctx)('1234:5678', [d])).length, 0);
});
