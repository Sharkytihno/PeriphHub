// Souris Scyrox (plateforme Compx « S-center », VID 0x3554).
// Protocole extrait de https://www.scyrox.net/ (bundle Vite non obfusqué) :
//   - report HID 8, 16 octets : [cmd, 0, addrHi, addrLo, len, data(10)…, checksum]
//   - checksum = (0x55 - somme(octets 0..14) - reportId) & 0xFF
//   - la config vit dans une « flash » de 256 octets ; chaque valeur est une paire
//     (v, 0x55 - v) — l'octet de contrôle permet de savoir si la case est valide.
// Les commandes de mise à jour du firmware ne sont volontairement PAS implémentées.

const SCYROX_REPORT_ID = 8;

const SCYROX_CMD = {
  EncryptionData: 1, // simple poignée de main (4 octets aléatoires), pas de vrai chiffrement
  DeviceOnLine: 3,
  BatteryLevel: 4,
  WriteFlashData: 7,
  ReadFlashData: 8,
  GetCurrentConfig: 14,
  ReadVersionID: 18,
};

// Adresses dans la flash (table `Se` du site officiel)
const SCYROX_ADDR = {
  ReportRate: 0, maxDpiStage: 2, CurrentDPI: 4, Scyrox20K: 8, LOD: 10, DPIValue: 12,
  DPIColor: 44, KeyFunction: 96, Light: 160, DebounceTime: 169, MotionSync: 171,
  SleepTime: 173, Angle: 175, Ripple: 177, MovingOffLight: 179, PerformanceState: 181,
  Performance: 183, SensorMode: 185, AngleTune: 189, AngleTuneState: 191,
  SensorFPS20K: 225, WheelDebounceTime: 227, DebounceReleaseTime: 229,
  ShortcutKey: 256, Macro: 768,
};

// Boutons (ordre de KeyFunction) et fonction d'usine de chacun
const SCYROX_BUTTONS = ['Clic gauche', 'Clic droit', 'Clic molette', 'Latéral arrière', 'Latéral avant', 'Bouton DPI'];

// Types de fonction d'un bouton (Ro du site) ; un bouton = 4 octets [type, p1, p2, contrôle]
const SCYROX_FN = { Disable: 0, Mouse: 1, Dpi: 2, HScroll: 3, Fire: 4, Shortcut: 5, Macro: 6, Polling: 7, VScroll: 11 };
const SCYROX_DEFAULT_KEYS = [[1, 1], [1, 2], [1, 4], [1, 8], [1, 0x10], [2, 1]];
// Modificateurs dans les raccourcis et macros : type 0, valeur = bit du modificateur (octet HID)
const SCYROX_MOD_BITS = { 0xe0: 1, 0xe1: 2, 0xe2: 4, 0xe3: 8, 0xe4: 16, 0xe5: 32, 0xe6: 64, 0xe7: 128 };
// Répétition d'une macro : 1 à 250 fois, ou modes spéciaux
const SCYROX_MACRO_REPEAT = { held: 254, untilAny: 255, toggle: 253 };

class ScyroxMouse {
  static name = 'Souris Scyrox';
  static filters = [{ vendorId: 0x3554 }];

  /** @param {HIDDevice} dev */
  constructor(dev) {
    this.dev = dev;
    this.flash = new Uint8Array(SCYROX_ADDR.Macro + SCYROX_BUTTONS.length * 384).fill(255);
    this.info = {};
    this._waiters = [];
    this._onReport = e => {
      if (e.reportId !== SCYROX_REPORT_ID) return;
      const d = new Uint8Array(e.data.buffer);
      const i = this._waiters.findIndex(w => w.match(d));
      if (i >= 0) this._waiters.splice(i, 1)[0].resolve(d);
    };
  }

