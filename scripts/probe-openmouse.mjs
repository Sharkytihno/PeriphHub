// Demande aux protocoles OpenMouse embarqués (ui/vendor/openmouse*) quels VID:PID ils acceptent
// vraiment, avec des appareils simulés : aucun accès matériel, aucune donnée envoyée.
// Appelé par build-catalog.py :  node scripts/probe-openmouse.mjs <liste.json>
// <liste.json> = ["VVVV:PPPP", …] ; sortie = {"VVVV:PPPP": ["om:Razer", …]} sur stdout.
//
// Un protocole qui accepte n'importe quel PID d'un fabricant (test avec un PID inventé) n'est pas
// compté pour ce fabricant : il ne prouve rien sur un modèle précis.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
Object.defineProperty(globalThis, 'navigator', {
  value: { hid: { getDevices: async () => [], requestDevice: async () => [], addEventListener() {} }, userAgent: 'node' },
  configurable: true,
});
globalThis.window = globalThis;
const reg = await import(pathToFileURL(path.join(REPO, 'ui/vendor/openmouse/drivers/registry.js')));
const kb = await import(pathToFileURL(path.join(REPO, 'ui/vendor/openmouse-kb/drivers/registry.js')));
const ids = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

// Collections vendeur courantes (page, usage) × identifiants de rapport : chaque protocole
// vérifie lui-même l'interface qu'il attend, on lui en présente un large éventail.
const PAGES = [[0xFF00, 1], [0xFF00, 2], [0xFF01, 1], [0xFF02, 1], [0xFF03, 1], [0xFF07, 1], [0xFF0A, 1], [0xFF13, 1],
  [0xFF1C, 0x92], [0xFF42, 1], [0xFF43, 0x202], [0xFF60, 0x61], [0xFF88, 1], [0xFFA0, 1], [0xFFB0, 1], [0xFFC0, 1],
  [0xFFFF, 1], [0x0001, 2], [0x0001, 6], [0x000C, 1]];
const RIDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 0x0B, 0x10, 0x11, 0xBA];
function* fakes(vid, pid) {
  for (const [usagePage, usage] of PAGES) for (const reportId of RIDS) {
    const r = [{ reportId, items: [] }];
    yield {
      vendorId: vid, productId: pid, productName: '', opened: false,
      collections: [{ usagePage, usage, inputReports: r, outputReports: r, featureReports: r, children: [] }],
      open: async () => {}, close: async () => {}, sendReport: async () => {}, sendFeatureReport: async () => {},
      receiveFeatureReport: async () => new DataView(new ArrayBuffer(64)), addEventListener() {}, removeEventListener() {},
    };
  }
}
const DRV = [...reg.DEVICE_DRIVERS.map(x => ['om:' + x.brand, x]), ...(kb.DEVICE_DRIVERS || []).map(x => ['kb:' + (x.brand || x.name || '?'), x])];
function hits(vid, pid) {
  const s = new Set();
  for (const d of fakes(vid, pid)) for (const [name, x] of DRV) { try { if (x.supports(d)) s.add(name); } catch { /* ignoré */ } }
  return s;
}
// Un protocole générique (accepte tout PID du fabricant) compte quand même si le PID est écrit
// en toutes lettres dans ses sources (ex. HyperX : la page vendeur seule suffit à isSupported)
const srcText = new Map();
function inSources(name, pid) {
  const brand = name.slice(3).toLowerCase().replace(/\s+/g, '-');
  if (!srcText.has(brand)) {
    let t = '';
    for (const root of ['ui/vendor/openmouse', 'ui/vendor/openmouse/drivers', 'ui/vendor/openmouse-kb', 'ui/vendor/openmouse-kb/drivers']) {
      const dir = path.join(REPO, root, brand);
      if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir, { recursive: true })) if (String(f).endsWith('.js')) t += fs.readFileSync(path.join(dir, String(f)), 'utf8');
    }
    srcText.set(brand, t.toLowerCase());
  }
  return new RegExp('0x0*' + pid.toString(16) + '\\b').test(srcText.get(brand));
}
const generic = new Map();
const out = {};
for (const id of ids) {
  const [v, p] = id.split(':').map(x => parseInt(x, 16));
  if (!generic.has(v)) generic.set(v, hits(v, 0xFFFE));
  const h = [...hits(v, p)].filter(n => !generic.get(v).has(n) || (n !== 'kb:VIA' && inSources(n, p)));
  if (h.length) out[id] = h;
}
process.stdout.write(JSON.stringify(out));
