// PeriphHub — pilote générique Logitech HID++ 2.0 (souris, claviers, casques récents).
// Protocole documenté par Logitech et réimplémenté par Solaar (GPL-2.0) et libratbag (MIT) :
// rapport long 0x11 = [index appareil, index fonctionnalité, fonction << 4 | id logiciel, 16 octets].
// Une « fonctionnalité » (feature) a un numéro fixe (0x2201 = DPI…) et un index propre à chaque
// appareil, qu'on demande à la fonctionnalité racine (index 0). Aucune commande de firmware.

const LG = {
  ROOT: 0x0000, NAME: 0x0005, FW: 0x0003, BATTERY: 0x1000, UNIFIED_BATTERY: 0x1004,
  DPI: 0x2201, EXT_DPI: 0x2202, RATE: 0x8060, EXT_RATE: 0x8061, SMARTSHIFT: 0x2110, SMARTSHIFT2: 0x2111, HIRES: 0x2121,
  PROFILES: 0x8100,
};
const LG_SW = 0x0B;                    // id logiciel (4 bits) : distingue nos réponses des notifications
const LG_TYPE = { 0: 'clavier', 2: 'clavier', 3: 'souris', 4: 'souris', 5: 'souris', 8: 'casque' };
const LG_EXT_RATES = [125, 250, 500, 1000, 2000, 4000, 8000];

class HidppChannel {
  constructor(dev) {
    this.dev = dev;
    this.waiters = new Set();
    this.queue = Promise.resolve();
    this.listeners = new Set();
    dev.addEventListener('inputreport', e => {
      if (e.reportId !== 0x11 && e.reportId !== 0x10) return;
      const b = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
      for (const w of this.waiters) if (w(b)) return;
      for (const f of this.listeners) f(b);
    });
  }

  // Une requête à la fois : les réponses ne portent pas de numéro de séquence
  request(idx, feat, fn, params = [], timeout = 800) {
    const run = () => new Promise((resolve, reject) => {
      const data = new Uint8Array(19);
      data[0] = idx; data[1] = feat; data[2] = (fn << 4) | LG_SW;
      data.set(params.slice(0, 16), 3);
      const done = (fnRes, value) => { clearTimeout(timer); this.waiters.delete(w); fnRes(value); };
      const w = b => {
        if (b[0] !== idx) return false;
        if (b[1] === feat && b[2] === data[2]) { done(resolve, b.slice(3)); return true; }
        if (b[1] === 0xFF && b[2] === feat && b[3] === data[2]) { done(reject, new Error(`erreur HID++ ${b[4]}`)); return true; }
        if (b[1] === 0x8F && b[2] === feat) { done(reject, new Error(`erreur HID++ 1.0 ${b[4]}`)); return true; }
        return false;
      };
      const timer = setTimeout(() => done(reject, new Error('pas de réponse')), timeout);
      this.waiters.add(w);
      this.dev.sendReport(0x11, data).catch(e => done(reject, e));
    });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
}

class LogitechDevice {
  constructor(ch, idx, dev) {
    this.ch = ch; this.idx = idx; this.dev = dev;
    this.features = new Map();
    this.state = {}; this.caps = {};
  }
  async feature(id) {
    if (!this.features.has(id)) {
      const r = await this.ch.request(this.idx, 0, 0, [id >> 8, id & 0xFF]).catch(() => [0]);
      this.features.set(id, r[0] || 0);
    }
    return this.features.get(id);
  }
  async call(id, fn, params = []) {
    const i = await this.feature(id);
    if (!i) throw new Error(`fonctionnalité 0x${hex4(id)} absente`);
    return this.ch.request(this.idx, i, fn, params);
  }

  async describe() {
    try {
      const len = (await this.call(LG.NAME, 0))[0];
      let name = '';
      while (name.length < len) {
        const part = await this.call(LG.NAME, 1, [name.length]);
        const chunk = String.fromCharCode(...part.slice(0, len - name.length)).replace(/\0.*$/s, '');
        if (!chunk) break;
        name += chunk;
      }
      this.name = name.trim();
      this.kind = LG_TYPE[(await this.call(LG.NAME, 2))[0]] || 'autre';
    } catch {
      this.kind = 'autre';
    }
    this.name ||= this.dev.productName || 'Appareil Logitech';
    if (!/logi/i.test(this.name)) this.name = 'Logitech ' + this.name;
  }

