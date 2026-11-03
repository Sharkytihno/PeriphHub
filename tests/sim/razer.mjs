// Souris / clavier Razer simulé, d'après la structure razer_report d'OpenRazer (driver/razercommon.h)
// et les commandes de driver/razerchromacommon.c. Il vérifie le CRC et l'id de transaction comme le
// microcontrôleur : mauvais CRC ou mauvais id = pas de réponse utile.
import { FakeHid } from '../harness.mjs';

export class RazerSim extends FakeHid {
  // opts : { pid, kind ('souris'|'clavier'), tid (0x1F | 0x3F | 0xFF), dpi, rate, battery, wired }
  constructor(opts = {}) {
    const kb = opts.kind === 'clavier';
    super({ vendorId: 0x1532, productId: opts.pid || 0x0084, productName: kb ? 'Razer BlackWidow' : 'Razer DeathAdder V2', usagePage: 0x01, usage: kb ? 6 : 2, iface: 0 });
    this.o = opts;
    this.tid = opts.tid ?? 0x1F;
    this.state = { dpi: opts.dpi ?? 800, rate: opts.rate ?? 1, brightness: 255, effect: null, color: null };
    this.reply = new Uint8Array(90);
    this.log = []; // [classe, commande, arguments] acceptés
  }

  answer(cls, cmd, a) {
    const s = this.state, key = (cls << 8) | cmd;
    switch (key) {
      case 0x0081: return [2, 3]; // firmware 2.3
      case 0x0085: return [s.rate];
      case 0x0005: if (![1, 2, 8].includes(a[0])) return null; s.rate = a[0]; return [a[0]];
      case 0x0485: return [a[0], s.dpi >> 8, s.dpi & 0xFF, s.dpi >> 8, s.dpi & 0xFF];
      case 0x0405: s.dpi = (a[1] << 8) | a[2]; return [...a.slice(0, 7)];
      case 0x0780: return this.o.battery == null ? null : [0, Math.round(this.o.battery * 2.55)];
      case 0x0784: return this.o.battery == null ? null : [0, 0];
      case 0x0F84: return [a[0], a[1], s.brightness];
      case 0x0F04: s.brightness = a[2]; return [...a.slice(0, 3)];
      case 0x0F02: s.effect = a[2]; s.color = a[2] === 1 || a[2] === 2 ? [a[6], a[7], a[8]] : null; return [...a.slice(0, 9)];
    }
    return null; // commande inconnue de ce modèle
  }

  onFeature(id, r) {
    if (id !== 0 || r.length !== 90) throw new Error('feature report Razer attendu (n° 0, 90 octets)');
    let crc = 0;
    for (let i = 2; i < 88; i++) crc ^= r[i];
    const out = new Uint8Array(90);
    out.set(r);
    if (crc !== r[88] || r[1] !== this.tid) { out[0] = 4; out[6] = 0; this.reply = out; return; } // délai dépassé, rien d'exécuté
    const args = [...r.slice(8, 88)];
    const res = this.answer(r[6], r[7], args);
    if (res == null) { out[0] = 5; this.reply = out; return; } // non pris en charge
    this.log.push([r[6], r[7], args.slice(0, r[5])]);
    out[0] = 2;
    out.fill(0, 8, 88);
    out.set(res, 8);
    this.reply = out;
  }
  featureReply() { return this.reply; }
}
