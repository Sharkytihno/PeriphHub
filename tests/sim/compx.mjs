// Souris CompX simulée (Scyrox, Lamzu, Pulsar, Attack Shark…) : rapport 8 de 16 octets,
// [commande, erreur, adresse haute, adresse basse, longueur, données…, somme]. Seule la lecture de
// mémoire (0x08) renvoie des données ; les autres commandes renvoient des zéros.
// La mémoire vient d'un objet Map(adresse → octet) ou du vidage d'un diagnostic (flashFromDiag).
import { pulsarPacketChecksum } from '../../ui/vendor/openmouse/pulsar/index.js';

export const seal = v => [...v, (0x55 - v.reduce((a, b) => a + b, 0)) & 0xff];
export const put = (flash, addr, bytes) => bytes.forEach((b, i) => flash.set(addr + i, b));

export function fakeCompx(name, flash, { vendorId = 0x3554, productId = 0xf517, size = 0x2000 } = {}) {
  const listeners = [];
  return {
    vendorId, productId, productName: name, opened: false, reads: [], writes: [],
    collections: [{ usagePage: 0xff02, usage: 0x02, children: [], outputReports: [{ reportId: 8 }], inputReports: [], featureReports: [] }],
    async open() { this.opened = true; },
    async close() { this.opened = false; },
    addEventListener(_t, f) { listeners.push(f); },
    removeEventListener(_t, f) { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); },
    async sendReport(id, req) {
      const out = new Uint8Array(16);
      out.set(req.subarray(0, 5));
      const addr = (req[2] << 8) | req[3];
      if (req[0] === 0x08) {
        this.reads.push(addr);
        if (addr + req[4] > size) out[1] = 1; // au-delà de la mémoire : erreur
        else for (let i = 0; i < req[4]; i++) out[5 + i] = flash.get(addr + i) ?? 0xff;
      } else if (req[0] === 0x07) this.writes.push(addr);
      out[15] = pulsarPacketChecksum(out);
      queueMicrotask(() => listeners.forEach(f => f({ reportId: id, data: new DataView(out.buffer) })));
    },
  };
}

// Relit la sonde « compx » d'un diagnostic (lignes « ▸ 0040 0102… » et « ▸ 0200-1AFF ×ff »)
export function flashFromDiag(text) {
  const section = text.split(/Sonde compx/)[1] || '';
  const flash = new Map();
  for (const line of section.split(/\r?\n/)) {
    const range = line.match(/▸ ([0-9A-F]{4})-([0-9A-F]{4}) ×([0-9a-f]{2})/);
    if (range) { for (let a = parseInt(range[1], 16); a <= parseInt(range[2], 16); a++) flash.set(a, parseInt(range[3], 16)); continue; }
    const row = line.match(/▸ ([0-9A-F]{4}) ([0-9a-f]+)\s*$/);
    if (row) { const a = parseInt(row[1], 16); row[2].match(/../g).forEach((h, i) => flash.set(a + i, parseInt(h, 16))); continue; }
    if (/^\S/.test(line) && flash.size) break; // section suivante
  }
  return flash;
}
