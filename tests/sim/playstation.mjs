// Manettes PlayStation simulées d'après le pilote hid-playstation du noyau Linux : tailles des
// rapports, CRC32 du Bluetooth (graine 0xA2 en sortie, 0xA1 en entrée), rapports réduits tant que
// le rapport de calibration n'a pas été lu (Bluetooth). Une erreur de taille ou de CRC fait
// échouer le test, comme la vraie manette ignorerait le rapport.
import { FakeHid } from '../harness.mjs';

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export const crc32 = bytes => { let c = 0xFFFFFFFF; for (const b of bytes) c = TABLE[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

export class PsSim extends FakeHid {
  // opts : { pid, bt, status (octet d'état batterie), status1 (DS4 : bit 2 = adaptateur sans manette) }
  constructor(opts = {}) {
    super({ vendorId: 0x054C, productId: opts.pid || 0x0CE6, usagePage: 0x01, usage: 0x05 });
    this.o = opts;
    this.ds = [0x0CE6, 0x0DF2].includes(this.productId);
    this.bt = !!opts.bt;
    this.full = !this.bt; // Bluetooth : rapports réduits jusqu'à la lecture de la calibration
    const out = this.ds ? (this.bt ? 0x31 : 0x02) : (this.bt ? 0x11 : 0x05);
    this.collections = [{ usagePage: 0x01, usage: 0x05, outputReports: [{ reportId: out }] }];
    this.light = null; this.players = null; this.blink = null; this.setup = 0; this.opens = 0;
  }
  async open() {
    this.opened = true; this.opens++;
    setTimeout(() => this.report(), 5);
  }
  report() {
    if (!this.opened) return;
    const st = this.o.status ?? 0x08;
    if (!this.full) return this.emit(0x01, new Array(9).fill(0)); // rapport réduit (Bluetooth)
    if (this.ds) {
      if (!this.bt) { const d = new Array(63).fill(0); d[52] = st; return this.emit(0x01, d); }
      const r = new Array(78).fill(0); r[0] = 0x31; r[54] = st;
      const c = crc32([0xA1, ...r.slice(0, 74)]); r.splice(74, 4, c & 0xFF, (c >> 8) & 0xFF, (c >> 16) & 0xFF, c >>> 24);
      return this.emit(0x31, r.slice(1));
    }
    if (!this.bt) { const d = new Array(63).fill(0); d[29] = st; d[30] = this.o.status1 ?? 0; return this.emit(0x01, d); }
    const d = new Array(77).fill(0); d[31] = st; return this.emit(0x11, d);
  }
  async receiveFeatureReport(id) {
    if (id === 0x05 && this.bt) this.full = true;
    return new DataView(new Uint8Array(41).buffer);
  }
  onReport(id, b) {
    const full = [id, ...b];
    let c;
    if (this.ds && !this.bt) {
      if (id !== 0x02 || full.length !== 63) throw new Error(`DualSense USB : rapport 0x02 de 63 octets attendu (reçu 0x${id.toString(16)}, ${full.length})`);
      c = full.slice(1, 48);
    } else if (this.bt) {
      const want = this.ds ? 0x31 : 0x11;
      if (id !== want || full.length !== 78) throw new Error(`Bluetooth : rapport 0x${want.toString(16)} de 78 octets attendu`);
      const crc = crc32([0xA2, ...full.slice(0, 74)]);
      const got = full[74] | (full[75] << 8) | (full[76] << 16) | (full[77] << 24);
      if ((got >>> 0) !== crc) throw new Error('CRC32 Bluetooth faux : la manette ignorerait le rapport');
      if (this.ds && full[2] !== 0x10) throw new Error('DualSense Bluetooth : étiquette 0x10 manquante');
      if (!this.ds && (full[1] & 0xC0) !== 0xC0) throw new Error('DualShock 4 Bluetooth : drapeaux HID + CRC manquants');
      c = full.slice(3, this.ds ? 50 : 13);
    } else {
      if (id !== 0x05 || full.length !== 32) throw new Error('DualShock 4 USB : rapport 0x05 de 32 octets attendu');
      c = full.slice(1, 11);
    }
    if (this.ds) {
      if (c[0] & 0x03 || c[2] || c[3]) throw new Error('vibration demandée : interdit');
      if (c[38] & 0x02) { this.setup++; if (c[41] !== 0x02) throw new Error('mise en place de la barre incorrecte'); }
      if (c[1] & 0x04) this.light = c.slice(44, 47);
      if (c[1] & 0x10) this.players = c[43];
    } else {
      if (c[0] & 0x01 || c[3] || c[4]) throw new Error('vibration demandée : interdit');
      if (c[0] & 0x02) this.light = c.slice(5, 8);
      if (c[0] & 0x04) this.blink = [c[8], c[9]];
    }
  }
}
