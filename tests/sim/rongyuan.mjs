// Simulateur d'un clavier Rongyuan (firmware RY5088) sur son interface fabricant : feature report 0 de
// 64 octets, sommes de contrôle « Bit7 » / « Bit8 » vérifiées sur chaque trame reçue (une trame fausse
// est refusée, comme le ferait le clavier).
import { FakeHid } from '../harness.mjs';

const sum = (b, n) => { let s = 0; for (let i = 0; i < n; i++) s += b[i]; return 255 - (s & 255); };

export class RongyuanKeyboard extends FakeHid {
  constructor({ id = 2472, usb = 0x0500, rf = 0, pid = 0x502D, precision = null, slots = 128, rate = 3, light = null, travel = 200 } = {}) {
    super({ vendorId: 0x3151, productId: pid, productName: 'X68HE', usagePage: 0xFFFF, usage: 2, iface: 2 });
    this.state = {
      id, usb, rf, precision, rate,
      light: light || [7, 1, 2, 4, 7, 255, 0, 0], // fixe, vitesse 2, luminosité 4, rouge
      mag: { 0: new Array(slots).fill(travel), 2: new Array(slots).fill(0), 3: new Array(slots).fill(0), 7: new Array(slots).fill(0) },
      saved: 0, // trames « dernière » reçues (enregistrement)
    };
    this.slots = slots;
    this.reply = new Uint8Array(64);
    this.rejected = [];
  }
  onFeature(reportId, b) {
    if (reportId !== 0 || b.length !== 64) { this.rejected.push(b); return; }
    const cmd = b[0];
    const bit8 = cmd === 0x07 || cmd === 0x08;
    if (b[bit8 ? 8 : 7] !== sum(b, bit8 ? 8 : 7)) { this.rejected.push(b); this.reply = new Uint8Array(64); return; }
    const s = this.state;
    const r = new Uint8Array(64);
    r[0] = cmd;
    switch (cmd) {
      case 0x8F: // identité
        r[1] = s.id & 255; r[2] = s.id >> 8 & 255; r[3] = s.id >> 16 & 255; r[4] = s.id >>> 24;
        r[7] = s.usb & 255; r[8] = s.usb >> 8;
        break;
      case 0x80: r[1] = s.rf & 255; r[2] = s.rf >> 8; break;
      case 0xE6: if (s.precision != null) { r[1] = 0xAA; r[2] = s.precision; } break;
      case 0x83: r[2] = s.rate; break;
      case 0x03: s.rate = b[2]; break;
      case 0x87: r.set(s.light.slice(1), 1); break;
      case 0x07: s.light = [...b.slice(0, 8)]; break;
      case 0xE5: { // lecture : page brute de 64 octets, sans en-tête
        const arr = s.mag[b[1]] || new Array(this.slots).fill(0);
        const two = b[1] !== 7;
        const bytes = two ? arr.flatMap(v => [v & 255, v >> 8]) : arr.slice();
        while (bytes.length < (two ? 256 : 128)) bytes.push(0);
        const page = bytes.slice(b[3] * 64, b[3] * 64 + 64);
        r.set(page.concat(new Array(64 - page.length).fill(0)));
        break;
      }
      case 0x65: { // écriture : en-tête de 8 octets + 56 octets de données par page
        const op = b[1], two = op !== 7;
        if (b[2] !== 1) { this.rejected.push(b); break; }
        const arr = s.mag[op] || (s.mag[op] = new Array(this.slots).fill(0));
        const data = [...b.slice(8, 64)];
        for (let j = 0; j < 56; j++) {
          const pos = b[3] * 56 + j;
          if (two) {
            const slot = pos >> 1;
            if (slot >= this.slots) continue;
            arr[slot] = pos & 1 ? (arr[slot] & 255) | data[j] << 8 : (arr[slot] & 0xFF00) | data[j];
          } else if (pos < this.slots) arr[pos] = data[j];
        }
        if (b[4]) s.saved++;
        break;
      }
      default: break;
    }
    this.reply = r;
  }
  featureReply() { return this.reply; }
}