  async refreshBattery() {
    if (await this.feature(LG.UNIFIED_BATTERY)) {
      const r = await this.call(LG.UNIFIED_BATTERY, 1);
      this.state.battery = { level: r[0], charging: r[2] === 1 || r[2] === 2 };
    } else if (await this.feature(LG.BATTERY)) {
      const r = await this.call(LG.BATTERY, 0);
      this.state.battery = { level: r[0], charging: r[2] === 1 || r[2] === 2 };
    }
  }

  // Liste des DPI : valeurs sur 16 bits ; 0xE000 | pas = « de la valeur précédente à la suivante, par ce pas »
  async probeDpi() {
    if (!await this.feature(LG.DPI)) return this.probeExtDpi();
    const r = await this.call(LG.DPI, 1, [0]);
    const vals = [];
    let step = 0;
    for (let i = 1; i + 1 < r.length; i += 2) {
      const v = (r[i] << 8) | r[i + 1];
      if (!v) break;
      if ((v & 0xE000) === 0xE000) step = v & 0x1FFF;
      else vals.push(v);
    }
    if (!vals.length) return;
    const min = Math.min(...vals), max = Math.max(...vals);
    this.caps.dpi = step
      ? { min, max, step, presets: [400, 800, 1200, 1600, 3200, 6400].filter(p => p >= min && p <= max && (p - min) % step === 0) }
      : { min, max, step: 0, presets: vals.length <= 12 ? vals : vals.filter((_, i) => i % Math.ceil(vals.length / 10) === 0), list: vals };
  }

  // DPI étendu (0x2202 : PRO X Superlight 2 et modèles récents), d'après Solaar (ExtendedAdjustableDpi).
  // Fonctions : 1 = capacités du capteur, 2 = liste des DPI (par pages), 5 = lecture, 6 = écriture.
  // Valeurs sur 16 bits (gros-boutiste) ; même codage de liste que 0x2201, la liste commence à l'octet 3.
  async probeExtDpi() {
    if (!await this.feature(LG.EXT_DPI)) return;
    const flags = (await this.call(LG.EXT_DPI, 1, [0]))[2] || 0;
    this.extDpi = { y: !!(flags & 1), lod: !!(flags & 2) };
    let bytes = [];
    for (let page = 0; page < 16; page++) {
      bytes = bytes.concat([...(await this.call(LG.EXT_DPI, 2, [0, 0, page])).slice(3)]);
      if (bytes.length >= 2 && !bytes[bytes.length - 1] && !bytes[bytes.length - 2]) break;
    }
    const vals = [];
    for (let i = 0; i + 1 < bytes.length;) {
      const v = (bytes[i] << 8) | bytes[i + 1];
      if (!v) break;
      if (v >> 13 === 0b111) {
        const step = v & 0x1FFF, last = (bytes[i + 2] << 8) | bytes[i + 3];
        if (!step || !vals.length || last <= vals[vals.length - 1]) break; // liste incohérente : on s'arrête là
        for (let d = vals[vals.length - 1] + step; d <= last; d += step) vals.push(d);
        i += 4;
      } else {
        vals.push(v);
        i += 2;
      }
    }
    if (!vals.length) return;
    const min = vals[0], max = vals[vals.length - 1];
    const step = vals.length > 1 ? vals[1] - vals[0] : 0;
    const regular = step > 0 && vals.every((d, i) => d === min + i * step);
    this.caps.dpi = regular
      ? { min, max, step, presets: [400, 800, 1200, 1600, 3200, 6400].filter(p => p >= min && p <= max && (p - min) % step === 0) }
      : { min, max, step: 0, presets: vals.length <= 12 ? vals : vals.filter((_, i) => i % Math.ceil(vals.length / 10) === 0), list: vals };
    this.caps.dpi.values = vals;
  }

  async readExtDpi() {
    const r = await this.call(LG.EXT_DPI, 5, [0]);
    const w = i => (r[i] << 8) | r[i + 1];
    this.extDpi.cur = { x: w(1) || w(3), y: w(5) || w(7), lod: r[9] };
    return this.extDpi.cur.x;
  }

