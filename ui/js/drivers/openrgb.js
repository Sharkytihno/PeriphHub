// PeriphHub — éclairage de tous les appareils connus d'OpenRGB (plus de 1 000 modèles : barrettes de
// mémoire, cartes graphiques, ventilateurs, bandeaux, claviers…), via son serveur SDK local.
// OpenRGB doit être lancé avec « Serveur SDK » activé (src-tauri/src/openrgb.rs).
//   · effets de l'appareil (ceux de son firmware : respiration, vague…) avec vitesse, sens et couleurs ;
//   · couleur unie sur toutes les LED (mode personnalisé d'OpenRGB) ;
//   · « Enregistrer dans l'appareil » : l'effet reste sans PeriphHub ni OpenRGB, quand l'appareil le permet.

let orgbInst = null;

// Noms d'effets d'OpenRGB (en anglais) → français ; inconnus affichés tels quels
const ORGB_NAMES = {
  Direct: 'Direct', Custom: 'Personnalisé', Static: 'Fixe', Breathing: 'Respiration', Flashing: 'Clignotement', Strobe: 'Stroboscope',
  'Spectrum Cycle': 'Cycle de couleurs', 'Color Cycle': 'Cycle de couleurs', Rainbow: 'Arc-en-ciel', 'Rainbow Wave': 'Vague arc-en-ciel',
  Wave: 'Vague', 'Color Wave': 'Vague de couleurs', Reactive: 'Réactif', Ripple: 'Ondulation', Starlight: 'Étoiles', Comet: 'Comète',
  Marquee: 'Chenillard', 'Color Pulse': 'Pulsation', Pulse: 'Pulsation', Fire: 'Feu', Music: 'Musique', Off: 'Éteint', Random: 'Aléatoire',
  'Breathing Spectrum': 'Respiration multicolore', 'Spectrum Breathing': 'Respiration multicolore', Twinkle: 'Scintillement', Spiral: 'Spirale',
  Gradient: 'Dégradé', Visor: 'Balayage', Rain: 'Pluie', Meteor: 'Météore', Lightning: 'Éclair', Temperature: 'Température',
};
const orgbName = n => (LANG === 'fr' && ORGB_NAMES[n]) || n;
// Bits de sens annoncés par l'effet → valeurs d'OpenRGB (0 gauche, 1 droite, 2 haut, 3 bas, 4 horizontal, 5 vertical)
const ORGB_DIRS = [[2, [[0, 'Vers la gauche'], [1, 'Vers la droite']]], [4, [[2, 'Vers le haut'], [3, 'Vers le bas']]], [8, [[4, 'Horizontal'], [5, 'Vertical']]]];
function hexRgb(c) { return [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)); }
// Vitesse en % : speed_min = la plus lente, speed_max = la plus rapide (bornes parfois inversées)
function orgbPct(s) { return s.max === s.min ? 100 : Math.round((s.value - s.min) / (s.max - s.min) * 100); }
function orgbSpeed(s, pct) { return Math.round(s.min + (s.max - s.min) * pct / 100); }

function orgbInstance(list) {
  const dev = { vendorId: 0, productId: 0 };
  const inst = {
    key: 'drv-openrgb', name: 'Éclairage OpenRGB', kind: 'rgb', dev, caps: {}, state: { list, colors: {} }, noOrigin: true, diagId: null,
    meta: '', source: 'Passerelle OpenRGB (projet libre, GPL-2.0) : effets de chaque appareil, ou couleur unie en mode personnalisé. '
      + 'Pour garder l’éclairage sans PeriphHub ni OpenRGB, « Enregistrer dans l’appareil » quand il le permet ; sinon, un profil OpenRGB lancé avec Windows.',
    async set(cap, v) {
      if (cap === 'mode') {
        await nativeInvoke('openrgb_mode', { index: v.index, mode: v.mode, speed: v.speed ?? null, direction: v.direction ?? null,
          colors: v.colors ? v.colors.map(hexRgb) : null, save: !!v.save });
        delete inst.state.colors[v.index];
        return;
      }
      const targets = v.index == null ? inst.state.list.map(d => d.index) : [v.index];
      for (const index of targets) {
        await nativeInvoke('openrgb_color', { index, rgb: hexRgb(v.color) });
        inst.state.colors[index] = v.color;
      }
    },
    async refresh() {
      const list = await nativeInvoke('openrgb_list');
      if (list?.length) inst.state.list = list;
    },
    // Sortie de veille : relecture seulement (OpenRGB et les appareils gardent leur effet ; renvoyer
    // le dernier choix ici écraserait un profil chargé entre-temps dans OpenRGB)
    reapply: () => inst.refresh(),
    rows() {
      const s = inst.state;
      const pick = (label, index, current) => h('div', { class: 'row-inline' },
        SWATCHES.map(col => h('button', { class: 'swatch' + (col === current ? ' on' : ''), style: `background:${col}`, title: col,
          onclick: () => drvSet(inst, label, 'color', { index, color: col }) })),
        h('button', { class: 'mini ghost', onclick: () => drvSet(inst, label + ' éteint', 'color', { index, color: '#000000' }) }, 'Éteindre'),
        h('input', { type: 'color', value: current || '#ffffff', onchange: e => drvSet(inst, label, 'color', { index, color: e.target.value }) }));
      return [
        field('Tous les appareils', h('div', { class: 'muted small' }, 'Couleur unie sur toutes les LED'), pick('Éclairage', null, null)),
        ...s.list.map(d => field(d.name, h('div', { class: 'muted small' }, `${d.kind} · ${d.leds} LED`),
          ...orgbModeRows(inst, d), pick(d.name, d.index, s.colors[d.index]))),
      ];
    },
  };
  return inst;
}

