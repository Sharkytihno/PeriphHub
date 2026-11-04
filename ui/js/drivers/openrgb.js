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
    want: {}, busy: {},
    meta: '', source: 'Passerelle OpenRGB (projet libre, GPL-2.0) : effets de chaque appareil, ou couleur unie en mode personnalisé. '
      + 'Pour garder l’éclairage sans PeriphHub ni OpenRGB, « Enregistrer dans l’appareil » quand il le permet ; sinon, un profil OpenRGB lancé avec Windows.',
    async set(cap, v) {
      if (cap === 'mode') {
        await nativeInvoke('openrgb_mode', { index: v.index, mode: v.mode, speed: v.speed ?? null, direction: v.direction ?? null,
          colors: v.colors ? v.colors.map(hexRgb) : null, save: !!v.save });
        delete inst.state.colors[v.index];
        return;
      }
      if (cap === 'zone') {
        await nativeInvoke('openrgb_resize', { index: v.index, zone: v.zone, size: v.size });
        // Les LED ajoutées sont éteintes : l'éclairage de l'appareil est renvoyé sur toute la nouvelle taille
        const d = (await nativeInvoke('openrgb_list'))?.find(x => x.index === v.index);
        const m = d?.modes?.[d.active];
        if (!d) return;
        if (inst.state.colors[v.index] || !m || /^(direct|custom)$/i.test(m.name)) {
          await nativeInvoke('openrgb_color', { index: v.index, rgb: hexRgb(inst.state.colors[v.index] || '#ffffff') });
          inst.state.colors[v.index] ||= '#ffffff';
        } else {
          await nativeInvoke('openrgb_mode', { index: v.index, mode: d.active, speed: m.speed?.value ?? null, direction: m.direction ?? null,
            colors: m.colors ? m.colors.value.map(hexRgb) : null, save: false });
        }
        return;
      }
      // Clics rapides (ou nuancier glissé) : seule la dernière couleur demandée part, les autres sont
      // sautées tant qu'une commande est en cours (un appareil lent ne prend pas des secondes de retard)
      const key = v.index == null ? 'all' : v.index;
      inst.want[key] = v.color;
      if (inst.busy[key]) return inst.busy[key];
      inst.busy[key] = (async () => {
        try {
          while (inst.want[key] != null) {
            const color = inst.want[key];
            inst.want[key] = null;
            if (v.index == null) {
              // Tous les appareils sur une seule connexion : un appareil en erreur n'arrête pas les autres
              const r = await nativeInvoke('openrgb_color_all', { rgb: hexRgb(color) });
              const bad = new Set((r?.errors || []).map(e => e.index));
              for (const d of inst.state.list) if (!bad.has(d.index)) inst.state.colors[d.index] = color;
              if (bad.size) {
                const names = (r.errors || []).map(e => (inst.state.list.find(d => d.index === e.index)?.name || `#${e.index}`) + ' : ' + e.error);
                throw new Error(names.join(' · '));
              }
            } else {
              await nativeInvoke('openrgb_color', { index: v.index, rgb: hexRgb(color) });
              inst.state.colors[v.index] = color;
            }
          }
        } finally {
          inst.busy[key] = null;
        }
      })();
      return inst.busy[key];
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
      // « Mémoire et carte mère » en tête tant qu'il reste à activer : en bas d'une longue liste, on ne le voyait pas
      const admin = orgbAdminRow(), todo = orgbSvc && (orgbSvc.service === 'absent' || orgbSvc.serviceStale);
      return [
        todo ? admin : null,
        field('Tous les appareils', h('div', { class: 'muted small' }, 'Couleur unie sur toutes les LED'), pick('Éclairage', null, null)),
        ...s.list.map(d => field(d.name, h('div', { class: 'muted small' }, `${d.kind} · ${d.leds} LED`),
          ...orgbZoneRows(inst, d), ...orgbModeRows(inst, d), pick(d.name, d.index, s.colors[d.index]))),
        todo ? null : admin,
      ];
    },
  };
  return inst;
}