  // Le dongle expose plusieurs interfaces : on garde celle qui a exactement
  // un report d'entrée et un de sortie, de reportId 8 (même logique que le site).
  static pick(devices) {
    return devices.find(d => d.collections.some(c =>
      c.inputReports.length === 1 && c.outputReports.length === 1 &&
      c.outputReports[0].reportId === SCYROX_REPORT_ID));
  }

  async open() {
    if (!this.dev.opened) await this.dev.open();
    this.dev.removeEventListener('inputreport', this._onReport); // open() peut être rappelé au réveil
    this.dev.addEventListener('inputreport', this._onReport);
    const rnd = Array.from({ length: 4 }, () => Math.floor(Math.random() * 256));
    const hs = await this._cmd(SCYROX_CMD.EncryptionData, [...rnd, 0, 0, 0, 0]);
    const type = hs[11];
    this.info = {
      cid: hs[9], mid: hs[10], type,
      wired: type === 2 || type === 3,
      maxReportRate: { 0: 1000, 1: 4000, 2: 1000, 3: 8000, 4: 2000, 5: 8000 }[type] ?? 1000,
    };
    // Souris en veille ou éteinte : le dongle répond mais pas la souris
    if (!(await this.isOnline())) return;
    const ver = await this._cmd(SCYROX_CMD.ReadVersionID, []);
    this.info.version = 'v' + ver[5] + '.' + ver[6].toString(16).padStart(2, '0');
    await this.refreshBattery();
  }

  async close() {
    this.dev.removeEventListener('inputreport', this._onReport);
    if (this.dev.opened) await this.dev.close();
  }

  _packet(cmd, addr, data) {
    const p = new Uint8Array(16);
    p[0] = cmd; p[2] = addr >> 8; p[3] = addr & 255; p[4] = data.length;
    data.forEach((v, i) => { p[5 + i] = v; });
    let sum = 0;
    for (let i = 0; i < 15; i++) sum += p[i];
    p[15] = (0x55 - (sum & 255) - SCYROX_REPORT_ID) & 255;
    return p;
  }

