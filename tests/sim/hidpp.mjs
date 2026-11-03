// Souris Logitech HID++ 2.0 simulée, d'après la spécification HID++ telle que la réimplémentent
// Solaar (lib/logitech_receiver) et libratbag (src/hidpp20.c). Elle refuse tout ce qu'une vraie
// souris refuserait : fonctionnalité absente (index 0), fonction inconnue, valeur hors liste.
import { FakeHid } from '../harness.mjs';

const ERR_INVALID_ARGUMENT = 2, ERR_INVALID_FUNCTION = 7;
const be16 = v => [v >> 8, v & 0xFF];

export class HidppMouse extends FakeHid {
  // opts : { name, index (0xFF filaire, 1-6 récepteur), dpi: {list | min,max,step, cur},
  //          extDpi: {values, cur}, rateMask (0x8060), extRateMask (0x8061), wheel, battery,
  //          led: [[ids d'effets de la zone 0], [zone 1]…] (0x8070, ids : 0 éteint, 1 fixe, 3 cycle, 0x0A respiration) }
  constructor(opts = {}) {
    super({ vendorId: 0x046D, productId: opts.pid || 0xC547, productName: 'USB Receiver', usagePage: 0xFF00, usage: 2 });
    this.o = opts;
    this.index = opts.index ?? 0xFF;
    this.name = opts.name || 'G502 X';
    this.state = { dpi: opts.dpi?.cur ?? 800, rate: 1, extRate: 3, wheel: opts.wheel ?? 0, ext: { x: opts.extDpi?.cur ?? 800, y: 0, lod: 0 } };
    this.table = [0x0000, 0x0001, 0x0003, 0x0005];
    if (opts.battery != null) this.table.push(0x1004);
    if (opts.dpi) this.table.push(0x2201);
    if (opts.extDpi) this.table.push(0x2202);
    if (opts.rateMask != null) this.table.push(0x8060);
    if (opts.extRateMask != null) this.table.push(0x8061);
    if (opts.wheel != null) this.table.push(0x2121);
    if (opts.led) this.table.push(0x8070);
    this.swControl = 0;
    this.writes = []; // [fonctionnalité, fonction, paramètres] des écritures reçues
  }

  dpiList() {
    const d = this.o.dpi;
    return d.list ? d.list.flatMap(be16) : [...be16(d.min), ...be16(0xE000 | d.step), ...be16(d.max)];
  }
  dpiValues() {
    const d = this.o.dpi;
    if (d.list) return d.list;
    const v = [];
    for (let x = d.min; x <= d.max; x += d.step) v.push(x);
    return v;
  }