  async probeRate() {
    if (await this.feature(LG.EXT_RATE)) {
      const r = await this.call(LG.EXT_RATE, 1);
      const mask = (r[0] << 8) | r[1];
      this.rateExt = true;
      this.caps.rate = LG_EXT_RATES.filter((_, i) => mask & (1 << i));
    } else if (await this.feature(LG.RATE)) {
      const mask = (await this.call(LG.RATE, 0))[0];
      this.caps.rate = [8, 4, 2, 1].filter(ms => mask & (1 << (ms - 1))).map(ms => 1000 / ms);
    }
    if (!this.caps.rate?.length) delete this.caps.rate;
  }

  async probe() {
    await this.describe();
    await this.refreshBattery().catch(() => {});
    this.caps.battery = !!this.state.battery;
    await this.probeDpi().catch(() => {});
    await this.probeRate().catch(() => {});
    this.smartshiftFeat = (await this.feature(LG.SMARTSHIFT2)) ? LG.SMARTSHIFT2 : (await this.feature(LG.SMARTSHIFT)) ? LG.SMARTSHIFT : 0;
    this.caps.smartshift = !!this.smartshiftFeat;
    if (await this.feature(LG.HIRES)) this.caps.hires = this.caps.invert = true;
    this.onboard = !!await this.feature(LG.PROFILES);
    try {
      const fw = await this.call(LG.FW, 1, [0]);
      this.fw = `${String.fromCharCode(fw[1], fw[2], fw[3]).trim()} ${fw[4].toString(16)}.${fw[5].toString(16).padStart(2, '0')}`;
    } catch {}
    await this.refresh();
  }

  async refresh() {
    const s = this.state;
    if (this.caps.dpi) s.dpi = this.extDpi ? await this.readExtDpi() : (r => (r[1] << 8) | r[2])(await this.call(LG.DPI, 2, [0]));
    if (this.caps.rate) {
      s.rate = this.rateExt ? LG_EXT_RATES[(await this.call(LG.EXT_RATE, 2))[0]] : 1000 / (await this.call(LG.RATE, 1))[0];
    }
    if (this.caps.smartshift) {
      const r = await this.call(this.smartshiftFeat, this.smartshiftFeat === LG.SMARTSHIFT2 ? 1 : 0);
      s.smartshift = { mode: r[0], auto: r[1] };
    }
    if (this.caps.hires) {
      const m = (await this.call(LG.HIRES, 1))[0];
      this.wheelMode = m;
      s.hires = !!(m & 2);
      s.invert = !!(m & 4);
    }
  }

