// PeriphHub — éclairage des claviers SteelSeries Apex 3 et Apex 3 TKL, d'après le pilote libre
// OpenRGB (SteelSeriesApexTZoneController / SteelSeriesApex8ZoneController, GPL-2.0) :
// protocole réécrit ici, aucun code repris.
//
// Apex 3 (1038:161A, interface 3) : rapports de 32 octets, ID 0.
//   [0x0A, 0x00, luminosité 0-100]           luminosité
//   [0x0B, 0x00, R,G,B × 10 zones]           couleurs, en direct
// Apex 3 TKL (1038:1622, interface 1, page 0xFFC0) : rapports de 64 octets, ID 0.
//   [0x23, luminosité 0-16]                  luminosité
//   [0x21, 0xFF, R,G,B × 8 zones]            couleurs, en direct
//
// C'est tout ce que ces claviers savent régler (pas de mémoire intégrée, pas de macros matérielles :
// les touches multimédia et le verrouillage Windows sont gérés par le clavier lui-même). Les effets
// animés de SteelSeries GG sont calculés par le logiciel : PeriphHub fait pareil.
//
// Ces claviers ne savent pas dire leur éclairage actuel : PeriphHub n'écrit JAMAIS dans leur
// mémoire (pas de commande d'enregistrement). Débrancher puis rebrancher le clavier lui rend
// son éclairage d'origine ; PeriphHub renvoie le choix de l'utilisateur à chaque branchement.

const APEX_MODELS = {
  // pid : [nom, interface, page d'usage (null : peu importe), zones, taille du rapport, luminosité max]
  0x161A: ['SteelSeries Apex 3', 3, null, 10, 32, 100],
  0x1622: ['SteelSeries Apex 3 TKL', 1, 0xFFC0, 8, 64, 16],
};
const apexModel = d => d.vendorId === 0x1038 ? APEX_MODELS[d.productId] : null;
const apexRgb = hex => [1, 3, 5].map(i => parseInt(String(hex || '#ffffff').slice(i, i + 2), 16) || 0);
const apexHex = rgb => '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
// Teinte (0-360) → RGB à pleine saturation
const apexHue = deg => [5, 3, 1].map(n => {
  const k = (n + (((deg % 360) + 360) % 360) / 60) % 6;
  return 255 * (1 - Math.max(0, Math.min(k, 4 - k, 1)));
});

// Effets. « keyboard » : éclairage du clavier lui-même (rien envoyé). Les effets animés ne tournent
// que tant que PeriphHub est ouvert.
const APEX_FX = ['keyboard', 'static', 'zones', 'rainbow', 'spectrum', 'breathing', 'wave', 'off'];
const APEX_ANIMATED = new Set(['spectrum', 'breathing', 'wave']);
const APEX_LABELS = { keyboard: 'Celui du clavier', zones: 'Par zone', rainbow: 'Arc-en-ciel', wave: 'Vague' };
const APEX_SPEEDS = { 1: 'Lente', 2: 'Moyenne', 3: 'Rapide' };

// Couleurs des zones (de gauche à droite) pour l'effet `l` à l'instant `t` (secondes)
function apexFrame(l, zones, t) {
  const speed = [0, 0.5, 1, 2][l.speed || 2];
  const all = f => Array.from({ length: zones }, (_, i) => f(i));
  switch (l.effect) {
    case 'off': return all(() => [0, 0, 0]);
    case 'zones': return all(i => apexRgb(l.zones?.[i] || l.color));
    case 'rainbow': return all(i => apexHue(i * 300 / (zones - 1)));
    case 'spectrum': return all(() => apexHue(t * 40 * speed));
    case 'breathing': {
      const k = 0.08 + 0.92 * (0.5 - 0.5 * Math.cos(t * Math.PI * 0.5 * speed));
      return all(() => apexRgb(l.color).map(v => v * k));
    }
    case 'wave': return all(i => apexHue(i * 36 - t * 90 * speed));
    default: return all(() => apexRgb(l.color));
  }
}

