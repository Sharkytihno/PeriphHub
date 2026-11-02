// Clavier REKT Shogun68 (switchs magnétiques, plateforme « DuckBread », VID 0x373B).
// Protocole VIA (raw HID, usagePage 0xFF60, rapports de 32 octets, reportId 0) :
//   - 0x12 [offHi offLo taille]          : lecture du keymap dynamique (VIA standard)
//   - 0x02 0x96 [sous-cmd] 00 00 00 [offset] [n]          : lecture d'une table maison
//   - 0x03 0x96 [sous-cmd] 00 00 00 [offset] [n] [drapeau] [données] : écriture
//       drapeau : 1 = premier paquet, 0 = suite, 2 = dernier
//   sous-cmd 0x0D : course de déclenchement, 1 valeur/touche (uint16 BE, centièmes de mm)
//   sous-cmd 0x0E : rapid trigger, 5 octets/touche : [actif, réinit (BE), déclenchement (BE)]
//   - 0x08 0x41 / 0x07 0x41 [effet, 0, vitesse, R, V, B, luminosité] : lecture / écriture de
//     l'éclairage (capturé sur keyboard.rekt.fr, gardé par le clavier sans commande de sauvegarde)
//   - 0x05 [couche, ligne, colonne, code BE] : réaffectation d'une touche (VIA standard,
//     codes QMK v12 : 0x5220+n = Fn vers la couche n, 0x7700+n = macro n)
// Relevé le 2026-10-26 par capture WebHID de keyboard.rekt.fr (bundle obfusqué).
// Le mode bootloader (PID 0x215C) sert aux mises à jour : jamais ouvert ici.

const REKT_ROWS = 5, REKT_COLS = 15, REKT_KEYS = REKT_ROWS * REKT_COLS;
const REKT_ACT_SLOTS = 88;   // la page officielle écrit 8 paquets de 11 valeurs
const REKT_RT_SLOTS = 76;    // 19 paquets de 4 enregistrements
const REKT_LIMITS = { act: [10, 340], rt: [1, 340] }; // centièmes de mm (bornes de la page officielle)
const REKT_LAYERS = 2;       // couche normale (Windows) + couche Fn ; les couches 2-3 servent au mode Mac
const REKT_MAX_BRIGHT = 200; // luminosité maximale conseillée par la page officielle

// Effets d'éclairage (numéros relevés sur la page officielle, dans son ordre d'affichage)
const REKT_EFFECTS = [
  { v: 0x00, label: 'Éteint' }, { v: 0x02, label: 'Couleur fixe' }, { v: 0x06, label: 'Respiration' },
  { v: 0x1f, label: 'Monochrome' }, { v: 0x03, label: 'Concentration' }, { v: 0x04, label: 'Arc-en-ciel vertical' },
  { v: 0x05, label: 'Arc-en-ciel horizontal' }, { v: 0x0d, label: 'Cycle du spectre' }, { v: 0x1a, label: 'Spectre respirant' },
  { v: 0x1c, label: 'Spectre flottant' }, { v: 0x07, label: 'Ruban 1' }, { v: 0x08, label: 'Ruban 2' },
  { v: 0x09, label: 'Rotation 1' }, { v: 0x0b, label: 'Rotation 2' }, { v: 0x13, label: 'Tourbillons 1' },
  { v: 0x17, label: 'Tourbillons 2' }, { v: 0x19, label: 'Noël' }, { v: 0x1e, label: 'Pluie numérique' },
  { v: 0x24, label: 'Croix' }, { v: 0x27, label: 'Au toucher' }, { v: 0x01, label: 'Touche par touche' },
];

class RektKeyboard {
  static name = 'Clavier REKT Shogun68';
  static filters = [{ vendorId: 0x373b, productId: 0x1194, usagePage: 0xff60, usage: 0x61 }];

  static pick(devices) {
    return devices.find(d => d.vendorId === 0x373b && d.productId === 0x1194 &&
      d.collections.some(c => c.usagePage === 0xff60));
  }