  async set(cap, v) {
    if (cap === 'dpi') {
      let dpi = Math.round(v);
      if (this.caps.dpi.list) dpi = this.caps.dpi.list.reduce((a, b) => Math.abs(b - dpi) < Math.abs(a - dpi) ? b : a);
      if (this.extDpi) {
        const c = this.caps.dpi;
        if (c.step) dpi = Math.min(c.max, Math.max(c.min, c.min + Math.round((dpi - c.min) / c.step) * c.step));
        // Valeur hors de la liste annoncée par la souris : refusée plutôt qu'envoyée
        if (!this.caps.dpi.values.includes(dpi)) throw new Error('valeur hors limites');
        const cur = this.extDpi.cur || {};
        const y = this.extDpi.y ? dpi : 0; // même sensibilité sur les deux axes
        await this.call(LG.EXT_DPI, 6, [0, dpi >> 8, dpi & 0xFF, y >> 8, y & 0xFF, this.extDpi.lod ? (cur.lod ?? 0) : 0]);
        this.extDpi.cur = { ...cur, x: dpi, y };
      } else await this.call(LG.DPI, 3, [0, dpi >> 8, dpi & 0xFF]);
    } else if (cap === 'rate') {
      if (this.rateExt) await this.call(LG.EXT_RATE, 3, [LG_EXT_RATES.indexOf(v)]);
      else await this.call(LG.RATE, 2, [Math.round(1000 / v)]);
    } else if (cap === 'smartshift') {
      await this.call(this.smartshiftFeat, this.smartshiftFeat === LG.SMARTSHIFT2 ? 2 : 1, [v.mode, v.auto || 0, 0]);
    } else if (cap === 'hires' || cap === 'invert') {
      const hires = cap === 'hires' ? v : this.state.hires;
      const invert = cap === 'invert' ? v : this.state.invert;
      // bit 0 (molette détournée vers HID++) laissé tel quel : sinon la molette ne défile plus
      const mode = (this.wheelMode & ~6) | (hires ? 2 : 0) | (invert ? 4 : 0);
      await this.call(LG.HIRES, 2, [mode]);
      // État à jour tout de suite : la réapplication au branchement enchaîne hires puis invert
      // sans relire la souris, et le second écrasait le premier
      this.wheelMode = mode;
      Object.assign(this.state, { hires: !!hires, invert: !!invert });
    }
  }
}

registerDriver({
  id: 'logitech-hidpp',
  // Collection « longue » du canal HID++ (0xFF00 usage 2 : récepteurs et filaire ; 0xFF43 : modèles récents)
  match: d => d.vendorId === 0x046D && ((d.collections[0].usagePage === 0xFF00 && d.collections[0].usage === 2) ||
    (d.collections[0].usagePage === 0xFF43 && d.collections[0].usage === 0x0202)),
  async connect(dev, group) {
    await dev.open();
    const ch = new HidppChannel(dev);
    const found = [];
    const tryIndex = async idx => {
      try {
        const r = await ch.request(idx, 0, 1, [0, 0, 0x5A], idx === 0xFF ? 800 : 500);
        if (r[0] < 2) return null; // HID++ 1.0 : trop ancien
      } catch { return null; }
      const d = new LogitechDevice(ch, idx, dev);
      await d.probe();
      return d;
    };
    // Branché en direct (filaire, Bluetooth) : index 0xFF ; derrière un récepteur : 1 à 6
    const direct = await tryIndex(0xFF);
    if (direct) found.push(direct);
    else for (let i = 1; i <= 6; i++) { const d = await tryIndex(i); if (d) found.push(d); }
    const wrap = d => {
      const inst = {
        key: `drv-${devId(dev).replace(':', '').toLowerCase()}-${d.idx}`,
        name: d.name, kind: d.kind, dev,
        meta: [d.idx === 0xFF ? 'Branché en direct' : `Sans fil (récepteur, emplacement ${d.idx})`, d.fw ? `firmware ${d.fw}` : null].filter(Boolean).join(' · '),
        state: d.state, caps: d.caps,
        refresh: () => d.refresh(), set: (c, v) => d.set(c, v), refreshBattery: () => d.refreshBattery(),
        note: d.onboard
          ? 'Cette souris a une mémoire intégrée (profils G HUB). Si elle est en mode « mémoire intégrée », elle peut ignorer ces réglages ou les reprendre au rallumage : '
            + 'pour les garder sans aucun logiciel, enregistrez-les une fois dans sa mémoire avec G HUB, puis allégez G HUB.'
          : 'Les appareils Logitech sans mémoire intégrée oublient ces réglages à l’extinction : PeriphHub les réapplique à chaque branchement.',
      };
      return inst;
    };
    // Appareil qui se réveille derrière le récepteur : notification de connexion 0x41 (rapport court,
    // sur la collection 0xFF00 usage 1 ; bit 0x40 = liaison coupée)
    const onWake = async b => {
      if (b[1] !== 0x41 || b[0] < 1 || b[0] > 6 || (b[3] & 0x40)) return;
      const key = `drv-${devId(dev).replace(':', '').toLowerCase()}-${b[0]}`;
      if (drvLive.has(key)) return;
      const d = await tryIndex(b[0]).catch(() => null);
      if (d) { const inst = wrap(d); await drvReapply(inst); drvAdd(inst, this); }
    };
    ch.listeners.add(onWake);
    const short = group.find(g => g.collections[0].usagePage === 0xFF00 && g.collections[0].usage === 1);
    if (short && direct == null) {
      await short.open().catch(() => {});
      short.addEventListener('inputreport', e => onWake(new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength)));
    }
    const list = found.map(wrap);
    for (const inst of list) await drvReapply(inst);
    if (!list.length) await dev.close().catch(() => {});
    return list;
  },
});