registerDriver({
  id: 'steelseries-apex',
  priority: 12, // avant OpenMouse (10), qui accepte tout appareil SteelSeries puis abandonne
  match: d => {
    const m = apexModel(d);
    return !!m && d.info?.interface === m[1] && (m[2] == null || d.collections?.some(c => c.usagePage === m[2]));
  },
  async connect(dev) {
    const [name, , , zones, size, bmax] = apexModel(dev);
    await dev.open();
    const tkl = zones === 8;
    const send = async bytes => {
      const r = new Uint8Array(size);
      r.set(bytes.map(v => Math.max(0, Math.min(255, Math.round(v)))));
      await dev.sendReport(0, r);
    };
    const sendColors = rgbs => send(tkl ? [0x21, 0xFF, ...rgbs.flat()] : [0x0B, 0x00, ...rgbs.flat()]);
    const sendBrightness = pct => send(tkl ? [0x23, pct * bmax / 100] : [0x0A, 0x00, pct * bmax / 100]);

    // Au départ, le clavier affiche son propre éclairage (inconnu de PeriphHub)
    const state = { light: { effect: 'keyboard', color: '#ffffff', brightness: null, speed: 2, zones: Array(zones).fill('#ffffff') } };

    // Animation : 15 images par seconde, jamais deux envois en même temps
    let timer = null, busy = false, t0 = 0;
    const stop = () => { if (timer) clearInterval(timer); timer = null; };
    const animate = () => {
      stop();
      t0 = performance.now();
      timer = setInterval(async () => {
        if (busy) return;
        busy = true;
        try { await sendColors(apexFrame(state.light, zones, (performance.now() - t0) / 1000)); }
        catch (e) { stop(); console.warn('[PeriphHub] animation Apex arrêtée :', e.message); }
        finally { busy = false; }
      }, 66);
    };

    const inst = {
      key: `drv-${devId(dev).replace(':', '').toLowerCase()}`,
      name, kind: 'clavier', dev, state,
      caps: { light: { effects: APEX_FX, labels: APEX_LABELS, color: true, brightness: true } },
      meta: `éclairage · ${zones} zones`,
      noOrigin: true, // rien n'est enregistré dans le clavier : le rebrancher suffit
      source: 'Protocole du logiciel libre OpenRGB (GPL-2.0), pas encore confirmé sur ce modèle dans PeriphHub. '
        + 'PeriphHub n’écrit rien dans la mémoire du clavier.',
      note: 'Ce clavier ne sait pas indiquer son éclairage actuel. PeriphHub l’applique en direct sans rien enregistrer '
        + 'dans le clavier, et le renvoie à chaque branchement. Pour retrouver l’éclairage d’origine : choisissez « Celui du clavier », '
        + 'puis débranchez et rebranchez le clavier. Fermez SteelSeries GG, sinon il réimpose le sien.',
      refresh: async () => {},
      release: stop,
      async set(cap, v) {
        if (cap !== 'light' || !v || !APEX_FX.includes(v.effect)) throw new Error('effet inconnu');
        stop();
        if (v.effect === 'keyboard') {
          // Rien à envoyer : le clavier reprend son éclairage au prochain branchement
          if (state.light.effect !== 'keyboard') toast('Débranchez et rebranchez le clavier pour retrouver son éclairage.', 'ok');
          Object.assign(state.light, v, { effect: 'keyboard', brightness: null });
          return;
        }
        const pct = Math.max(0, Math.min(100, Math.round(Number(v.brightness ?? 100))));
        const next = { ...state.light, ...v, brightness: pct };
        if (!Array.isArray(next.zones) || next.zones.length !== zones) next.zones = Array(zones).fill(next.color || '#ffffff');
        if (tkl) { await sendColors(apexFrame(next, zones, 0)); await sendBrightness(pct); }
        else { await sendBrightness(pct); await sendColors(apexFrame(next, zones, 0)); }
        Object.assign(state.light, next);
        if (APEX_ANIMATED.has(next.effect)) animate();
      },
      // Réglages propres à l'effet choisi (effet, couleur fixe et luminosité : rendu commun de core.js)
      rows() {
        const l = state.light;
        const out = [];
        const pick = (current, onPick) => h('div', { class: 'row-inline' },
          SWATCHES.map(col => h('button', { class: 'swatch' + (col === current ? ' on' : ''), style: `background:${col}`, title: col, onclick: () => onPick(col) })),
          h('input', { type: 'color', value: current || '#ffffff', onchange: e => onPick(e.target.value) }));
        if (l.effect === 'breathing') out.push(field('Couleur', pick(l.color, col => drvSet(inst, 'Couleur', 'light', { ...l, color: col }))));
        if (l.effect === 'zones') {
          out.push(field('Zones (de gauche à droite)',
            h('div', { class: 'row-inline' }, l.zones.map((col, i) => h('input', { type: 'color', value: col, title: `Zone ${i + 1}`,
              onchange: e => drvSet(inst, `Zone ${i + 1}`, 'light', { ...l, zones: l.zones.map((c, j) => j === i ? e.target.value : c) }) }))),
            h('div', { class: 'muted small' }, 'Toutes les zones :'),
            pick(null, col => drvSet(inst, 'Zones', 'light', { ...l, zones: Array(zones).fill(col) })),
            h('div', { class: 'row-inline' },
              h('button', { class: 'mini ghost', onclick: () => drvSet(inst, 'Dégradé', 'light', { ...l, zones: apexFrame({ effect: 'rainbow' }, zones, 0).map(apexHex) }) }, 'Dégradé arc-en-ciel'))));
        }
        if (APEX_ANIMATED.has(l.effect)) {
          out.push(field('Vitesse',
            segmented(Object.entries(APEX_SPEEDS).map(([v, label]) => ({ v: Number(v), label })), l.speed || 2, v => drvSet(inst, 'Vitesse', 'light', { ...l, speed: v })),
            h('div', { class: 'muted small' }, 'Effet animé par PeriphHub, comme SteelSeries GG : il s’arrête quand PeriphHub est fermé (le clavier garde la dernière couleur affichée).')));
        }
        return out;
      },
    };
    await drvReapply(inst);
    return [inst];
  },
});