  /** @param {HIDDevice} dev */
  constructor(dev) {
    this.dev = dev;
    this.keymap = [];   // codes HID de la couche 0, index = ligne*15 + colonne
    this.layers = [];   // codes des couches 0 (normale) et 1 (Fn)
    this.holes = new Set(); // positions de la matrice sans touche
    this.light = null;  // { effect, b3, speed, color, brightness }
    this.act = [];      // course par touche (centièmes de mm)
    this.rt = [];       // [{ on, reset, trigger }] par touche
    this._queue = Promise.resolve();
  }

  async open() {
    if (!this.dev.opened) await this.dev.open();
  }

  // Envoie un rapport et attend l'écho correspondant (le clavier renvoie la commande en tête)
  _xfer(bytes) {
    const run = () => new Promise((resolve, reject) => {
      const p = new Uint8Array(32);
      p.set(bytes);
      // octets de la réponse qui identifient l'écho de cette commande
      const key = p[0] === 0x12 || p[0] === 0x0e || p[0] === 0x0f ? [0, 1, 2] : p[0] === 0x02 || p[0] === 0x03 ? [0, 1, 2, 6]
        : p[0] === 0x05 ? [0, 1, 2, 3] : p[0] === 0x0c || p[0] === 0x0d ? [0] : [0, 1];
      const on = e => {
        const d = new Uint8Array(e.data.buffer);
        if (key.every(k => d[k] === p[k])) { done(); resolve(d); }
      };
      const timer = setTimeout(() => { done(); reject(new Error('Le clavier ne répond pas')); }, 1000);
      const done = () => { clearTimeout(timer); this.dev.removeEventListener('inputreport', on); };
      this.dev.addEventListener('inputreport', on);
      this.dev.sendReport(0, p).catch(err => { done(); reject(err); });
    });
    // une seule transaction à la fois
    const r = this._queue.then(run, run);
    this._queue = r.catch(() => {});
    return r;
  }

  async readKeymap() {
    const total = REKT_LAYERS * REKT_KEYS * 2;
    const bytes = [];
    for (let off = 0; off < total; off += 28) {
      const n = Math.min(28, total - off);
      const d = await this._xfer([0x12, off >> 8, off & 255, n]);
      bytes.push(...d.slice(4, 4 + n));
    }
    this.layers = [...Array(REKT_LAYERS).keys()].map(l =>
      [...Array(REKT_KEYS).keys()].map(i => bytes[(l * REKT_KEYS + i) * 2] << 8 | bytes[(l * REKT_KEYS + i) * 2 + 1]));
    this.keymap = this.layers[0];
    // Plan physique (touches imprimées), figé à la première lecture
    if (!this.layout) this.layout = this.keymap.slice();
    // Un trou de la matrice n'a de code sur aucune couche (une touche désactivée garde son Fn)
    if (!this.holes.size) this.holes = new Set(this.keymap.flatMap((c, i) => c === 0 && this.layers[1][i] === 0 ? [i] : []));
  }

  async setKey(layer, i, code) {
    await this._xfer([0x05, layer, Math.floor(i / REKT_COLS), i % REKT_COLS, code >> 8, code & 255]);
    this.layers[layer][i] = code;
  }

  async readLight() {
    const d = await this._xfer([0x08, 0x41]);
    const hex = v => v.toString(16).padStart(2, '0');
    this.light = { effect: d[2], b3: d[3], speed: d[4], color: '#' + hex(d[5]) + hex(d[6]) + hex(d[7]), brightness: d[8] };
    return this.light;
  }

  async writeLight(patch) {
    const l = { ...this.light, ...patch };
    const c = parseInt(l.color.slice(1), 16);
    await this._xfer([0x07, 0x41, l.effect, l.b3, Math.min(255, l.speed), c >> 16, (c >> 8) & 255, c & 255,
      Math.min(REKT_MAX_BRIGHT, l.brightness)]);
    this.light = l;
  }