// Prises à taille réglable (ARGB de carte mère : JRAINBOW, D_LED…, bandeaux) : OpenRGB ne sait pas
// combien de LED y sont branchées et part de 0, donc ventilateurs et bandeaux restent éteints tant
// qu'on ne le dit pas. OpenRGB garde la taille choisie (ses réglages), même après un redémarrage.
function orgbZoneRows(inst, d) {
  const zones = (d.zones || []).map((z, i) => ({ ...z, i })).filter(z => z.max > z.min);
  if (!zones.length) return [];
  const empty = zones.filter(z => !z.count);
  return [
    empty.length ? h('div', { class: 'notice' }, h('p', { class: 'muted small' },
      `Ventilateurs ou bandeau branchés sur ${empty.map(z => z.name).join(', ')} : indiquez combien de LED y sont branchées, `
      + 'sinon ils restent éteints (OpenRGB ne peut pas les compter). Repère : souvent 8 à 12 LED par ventilateur ; '
      + 'plusieurs ventilateurs en chaîne sur la même prise, additionnez. Trop de LED ne gêne pas ; pas assez, les dernières restent éteintes.')) : null,
    ...zones.map(z => {
      const input = h('input', { type: 'number', min: z.min, max: z.max, value: z.count, style: 'width:5em' });
      const go = () => {
        const size = Math.max(z.min, Math.min(z.max, Math.round(Number(input.value) || 0)));
        if (size !== z.count) drvSet(inst, `${d.name} : ${z.name} à ${size} LED`, 'zone', { index: d.index, zone: z.i, size });
      };
      input.onchange = go;
      return h('div', {}, h('div', { class: 'muted small' }, `Prise ${z.name} : nombre de LED (${z.min} à ${z.max})`),
        h('div', { class: 'row-inline' }, input,
          ...[12, 24, 36].filter(n => n <= z.max).map(n => h('button', { class: 'mini ghost' + (z.count === n ? ' on' : ''),
            title: n / 12 + ' ventilateur(s) de 12 LED', onclick: () => { input.value = n; go(); } }, String(n)))));
    }),
  ];
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

// OpenRGB est livré avec PeriphHub (src-tauri/src/openrgb.rs) : lancé tout seul, sans fenêtre, quand
// le PC a un appareil que seul OpenRGB sait piloter (carte mère, ventilateurs, mémoire, carte
// graphique… : statut « rgb » du catalogue), ou quand l'utilisateur l'a lancé une fois depuis PeriphHub.
// Jamais quand l'utilisateur a ouvert le sien (il garde la main) ; au plus un essai toutes les 2 min.
let orgbAutoAt = 0;
const orgbWanted = () => (typeof report !== 'undefined' && (report?.devices || []).some(d => d.status === 'rgb'))
  || (() => { try { return localStorage.getItem('orgbAuto') === 'on'; } catch { return false; } })();
async function orgbAuto() {
  if (!NATIVE || Date.now() - orgbAutoAt < 120000 || !orgbWanted()) return;
  orgbAutoAt = Date.now();
  try {
    const st = await nativeInvoke('openrgb_info');
    if (st.server || st.running || !st.bundled || (st.service && st.service !== 'absent')) return;
    await nativeInvoke('openrgb_launch');
  } catch (e) { console.warn('[PeriphHub] lancement d’OpenRGB :', e?.message || e); }
}

// ---------- Mémoire (RAM) et puces protégées de la carte mère (src-tauri/src/openrgb_service.rs) ----------
// Une validation Windows, une fois pour toutes : pilote PawnIO + OpenRGB en service. Ensuite plus rien à faire.
let orgbSvc = null; // dernier openrgb_info : service, serviceStale, pawnio
async function orgbAdmin(action, btn) {
  btn.disabled = true;
  btn.textContent = action === 'install' ? 'Installation… (validez la fenêtre de Windows)' : 'Retrait…';
  try {
    const done = await nativeInvoke('openrgb_admin', { action });
    if (!done) toast('Autorisation refusée : rien n’a été changé.', 'err');
    else toast(action === 'install' ? 'Éclairage de la mémoire et de la carte mère activé.' : 'Service OpenRGB retiré.', 'ok');
  } catch (e) { toast(String(e?.message || e), 'err'); }
  orgbAutoAt = 0; // service retiré ou refusé : l'OpenRGB livré peut reprendre aussitôt
  // Le service détecte les appareils (quelques secondes) : nouvelle lecture tout de suite, puis 8 s après
  await openrgbPoll();
  if (!$('options').hidden) renderOptions();
  setTimeout(async () => { await openrgbPoll(); if (!$('options').hidden) renderOptions(); }, 8000);
}
function orgbAdminRow() {
  const s = orgbSvc;
  if (!NATIVE || !s || !s.bundled) return null;
  const btn = (label, action, cls = 'mini') => {
    const b = h('button', { class: cls, onclick: () => orgbAdmin(action, b) }, label);
    return b;
  };
  let text, buttons;
  if (s.service === 'absent') {
    text = 'Barrettes de mémoire (RAM) et certaines cartes mères : Windows exige une autorisation administrateur. '
      + 'Une seule fois : PeriphHub installe le pilote PawnIO et OpenRGB en service Windows, puis plus rien à faire.';
    buttons = [btn('Activer (une autorisation Windows)', 'install')];
  } else if (s.serviceStale) {
    text = 'OpenRGB a été mis à jour avec PeriphHub : une autorisation Windows met aussi à jour le service.';
    buttons = [btn('Mettre à jour', 'install'), btn('Retirer', 'uninstall', 'mini ghost')];
  } else {
    text = s.service === 'stopped' ? 'Service OpenRGB installé mais arrêté.' : 'Activé : OpenRGB tourne en service Windows (mémoire et carte mère comprises).';
    buttons = [s.service === 'stopped' ? btn('Relancer', 'install') : null, btn('Retirer', 'uninstall', 'mini ghost')];
  }
  return field('Mémoire et carte mère', h('div', { class: 'muted small' }, text), h('div', { class: 'row-inline' }, ...buttons));
}

async function openrgbPoll() {
  if (!NATIVE) return;
  const svcKey = () => orgbSvc ? [orgbSvc.service, orgbSvc.serviceStale, orgbSvc.bundled].join() : '';
  const before = svcKey();
  try { orgbSvc = await nativeInvoke('openrgb_info'); } catch {}
  const svcChanged = before !== svcKey(); // bouton « Mémoire et carte mère » à redessiner
  await orgbAuto();
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
    if (!changed && !svcChanged) return;
  }
  const pl = list.length > 1 ? 's' : '';
  orgbInst.meta = `${list.length} appareil${pl} piloté${pl} par OpenRGB`;
  drvRender(orgbInst);
}

// OpenRGB lancé ou fermé : vérifié toutes les 30 s (fenêtre visible)
setInterval(() => { if (!document.hidden) openrgbPoll(); }, 30000);
