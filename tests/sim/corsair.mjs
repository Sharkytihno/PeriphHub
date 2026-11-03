// Souris Corsair simulées d'après ckb-next (nxp_proto.h, dpi.c, bragi_proto.h) et OpenMouse
// (transport NXP relevé sur Nightsword). Elles refusent toute commande hors de la liste sûre :
// un pilote qui enverrait FW_START, RESET ou un changement de mode ferait échouer le test.
import { FakeHid } from '../harness.mjs';

export class CorsairNxpSim extends FakeHid {
  // opts : { pid, dpi (6 étages), stage, poll (ms), bigEndian (ordre des octets relus), ignoreWrites }
  constructor(opts = {}) {
    super({ vendorId: 0x1B1C, productId: opts.pid || 0x1B2E, usagePage: 0xFFC2, usage: 4, iface: 1 });
    this.o = opts;
    this.dpi = opts.dpi || [400, 800, 1600, 3200, 6400, 12000];
    this.stage = opts.stage ?? 1;
    this.poll = opts.poll ?? 1;
    this.reply = new Uint8Array(64);
  }
  onFeature(id, b) {
    if (id !== 0 || b.length !== 64) throw new Error('feature report Corsair attendu (n° 0, 64 octets)');
    const [cmd, field, sub, prof] = b;
    const ok = (cmd === 0x0E && (field === 0x01 || (field === 0x13 && (sub === 0x02 || (sub & 0xF0) === 0xD0))))
      || (cmd === 0x07 && (field === 0x0A || (field === 0x13 && (sub & 0xF0) === 0xD0)));
    if (!ok) throw new Error(`commande interdite ${[...b.slice(0, 4)].map(x => x.toString(16)).join(' ')}`);
    if (cmd === 0x07) {
      if (field === 0x0A) this.poll = b[4];
      else if (!this.o.ignoreWrites && prof === 0) this.dpi[sub & 0x0F] = b[5] | (b[6] << 8);
      return;
    }
    const r = new Uint8Array(64);
    r.set(b.slice(0, 4));
    if (field === 0x01) { r[8] = 0x05; r[9] = 0x03; r[16] = this.poll; }
    else if (sub === 0x02) r[4] = this.stage;
    else {
      const v = this.dpi[sub & 0x0F];
      if (this.o.bigEndian) { r[5] = v >> 8; r[6] = v & 0xFF; } else { r[5] = v & 0xFF; r[6] = v >> 8; }
    }
    this.reply = r;
  }
  featureReply() { return this.reply; }
}

export class CorsairBragiSim extends FakeHid {
  // opts : { pid, slot, dpi, rate (1-4), battery (dixièmes de %), ignoreWrites }
  constructor(opts = {}) {
    super({ vendorId: 0x1B1C, productId: opts.pid || 0x1B93, usagePage: 0xFF42, usage: 1, iface: 1 });
    this.o = opts;
    this.slot = opts.slot ?? 0;
    this.props = { 0x01: opts.rate ?? 4, 0x12: this.productId, 0x21: opts.dpi ?? 800, 0x22: opts.dpi ?? 800 };
    if (opts.battery != null) Object.assign(this.props, { 0x0F: opts.battery, 0x10: 2 });
  }
  onReport(id, b) {
    if (id !== 0 || b.length !== 64) throw new Error('rapport Bragi attendu (sans ID, 64 octets)');
    if (b[0] !== (0x08 | this.slot)) return; // autre emplacement : personne ne répond
    const [, cmd, prop] = b;
    if (cmd !== 0x01 && cmd !== 0x02) throw new Error('commande Bragi interdite ' + cmd);
    if (cmd === 0x01 && ![0x01, 0x21, 0x22].includes(prop)) throw new Error('propriété Bragi interdite en écriture 0x' + prop.toString(16));
    const out = [this.slot, cmd, 0, 0, 0];
    if (!(prop in this.props)) out[2] = 5;
    else if (cmd === 0x02) { const v = this.props[prop]; out[3] = v & 0xFF; out[4] = v >> 8; }
    else if (!this.o.ignoreWrites) this.props[prop] = b[4] | (b[5] << 8);
    this.emit(0, [...out, ...new Array(59).fill(0)]);
  }
}