  // Macros (VIA) : tampon de macros séparées par un octet nul. Dans une macro :
  // 01 01 kc = appui bref, 01 02 kc = enfoncer, 01 03 kc = relâcher, 01 04 <chiffres> '|' = pause (ms),
  // un caractère imprimable = texte tapé par le clavier (disposition QWERTY).
  async readMacros() {
    this.macroCount = (await this._xfer([0x0c]))[1];
    const sz = await this._xfer([0x0d]);
    this.macroSize = sz[1] << 8 | sz[2];
    const bytes = [];
    let nul = 0;
    for (let off = 0; off < this.macroSize && nul < this.macroCount; off += 28) {
      const n = Math.min(28, this.macroSize - off);
      const d = await this._xfer([0x0e, off >> 8, off & 255, n]);
      for (const b of d.slice(4, 4 + n)) {
        bytes.push(b);
        if (b === 0 && ++nul === this.macroCount) break;
      }
    }
    this.macroUsed = bytes.length;
    this.macros = [];
    let i = 0;
    for (let m = 0; m < this.macroCount; m++) {
      const steps = [];
      while (i < bytes.length && bytes[i] !== 0) {
        if (bytes[i] === 1) {
          const a = bytes[i + 1];
          if (a >= 1 && a <= 3) { steps.push({ t: ['tap', 'down', 'up'][a - 1], kc: bytes[i + 2] }); i += 3; }
          else if (a === 4) {
            let j = i + 2, ms = '';
            while (j < bytes.length && bytes[j] !== 0x7c && bytes[j] !== 0) ms += String.fromCharCode(bytes[j++]);
            steps.push({ t: 'delay', ms: Number(ms) || 0 });
            i = j + 1;
          } else if (a >= 5 && a <= 7) { steps.push({ t: ['tap', 'down', 'up'][a - 5], kc: bytes[i + 2] << 8 | bytes[i + 3] }); i += 4; }
          else i += 2;
        } else steps.push({ t: 'text', ch: String.fromCharCode(bytes[i++]) });
      }
      i++;
      this.macros.push(steps);
    }
    return this.macros;
  }

  static macroBytes(macros) {
    const out = [];
    for (const steps of macros) {
      for (const s of steps) {
        if (s.t === 'delay') out.push(1, 4, ...[...String(Math.max(1, Math.min(9999, Math.round(s.ms))))].map(c => c.charCodeAt(0)), 0x7c);
        else if (s.t === 'text') out.push(s.ch.charCodeAt(0));
        else {
          const a = ['tap', 'down', 'up'].indexOf(s.t) + 1;
          if (s.kc > 0xff) out.push(1, a + 4, s.kc >> 8, s.kc & 255); else out.push(1, a, s.kc);
        }
      }
      out.push(0);
    }
    return out;
  }

  async writeMacros(macros) {
    const bytes = RektKeyboard.macroBytes(macros);
    if (bytes.length > this.macroSize) throw new Error('Macros trop longues pour la mémoire du clavier');
    // on efface aussi la fin de l'ancien contenu
    while (bytes.length < Math.min(this.macroSize, this.macroUsed)) bytes.push(0);
    for (let off = 0; off < bytes.length; off += 28) {
      const chunk = bytes.slice(off, off + 28);
      await this._xfer([0x0f, off >> 8, off & 255, chunk.length, ...chunk]);
    }
    await this.readMacros();
  }

  async readAct() {
    this.act = [];
    for (let off = 0; off < 84; off += 12) {
      const d = await this._xfer([0x02, 0x96, 0x0d, 0, 0, 0, off, 12]);
      for (let i = 0; i < 12; i++) this.act[off + i] = (d[8 + 2 * i] << 8) | d[9 + 2 * i];
    }
  }

  async readRt() {
    this.rt = [];
    for (let off = 0; off < REKT_RT_SLOTS; off += 4) {
      const d = await this._xfer([0x02, 0x96, 0x0e, 0, 0, 0, off, 4]);
      for (let i = 0; i < 4; i++) {
        const o = 8 + 5 * i;
        this.rt[off + i] = { on: d[o] === 1, reset: (d[o + 1] << 8) | d[o + 2], trigger: (d[o + 3] << 8) | d[o + 4] };
      }
    }
  }