  handle(feat, fn, p) {
    switch (feat) {
      case 0x0000:
        if (fn === 0) { const i = this.table.indexOf((p[0] << 8) | p[1]); return [i < 0 ? 0 : i, 0, 0]; }
        if (fn === 1) return [4, 2, p[2]];
        break;
      case 0x0003: if (fn === 1) return [0, 0x55, 0x31, 0x30, 0x12, 0x03]; break; // « U10 12.03 »
      case 0x0005: {
        if (fn === 0) return [this.name.length];
        if (fn === 1) return [...this.name.slice(p[0], p[0] + 16)].map(c => c.charCodeAt(0));
        if (fn === 2) return [3]; // souris
        break;
      }
      case 0x1004: if (fn === 1) return [this.o.battery, 4, 0, 0]; break;
      case 0x2201: {
        if (fn === 0) return [1];
        if (fn === 1) return [0, ...this.dpiList(), 0, 0];
        if (fn === 2) return [0, ...be16(this.state.dpi), ...be16(800)];
        if (fn === 3) {
          const v = (p[1] << 8) | p[2];
          if (!this.dpiValues().includes(v)) throw ERR_INVALID_ARGUMENT;
          this.state.dpi = v; this.writes.push([feat, fn, [...p.slice(0, 3)]]);
          return [0, ...be16(v)];
        }
        break;
      }
      case 0x2202: {
        const vals = this.o.extDpi.values;
        if (fn === 1) return [0, vals.length, 0x01]; // axe Y séparé, pas de LOD
        if (fn === 2) {
          // Pages de 13 octets utiles (16 - 3 d'en-tête), terminées par 0x0000
          const bytes = [...vals.flatMap(be16), 0, 0];
          const page = bytes.slice(p[2] * 13, p[2] * 13 + 13);
          return [p[0], p[1], p[2], ...page];
        }
        if (fn === 5) return [0, ...be16(this.state.ext.x), 0, 0, ...be16(this.state.ext.y), 0, 0, this.state.ext.lod];
        if (fn === 6) {
          const x = (p[1] << 8) | p[2], y = (p[3] << 8) | p[4];
          if (!vals.includes(x) || (y && !vals.includes(y))) throw ERR_INVALID_ARGUMENT;
          this.state.ext = { x, y, lod: p[5] }; this.writes.push([feat, fn, [...p.slice(0, 6)]]);
          return [0];
        }
        break;
      }
      case 0x8060: {
        if (fn === 0) return [this.o.rateMask];
        if (fn === 1) return [this.state.rate];
        if (fn === 2) {
          if (!(this.o.rateMask & (1 << (p[0] - 1)))) throw ERR_INVALID_ARGUMENT;
          this.state.rate = p[0]; this.writes.push([feat, fn, [p[0]]]); return [];
        }
        break;
      }
      case 0x8061: {
        if (fn === 1) return be16(this.o.extRateMask);
        if (fn === 2) return [this.state.extRate];
        if (fn === 3) {
          if (!(this.o.extRateMask & (1 << p[0]))) throw ERR_INVALID_ARGUMENT;
          this.state.extRate = p[0]; this.writes.push([feat, fn, [p[0]]]); return [];
        }
        break;
      }
      case 0x8070: {
        const zones = this.o.led;
        if (fn === 0) return [zones.length, 0, 0, 0, 0];
        if (fn === 1) { if (!zones[p[0]]) throw ERR_INVALID_ARGUMENT; return [p[0], 0, 1 + p[0], zones[p[0]].length]; }
        if (fn === 2) {
          const id = zones[p[0]]?.[p[1]];
          if (id == null) throw ERR_INVALID_ARGUMENT;
          return [p[0], p[1], ...be16(id), 0, 0, 0, 0];
        }
        if (fn === 3) {
          if (!zones[p[0]] || zones[p[0]][p[1]] == null) throw ERR_INVALID_ARGUMENT;
          if (!this.swControl) throw ERR_INVALID_ARGUMENT; // effets refusés tant que l'ordinateur n'a pas la main
          this.writes.push([feat, fn, [...p.slice(0, 13)]]); return [p[0]];
        }
        if (fn === 8) { this.swControl = p[0]; this.writes.push([feat, fn, [p[0]]]); return []; }
        break;
      }
      case 0x2121: {
        if (fn === 1) return [this.state.wheel];
        if (fn === 2) { this.state.wheel = p[0]; this.writes.push([feat, fn, [p[0]]]); return [p[0]]; }
        break;
      }
    }
    throw ERR_INVALID_FUNCTION;
  }

  onReport(id, b) {
    if (id !== 0x11 || b.length !== 19) throw new Error('rapport long HID++ attendu (0x11, 19 octets)');
    const [idx, fi, fnsw] = b;
    if (idx !== this.index) return; // personne à cet emplacement : pas de réponse
    const feat = this.table[fi];
    if (feat == null) return this.emit(0x11, [idx, 0xFF, fi, fnsw, ERR_INVALID_FUNCTION, ...new Array(14).fill(0)]);
    try {
      const r = this.handle(feat, fnsw >> 4, [...b.slice(3)]);
      this.emit(0x11, [idx, fi, fnsw, ...r, ...new Array(16).fill(0)].slice(0, 20));
    } catch (code) {
      if (typeof code !== 'number') throw code;
      this.emit(0x11, [idx, 0xFF, fi, fnsw, code, ...new Array(14).fill(0)]);
    }
  }
}