  // Envoie un paquet et attend la réponse de même commande et même adresse
  // (5 essais, 300 ms chacun — même politique que le site officiel)
  async _send(p) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const reply = new Promise(resolve => {
        // l'adresse n'est renvoyée que pour les lectures/écritures flash
        const flash = p[0] === SCYROX_CMD.WriteFlashData || p[0] === SCYROX_CMD.ReadFlashData;
        const w = { match: d => d[0] === p[0] && (!flash || (d[2] === p[2] && d[3] === p[3])), resolve };
        this._waiters.push(w);
        setTimeout(() => {
          const i = this._waiters.indexOf(w);
          if (i >= 0) { this._waiters.splice(i, 1); resolve(null); }
        }, 300);
      });
      await this.dev.sendReport(SCYROX_REPORT_ID, p);
      const d = await reply;
      if (d) return d;
    }
    throw new Error('La souris ne répond pas (commande ' + p[0] + ')');
  }

  _cmd(cmd, data) {
    return this._send(this._packet(cmd, 0, data));
  }

  // Écrit des octets bruts dans la flash, par blocs de 10 (Et() du site)
  async _writeBlock(addr, bytes) {
    for (let o = 0; o < bytes.length; o += 10) {
      const chunk = [...bytes.slice(o, o + 10)];
      await this._send(this._packet(SCYROX_CMD.WriteFlashData, addr + o, chunk));
    }
    bytes.forEach((b, i) => { this.flash[addr + i] = b & 255; });
  }

  // Écrit une valeur simple sous forme de paire (v, 0x55 - v) (st() du site)
  _write(addr, v) {
    return this._writeBlock(addr, [v & 255, (0x55 - v) & 255]);
  }

  // ---- Réglages (mêmes encodages que scyrox.net) ----

  setReportRate(hz) {
    if (!SCYROX_REPORT_RATES.some(r => r.hz === hz) || hz > this.info.maxReportRate) throw new Error('Polling non supporté : ' + hz);
    return this._write(SCYROX_ADDR.ReportRate, hz <= 1000 ? 1000 / hz : hz / 2000 * 16);
  }

  // Capteur PAW3950 : 50 à 30 000 DPI par pas de 50, stocké en (dpi/50 - 1) sur 10 bits
  setDpi(stage, dpi) {
    if (stage < 0 || stage > 7) throw new Error('Niveau DPI invalide');
    dpi = Math.min(30000, Math.max(50, Math.round(dpi / 50) * 50));
    const val = dpi / 50 - 1, hi = val >> 8;
    const r = [val & 255, val & 255, (hi << 2) | (hi << 6)];
    r.push((0x55 - (r[0] + r[1] + r[2])) & 255);
    return this._writeBlock(SCYROX_ADDR.DPIValue + stage * 4, r);
  }

  setDpiStages(n) { return this._write(SCYROX_ADDR.maxDpiStage, Math.min(8, Math.max(1, n))); }
  setCurrentDpi(stage) { return this._write(SCYROX_ADDR.CurrentDPI, stage); }
  setLod(v) { return this._write(SCYROX_ADDR.LOD, v); }
  // Le site écrit la même valeur dans SleepTime et Performance (Set_MS_ScyroxSleepTime)
  async setSleep(v) { await this._write(SCYROX_ADDR.SleepTime, v); await this._write(SCYROX_ADDR.Performance, v); }
  setMotionSync(on) { return this._write(SCYROX_ADDR.MotionSync, on ? 1 : 0); }
  setRipple(on) { return this._write(SCYROX_ADDR.Ripple, on ? 1 : 0); }
  setAngleSnapping(on) { return this._write(SCYROX_ADDR.Angle, on ? 1 : 0); }
  setCompetitive(on) { return this._write(SCYROX_ADDR.PerformanceState, on ? 1 : 0); }
  set20K(on) { return this._write(SCYROX_ADDR.Scyrox20K, on ? 1 : 0); }
  setDebounce(ms) { return this._write(SCYROX_ADDR.DebounceTime, Math.min(30, Math.max(0, ms))); }
  async setAngleTune(deg) {
    deg = Math.min(30, Math.max(-30, Math.round(deg)));
    if (this._val(SCYROX_ADDR.AngleTuneState) !== 1) await this._write(SCYROX_ADDR.AngleTuneState, 1);
    await this._write(SCYROX_ADDR.AngleTune, deg < 0 ? deg + 256 : deg);
  }

  // ---- Boutons ----

  // Lit raccourcis et macros des boutons qui en ont (la table KeyFunction est déjà lue avec le reste)
  async readButtons() {
    for (let i = 0; i < SCYROX_BUTTONS.length; i++) {
      const k = this._key(i);
      if (k?.type === SCYROX_FN.Shortcut) {
        const a = SCYROX_ADDR.ShortcutKey + i * 32;
        await this.readFlash(a, a + 10);
        await this.readFlash(a + 10, a + Math.min(32, this.flash[a] * 3 + 2));
      } else if (k?.type === SCYROX_FN.Macro) {
        const a = SCYROX_ADDR.Macro + i * 384;
        await this.readFlash(a, a + 32);
        const n = this.flash[a + 31];
        if (n <= 70) await this.readFlash(a + 32, a + 33 + n * 5);
      }
    }
  }

  _key(i) {
    const f = this.flash, a = SCYROX_ADDR.KeyFunction + i * 4;
    if (((f[a] + f[a + 1] + f[a + 2] + f[a + 3]) & 255) !== 0x55) return null;
    return { type: f[a], p1: f[a + 1], p2: f[a + 2] };
  }

  // Étapes d'un raccourci ou d'une macro : 1 octet (état << 6 | type), valeur LE
  // état 2 (0x80) = appui, 1 (0x40) = relâchement ; type 0 = modificateur (bits), 1 = touche HID, 2 = multimédia
  static _hid(type, value) {
    if (type === 0) return Number(Object.keys(SCYROX_MOD_BITS).find(k => SCYROX_MOD_BITS[k] === value)) || null;
    return type === 1 ? value : null;
  }

  button(i) {
    const k = this._key(i);
    if (!k) return { type: null };
    const b = { ...k };
    const f = this.flash;
    if (k.type === SCYROX_FN.Shortcut) {
      const a = SCYROX_ADDR.ShortcutKey + i * 32, n = f[a] / 2;
      const ctx = [...Array(n > 0 && n <= 5 ? n : 0).keys()].map(o => ({ type: f[a + 1 + o * 3] & 15, value: f[a + 2 + o * 3] | f[a + 3 + o * 3] << 8 }));
      if (ctx.length === 1 && ctx[0].type === 2) b.media = ctx[0].value;
      else b.keys = ctx.map(c => ScyroxMouse._hid(c.type, c.value)).filter(Boolean);
    } else if (k.type === SCYROX_FN.Macro) {
      const a = SCYROX_ADDR.Macro + i * 384, len = f[a], n = f[a + 31];
      b.repeat = k.p2;
      b.macro = { name: '', steps: [] };
      if (len > 0 && len <= 30 && n <= 70) {
        b.macro.name = new TextDecoder().decode(f.slice(a + 1, a + 1 + len));
        for (let o = 0; o < n; o++) {
          const p = a + 32 + o * 5;
          const kc = ScyroxMouse._hid(f[p] & 15, f[p + 1] | f[p + 2] << 8);
          if (kc) b.macro.steps.push({ down: f[p] >> 6 === 2, kc, delay: f[p + 3] << 8 | f[p + 4] });
        }
      }
    }
    return b;
  }

  static _ctx(kc) {
    return kc in SCYROX_MOD_BITS ? [0, SCYROX_MOD_BITS[kc], 0] : [1, kc & 255, kc >> 8];
  }

  // b = { type, p1, p2 } + keys (raccourci, ≤ 5 touches) | media (code multimédia) | macro {name, steps} + repeat
  async setButton(i, b) {
    if (i < 0 || i >= SCYROX_BUTTONS.length) throw new Error('Bouton invalide');
    let { type, p1 = 0, p2 = 0 } = b;
    if (type === SCYROX_FN.Shortcut) {
      const r = [];
      if (b.media != null) r.push(2, 0x82, b.media & 255, b.media >> 8, 0x42, b.media & 255, b.media >> 8);
      else {
        const keys = (b.keys || []).slice(0, 5);
        if (!keys.length) throw new Error('Raccourci vide');
        r.push(keys.length * 2);
        for (const kc of keys) { const [t, lo, hi] = ScyroxMouse._ctx(kc); r.push(t | 0x80, lo, hi); }
        for (const kc of [...keys].reverse()) { const [t, lo, hi] = ScyroxMouse._ctx(kc); r.push(t | 0x40, lo, hi); }
      }
      r.push((0x55 - r.reduce((s, v) => s + v, 0)) & 255);
      await this._writeBlock(SCYROX_ADDR.ShortcutKey + i * 32, r);
      p1 = p2 = 0;
    } else if (type === SCYROX_FN.Macro) {
      const steps = (b.macro?.steps || []).slice(0, 70);
      if (!steps.length) throw new Error('Macro vide');
      const name = new TextEncoder().encode((b.macro.name || 'Macro').slice(0, 30)).slice(0, 30);
      const r = new Array(32).fill(255);
      r[0] = name.length;
      name.forEach((v, j) => { r[1 + j] = v; });
      r[31] = steps.length;
      const ctx = [];
      for (const s of steps) {
        const [t, lo, hi] = ScyroxMouse._ctx(s.kc);
        const d = Math.max(0, Math.min(65535, Math.round(s.delay || 0)));
        ctx.push((s.down ? 0x80 : 0x40) | t, lo, hi, d >> 8, d & 255);
      }
      ctx.push((0x55 - steps.length - ctx.reduce((s, v) => s + v, 0)) & 255);
      await this._writeBlock(SCYROX_ADDR.Macro + i * 384, [...r, ...ctx]);
      p1 = i;
      p2 = Math.max(1, Math.min(255, b.repeat || 1));
    }
    const k = [type, p1 & 255, p2 & 255];
    k.push((0x55 - k[0] - k[1] - k[2]) & 255);
    await this._writeBlock(SCYROX_ADDR.KeyFunction + i * 4, k);
  }

  resetButton(i) {
    const [type, p1] = SCYROX_DEFAULT_KEYS[i];
    return this.setButton(i, { type, p1 });
  }

  async isOnline() {
    const on = await this._cmd(SCYROX_CMD.DeviceOnLine, []);
    this.info.online = on[5] === 1;
    return this.info.online;
  }

  async refreshBattery() {
    const bat = await this._cmd(SCYROX_CMD.BatteryLevel, []);
    this.info.battery = { level: bat[5], charging: bat[6] === 1, mv: (bat[7] << 8) + bat[8] };
    return this.info.battery;
  }

  async readFlash(from = 0, to = 256) {
    for (let a = from; a < to; a += 10) {
      const len = Math.min(10, to - a);
      // len = nombre d'octets demandés, zone de données à zéro
      const p = this._packet(SCYROX_CMD.ReadFlashData, a, new Array(len).fill(0));
      const d = await this._send(p);
      for (let i = 0; i < (d[4] & 15); i++) this.flash[a + i] = d[5 + i];
    }
    return this.flash;
  }

  // Une case (v, 0x55 - v) est valide si la somme des deux vaut 0x55
  _val(addr) {
    const f = this.flash;
    return ((f[addr] + f[addr + 1]) & 255) === 0x55 ? f[addr] : null;
  }

  _dpi(stage) {
    const f = this.flash, a = SCYROX_ADDR.DPIValue + stage * 4;
    return (f[a] + (((f[a + 2] >> 2) & 3) << 8) + 1) * 50;
  }

  decode() {
    const v = a => this._val(a);
    const rr = v(SCYROX_ADDR.ReportRate);
    const tune = v(SCYROX_ADDR.AngleTune);
    return {
      reportRate: rr == null ? null : rr >= 16 ? rr / 16 * 2000 : 1000 / rr,
      dpiStages: v(SCYROX_ADDR.maxDpiStage),
      currentDpiStage: v(SCYROX_ADDR.CurrentDPI),
      dpis: [...Array(8).keys()].map(i => this._dpi(i)),
      lod: v(SCYROX_ADDR.LOD),
      sleepTime: v(SCYROX_ADDR.SleepTime),
      motionSync: v(SCYROX_ADDR.MotionSync) === 1,
      ripple: v(SCYROX_ADDR.Ripple) === 1,
      angleSnapping: v(SCYROX_ADDR.Angle) === 1,
      competitive: v(SCYROX_ADDR.PerformanceState) === 1,
      scyrox20k: v(SCYROX_ADDR.Scyrox20K) === 1,
      debounceTime: v(SCYROX_ADDR.DebounceTime),
      angleTune: tune == null ? 0 : tune >= 128 ? tune - 256 : tune,
    };
  }
}

// Valeurs tirées de https://www.scyrox.net/lang/en.json (capteur 3950)
const SCYROX_REPORT_RATES = [125, 250, 500, 1000, 2000, 4000, 8000].map(hz => ({ hz, label: hz + ' Hz' }));
const SCYROX_LOD = [{ v: 3, label: '0,7 mm' }, { v: 1, label: '1 mm' }, { v: 2, label: '2 mm' }];
const SCYROX_SLEEP = [{ v: 1, label: '10 s' }, { v: 3, label: '30 s' }, { v: 6, label: '1 min' }, { v: 30, label: '5 min' }, { v: 60, label: '10 min' }, { v: 180, label: '30 min' }];