  async readAll() {
    await this.readKeymap();
    await this.readAct();
    await this.readRt();
    await this.readLight();
    await this.readMacros();
  }

  // Une position du keymap sans code HID est un trou de la matrice (pas de touche)
  isKey(i) { return i < REKT_KEYS && !this.holes.has(i); }

  static _clamp(v, [lo, hi]) { return Math.min(hi, Math.max(lo, Math.round(v))); }

  // values : tableau complet (index = position matrice) — on réécrit toute la table,
  // comme la page officielle
  async writeAct(values) {
    const all = Array.from({ length: REKT_ACT_SLOTS }, (_, i) =>
      i < REKT_KEYS && values[i] ? RektKeyboard._clamp(values[i], REKT_LIMITS.act) : (values[i] || 0));
    for (let off = 0; off < REKT_ACT_SLOTS; off += 11) {
      const b = [0x03, 0x96, 0x0d, 0, 0, 0, off, 11, off === 0 ? 1 : off + 11 >= REKT_ACT_SLOTS ? 2 : 0];
      for (let i = 0; i < 11; i++) b.push(all[off + i] >> 8, all[off + i] & 255);
      await this._xfer(b);
    }
    this.act = all.slice(0, 84);
  }

  async writeRt(records) {
    const all = Array.from({ length: REKT_RT_SLOTS }, (_, i) => records[i] || { on: false, reset: 0, trigger: 0 });
    for (let off = 0; off < REKT_RT_SLOTS; off += 4) {
      const b = [0x03, 0x96, 0x0e, 0, 0, 0, off, 4, off === 0 ? 1 : off + 4 >= REKT_RT_SLOTS ? 2 : 0];
      for (let i = 0; i < 4; i++) {
        const r = all[off + i];
        const reset = r.reset ? RektKeyboard._clamp(r.reset, REKT_LIMITS.rt) : 0;
        const trig = r.trigger ? RektKeyboard._clamp(r.trigger, REKT_LIMITS.rt) : 0;
        b.push(r.on ? 1 : 0, reset >> 8, reset & 255, trig >> 8, trig & 255);
      }
      await this._xfer(b);
    }
    this.rt = all;
  }

  // Applique des réglages aux touches sélectionnées, en gardant les autres intactes
  async applyAct(keys, value) {
    const v = this.act.slice();
    keys.forEach(i => { v[i] = value; });
    await this.writeAct(v);
  }

  async applyRt(keys, patch) {
    const r = this.rt.map(x => ({ ...x }));
    keys.forEach(i => { Object.assign(r[i], patch); });
    await this.writeRt(r);
  }
}

// Libellés AZERTY des codes HID (position physique → caractère imprimé sur un clavier FR)
const HID_FR = {
  0x04: 'Q', 0x05: 'B', 0x06: 'C', 0x07: 'D', 0x08: 'E', 0x09: 'F', 0x0a: 'G', 0x0b: 'H', 0x0c: 'I', 0x0d: 'J',
  0x0e: 'K', 0x0f: 'L', 0x10: ',', 0x11: 'N', 0x12: 'O', 0x13: 'P', 0x14: 'A', 0x15: 'R', 0x16: 'S', 0x17: 'T',
  0x18: 'U', 0x19: 'V', 0x1a: 'Z', 0x1b: 'X', 0x1c: 'Y', 0x1d: 'W',
  0x1e: '&', 0x1f: 'é', 0x20: '"', 0x21: "'", 0x22: '(', 0x23: '-', 0x24: 'è', 0x25: '_', 0x26: 'ç', 0x27: 'à',
  0x28: 'Entrée', 0x29: 'Échap', 0x2a: '⌫', 0x2b: 'Tab', 0x2c: 'Espace', 0x2d: ')', 0x2e: '=', 0x2f: '^', 0x30: '$',
  0x31: '*', 0x32: '*', 0x33: 'M', 0x34: 'ù', 0x35: '²', 0x36: ';', 0x37: ':', 0x38: '!', 0x39: 'Verr.Maj',
  0x49: 'Inser', 0x4a: 'Début', 0x4b: 'PgPréc', 0x4c: 'Suppr', 0x4d: 'Fin', 0x4e: 'PgSuiv',
  0x4f: '→', 0x50: '←', 0x51: '↓', 0x52: '↑', 0x64: '<',
  0xe0: 'Ctrl', 0xe1: 'Maj', 0xe2: 'Alt', 0xe3: 'Win', 0xe4: 'Ctrl', 0xe5: 'Maj', 0xe6: 'AltGr', 0xe7: 'Win',
};
const HID_MORE = {
  0x00: '—', 0x01: '▽', 0x46: 'ImprÉc', 0x47: 'ArrDéf', 0x48: 'Pause', 0x65: 'Menu',
  0xa8: 'Muet', 0xa9: 'Vol +', 0xaa: 'Vol −', 0xab: 'Suivant', 0xac: 'Précédent', 0xad: 'Stop', 0xae: 'Lecture',
  0xbd: 'Lum +', 0xbe: 'Lum −', 0xc2: 'Calc',
};

