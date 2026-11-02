// Éclairage de la carte mère Gigabyte (RGB Fusion 2, contrôleur ITE 048D:5702)
// Protocole documenté par OpenRGB (GigabyteRGBFusion2USBController) : feature reports
// de 64 octets, identifiant 0xCC. Les indices ci-dessous sont SANS l'identifiant
// (WebHID et la passerelle native l'ajoutent / le retirent).
//   0x60 → lecture de l'identité (modèle, firmware, ordre des couleurs…)
//   0x20+zone → effet matériel d'une zone ; 0x28 0xFF → appliquer
//   0x32 masque → effets matériels coupés sur les connecteurs ARGB (0 = tous actifs)
// Rien n'est écrit en mémoire flash : sans « enregistrer », la carte reprend ses
// réglages enregistrés au prochain démarrage.

const FUSION2_VID = 0x048d;
const FUSION2_REPORT = 0xcc;

// Zones de la B650 EAGLE AX (disposition « it5702_7 » d'OpenRGB)
const FUSION2_ZONES = [
  { idx: 5, name: 'ARGB_V2_1 / ARGB_V2_3', desc: 'Connecteurs ARGB 5 V (ventilateurs, bandes)' },
  { idx: 6, name: 'ARGB_V2_2', desc: 'Connecteur ARGB 5 V' },
  { idx: 4, name: 'LED_C', desc: 'Connecteur RGB 12 V' },
];

const FUSION2_EFFECTS = [
  { v: 0, label: 'Éteint' }, { v: 1, label: 'Fixe' }, { v: 2, label: 'Respiration' },
  { v: 3, label: 'Clignotement' }, { v: 4, label: 'Cycle de couleurs' }, { v: 6, label: 'Vague' },
];

class GigabyteRgb {
  static filters = [{ vendorId: FUSION2_VID, productId: 0x5702 }];

  static pick(devices) {
    return devices.find(d => d.vendorId === FUSION2_VID &&
      d.collections.some(c => c.featureReports?.some(r => r.reportId === FUSION2_REPORT)));
  }

  constructor(dev) {
    this.dev = dev;
    this.info = null;
  }

  async open() {
    if (!this.dev.opened) await this.dev.open();
  }

  _cmd(bytes) {
    const b = new Uint8Array(63);
    b.set(bytes);
    return this.dev.sendFeatureReport(FUSION2_REPORT, b);
  }

  async readInfo() {
    await this._cmd([0x60, 0]);
    const v = await this.dev.receiveFeatureReport(FUSION2_REPORT);
    const u8 = i => v.getUint8(i), u32 = i => v.getUint32(i, true);
    let name = '';
    for (let i = 11; i < 39 && u8(i); i++) name += String.fromCharCode(u8(i));
    const fw = u32(3);
    this.info = {
      product: u8(0), deviceNum: u8(1), name,
      fw: [fw & 255, (fw >> 8) & 255, (fw >> 16) & 255, fw >>> 24].join('.'),
      supportFlags: u8(10), chipId: '0x' + u32(55).toString(16).toUpperCase().padStart(8, '0'),
      calStrip0: u32(43), calStrip1: u32(47), rgbCali: u32(51),
    };
    return this.info;
  }

  // Effet matériel d'une zone. color = '#rrggbb', speed 0..9 (0 = rapide), brightness 0..255
  async setEffect(idx, { effect, color = '#ffffff', speed = 4, brightness = 255 }) {
    const p = new Uint8Array(63);
    const dv = new DataView(p.buffer);
    p[0] = 0x20 + idx;
    dv.setUint32(1, 1 << idx, true);
    p[10] = effect;
    p[11] = brightness;
    p[12] = 0;
    dv.setUint32(13, parseInt(color.slice(1), 16), true); // 0x00RRGGBB
    const period = i => (n => dv.setUint16(21 + i * 2, n, true));
    if (effect === 2) { // respiration : 400..1600 ms
      const t = speed <= 6 ? 400 + speed * 100 : 1000 + (speed - 6) * 200;
      period(0)(t); period(1)(t); period(2)(200);
    } else if (effect === 3) { // clignotement
      period(0)(100); period(1)(100); period(2)(speed * 200 + 700);
    } else if (effect === 4) { // cycle de couleurs
      const t = speed * 100 + 300 + (speed > 8 ? 1300 * (speed - 8) : 0);
      period(0)(t); period(1)(t - 200); p[29] = 7;
    } else if (effect === 6) { // vague
      period(0)(((speed + 1) ** 2 + (speed + 1) + 10) * 5 / 2); p[29] = 7; p[30] = 1;
    }
    await this._cmd(p);
  }

  async apply() { await this._cmd([0x28, 0xff, 0x00]); }

  // Enregistre l'éclairage dans la carte : il reste actif sans PeriphHub, même après redémarrage
  async save() {
    await this._cmd([0x47, 1]);
    await new Promise(r => setTimeout(r, 20));
    await this._cmd([0x5e, 0]);
  }

  // Effets matériels actifs sur tous les connecteurs ARGB (sinon ils attendent des couleurs LED par LED)
  async enableBuiltinEffects() { await this._cmd([0x32, 0x00]); }
}