// Effet de l'appareil : liste, vitesse, sens, couleurs, enregistrement
function orgbModeRows(inst, d) {
  const modes = d.modes || [];
  if (modes.length < 2) return [];
  const cur = modes[d.active] || {};
  const send = (label, mode, m, patch = {}) => drvSet(inst, `${d.name} : ${label}`, 'mode', {
    index: d.index, mode, speed: m.speed?.value, direction: m.direction, colors: m.colors?.value, ...patch });
  const curLabel = orgbName(cur.name || '');
  const dirs = ORGB_DIRS.filter(([bit]) => cur.directions & bit).flatMap(([, o]) => o).map(([v, label]) => ({ v, label }));
  const cols = cur.colors ? [...cur.colors.value] : [];
  const sub = text => h('div', { class: 'muted small' }, text);
  return [
    h('div', {}, sub('Effet'),
      h('select', { onchange: e => { const i = Number(e.target.value); send(orgbName(modes[i].name), i, modes[i]); } },
        modes.map((m, i) => h('option', { value: i, selected: i === d.active }, orgbName(m.name))))),
    cur.speed && cur.speed.min !== cur.speed.max ? h('div', {}, sub('Vitesse'),
      slider(0, 100, 5, orgbPct(cur.speed), ' %', v => send(curLabel, d.active, cur, { speed: orgbSpeed(cur.speed, v) }))) : null,
    dirs.length > 1 ? h('div', {}, sub('Sens'), segmented(dirs, cur.direction, v => send(curLabel, d.active, cur, { direction: v }))) : null,
    cur.colors ? h('div', {}, sub(cols.length > 1 ? 'Couleurs de l’effet' : 'Couleur de l’effet'), h('div', { class: 'row-inline' },
      cols.map((c, i) => h('input', { type: 'color', value: c, onchange: e => { const next = [...cols]; next[i] = e.target.value; send(curLabel, d.active, cur, { colors: next }); } })),
      cols.length < cur.colors.max ? h('button', { class: 'mini ghost', title: 'Ajouter une couleur', onclick: () => send(curLabel, d.active, cur, { colors: [...cols, '#ffffff'] }) }, '+') : null,
      cols.length > Math.max(1, cur.colors.min) ? h('button', { class: 'mini ghost', title: 'Retirer la dernière couleur', onclick: () => send(curLabel, d.active, cur, { colors: cols.slice(0, -1) }) }, '−') : null)) : null,
    cur.save ? h('div', { class: 'row-inline' },
      h('button', { class: 'mini ghost', title: 'L’effet reste au démarrage du PC, même sans PeriphHub ni OpenRGB',
        onclick: () => send(curLabel + ' enregistré', d.active, cur, { save: true }) }, 'Enregistrer dans l’appareil')) : null,
  ];
}

async function openrgbPoll() {
  if (!NATIVE) return;
  let list = null;
  try { list = await nativeInvoke('openrgb_list'); } catch { list = null; }
  if (!list?.length) {
    if (orgbInst) { drvRelease(orgbInst.dev); orgbInst = null; }
    return;
  }
  if (!orgbInst) {
    orgbInst = orgbInstance(list);
    drvAdd(orgbInst, { id: 'openrgb' });
  } else {
    // Redessinée seulement si quelque chose a changé (pas pendant qu'on choisit une couleur)
    const changed = JSON.stringify(orgbInst.state.list) !== JSON.stringify(list);
    orgbInst.state.list = list;
    if (!changed) return;
  }
  const pl = list.length > 1 ? 's' : '';
  orgbInst.meta = `${list.length} appareil${pl} piloté${pl} par OpenRGB`;
  drvRender(orgbInst);
}

// OpenRGB lancé ou fermé : vérifié toutes les 30 s (fenêtre visible)
setInterval(() => { if (!document.hidden) openrgbPoll(); }, 30000);
