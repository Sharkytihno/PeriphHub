// Dongle CompX 3554:F517 partagé : Scyrox V8S (capteur 3955, paliers à 6912) et Attack Shark V8
// (diagnostic #17 : paliers à l'emplacement classique 12, zone 6912 vierge → « corrupt DPI stage »).
// Et la sonde du diagnostic : vidage de la mémoire → simulateur rejouable sans le matériel.
//   node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ScyroxHidClient } from '../ui/vendor/openmouse/drivers/scyrox/hid.js';
import { fakeCompx, flashFromDiag, put, seal } from './sim/compx.mjs';
import { REPO } from './harness.mjs';

globalThis.window = globalThis.window || {};
const { compxDump } = await import('../ui/js/drivers/openmouse.js');
const probes = vm.createContext({ globalThis: {}, performance, Date, Uint8Array, Map, String, Array });
vm.runInContext(fs.readFileSync(path.join(REPO, 'ui/js/drivers/probes.js'), 'utf8'), probes);

test('Scyrox V8S : paliers du capteur 3955 gardés quand leur sceau est bon', async () => {
  const flash = new Map();
  put(flash, 6912, seal([0x3f, 0x06, 0x3f, 0x06, 0x00])); // 1 600 DPI
  put(flash, 12, seal([0x07, 0x07, 0x00]));               // 400 d'usine
  const c = new ScyroxHidClient(fakeCompx('Scyrox Turbo 8k dongle', flash));
  await c.probeDpiLayout();
  assert.equal(c.dpiLayout(), 'sensor3955');
  assert.equal(c.turboModeAddress(), 8);
  assert.equal(c.displayName(), 'Scyrox V8S');
  assert.equal(c.decodeDpiStage(await c.transaction(() => c.readRaw(c.dpiStageAddress(0), c.dpiStageStride()))).x, 1600);
});

test('Attack Shark V8 (diag #17) : zone 6912 vierge → paliers classiques', async () => {
  const flash = new Map();
  put(flash, 12, seal([0x0f, 0x0f, 0x00])); // 800 DPI
  put(flash, 16, seal([0x1f, 0x1f, 0x00])); // 1 600 DPI
  const dev = fakeCompx('ATTACK SHARK Mouse', flash);
  const c = new ScyroxHidClient(dev);
  await c.probeDpiLayout();
  assert.equal(c.dpiLayout(), 'legacy');
  assert.equal(c.displayName(), 'Attack Shark V8');
  assert.equal(c.turboModeAddress(), null);
  assert.equal(c.maxDpi(), 26000);
  const read = s => c.transaction(() => c.readRaw(c.dpiStageAddress(s), c.dpiStageStride()));
  assert.equal(c.decodeDpiStage(await read(0)).x, 800);
  assert.equal(c.decodeDpiStage(await read(1)).x, 1600);
  assert.deepEqual(dev.reads.slice(0, 2), [6912, 12]);
});

test('Aucun sceau valide : disposition du catalogue gardée (erreur franche, pas de faux DPI)', async () => {
  const c = new ScyroxHidClient(fakeCompx('ATTACK SHARK Mouse', new Map()));
  await c.probeDpiLayout();
  assert.equal(c.dpiLayout(), 'sensor3955');
  assert.equal(c.decodeDpiStage(await c.transaction(() => c.readRaw(6912, 6))), null);
});

test('Sonde CompX : vidage complet, compact, sans écriture, puis rejoué tel quel', async () => {
  const flash = new Map();
  put(flash, 0, [0x01, 0x54, 0x02, 0x53]);
  put(flash, 12, seal([0x0f, 0x0f, 0x00]));
  for (let a = 0x200; a < 0x1B00; a++) flash.set(a, 0x00);
  put(flash, 6912, seal([0x3f, 0x06, 0x3f, 0x06, 0x00]));
  const dev = fakeCompx('ATTACK SHARK Mouse', flash, { size: 0x2000 });
  const { bytes, stop } = await compxDump(dev);
  assert.equal(stop, '');
  assert.equal(bytes.length, 0x2000);
  assert.deepEqual(dev.writes, []);
  const lines = vm.runInContext('diagHexDump', probes)(bytes);
  assert.ok(lines.length < 40, `vidage trop long : ${lines.length} lignes`);
  const text = 'Sonde compx · mémoire · lecture seule\n' + lines.map(l => '    ' + l).join('\n') + '\nJournal :';
  const replay = flashFromDiag(text);
  for (let a = 0; a < 0x2000; a++) assert.equal(replay.get(a), bytes[a], `octet ${a}`);
  // Le simulateur rejoué donne la même lecture que la vraie souris
  const c = new ScyroxHidClient(fakeCompx('ATTACK SHARK Mouse', replay));
  await c.probeDpiLayout();
  assert.equal(c.dpiLayout(), 'sensor3955');
});

test('Sonde CompX : arrêt propre en fin de mémoire', async () => {
  const { bytes, stop } = await compxDump(fakeCompx('X', new Map(), { size: 0x100 }));
  assert.equal(bytes.length, 0x100);
  assert.match(stop, /failed with status 1/);
});
