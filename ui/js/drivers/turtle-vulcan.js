// PeriphHub — éclairage du clavier Turtle Beach Vulcan II TKL Pro (10F5:5001), d'après le pilote libre
// OpenRGB (RoccatVulcanKeyboardController, GPL-2.0-or-later) : protocole réécrit ici.
//
// Interface 1, collection qui porte le feature report 0x11 (page 0x0001) :
//   0x11 « mode » (283 octets après l'ID) : [taille 284 LE (2 o), 0x03, mode, vitesse 1-11,
//        luminosité 1-69, 0x0B, 0x01, R × 91, G × 91, B × 91, …, somme de contrôle LE (2 o)]
//        modes : 0x01 fixe (couleur par touche), 0x0A vague arc-en-ciel. Le clavier le garde en mémoire
//        (comme Swarm II) : pas de firmware, seulement le réglage d'éclairage.
//   0x0E [0x05, 0x00, 0x00, 0x00] : quitte le mode « direct » (couleurs envoyées en continu)
//   0x04 (2 octets) : prêt quand le 1er octet vaut 1
// La somme de contrôle porte sur l'ID et tous les octets qui la précèdent.

const VULCAN_LEDS = 91;          // index des touches 0x00 à 0x5A (disposition TKL Pro)
const VULCAN_LEN = 284;          // taille du rapport 0x11, ID compris
const VULCAN_BMAX = 0x45;        // luminosité maximale
const VULCAN_FX = ['keyboard', 'static', 'wave', 'off'];
const VULCAN_LABELS = { keyboard: 'Celui du clavier', wave: 'Vague arc-en-ciel' };
const VULCAN_SPEEDS = { 1: 'Lente', 2: 'Moyenne', 3: 'Rapide' };
const VULCAN_SPEED_RAW = { 1: 2, 2: 6, 3: 10 };

// Rapport 0x11 complet, ID en tête (octet 0) : la somme de contrôle en dépend
function vulcanModeReport(mode, speed, brightness, rgb) {
  const b = new Uint8Array(VULCAN_LEN);
  b.set([0x11, VULCAN_LEN & 0xFF, VULCAN_LEN >> 8, 0x03, mode, speed, brightness, 0x0B, 0x01]);
  if (rgb) for (let i = 0; i < VULCAN_LEDS; i++) {
    b[9 + i] = rgb[0];
    b[9 + VULCAN_LEDS + i] = rgb[1];
    b[9 + 2 * VULCAN_LEDS + i] = rgb[2];
  }
  let sum = 0;
  for (let i = 0; i < VULCAN_LEN - 2; i++) sum += b[i];
  b[VULCAN_LEN - 2] = sum & 0xFF;
  b[VULCAN_LEN - 1] = (sum >> 8) & 0xFF;
  return b;
}

// ID des feature reports de toutes les collections (sous-collections comprises)
const vulcanFeatureIds = d => {
  const ids = [];
  const walk = cs => (cs || []).forEach(c => { (c.featureReports || []).forEach(r => ids.push(r.reportId)); walk(c.children); });
  walk(d.parsed || d.collections);
  return ids;
};

registerDriver({
  id: 'turtle-vulcan',
  priority: 12,
  match: d => d.vendorId === 0x10F5 && d.productId === 0x5001 && d.info?.interface === 1 && vulcanFeatureIds(d).includes(0x11),
  async connect(dev) {
    await dev.open();
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    // Le clavier traite un rapport à la fois : on attend qu'il se dise prêt (au plus ~1 s)
    const ready = async () => {
      for (let i = 0; i < 40; i++) {
        const r = await dev.receiveFeatureReport(0x04, 2).catch(() => null);
        if (r && r.byteLength && r.getUint8(0) === 1) return;
        await sleep(25);
      }
    };
    const state = { light: { effect: 'keyboard', color: '#ffffff', brightness: null, speed: 2 } };
    const inst = {
      key: `drv-${devId(dev).replace(':', '').toLowerCase()}`,
      name: 'Turtle Beach Vulcan II TKL Pro', kind: 'clavier', dev, state,
      caps: { light: { effects: VULCAN_FX, labels: VULCAN_LABELS, color: true, brightness: true } },
      meta: 'éclairage',
      noOrigin: true,
      source: 'Protocole du logiciel libre OpenRGB (GPL-2.0-or-later), pas encore confirmé sur ce modèle dans PeriphHub. '
        + 'Seul le réglage d’éclairage est écrit, jamais le firmware.',
      note: 'Ce clavier ne sait pas indiquer son éclairage actuel. Le réglage choisi est gardé par le clavier, même PeriphHub fermé. '
        + 'Fermez Turtle Beach Swarm II, sinon il réimpose le sien.',
      refresh: async () => {},
      async set(cap, v) {
        if (cap !== 'light' || !v || !VULCAN_FX.includes(v.effect)) throw new Error('effet inconnu');
        if (v.effect === 'keyboard') { Object.assign(state.light, v, { brightness: null }); return; }
        const pct = Math.max(0, Math.min(100, Math.round(Number(v.brightness ?? 100))));
        const bright = Math.max(1, Math.round(pct * VULCAN_BMAX / 100));
        const speed = VULCAN_SPEED_RAW[v.speed || 2] || 6;
        const rep = v.effect === 'wave' ? vulcanModeReport(0x0A, speed, bright, null)
          : vulcanModeReport(0x01, speed, bright, v.effect === 'off' ? [0, 0, 0] : apexRgb(v.color));
        await dev.sendFeatureReport(0x11, rep.subarray(1));
        await ready();
        await dev.sendFeatureReport(0x0E, Uint8Array.of(0x05, 0x00, 0x00, 0x00));
        await ready();
        Object.assign(state.light, v, { brightness: pct });
      },
      rows() {
        const l = state.light;
        if (l.effect !== 'wave') return [];
        return [field('Vitesse',
          segmented(Object.entries(VULCAN_SPEEDS).map(([v, label]) => ({ v: Number(v), label })), l.speed || 2, v => drvSet(inst, 'Vitesse', 'light', { ...l, speed: v })))];
      },
    };
    await drvReapply(inst);
    return [inst];
  },
});