function rektKeyLabel(code) {
  if (code in HID_FR) return HID_FR[code];
  if (code in HID_MORE) return HID_MORE[code];
  if (code >= 0x3a && code <= 0x45) return 'F' + (code - 0x39);
  if (code >= 0x68 && code <= 0x73) return 'F' + (code - 0x5b);
  if (code >= 0x5220 && code <= 0x523f) return code === 0x5221 ? 'Fn' : 'Fn' + (code - 0x5220);
  if (code >= 0x7700 && code <= 0x771f) return 'Macro ' + (code - 0x76ff);
  if (code >= 0x7800 && code <= 0x78ff) return 'Éclair.';
  if (code >= 0x7e00 && code <= 0x7eff) return 'Spécial';
  return '0x' + code.toString(16);
}

// Fonctions proposées pour réaffecter une touche (codes QMK v12)
const REKT_KEY_GROUPS = [
  { name: 'Désactiver', codes: [0x00] },
  { name: 'Lettres', codes: [0x14, 0x1d, 0x08, 0x15, 0x17, 0x1c, 0x18, 0x0c, 0x12, 0x13, 0x04, 0x16, 0x07, 0x09, 0x0a,
    0x0b, 0x0d, 0x0e, 0x0f, 0x33, 0x1a, 0x1b, 0x06, 0x19, 0x05, 0x11] },
  { name: 'Chiffres et symboles', codes: [0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x2d, 0x2e, 0x2f, 0x30,
    0x31, 0x34, 0x35, 0x36, 0x37, 0x38, 0x10, 0x64] },
  { name: 'Fonctions', codes: [...Array(12).keys()].map(i => 0x3a + i).concat([...Array(12).keys()].map(i => 0x68 + i)) },
  { name: 'Édition et navigation', codes: [0x29, 0x2b, 0x2c, 0x28, 0x2a, 0x4c, 0x49, 0x4a, 0x4d, 0x4b, 0x4e, 0x52, 0x51, 0x50, 0x4f,
    0x46, 0x47, 0x48, 0x65, 0x39] },
  { name: 'Modificateurs', codes: [0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7] },
  { name: 'Multimédia', codes: [0xae, 0xab, 0xac, 0xad, 0xa8, 0xa9, 0xaa, 0xc2] },
  { name: 'Macros', codes: [...Array(16).keys()].map(i => 0x7700 + i) },
];

// Nom long (liste de choix) : on précise gauche/droite pour les modificateurs
const REKT_LONG = { 0x00: 'Aucune (touche désactivée)', 0xe0: 'Ctrl gauche', 0xe1: 'Maj gauche', 0xe2: 'Alt', 0xe3: 'Win gauche',
  0xe4: 'Ctrl droit', 0xe5: 'Maj droite', 0xe6: 'AltGr', 0xe7: 'Win droite', 0x2c: 'Espace', 0x2a: 'Retour arrière' };
const rektKeyName = code => REKT_LONG[code] || rektKeyLabel(code);
