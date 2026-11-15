// Dongle CompX 3554:F517 partagé : Scyrox V8S (capteur 3955, paliers à 6912) et Attack Shark V8
// (diagnostic #17 : paliers à l'emplacement classique 12, zone 6912 vierge → « corrupt DPI stage »).
//   node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { ScyroxHidClient } from '../ui/vendor/openmouse/drivers/scyrox/hid.js';
import { pulsarPacketChecksum } from '../ui/vendor/openmouse/pulsar/index.js';

const seal = (v) => [...v, (0x55 - v.reduce((a, b) => a + b, 0)) & 0xff];

// Souris CompX simulée : rapport 8, lecture flash 0x08 [cmd, err, addrHi, addrLo, len, payload…, checksum]
function fakeMouse(name, flash) {
  const listeners = [];
  return {
    vendorId: 0x3554, productId: 0xf517, productName: name, opened: false, reads: [],
    collections: [{ usagePage: 0xff02, usage: 0x02, children: [], outputReports: [{ reportId: 8 }], inputReports: [], featureReports: [] }],
    async open() { this.opened = true; },
    async close() { this.opened = false; },
    addEventListener(_t, f) { listeners.push(f); },
    removeEventListener(_t, f) { listeners.splice(listeners.indexOf(f), 1); },
    async sendReport(id, req) {
      const out = new Uint8Array(16);
      out.set(req.subarray(0, 5));
      const addr = (req[2] << 8) | req[3];
      if (req[0] === 0x08) {
        this.reads.push(addr);
        for (let i = 0; i < req[4]; i++) out[5 + i] = flash.get(addr + i) ?? 0xff;
      }
      out[15] = pulsarPacketChecksum(out);
      queueMicrotask(() => listeners.forEach((f) => f({ reportId: id, data: new DataView(out.buffer) })));
    },
  };
}
const put = (m, addr, bytes) => bytes.forEach((b, i) => m.set(addr + i, b));

test('Scyrox V8S : paliers du capteur 3955 gardés quand leur sceau est bon', async () => {
  const flash = new Map();
  put(flash, 6912, seal([0x3f, 0x06, 0x3f, 0x06, 0x00])); // 1 600 DPI
  put(flash, 12, seal([0x07, 0x07, 0x00]));               // 400 d'usine
  const c = new ScyroxHidClient(fakeMouse('Scyrox Turbo 8k dongle', flash));
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
  const dev = fakeMouse('ATTACK SHARK Mouse', flash);
  const c = new ScyroxHidClient(dev);
  await c.probeDpiLayout();
  assert.equal(c.dpiLayout(), 'legacy');
  assert.equal(c.displayName(), 'Attack Shark V8');
  assert.equal(c.turboModeAddress(), null);
  assert.equal(c.maxDpi(), 26000);
  const read = (s) => c.transaction(() => c.readRaw(c.dpiStageAddress(s), c.dpiStageStride()));
  assert.equal(c.decodeDpiStage(await read(0)).x, 800);
  assert.equal(c.decodeDpiStage(await read(1)).x, 1600);
  assert.deepEqual(dev.reads.slice(0, 2), [6912, 12]);
});

test('Aucun sceau valide : disposition du catalogue gardée (erreur franche, pas de faux DPI)', async () => {
  const c = new ScyroxHidClient(fakeMouse('ATTACK SHARK Mouse', new Map()));
  await c.probeDpiLayout();
  assert.equal(c.dpiLayout(), 'sensor3955');
  assert.equal(c.decodeDpiStage(await c.transaction(() => c.readRaw(6912, 6))), null);
});
