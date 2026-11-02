// PeriphHub — claviers QMK compatibles VIA ou Vial (Keychron, Akko, Epomaker, GMMK, NuPhy, kits…),
// d'après la documentation publique du protocole VIA (the-via/app, GPL-3.0 ; qmk_firmware, GPL-2.0).
// Rapports bruts de 32 octets sur la collection 0xFF60 / 0x61 :
//   0x01 version du protocole · 0x08 lire une valeur · 0x07 écrire · 0x09 enregistrer dans le clavier.
// Valeurs d'éclairage : canal 3 = RGB Matrix, 2 = RGBLight, 1 = rétroéclairage simple ;
// identifiants 1 luminosité, 2 effet, 3 vitesse, 4 couleur (teinte, saturation).
// La disposition des touches se modifie toujours avec VIA / Vial (elle dépend du modèle).

const VIA_NEVER = new Set(['373B:215C']); // bootloader REKT : jamais
const VIA_CHANNELS = [[3, 'RGB Matrix'], [2, 'RGBLight'], [1, 'rétroéclairage']];

function hexToHs(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let hue = 0;
  if (d) hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(((hue * 60 + 360) % 360) / 360 * 255), Math.round(max ? d / max * 255 : 0)];
}
function hsToHex(h8, s8) {
  const hue = h8 / 255 * 360, s = s8 / 255, c = s, x = c * (1 - Math.abs((hue / 60) % 2 - 1)), m = 1 - c;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

class ViaKeyboard {
  constructor(dev) {
    this.dev = dev;
    this.state = {}; this.caps = {};
    this.queue = Promise.resolve();
    this.pending = null;
    dev.addEventListener('inputreport', e => {
      const b = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
      if (this.pending && (b[0] === this.pending.cmd || b[0] === 0xFF)) this.pending.done(b);
    });
  }
  xfer(bytes) {
    const run = () => new Promise((resolve, reject) => {
      const data = new Uint8Array(32);
      data.set(bytes);
      const timer = setTimeout(() => { this.pending = null; reject(new Error('pas de réponse')); }, 500);
      this.pending = { cmd: bytes[0], done: b => {
        clearTimeout(timer); this.pending = null;
        b[0] === 0xFF ? reject(new Error('commande non prise en charge')) : resolve(b);
      } };
      this.dev.sendReport(0, data).catch(e => { clearTimeout(timer); this.pending = null; reject(e); });
    });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
  get = (id) => this.xfer([0x08, this.ch, id]);
  put = (id, ...v) => this.xfer([0x07, this.ch, id, ...v]);

  async probe() {
    const v = await this.xfer([0x01]);
    this.version = (v[1] << 8) | v[2];
    for (const [ch, label] of VIA_CHANNELS) {
      this.ch = ch;
      try { await this.get(1); this.chLabel = label; break; } catch { this.ch = 0; }
    }
    if (this.ch) {
      const rgb = this.ch !== 1;
      this.caps.light = { effects: ['off', 'static'], color: rgb, brightness: true, labels: {} };
      this.state.light = {};
    }
    await this.refresh();
  }
  async refresh() {
    if (!this.ch) return;
    const l = this.state.light;
    l.brightness = Math.round((await this.get(1))[3] / 255 * 100);
    const fx = (await this.get(2).catch(() => [0, 0, 0, 1]))[3];
    l.effect = fx === 0 ? 'off' : fx === 1 ? 'static' : 'fx' + fx;
    // effet animé déjà choisi dans le clavier : on le garde dans la liste pour pouvoir y revenir
    if (fx > 1 && !this.caps.light.effects.includes(l.effect)) {
      this.caps.light.effects.push(l.effect);
      this.caps.light.labels[l.effect] = `Effet n° ${fx} (actuel)`;
    }
    if (this.caps.light.color) { const c = await this.get(4).catch(() => null); if (c) l.color = hsToHex(c[3], c[4]); }
  }
  async set(cap, v) {
    if (cap !== 'light') return;
    const cur = this.state.light;
    if (v.brightness !== cur.brightness) await this.put(1, Math.round(v.brightness / 100 * 255));
    if (v.effect !== cur.effect) await this.put(2, v.effect === 'off' ? 0 : v.effect === 'static' ? 1 : Number(v.effect.slice(2)));
    if (v.color && v.color !== cur.color && this.caps.light.color) await this.put(4, ...hexToHs(v.color));
    await this.xfer([0x09, this.ch]); // enregistré dans le clavier : reste sans logiciel
  }
}

registerDriver({
  id: 'via',
  match: d => d.collections[0].usagePage === 0xFF60 && d.collections[0].usage === 0x61 && !VIA_NEVER.has(devId(d)),
  async connect(dev) {
    await dev.open();
    const k = new ViaKeyboard(dev);
    try { await k.probe(); } catch { await dev.close().catch(() => {}); return []; }
    return [{
      key: `drv-via-${devId(dev).replace(':', '').toLowerCase()}`,
      name: dev.productName || 'Clavier VIA', kind: 'clavier', dev,
      meta: `Protocole VIA ${k.version}` + (k.ch ? ` · éclairage ${k.chLabel}` : ''),
      state: k.state, caps: k.caps,
      refresh: () => k.refresh(), set: (c, v) => k.set(c, v),
      note: 'Les réglages sont enregistrés dans le clavier. Pour modifier la disposition des touches et les macros, '
        + 'utilisez VIA (usevia.app) ou Vial : elles dépendent du plan propre à chaque modèle.',
    }];
  },
});
