// PeriphHub — coquille de l'interface : navigation, accueil, allègement, options, notifications.
// Chargé en dernier : utilise mouse, kb, hs, rgb, h, $, setStatus (js/devices.js).

// ---------- Outils ----------

function mo(bytes) {
  const v = (bytes || 0) / 1048576;
  if (v >= 1024) return (v / 1024).toLocaleString(LOCALE, { maximumFractionDigits: 1 }) + (LANG === 'en' ? ' GB' : ' Go');
  return Math.round(v).toLocaleString(LOCALE) + (LANG === 'en' ? ' MB' : ' Mo');
}
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// Module (data/devices.json) → page de l'interface
const PLUGIN_TAB = { scyrox: 'mouse', 'via-he': 'keyboard', 'razer-audio': 'headset', 'gigabyte-fusion2': 'rgb' };
const PLUGIN_TAB_VALUES = new Set(Object.values(PLUGIN_TAB));
const KIND_TAB = { souris: 'mouse', clavier: 'keyboard', casque: 'headset', rgb: 'rgb' };

function navIcon(tab) {
  return document.querySelector(`nav [data-tab="${tab}"] svg`)?.cloneNode(true);
}
const ICONS = {
  audio: 'M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
  manette: 'M7 9h10a4 4 0 0 1 4 4v1a3 3 0 0 1-5.4 1.8L14 14h-4l-1.6 1.8A3 3 0 0 1 3 14v-1a4 4 0 0 1 4-4zM8 11v3M6.5 12.5h3M15.5 12h.01M17.5 13.5h.01',
  micro: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3M8 21h8',
  webcam: 'M12 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM12 7.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM7 21h10M12 17v4',
  autre: 'M9 2v6M15 2v6M7 8h10v4a5 5 0 0 1-10 0zM12 17v5',
  chip: 'M6 6h12v12H6zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4',
  refroidissement: 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 10c0-3 1-6 4-6s3 4 0 6M14 12c3 0 6 1 6 4s-4 3-6 0M12 14c0 3-1 6-4 6s-3-4 0-6M10 12c-3 0-6-1-6-4s4-3 6 0',
};
function kindIcon(kind) {
  const tab = KIND_TAB[kind];
  if (tab) return navIcon(tab);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ic');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[kind] || ICONS.autre);
  svg.append(p);
  return svg;
}

// ---------- Notifications ----------

let lastToast = { text: '', at: 0 };
function toast(text, kind = 'ok') {
  if (text === lastToast.text && Date.now() - lastToast.at < 8000) return;
  lastToast = { text, at: Date.now() };
  const box = $('toasts');
  const t = h('div', { class: 'toast ' + kind }, text);
  box.append(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, kind === 'err' ? 6000 : 2600);
}

// ---------- Navigation ----------

let settleTimer = 0;
function showTab(name) {
  if (!$(name) || document.querySelector(`nav [data-tab="${name}"]`)?.hidden) name = 'home';
  // Entrées en cascade à l'ouverture d'une page seulement (pas à chaque actualisation)
  document.body.classList.remove('settled');
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => document.body.classList.add('settled'), 900);
  for (const b of document.querySelectorAll('nav [data-tab]')) b.classList.toggle('on', b.dataset.tab === name);
  for (const sec of document.querySelectorAll('main > section')) sec.hidden = sec.id !== name;
  try { localStorage.setItem('tab', name); } catch {}
  if (typeof kbRecord === 'function') { kbRecord(false); msRecord(false); }
  if (name === 'options') {
    renderOptions(); bgLoad();
    // État du service OpenRGB (mémoire et carte mère), relu à l'ouverture des options
    if (typeof openrgbPoll === 'function') openrgbPoll().then(() => { if (!$('options').hidden) renderOptions(); });
  }
  if (name === 'slim') renderSlim();
  refreshHome();
}
for (const b of document.querySelectorAll('nav [data-tab]')) b.onclick = () => showTab(b.dataset.tab);

// ---------- Analyse (logiciels constructeurs, appareils branchés) ----------

let report = null;
let journal = [];   // logiciels allégés : actions faites, état d'avant, mémoire avant / après
let scanning = false;

async function rescan() {
  if (!NATIVE || scanning) return;
  scanning = true;
  document.body.classList.add('scanning');
  $('rescan').disabled = true;
  setStatus('slimStatus', 'Analyse…');
  try {
    // Garde-fou : l'analyse a ses propres délais côté Rust, mais l'écran ne doit jamais tourner à l'infini
    const late = new Promise((_, no) => setTimeout(() => no(new Error('l’analyse ne répond pas (plus de 60 s)')), 60000));
    [report, journal] = await Promise.race([Promise.all([nativeInvoke('scan'), nativeInvoke('slim_journal')]), late]);
    setStatus('slimStatus', '');
    $('copyReport').disabled = false;
  } catch (e) {
    console.error('[PeriphHub]', e);
    setStatus('slimStatus', 'Analyse impossible : ' + e, 'err');
  } finally {
    scanning = false;
    document.body.classList.remove('scanning');
    $('rescan').disabled = false;
  }
  applyReport();
  // Appareil que seul OpenRGB sait piloter : OpenRGB livré lancé tout de suite (sinon au relevé suivant)
  if (typeof openrgbPoll === 'function') openrgbPoll();
}

// Résultat de l'analyse → barre latérale, page d'allègement, accueil
function applyReport() {
  // Appareils pris en charge détectés : leur page apparaît dans la barre latérale
  for (const d of report?.devices || []) {
    const tab = PLUGIN_TAB[d.plugin];
    if (tab && d.status !== 'unknown') document.querySelector(`nav [data-tab="${tab}"]`).hidden = false;
  }
  if (!$('slim').hidden) renderSlim();
  refreshHome();
}

// Changer de langue recharge l'interface (i18n.js) : l'analyse qui vient d'être faite est gardée
// le temps du rechargement au lieu d'être refaite. sessionStorage disparaît à la fermeture de PeriphHub.
function keepScan() {
  if (!report || scanning) return;
  try { sessionStorage.setItem('scanKept', JSON.stringify({ at: Date.now(), report, journal })); } catch {}
}
function keptScan() {
  let k = null;
  try { k = JSON.parse(sessionStorage.getItem('scanKept')); sessionStorage.removeItem('scanKept'); } catch {}
  return k?.report && Date.now() - k.at < 60000 ? k : null;
}

// Appareils qui ont des réglages (le reste : hubs, puces internes, webcams…)
const interesting = d => d.status !== 'unknown' || ['souris', 'clavier', 'casque', 'manette', 'rgb', 'refroidissement'].includes(d.kind);
// Détectés mais sans page dans PeriphHub
var undetected = () => (report?.devices || []).filter(d => interesting(d) && !(PLUGIN_TAB[d.plugin] && d.status !== 'unknown') && !driverHas(d.vid, d.pid));

// ---------- Accueil ----------

function meter(pct) {
  return h('div', { class: 'meter' + (pct <= 10 ? ' crit' : pct <= 25 ? ' low' : '') }, h('i', { style: `width:${Math.max(2, Math.min(100, pct))}%` }));
}

function tile(tab, name, live, state, stats, extra) {
  return h('button', { class: 'tile' + (live ? ' live' : ''), onclick: () => showTab(tab) },
    h('div', { class: 'thead' }, h('div', { class: 'tico' }, navIcon(tab)),
      h('div', { class: 'tmain' }, h('div', { class: 'tname' }, name), h('div', { class: 'tstate' }, h('span', { class: 'led' }), state))),
    stats?.length ? h('div', { class: 'tstats' }, stats.map(([l, v]) => h('div', { class: 'tstat' }, h('span', {}, l), h('strong', {}, v)))) : null,
    extra || null);
}

function deviceTiles() {
  const title = tab => $(tab + 'Title').textContent;
  const shown = tab => !document.querySelector(`nav [data-tab="${tab}"]`).hidden;
  const waiting = id => $(id).textContent;
  const tiles = [];
  const ms = mouse?.decode?.();
  const bat = mouse?.info?.battery;
  if (mouse || shown('mouse')) tiles.push(tile('mouse', title('mouse'), !!mouse, mouse ? 'Connectée' : waiting('mouseStatus'),
    mouse ? [['Batterie', bat ? bat.level + ' %' + (bat.charging ? ' ⚡' : '') : '—'], ['DPI', ms?.dpis?.[ms.currentDpiStage] ?? '—'],
      ['Fréquence', ms?.reportRate ? ms.reportRate + ' Hz' : '—']] : null,
    bat ? meter(bat.level) : null));
  if (kb || shown('keyboard')) {
    const macros = kb?.macros ? kb.macros.filter(m => m && m.length).length : 0;
    const rt = kb?.rt ? kb.rt.filter(r => r?.on).length : 0;
    tiles.push(tile('keyboard', title('keyboard'), !!kb, kb ? 'Connecté' : waiting('kbStatus'),
      kb ? [['Macros', String(macros)], ['Rapid trigger', rt ? plural(rt, 'touche', 'touches') : 'désactivé']] : null));
  }
  const hb = hs?.state?.battery;
  if (hs || shown('headset')) tiles.push(tile('headset', title('headset'), !!hs, hs ? (hs.state?.charging ? 'Connecté · en charge' : 'Connecté') : waiting('hsStatus'),
    hs ? [['Batterie', hb != null ? hb + ' %' : '—'], ['Retour micro', hs.state?.sidetone ? 'activé' : 'coupé'], ['Firmware', hs.state?.fw || '—']] : null,
    hb != null ? meter(hb) : null));
  if (rgb || shown('rgb')) tiles.push(tile('rgb', title('rgb'), !!rgb, rgb ? 'Connecté' : waiting('rgbStatus')));
  return tiles.concat(driverTiles());
}

// Mémoire libérée : mesurée juste avant et juste après chaque allègement
const gained = () => journal.reduce((s, l) => s + Math.max(0, l.before_bytes - l.after_bytes), 0);

// Compteur qui monte jusqu'à la valeur, à l'ouverture de la page seulement
function countUp(el, bytes, force = false) {
  if ((!force && document.body.classList.contains('settled')) || matchMedia('(prefers-reduced-motion: reduce)').matches || !bytes) return el;
  const t0 = performance.now(), dur = 700;
  const step = t => {
    const k = Math.max(0, Math.min(1, (t - t0) / dur));
    el.textContent = mo(bytes * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return el;
}

// Petites icônes au trait (cartes de l'accueil et de l'allègement)
const PICT = {
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
  heavy: 'M6 8h12l2 12H4zM9 8a3 3 0 0 1 6 0',
  light: 'M20 6 9 17l-5-5',
  pause: 'M8 5v14M16 5v14',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  apps: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
};
function pict(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', PICT[name]);
  svg.append(p);
  return svg;
}

// Accueil : l'état du PC en une phrase, et un seul bouton
function pcCard() {
  const r = report;
  if (!r) return h('div', { class: 'pcard wait' }, h('div', { class: 'pcico' }, pict('search')),
    h('div', { class: 'pctext' }, h('div', { class: 'pctitle' }, NATIVE ? 'Analyse de votre PC…' : 'L’analyse ne fonctionne que dans l’appli PeriphHub.'),
      NATIVE ? h('div', { class: 'pbar-ind' }) : null));
  const running = r.vendors.filter(v => v.bytes > 0);
  const freed = gained() > 0 ? h('div', { class: 'gain' }, `${mo(gained())} libérés grâce à l’allègement`) : null;
  if (!running.length) return h('div', { class: 'pcard light' }, h('div', { class: 'pcico' }, pict('light')),
    h('div', { class: 'pctext' }, h('div', { class: 'pctitle' }, 'Votre PC est léger'),
      h('div', { class: 'muted small' }, 'Aucun logiciel de marque ne tourne en fond pour rien.'), freed));
  return h('div', { class: 'pcard' }, h('div', { class: 'pcico' }, pict('heavy')),
    h('div', { class: 'pctext' },
      h('div', { class: 'pctitle' }, countUp(h('b', {}, mo(r.vendor_bytes)), r.vendor_bytes), ' ', 'de mémoire prise en fond'),
      h('div', { class: 'muted small' }, `Par : ${running.map(v => v.name).join(', ')}`), freed),
    h('button', { class: 'lg', onclick: () => showTab('slim') }, 'Alléger mon PC'));
}

// Allègement expliqué en trois cases, pour qui ne connaît pas le mot
function slimExplain() {
  const step = (icon, title, text) => h('div', { class: 'xstep' }, h('div', { class: 'xico' }, pict(icon)), h('strong', {}, title), h('p', {}, text));
  const steps = h('div', { class: 'explain' },
    step('heavy', 'Le problème', 'Les logiciels des marques (Razer, Logitech, Corsair…) restent ouverts en permanence et prennent de la mémoire.'),
    step('pause', 'Ce que fait PeriphHub', 'Il les ferme et les empêche de se relancer avec Windows. Vos réglages restent enregistrés dans vos appareils.'),
    step('undo', 'Sans risque', 'Rien n’est supprimé ni désinstallé. Un clic sur « Annuler l’allègement » remet tout comme avant.'));
  // Déjà utilisé : l'explication se replie
  return journal.length ? h('details', { class: 'more' }, h('summary', {}, 'Comment ça marche ?'), steps) : steps;
}

function ramHero() {
  const r = report;
  if (!r) return h('div', { class: 'pcard wait' }, h('div', { class: 'pcico' }, pict('search')),
    h('div', { class: 'pctext' }, h('div', { class: 'pctitle' }, NATIVE ? 'Analyse de votre PC…' : 'L’analyse ne fonctionne que dans l’appli PeriphHub.'),
      NATIVE ? h('div', { class: 'pbar-ind' }) : null));
  const running = r.vendors.filter(v => v.bytes > 0);
  const max = Math.max(r.vendor_bytes, r.periphhub_bytes, 1);
  const bar = (cls, label, bytes) => h('div', { class: 'hbar ' + cls },
    h('div', { class: 'hbl' }, h('span', {}, label), h('strong', {}, mo(bytes))),
    h('div', { class: 'htrack' }, h('i', { style: `width:${Math.max(1.5, bytes / max * 100)}%` })));
  return h('div', { class: 'hero' },
    h('div', { class: 'hleft' },
      h('div', { class: 'hlabel' }, 'Mémoire prise par les logiciels de marque'),
      countUp(h('div', { class: 'hvalue' + (r.vendor_bytes ? '' : ' zero') }, mo(r.vendor_bytes)), r.vendor_bytes),
      h('div', { class: 'muted small' }, running.length
        ? `${plural(running.length, 'logiciel ouvert', 'logiciels ouverts')} en arrière-plan : ${running.map(v => v.name).join(', ')}.`
        : 'Aucun logiciel constructeur connu ne tourne : votre PC est déjà léger.'),
      gained() > 0 ? h('div', { class: 'gain' }, `${mo(gained())} libérés grâce à l’allègement`) : null,
      running.length && $('slim').hidden ? h('button', { class: 'cta', onclick: () => showTab('slim') }, 'Voir comment alléger') : null),
    h('div', { class: 'hright' },
      bar('vendor', 'Logiciels de marque', r.vendor_bytes),
      bar('self', 'PeriphHub (cette fenêtre)', r.periphhub_bytes),
      h('div', { class: 'muted small' }, 'Mémoire privée, mesurée comme dans le Gestionnaire des tâches.')));
}

const STATUS = { supported: 'Pris en charge', experimental: 'Expérimental', partial: 'En partie', planned: 'Bientôt', rgb: 'Éclairage via OpenRGB',
  known: 'Reconnu, pas encore réglable', unknown: 'Pas encore pris en charge' };

// Configurateurs web officiels (seulement ceux dont l'adresse est sûre)
const WEB_TOOL = { '31E3': 'wootility.io', '03EB': 'wootility.io', '3434': 'launcher.keychron.com' };

// Ce que l'utilisateur peut faire pour un appareil que PeriphHub ne règle pas (encore)
function deviceHint(d) {
  return [h('div', { class: 'muted small' }, deviceHintText(d)), deviceTool(d), d.status === 'rgb' ? orgbTool() : '', d.status === 'rgb' && typeof orgbAdminRow === 'function' ? orgbAdminRow() : ''];
}

function deviceTool(d) {
  const web = WEB_TOOL[d.vid] || (d.plugin === 'via' ? 'usevia.app' : '');
  // Phrase à part : chaque nœud texte est traduit séparément
  return web ? h('div', { class: 'muted small' }, `Réglages aussi possibles sur ${web}, le configurateur officiel dans le navigateur.`) : '';
}

// OpenRGB : installé ? lancé avec son serveur ? Bouton pour le lancer comme il faut
function orgbTool() {
  if (!NATIVE) return '';
  const box = h('div', { class: 'muted small' });
  nativeInvoke('openrgb_info').then(st => {
    if (st.server) return box.replaceChildren('OpenRGB est lancé avec son serveur : son éclairage apparaît dans l’onglet Éclairage.');
    if (!st.installed) return box.replaceChildren('OpenRGB (livré avec PeriphHub) est introuvable : réinstallez PeriphHub.');
    if (st.ours) return box.replaceChildren('OpenRGB démarre (détection des appareils, quelques secondes)…');
    const btn = h('button', { class: 'mini', onclick: async () => {
      btn.disabled = true; btn.textContent = 'Lancement…';
      try {
        await nativeInvoke('openrgb_launch');
        try { localStorage.setItem('orgbAuto', 'on'); } catch {} // relancé tout seul les fois suivantes
        await openrgbPoll();
        toast('OpenRGB lancé avec son serveur.', 'ok');
        box.replaceChildren('OpenRGB est lancé avec son serveur : son éclairage apparaît dans l’onglet Éclairage.');
      } catch (e) { toast(String(e.message || e), 'err'); btn.disabled = false; btn.textContent = 'Lancer OpenRGB'; }
    } }, 'Lancer OpenRGB');
    box.replaceChildren(h('span', {}, st.running ? 'OpenRGB est ouvert, mais sans son serveur. ' : st.bundled ? 'OpenRGB (livré avec PeriphHub) est arrêté. ' : 'OpenRGB est installé mais fermé. '), btn);
  }).catch(() => {});
  return box;
}

// Appareil standard : inconnu des catalogues et sans page HID constructeur (≥ 0xFF00, où passent
// presque tous les protocoles de réglage) → Windows le gère seul, rien à corriger côté PeriphHub
function diagStandard(d) { return d.status === 'unknown' && d.vendor_page === false; }

function deviceHintText(d) {
  if (diagStandard(d)) return d.kind === 'souris' || d.kind === 'clavier'
    ? 'Appareil standard, sans protocole du fabricant : Windows le gère seul. Pointeur, molette et répétition des touches se règlent dans « Souris et clavier ».'
    : 'Appareil standard, sans protocole du fabricant : Windows le gère seul, PeriphHub n’y trouve aucun réglage à piloter.';
  if (d.status === 'experimental') return 'Un pilote expérimental le connaît, mais la connexion n’a pas abouti. Fermez son logiciel d’origine, rebranchez-le, puis Actualiser. Si ça ne marche toujours pas : « Copier le diagnostic », puis envoyez-le pour qu’on corrige.';
  if (d.status === 'rgb') return 'Son éclairage est réglable avec OpenRGB, livré avec PeriphHub et lancé tout seul (onglet Éclairage). Ses autres réglages restent dans son logiciel d’origine.';
  if (d.status === 'planned') return 'Prise en charge prévue : son logiciel d’origine reste nécessaire pour l’instant.';
  return 'Son logiciel d’origine reste nécessaire pour le régler.';
}

var othersOpen = null; // « Autres appareils détectés » ouvert ou replié (gardé d'un rendu à l'autre)
function otherDevices() {
  if (!report) return null;
  const others = undetected();
  if (!others.length) return null;
  // Replié par défaut (détails pour les curieux) ; ouvert si un appareil connu n'a pas pu se connecter
  if (othersOpen == null) othersOpen = others.some(d => ['experimental', 'supported', 'partial'].includes(d.status));
  return h('details', { class: 'more', id: 'othersBox', open: othersOpen, ontoggle: e => { othersOpen = e.target.open; } },
    h('summary', {}, 'Autres appareils détectés', h('span', { class: 'chip unknown' }, String(others.length)),
      h('span', { class: 'muted small' }, 'pas encore réglables ici')),
    h('div', { class: 'devlist' }, others.map(d => h('div', { class: 'dev', id: 'dev-' + (d.vid + d.pid).toUpperCase() },
      h('div', { class: 'tico' }, kindIcon(d.kind)),
      h('div', { class: 'dmain' },
        h('div', { class: 'dname' }, d.product || `Appareil ${d.vid}:${d.pid}`),
        h('div', { class: 'muted small' }, [d.brand || d.manufacturer || 'Fabricant inconnu', d.kind, `USB ${d.vid}:${d.pid}`].join(' · ')),
        ...deviceHint(d),
        drvReason(d)),
      h('div', { class: 'dside' },
        h('span', { class: 'chip ' + d.status }, diagStandard(d) ? 'Appareil standard' : STATUS[d.status] || d.status),
        NATIVE ? h('button', { class: 'mini ghost', title: 'Envoie (ou copie) le diagnostic de cet appareil, avec ce qui ne marche pas',
          onclick: () => diagDialog((d.vid + ':' + d.pid).toUpperCase()) }, 'Signaler') : null)))));
}

// Pourquoi aucun pilote ne l'a pris : affiché tel quel, pour qu'on puisse le recopier même sans le diagnostic
function drvReason(d) {
  const errs = drvErrors.get((d.vid + ':' + d.pid).toUpperCase());
  if (!NATIVE || !errs?.length) return null;
  return h('div', { class: 'muted small' }, 'Dernier essai : ' + errs[errs.length - 1]);
}

// Souris, clavier, casque ou manette qu'un pilote de PeriphHub connaît mais qui n'est pas (encore) connecté :
// gardé dans « Mes appareils », point orange, au lieu de disparaître de la barre latérale. Le clic mène à
// sa fiche sur l'accueil (pourquoi, que faire, Signaler). Retiré dès qu'un pilote le prend.
function pendingNav() {
  const want = new Map((report ? undetected() : [])
    .filter(d => ['experimental', 'supported', 'partial'].includes(d.status) && ['souris', 'clavier', 'casque', 'manette'].includes(d.kind))
    .map(d => [(d.vid + d.pid).toUpperCase(), d]));
  for (const b of document.querySelectorAll('nav .pending')) if (!want.has(b.dataset.pending)) b.remove();
  for (const [id, d] of want) {
    if (document.querySelector(`nav [data-pending="${id}"]`)) continue;
    const tab = KIND_TAB[d.kind];
    const icon = tab ? document.querySelector(`nav [data-tab="${tab}"] svg`)?.cloneNode(true) : kindIcon(d.kind);
    const name = d.product || d.catalog_name || `${d.vid}:${d.pid}`;
    document.querySelector('nav .nfoot').before(h('button', { class: 'pending', 'data-pending': id, title: 'Détecté, pas encore connecté : voir pourquoi',
      onclick: () => {
        othersOpen = true;
        showTab('home');
        setTimeout(() => { if ($('othersBox')) $('othersBox').open = true; $('dev-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50);
      } },
      icon || '', h('span', { class: 'nl' }, (KIND_NAME?.[d.kind] || d.kind[0].toUpperCase() + d.kind.slice(1)), h('small', { title: name }, name + ' · non connecté')),
      h('span', { class: 'dot warn' })));
  }
}

function refreshHome() {
  const sub = (id, t) => { const e = $(id); if (e && e.textContent !== t) e.textContent = t; };
  const ms = mouse?.decode?.();
  const bat = mouse?.info?.battery;
  sub('mouseSub', mouse ? [bat ? bat.level + ' %' : null, ms?.dpis?.[ms.currentDpiStage] ? ms.dpis[ms.currentDpiStage] + ' DPI' : null].filter(Boolean).join(' · ') || 'Connectée' : 'Non connectée');
  sub('kbSub', kb ? 'Connecté' : 'Non connecté');
  const hb = hs?.state?.battery;
  sub('hsSub', hs ? (hb != null ? hb + ' %' + (hs.state.charging ? ' · en charge' : '') : 'Connecté') : 'Non connecté');
  sub('rgbSub', rgb ? 'Connecté' : 'Carte mère');
  pendingNav();
  $('devGroup').hidden = !drvDevices().length && !document.querySelector('nav .pending')
    && ![...document.querySelectorAll('nav [data-tab]')].some(b => PLUGIN_TAB_VALUES.has(b.dataset.tab) && !b.hidden);
  bgTipSync();
  batAlerts();
  if (report) {
    sub('slimSub', report.vendor_bytes ? mo(report.vendor_bytes) + ' en fond' : 'Rien à alléger');
    const n = report.vendors.filter(v => v.bytes > 0).length;
    $('slimBadge').hidden = !n;
    $('slimBadge').textContent = n;
  }
  if ($('home').hidden) return;

  const tiles = deviceTiles();
  const live = [mouse, kb, hs, rgb].filter(Boolean).length + drvDevices().length;
  $('homeLead').textContent = live ? plural(live, 'appareil connecté', 'appareils connectés') : 'Vos appareils et votre PC, en un coup d’œil.';
  $('homeBody').replaceChildren(...[
    updateNotice(),
    hidBlockedNotice(),
    pcCard(),
    h('section', { class: 'block' },
      h('div', { class: 'bhead' }, h('h3', {}, 'Mes appareils'),
        tiles.length ? h('span', { class: 'muted small' }, 'Cliquez sur un appareil pour le régler') : null),
      tiles.length ? h('div', { class: 'tiles' }, tiles)
        : h('div', { class: 'empty' }, !report ? 'Recherche des appareils…'
          : otherDevices() ? 'Aucun de vos appareils n’est encore réglable ici. Ceux que PeriphHub a trouvés sont juste en dessous.'
          : 'Aucun appareil pris en charge n’est branché. Branchez-en un : il apparaît ici tout seul.')),
    diagAsk(),
    otherDevices(),
    NATIVE && report ? h('div', { class: 'homefoot' },
      h('span', {}, 'Un appareil manque ou ne marche pas ?'),
      h('div', { class: 'row-inline' },
        h('button', { class: 'ghost', disabled: diagBusy, onclick: () => diagDialog() }, diagBusy ? 'Envoi…' : 'Signaler un problème'),
        h('button', { class: 'ghost', onclick: () => copyDiag() }, 'Copier le diagnostic'))) : null].filter(Boolean));
}

// Un périphérique USB bloque Windows : on l'explique au lieu de chercher indéfiniment
navigator.hid?.addEventListener('blocked', () => refreshHome());
function hidBlockedNotice() {
  if (!report?.hid_blocked && !nativeHid.blocked) return null;
  return h('div', { class: 'notice warn' },
    h('strong', {}, 'Un périphérique USB ne répond pas à Windows'),
    h('p', { class: 'muted small' }, 'Windows reste bloqué en interrogeant l’un de vos appareils, donc PeriphHub ne peut pas lister les autres. '
      + 'Débranchez vos appareils un par un (dongles sans fil, manettes, casques, hubs) jusqu’à ce que ce message disparaisse : '
      + 'le dernier débranché est le coupable. Un redémarrage du PC règle souvent le problème.'),
    h('p', { class: 'muted small' }, 'PeriphHub réessaie tout seul toutes les 30 secondes.'));
}

// ---------- Mises à jour (version GitHub ; celle du Store est mise à jour par le Store) ----------

let upd = null; // dernier résultat de update_check
let updBusy = false;
const autoUpdate = () => { try { return localStorage.getItem('autoUpdate') !== 'off'; } catch { return true; } };

async function checkUpdate(manual = false) {
  if (!NATIVE || updBusy) return;
  updBusy = true;
  if (manual) renderOptions();
  try {
    upd = await nativeInvoke('update_check');
    // Fenêtre fermée (PeriphHub près de l'horloge, démarré avec Windows) : une notification par
    // nouvelle version, sinon personne ne la verrait
    let told = null;
    try { told = localStorage.getItem('updTold'); } catch {}
    if (upd.available && document.hidden && told !== upd.version) {
      try { localStorage.setItem('updTold', upd.version); } catch {}
      nativeInvoke('notify_show', { title: tx(`PeriphHub ${upd.version} est disponible`),
        body: tx('Ouvrez PeriphHub pour l’installer en un clic, vos réglages sont conservés.') }).catch(() => {});
    }
    if (manual) toast(upd.store ? 'Mises à jour assurées par le Microsoft Store'
      : upd.available ? `PeriphHub ${upd.version} est disponible` : 'PeriphHub est à jour');
  } catch (e) {
    if (manual) toast('Vérification impossible : ' + e, 'err');
  } finally {
    updBusy = false;
  }
  refreshHome();
  bgSync(); // infobulle de l'icône : mise à jour disponible
  if (!$('options').hidden) renderOptions();
}

async function installUpdate(btn) {
  btn.disabled = true;
  btn.textContent = 'Téléchargement…';
  // Progression envoyée par update.rs ; le bouton peut être recréé par un rendu : on le retrouve
  const label = (t) => { for (const b of document.querySelectorAll('.upd button')) b.textContent = t; btn.textContent = t; };
  let stop = null;
  try {
    stop = await window.__TAURI__.event.listen('update-progress', ({ payload: p }) => {
      if (p.installing) label('Installation… PeriphHub va redémarrer');
      else if (p.total) label(`Téléchargement… ${Math.min(100, Math.round(p.done * 100 / p.total))} %`);
    });
  } catch { /* sans progression */ }
  try {
    // PeriphHub se ferme : l'installeur attend sa fermeture, installe et le relance
    await nativeInvoke('update_install');
  } catch (e) {
    toast('Mise à jour impossible : ' + e, 'err');
    btn.disabled = false;
    label('Mettre à jour');
  } finally {
    stop?.();
  }
}

function updateNotice() {
  if (!upd?.available) return null;
  const btn = h('button', { onclick: () => installUpdate(btn) }, 'Mettre à jour');
  return h('div', { class: 'notice warn upd' },
    h('strong', {}, `PeriphHub ${upd.version} est disponible`),
    h('p', { class: 'muted small' }, 'Téléchargement et installation en un clic, vos réglages sont conservés. PeriphHub redémarre tout seul.'),
    btn);
}

if (NATIVE && autoUpdate()) {
  setTimeout(checkUpdate, 5000);
  setInterval(() => autoUpdate() && checkUpdate(), 6 * 3600 * 1000);
}

// ---------- Arrière-plan : zone de notification, démarrage avec Windows (background.rs) ----------
// Fenêtre fermée, PeriphHub reste près de l'horloge et renvoie leurs réglages aux appareils qui les
// oublient (casque rallumé, appareil rebranché, sortie de veille) : c'est ce qui permet de fermer
// pour de bon les logiciels constructeurs.

const bgKeep = () => { try { return localStorage.getItem('bgKeep') !== 'off'; } catch { return true; } };
const bgAnswered = () => { try { return localStorage.getItem('bgKeep') != null; } catch { return true; } };
let bgInfo = null; // { hidden_start, autostart : 'on' | 'off' | 'bloqué', store }
let bgBusy = false;

// Infobulle de l'icône : mise à jour disponible, puis batterie de chaque appareil (une ligne chacun)
// Batteries connues : souris et casque historiques, puis les pages des pilotes (Bluetooth compris)
function batteryList() {
  const out = [];
  const add = (key, name, b) => { if (b?.level != null) out.push({ key, name, level: b.level, charging: !!b.charging, label: b.label }); };
  if (mouse) add('mouse', $('mouseTitle')?.textContent || tx('Souris'), mouse.info?.battery);
  if (hs?.state?.battery != null) add('headset', $('headsetTitle')?.textContent || tx('Casque'), { level: hs.state.battery, charging: hs.state.charging });
  for (const i of drvDevices()) add(i.key, tx(i.name), i.state.battery);
  return out;
}

function bgTip() {
  const lines = [upd?.available ? tx(`PeriphHub ${upd.version} est disponible`) : 'PeriphHub'];
  for (const b of batteryList()) {
    const n = b.name.length > 26 ? b.name.slice(0, 25) + '…' : b.name;
    lines.push(b.label ? `${n} : ${tx(b.label).toLowerCase()}` : `${n} : ${b.level} %${b.charging ? ' ⚡' : ''}`);
  }
  // Limite de Windows : 127 caractères
  let tip = '';
  for (const l of lines) if ((tip ? tip.length + 1 : 0) + l.length <= 120) tip += (tip ? '\n' : '') + l;
  return tip;
}

let bgTipLast = '';
function bgSync() {
  if (!NATIVE) return;
  bgTipLast = bgTip();
  nativeInvoke('bg_set', {
    keep: bgKeep(), ask: !bgAnswered(),
    open: tx('Ouvrir PeriphHub'), quit: tx('Quitter PeriphHub'),
    tooltip: bgTipLast,
  }).catch(e => console.warn('[PeriphHub] arrière-plan', e));
}
// Appelé à chaque actualisation de l'accueil : l'infobulle suit les batteries
const bgTipSync = () => { if (NATIVE && bgTip() !== bgTipLast) bgSync(); };

// ---------- Batterie faible ----------
// Notification de Windows à 15 % ou moins (hors charge), une fois par appareil jusqu'à ce que la
// batterie remonte à 30 % ou se recharge : l'alerte qui faisait garder les logiciels constructeurs.
// Batteries relues toutes les 2 min (10 min fenêtre fermée) : core.js, puis refreshHome → batAlerts.
var batWarned = new Set();
var notifState = null; // 'on' | 'off-app' | 'off-user' | 'off-policy' | 'off' | 'unknown' (notify_state)
var notifAt = 0;
function batAlertOn() { try { return localStorage.getItem('batAlert') !== 'off'; } catch { return true; } }
function batAlertText(b) {
  return b.name + (LANG === 'fr' ? ' : ' : ': ') + (b.label ? tx(b.label).toLowerCase() : tx(`plus que ${b.level} %`));
}
function batAlerts() {
  if (!NATIVE) return;
  for (const b of batteryList()) {
    if (b.charging || b.level >= 30) { batWarned.delete(b.key); continue; }
    if (b.level < 1 || b.level > 15 || batWarned.has(b.key)) continue; // 0 % : souvent « inconnu »
    batWarned.add(b.key);
    if (batAlertOn()) nativeInvoke('notify_show', { title: tx('Batterie faible'), body: batAlertText(b) })
      .catch(e => console.warn('[PeriphHub] notification', e));
  }
}
// Windows peut ignorer les notifications sans erreur (coupées dans ses Paramètres) : on le dit
function notifCheck() {
  if (!NATIVE || Date.now() - notifAt < 5000) return;
  notifAt = Date.now();
  nativeInvoke('notify_state').then(st => {
    if (st === notifState) return;
    notifState = st;
    if (!$('options').hidden) renderOptions();
  }, () => {});
}
window.addEventListener('focus', () => { if (!$('options').hidden) notifCheck(); });

function batAlertField() {
  notifCheck();
  const why = {
    'off-user': 'Les notifications sont désactivées dans Windows : Paramètres > Système > Notifications.',
    'off-app': 'Les notifications de PeriphHub sont désactivées : Paramètres > Système > Notifications, puis PeriphHub.',
    'off-policy': 'Les notifications sont bloquées par une stratégie de cet ordinateur (entreprise, école).',
    off: 'Windows n’affiche pas les notifications de PeriphHub.',
    unknown: 'Notifications indisponibles sans installation (version portable) : installez PeriphHub pour les recevoir.',
  }[notifState];
  const on = batAlertOn();
  return field('Batterie faible',
    h('div', { class: 'muted small' }, 'Notification de Windows quand une batterie descend à 15 %, une fois jusqu’à la prochaine recharge'),
    segmented([{ v: 'on', label: 'Prévenir' }, { v: 'off', label: 'Ne pas prévenir' }], on ? 'on' : 'off', v => {
      try { localStorage.setItem('batAlert', v); } catch {}
      renderOptions();
    }),
    on && why ? h('p', { class: 'warnline' }, why) : null,
    on && notifState === 'on' ? h('div', { class: 'row-inline' }, h('button', { class: 'mini ghost',
      onclick: () => nativeInvoke('notify_show', { title: tx('Batterie faible'), body: tx('Essai : voici à quoi ressemble l’alerte') })
        .catch(e => toast(String(e?.message || e), 'err')) }, 'Essayer')) : null);
}

function bgSetKeep(on) {
  try { localStorage.setItem('bgKeep', on ? 'on' : 'off'); } catch {}
  bgSync();
}

async function bgLoad() {
  if (!NATIVE) return;
  try { bgInfo = await nativeInvoke('bg_state'); } catch (e) { bgInfo = { error: String(e?.message || e) }; }
  if (!$('options').hidden) renderOptions();
}

async function bgAutostart(on) {
  if (bgBusy) return;
  bgBusy = true;
  renderOptions();
  try {
    const r = await nativeInvoke('autostart_set', { on });
    bgInfo = { ...bgInfo, autostart: r };
    if (on && r === 'on') toast('PeriphHub démarrera avec Windows, fenêtre fermée');
  } catch (e) {
    toast('Réglage impossible : ' + (e?.message || e), 'err');
    await bgLoad();
  } finally {
    bgBusy = false;
    if (!$('options').hidden) renderOptions();
  }
}

function bgField() {
  const st = bgInfo?.autostart;
  return field('Arrière-plan',
    h('div', { class: 'muted small' }, 'Quand on ferme la fenêtre'),
    segmented([{ v: 'on', label: 'Rester près de l’horloge' }, { v: 'off', label: 'Quitter PeriphHub' }], bgKeep() ? 'on' : 'off',
      v => { bgSetKeep(v === 'on'); renderOptions(); }),
    h('div', { class: 'muted small' }, 'Démarrer avec Windows'),
    bgInfo && !bgInfo.error
      ? segmented([{ v: 'on', label: 'Oui, fenêtre fermée' }, { v: 'off', label: 'Non' }], st === 'on' ? 'on' : 'off', v => bgAutostart(v === 'on'))
      : h('div', { class: 'muted small' }, bgInfo?.error ? 'Indisponible : ' + bgInfo.error : 'Lecture…'),
    st === 'bloqué' ? h('p', { class: 'warnline' }, bgInfo.store
      ? 'Windows empêche PeriphHub de démarrer avec lui : réactivez-le dans Paramètres > Applications > Démarrage.'
      : 'Désactivé dans le Gestionnaire des tâches (Applications de démarrage) : choisissez « Oui » pour le réactiver.') : null,
    h('div', { class: 'muted small' }, 'En arrière-plan, PeriphHub renvoie vos réglages aux appareils qui les oublient : casque rallumé, appareil rebranché, sortie de veille. '
      + 'Sa fenêtre fermée, il se met en veille et consomme peu de mémoire. « Quitter PeriphHub » dans le menu de son icône (clic droit) le ferme vraiment.'));
}

// Première fermeture de la fenêtre : on demande, sinon PeriphHub semble refuser de se fermer
if (NATIVE) window.__TAURI__.event.listen('close-ask', () => {
  const pick = keep => {
    bgSetKeep(keep);
    m.close();
    nativeInvoke(keep ? 'bg_hide' : 'bg_quit').catch(() => {});
  };
  const m = modal(
    h('header', { class: 'dhead' }, h('h3', {}, 'Garder PeriphHub en arrière-plan ?'),
      h('button', { class: 'x', title: 'Fermer', onclick: () => m.close() }, '×')),
    h('p', {}, 'Fenêtre fermée, PeriphHub peut rester dans la zone de notification, près de l’horloge (sous la flèche ^ si son icône n’y est pas).'),
    h('p', { class: 'muted small' }, 'Il renvoie alors vos réglages aux appareils qui les oublient : casque rallumé, appareil rebranché, sortie de veille. '
      + 'Il se met en veille et consomme peu de mémoire. Modifiable à tout moment dans les Options.'),
    h('footer', { class: 'dfoot' }, h('span'),
      h('div', { class: 'row-inline' },
        h('button', { class: 'ghost', onclick: () => pick(false) }, 'Quitter complètement'),
        h('button', { onclick: () => pick(true) }, 'Garder en arrière-plan'))));
}).catch(() => {});

// ---------- Allègement ----------

const AUTO_LABEL = { run: 'Lancement au démarrage', dossier: 'Dossier Démarrage', service: 'Service Windows', 'tâche': 'Tâche planifiée' };

function vendorCard(v) {
  const nProc = v.processes.reduce((s, p) => s + p.count, 0);
  const facts = [nProc ? plural(nProc, 'processus', 'processus') + ' en cours' : 'fermé'];
  if (v.startup.length) facts.push(plural(v.startup.length, 'lancement automatique', 'lancements automatiques'));
  if (v.devices) facts.push(plural(v.devices, `appareil ${v.brand} branché`, `appareils ${v.brand} branchés`));
  return h('article', { class: 'vcard' + (v.bytes ? '' : ' idle') },
    h('div', { class: 'vhead' },
      h('div', {}, h('div', { class: 'vname' }, v.name, v.verified ? null : h('span', { class: 'chip unknown' }, 'à confirmer')),
        h('div', { class: 'muted small' }, facts.join(' · '))),
      h('div', { class: 'vram' }, v.bytes ? mo(v.bytes) : '—')),
    h('div', { class: 'vgrid' },
      v.keeps ? h('div', { class: 'vkeep' }, h('strong', {}, 'Continue sans lui'), h('span', {}, LANG === 'en' && v.keeps_en || v.keeps)) : null,
      v.loses ? h('div', { class: 'vlose' }, h('strong', {}, 'S’arrête sans lui'), h('span', {}, LANG === 'en' && v.loses_en || v.loses)) : null),
    vendorActions(v),
    v.processes.length || v.startup.length ? h('details', {},
      h('summary', {}, 'Détails techniques'),
      h('ul', {},
        v.processes.map(p => h('li', {}, `${p.name} ×${p.count} — ${mo(p.bytes)}`)),
        v.startup.map(s => h('li', {}, `${AUTO_LABEL[s.kind] || s.kind} : ${s.name}${s.mode ? ` (${s.mode})` : ''}`)))) : null);
}

const fmtDate = s => new Date(s * 1000).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' });

function vendorActions(v) {
  const log = journal.find(l => l.vendor === v.id);
  const active = v.startup.filter(s => s.mode === 'actif' || s.mode === 'auto').length;
  if (log) {
    const freed = Math.max(0, log.before_bytes - log.after_bytes);
    return h('div', { class: 'vact' },
      h('div', { class: 'vdone' }, h('span', { class: 'chip supported' }, 'Allégé le ' + fmtDate(log.date)),
        freed ? h('span', { class: 'muted small' }, mo(freed) + ' libérés') : null),
      h('div', { class: 'row-inline' },
        v.bytes ? h('button', { class: 'ghost', onclick: () => slimRun('slim_close', v, 'Fermeture') }, 'Refermer')
          : log.launch ? h('button', { class: 'ghost', onclick: () => slimRun('slim_open', v, 'Ouverture') }, 'Ouvrir pour un réglage') : null,
        active ? h('button', { class: 'ghost', onclick: () => slimWizard(v) }, 'Alléger encore') : null,
        h('button', { class: 'ghost', onclick: () => slimRun('slim_undo', v, 'Annulation') }, 'Annuler l’allègement')));
  }
  if (!v.bytes && !active) return h('div', { class: 'vact' }, h('span', { class: 'muted small' }, 'Ne tourne pas et ne démarre pas avec Windows : rien à faire.'));
  return h('div', { class: 'vact' }, h('button', { onclick: () => slimWizard(v) }, 'Alléger'));
}

// Ouvrir, refermer, annuler : résultat en notification puis nouvelle analyse
async function slimRun(cmd, v, label) {
  setStatus('slimStatus', label + ' de ' + v.name + '…');
  try {
    const r = await nativeInvoke(cmd, { vendor: v.id });
    if (r.cancelled) toast('Validation Windows refusée : ce qui en avait besoin n’a pas été modifié', 'err');
    else if (cmd === 'slim_undo') toast(r.failed?.length ? `Remis en partie : ${r.failed.join(', ')} à réessayer` : `${v.name} : tout est revenu comme avant`, r.failed?.length ? 'err' : 'ok');
    else if (cmd === 'slim_open') toast(`${v.name} est ouvert. Refermez-le ici une fois le réglage fait.`);
    else toast(`${v.name} refermé · ${mo(Math.max(0, r.before_bytes - r.after_bytes))} libérés`);
  } catch (e) {
    console.error('[PeriphHub]', e);
    toast(label + ' impossible : ' + e, 'err');
  }
  setStatus('slimStatus', '');
  rescan();
}

// ----- Parcours d'allègement (fenêtre en étapes) -----

const ITEM_LABEL = {
  run: n => `Ne plus lancer « ${n} » avec Windows`,
  dossier: n => `Retirer « ${n} » du démarrage de Windows`,
  service: n => `Service « ${n} » : démarrage à la demande au lieu d’automatique`,
  'tâche': n => `Désactiver la tâche planifiée « ${n} »`,
};

function brandDevices(v) {
  const ids = v.device_ids || [];
  return (report?.devices || []).filter(d => ids.includes(d.vid + ':' + d.pid));
}

function modal(...kids) {
  const ov = h('div', { class: 'overlay' }, h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' }, ...kids));
  const close = () => { ov.remove(); document.removeEventListener('keydown', esc); };
  const busy = () => ov.querySelector('.spin, .wbusy');
  const esc = e => { if (e.key === 'Escape' && !busy()) close(); };
  ov.addEventListener('click', e => { if (e.target === ov && !busy()) close(); });
  document.addEventListener('keydown', esc);
  document.body.append(ov);
  return { close, box: ov.firstChild };
}

function svgCheck() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 84 84');
  const c = document.createElementNS(ns, 'circle');
  c.setAttribute('cx', '42'); c.setAttribute('cy', '42'); c.setAttribute('r', '36');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M27 43l10 10 20-22');
  svg.append(c, p);
  return svg;
}

async function slimWizard(v) {
  const m = modal(h('div', { class: 'wbusy' }, h('div', { class: 'muted' }, 'Préparation…'), h('div', { class: 'pbar-ind' })));
  let plan;
  try {
    plan = await nativeInvoke('slim_plan', { vendor: v.id });
  } catch (e) {
    m.close();
    return toast('Préparation impossible : ' + e, 'err');
  }
  const picked = new Set(plan.items.map(i => i.id));
  let close = plan.running > 0;
  const devs = brandDevices(v);
  const step = (n, title, ...body) => h('section', { class: 'wstep' }, h('div', { class: 'wnum' }, String(n)),
    h('div', { class: 'wbody' }, h('h4', {}, title), ...body));
  const check = (on, label, hint, onChange) => h('label', { class: 'wcheck' },
    h('input', { type: 'checkbox', checked: on, onchange: e => onChange(e.target.checked) }),
    h('span', {}, label, hint ? h('small', {}, hint) : null));

  const go = async () => {
    // Progression par étapes pendant que Windows travaille, puis 100 % à la réponse
    const phases = [close ? `Fermeture de ${plan.name}…` : null, picked.size ? 'Retrait du démarrage de Windows…' : null, 'Mesure de la mémoire libérée…'].filter(Boolean);
    const bar = h('i', { style: 'width:4%' });
    const prog = h('div', { class: 'prog' }, bar);
    const phase = h('div', { class: 'wphase' }, phases[0]);
    const admin = plan.items.some(i => i.admin && picked.has(i.id)) || close;
    m.box.replaceChildren(h('div', { class: 'wbusy' }, h('div', {}, 'Allègement de ' + plan.name), prog, phase,
      admin ? h('div', { class: 'muted small' }, 'Si Windows demande une validation, cliquez sur « Oui ».') : null));
    let k = 0;
    const tick = setInterval(() => {
      k++;
      bar.style.width = Math.min(90, 4 + k * 14) + '%';
      const p = phases[Math.min(phases.length - 1, Math.floor(k / 2))];
      if (phase.textContent !== p) phase.textContent = p;
    }, 700);
    requestAnimationFrame(() => { bar.style.width = '18%'; });
    let r;
    try {
      r = await nativeInvoke('slim_apply', { vendor: v.id, ids: [...picked], close });
    } catch (e) {
      clearInterval(tick);
      console.error('[PeriphHub]', e);
      m.close();
      return toast('Allègement impossible : ' + e, 'err');
    }
    clearInterval(tick);
    bar.style.width = '100%';
    prog.classList.add('done');
    phase.textContent = 'Terminé';
    await new Promise(res => setTimeout(res, 550));
    const freed = Math.max(0, (r.before_bytes || 0) - (r.after_bytes || 0));
    // Coche dessinée et petits confettis (couleurs de l'interface), puis compteur de mémoire libérée
    const colors = ['var(--ok)', 'var(--accent)', 'var(--cost)', 'var(--warn)'];
    const bits = Array.from({ length: 14 }, (_, i) => {
      const a = i / 14 * Math.PI * 2, d = 60 + (i % 3) * 18;
      return h('i', { style: `background:${colors[i % 4]};--x:${Math.round(Math.cos(a) * d)}px;--y:${Math.round(Math.sin(a) * d)}px;--rot:${i * 47}deg` });
    });
    const big = h('div', { class: 'big' }, freed ? mo(freed) : plural(r.done || 0, 'changement', 'changements'));
    m.box.replaceChildren(h('div', { class: 'wdone' },
      h('div', { class: 'check' }, svgCheck(), ...bits),
      freed ? countUp(big, freed, true) : big,
      h('div', { class: 'wsub' }, freed ? 'de mémoire libérée. Votre PC est plus léger !' : `${plan.name} ne démarrera plus avec Windows.`),
      r.cancelled ? h('p', { class: 'warnline' }, 'Validation Windows refusée : seules les modifications possibles sans elle ont été faites.') : null,
      r.failed?.length ? h('p', { class: 'warnline' }, 'Pas modifié : ' + r.failed.join(', ')) : null,
      h('p', { class: 'muted small' }, `Besoin de ${plan.name} pour un réglage ? « Ouvrir pour un réglage » sur sa carte, puis « Refermer ».`),
      h('button', { class: 'lg', onclick: m.close }, 'Terminer')));
    rescan();
  };

  const draw = () => {
    const admin = plan.items.some(i => i.admin && picked.has(i.id)) || close;
    const n = picked.size + (close ? 1 : 0);
    const wasOpen = m.box.querySelector('details.more')?.open;
    m.box.replaceChildren(
      h('header', { class: 'dhead' }, h('h3', {}, 'Alléger ' + plan.name),
        h('button', { class: 'x', title: 'Fermer', onclick: m.close }, '×')),
      h('div', { class: 'stack' },
        h('p', { class: 'wlead' }, plan.running
          ? `PeriphHub va fermer ${plan.name} et l’empêcher de se relancer avec Windows.`
          : `PeriphHub va empêcher ${plan.name} de se lancer avec Windows.`),
        v.keeps ? h('div', { class: 'vkeep' }, h('strong', {}, 'Continue sans lui'), h('span', {}, LANG === 'en' && v.keeps_en || v.keeps)) : null,
        v.loses ? h('div', { class: 'vlose' }, h('strong', {}, 'S’arrête sans lui'), h('span', {}, LANG === 'en' && v.loses_en || v.loses)) : null,
        devs.length ? h('ul', { class: 'wdevs' }, devs.map(d => h('li', {},
          h('span', { class: 'chip ' + d.status }, d.status === 'supported' ? 'Réglable dans PeriphHub' : 'Pas encore dans PeriphHub'), ' ',
          d.product || d.vid + ':' + d.pid))) : null,
        devs.some(d => d.status !== 'supported') ? h('p', { class: 'muted small' },
          `Pour les appareils pas encore réglables ici, gardez ${plan.name} installé : vous l’ouvrirez à la demande depuis cette page, le temps d’un réglage.`) : null,
        !plan.items.length && !plan.running ? h('p', { class: 'muted' }, 'Rien à faire : ce logiciel ne tourne pas et ne démarre plus avec Windows.') : null,
        plan.items.length || plan.running ? h('details', { class: 'more', open: !!wasOpen },
          h('summary', {}, 'Voir le détail', h('span', { class: 'muted small' }, plural(n, 'changement choisi', 'changements choisis'))),
          h('div', { class: 'stack tight' },
            plan.items.map(i => check(picked.has(i.id), ITEM_LABEL[i.kind]?.(i.name) || i.name, i.admin ? 'validation Windows' : '',
              on => { if (on) picked.add(i.id); else picked.delete(i.id); draw(); })),
            plan.running ? check(close, `Fermer ${plan.name} maintenant`, `${plural(plan.running, 'processus', 'processus')} · ${mo(plan.bytes)}`,
              on => { close = on; draw(); }) : null)) : null,
        h('p', { class: 'muted small' }, 'Rien n’est supprimé ni désinstallé. « Annuler l’allègement » remet tout comme avant.')),
      h('footer', { class: 'dfoot' },
        admin ? h('span', { class: 'muted small' }, 'Windows vous demandera une validation.') : h('span'),
        h('div', { class: 'row-inline' },
          h('button', { class: 'ghost', onclick: m.close }, 'Annuler'),
          h('button', { class: 'lg', disabled: !picked.size && !close, onclick: go }, 'Alléger'))));
  };
  draw();
}

function renderSlim() {
  const box = $('slimBody');
  if (!report) return box.replaceChildren(h('div', { class: 'empty' }, NATIVE ? 'Analyse en cours…' : 'L’analyse ne fonctionne que dans l’appli PeriphHub.'));
  box.replaceChildren(
    slimExplain(),
    ramHero(),
    h('section', { class: 'block' },
      h('div', { class: 'bhead' }, h('h3', {}, 'Logiciels de marque trouvés'),
        h('span', { class: 'muted small' }, 'Les réglages enregistrés dans un appareil continuent de fonctionner quand son logiciel est fermé.')),
      report.vendors.length ? h('div', { class: 'vcards' }, report.vendors.map(vendorCard))
        : h('div', { class: 'empty' }, 'Aucun logiciel constructeur connu sur ce PC. Le vôtre manque ? Copiez le rapport et ouvrez un ticket sur GitHub.')));
}

$('copyReport').onclick = async () => {
  if (!report) return;
  try {
    let diag = '';
    try { diag = await fullDiag() + '\n\n'; } catch (e) { diag = 'Diagnostic indisponible : ' + (e.message || e) + '\n\n'; }
    await navigator.clipboard.writeText(diag + JSON.stringify(report, null, 2));
    toast('Rapport copié : collez-le dans un message (Discord…) ou un ticket GitHub');
  } catch {
    toast('Copie impossible', 'err');
  }
};
$('rescan').onclick = rescan;

// ---------- Options ----------

function renderOptions() {
  $('optBody').replaceChildren(
    field('Apparence',
      segmented([{ v: 'system', label: 'Comme Windows' }, { v: 'light', label: 'Clair' }, { v: 'dark', label: 'Sombre' }], themeChoice(),
        v => { setTheme(v); renderOptions(); })),
    field('Langue',
      segmented(Object.entries(LANGS).map(([v, label]) => ({ v, label })), LANG, v => { if (v !== LANG) { keepScan(); setLang(v); } })),
    NATIVE ? field('Mises à jour', ...(upd?.store
      ? [h('div', { class: 'muted small' }, 'Assurées par le Microsoft Store.')]
      : [segmented([{ v: 'on', label: 'Automatiques' }, { v: 'off', label: 'Désactivées' }], autoUpdate() ? 'on' : 'off', v => {
          try { localStorage.setItem('autoUpdate', v); } catch {}
          if (v === 'off') upd = null;
          renderOptions();
          refreshHome();
        }),
        h('div', { class: 'row-inline' },
          h('button', { class: 'ghost', disabled: updBusy, onclick: () => checkUpdate(true) }, updBusy ? 'Vérification…' : 'Vérifier maintenant')),
        h('div', { class: 'muted small' }, 'PeriphHub regarde sur GitHub si une nouvelle version existe et la propose en un clic. '
          + 'Rien sur votre ordinateur ni vos appareils n’est envoyé ; les mises à jour sont signées et vérifiées avant installation.')])) : null,
    NATIVE ? bgField() : null,
    NATIVE ? batAlertField() : null,
    NATIVE ? field('Son',
      segmented([{ v: 'off', label: 'Périphériques seulement' }, { v: 'on', label: 'Tout afficher' }], audioAll() ? 'on' : 'off', v => {
        try { localStorage.setItem('audioAll', v); } catch {}
        renderOptions();
        audioPoll();
      }),
      h('div', { class: 'muted small' }, 'Par défaut, seuls les casques, micros, DAC et enceintes USB ou Bluetooth ont un onglet. '
        + '« Tout afficher » ajoute le son de la carte mère, des écrans (HDMI) et les pilotes audio virtuels.')) : null,
    NATIVE && typeof orgbAdminRow === 'function' ? orgbAdminRow() : null,
    NATIVE ? field('Diagnostics',
      segmented([{ v: 'on', label: 'Envoi automatique' }, { v: 'off', label: 'Jamais' }], diagAuto() === 'on' ? 'on' : 'off', v => {
        try { localStorage.setItem('diagAuto', v); } catch {}
        renderOptions();
        if (v === 'on') diagMaybeAuto();
      }),
      h('div', { class: 'muted small' }, 'Quand un appareil détecté ne se connecte pas, ou si PeriphHub rencontre une erreur interne, il peut envoyer tout seul son diagnostic au développeur pour qu’il corrige : '
        + 'version de Windows, liste des appareils USB et essais des pilotes, sans numéro de série, nom d’utilisateur ni fichier. Une seule fois par problème. '
        + 'Il arrive dans un dépôt GitHub privé.'),
      h('div', { class: 'row-inline' }, h('button', { class: 'ghost', onclick: () => diagDialog() }, 'Envoyer un diagnostic maintenant'))) : null,
    field('Sauvegardes',
      h('div', { class: 'muted small' }, 'Avant la première modification d’un appareil, PeriphHub garde une copie de ses réglages d’origine : ' +
        'chaque page propose « Remettre d’origine ». Les réglages vivent dans la mémoire des appareils, pas dans PeriphHub.')),
    field('À propos',
      h('div', {}, h('strong', {}, 'PeriphHub ' + (report?.version || '')), h('span', { class: 'muted' }, ' · logiciel libre, licence GPL-3.0')),
      h('div', { class: 'muted small' }, 'Code source, appareils pris en charge et signalements : github.com/Sharkytihno/PeriphHub'),
      h('div', { class: 'muted small' }, 'Protocoles réimplémentés à partir de projets libres (OpenRazer, OpenRGB, VIA…) et de l’observation des appareils. ' +
        'PeriphHub n’écrit jamais de firmware.')));
}

// ---------- Envoi du diagnostic (sans compte) ----------
// Relais du projet (server/diag-relay) : il en fait un ticket dans un dépôt GitHub privé.
// Rien ne part sans action de l'utilisateur : un clic sur « Envoyer », ou l'envoi automatique
// qu'il a accepté (Options → Diagnostics, ou la question posée sur l'accueil).
var DIAG_URL = 'https://sharkywedding.fr/periphhub/diag';
var diagBusy = false; // var : refreshHome peut tourner avant cette ligne
function diagAuto() { try { return localStorage.getItem('diagAuto'); } catch { return null; } }
var diagKinds = d => ['souris', 'clavier', 'casque', 'manette'].includes(d.kind);
// Appareils standards exclus de la question et de l'envoi automatique (le bouton « Signaler » reste)
var diagMissing = () => undetected().filter(d => diagKinds(d) && !diagStandard(d));
var diagName = d => d.product || d.catalog_name || d.vid + ':' + d.pid;
var diagIdOf = d => (d.vid + ':' + d.pid).toUpperCase();
// Empreinte du problème : même version et mêmes appareils en échec → pas de second envoi automatique
var diagSignature = list => (report?.version || '') + '|' + list.map(diagIdOf).sort().join(',');
// Problèmes déjà envoyés automatiquement (les 30 derniers)
function diagSentList() { try { return JSON.parse(localStorage.getItem('diagSentList')) || []; } catch { return []; } }
function diagMarkSent(sig) {
  try { localStorage.setItem('diagSentList', JSON.stringify([...diagSentList().filter(s => s !== sig), sig].slice(-30))); } catch {}
}

// Appareils proposés dans « Appareil concerné » : connectés, puis détectés
function diagDevices() {
  const out = new Map();
  for (const i of drvLive.values()) if (i.dev && drvDiagId(i)) out.set(drvDiagId(i), i.name);
  for (const d of report?.devices || []) if (interesting(d) && !out.has(diagIdOf(d))) out.set(diagIdOf(d), diagName(d));
  return [...out].map(([id, name]) => ({ id, name }));
}

//   auto    : envoi automatique (accepté dans les Options) ; sinon clic sur « Envoyer »
//   comment : ce que l'utilisateur dit du problème ; focus : appareils en cause (« VID:PID »)
//   sig     : empreinte du problème, retenue une fois envoyé ; title : objet du ticket
var diagRetryAt = 0; // envoi automatique raté (réseau, relais) : pas de nouvel essai avant 10 min
async function sendDiag(auto, { comment = '', focus = null, sig = null, title = '' } = {}) {
  if (!NATIVE || diagBusy) return false;
  diagBusy = true;
  if (!auto) refreshHome();
  try {
    const missing = diagMissing();
    const ids = focus || missing.map(diagIdOf);
    const names = focus ? focus.map(id => diagDevices().find(d => d.id === id)?.name || id) : missing.map(diagName);
    const summary = [title || names.slice(0, 3).join(', '), String(comment).trim()].filter(Boolean).join(' : ').replace(/\s+/g, ' ').slice(0, 110);
    const r = await fetch(DIAG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' }, // requête « simple » : pas de vérification CORS préalable
      body: JSON.stringify({ version: report?.version || '', text: await fullDiag(null, { comment, focus: ids }), summary, auto }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    if (sig) diagMarkSent(sig);
    toast(auto ? 'Diagnostic envoyé automatiquement au développeur de PeriphHub' : 'Diagnostic envoyé, merci ! Le développeur va s’en servir pour corriger.', 'ok');
    return true;
  } catch (e) {
    if (!auto) toast('Envoi impossible (' + (e.message || e) + ') : utilisez « Copier le diagnostic » et envoyez-le vous-même.', 'err');
    else { console.warn('[PeriphHub] envoi automatique du diagnostic', e.message || e); diagRetryAt = Date.now() + 600000; }
    return false;
  } finally {
    diagBusy = false;
    refreshHome();
  }
}

// Envoi manuel : l'utilisateur dit sur quel appareil et ce qui ne marche pas (le diagnostic suffit
// alors à corriger du premier coup) et peut lire exactement ce qui part
function diagDialog(focus = '') {
  if (!NATIVE) return;
  const devs = diagDevices();
  if (focus && !devs.some(d => d.id === focus)) devs.unshift({ id: focus, name: 'Appareil' });
  const sel = h('select', { onchange: () => det.open && preview() },
    h('option', { value: '' }, 'Plusieurs, ou je ne sais pas'),
    devs.map(d => h('option', { value: d.id, selected: d.id === focus }, `${d.name} (${d.id})`)));
  const area = h('textarea', { rows: 4, maxlength: 1500,
    placeholder: 'Exemple : ma souris n’apparaît pas ; le DPI revient à 800 après la mise en veille ; le casque ne garde pas le retour micro…' });
  const opts = () => ({ comment: area.value, focus: sel.value ? [sel.value] : null });
  // <code> : le texte envoyé reste en français (le développeur le lit tel quel), pas traduit à l'écran
  const code = h('code');
  const preview = async () => { code.textContent = '…'; try { code.textContent = await fullDiag(null, opts()); } catch (e) { code.textContent = String(e); } };
  const det = h('details', { ontoggle: () => det.open && preview() }, h('summary', {}, 'Voir exactement ce qui sera envoyé'), h('pre', { class: 'diagprev' }, code));
  const send = h('button', { onclick: async () => {
    send.disabled = true;
    send.textContent = 'Envoi…';
    if (await sendDiag(false, opts())) m.close();
    else { send.disabled = false; send.textContent = 'Envoyer'; }
  } }, 'Envoyer');
  const m = modal(
    h('header', { class: 'dhead' }, h('h3', {}, 'Envoyer le diagnostic'),
      h('button', { class: 'x', title: 'Fermer', onclick: () => m.close() }, '×')),
    h('label', { class: 'stack tight' }, h('span', { class: 'muted small' }, 'Appareil concerné'), sel),
    h('label', { class: 'stack tight' }, h('span', { class: 'muted small' }, 'Ce qui ne marche pas (facultatif, mais ça aide beaucoup)'), area),
    h('p', { class: 'muted small' }, 'Le diagnostic contient la version de Windows, la liste des appareils USB, ce que PeriphHub a essayé '
      + 'et ses derniers échanges avec l’appareil concerné. Ni numéro de série, ni nom d’utilisateur, ni fichier. '
      + 'Il arrive dans un dépôt GitHub privé, lu seulement par le développeur.'),
    det,
    h('footer', { class: 'dfoot' },
      h('div', { class: 'row-inline' }, h('button', { class: 'ghost', onclick: () => copyDiag(null, opts()) }, 'Copier plutôt'),
        h('button', { class: 'ghost', onclick: reportProblem }, 'Ouvrir un ticket GitHub')),
      h('div', { class: 'row-inline' }, h('button', { class: 'ghost', onclick: () => m.close() }, 'Annuler'), send)));
  setTimeout(() => area.focus(), 60);
}

// Envoi automatique accepté : une fois par problème, quand les pilotes ont eu le temps d'essayer
// (souris sans fil en veille…) — au plus tôt 2 minutes après le lancement. Aussi une fois par erreur
// interne de cette version (erreurs.log), pour qu'elle soit corrigée sans attendre un signalement.
var diagStart = Date.now();
async function diagMaybeAuto() {
  if (diagAuto() !== 'on' || !report || diagBusy || Date.now() - diagStart < 120000 || Date.now() < diagRetryAt) return;
  const sent = diagSentList();
  const missing = diagMissing();
  if (missing.length && !sent.includes(diagSignature(missing))) return sendDiag(true, { sig: diagSignature(missing) });
  let errs = [];
  try { errs = (await nativeInvoke('sys_info')).errors || []; } catch {}
  // « date · version · fil · emplacement · message » : même emplacement et même message = même erreur
  const err = errs.map(l => l.split(' · ')).filter(p => p[1] === report.version).map(p => [p[1], p[3], p[4]].join(' · ')).pop();
  if (err && !sent.includes('erreur|' + err)) sendDiag(true, { focus: [], title: 'Erreur interne ' + err.split(' · ')[1], sig: 'erreur|' + err });
}
if (NATIVE) setInterval(() => { if (!document.hidden) diagMaybeAuto(); }, 30000);

// Question posée une fois, sur l'accueil, quand une souris, un clavier, un casque ou une manette
// détecté n'a pas pu être connecté (après 1 minute, le temps que les pilotes essaient)
function diagAsk() {
  if (!NATIVE || !report || diagAuto() || Date.now() - diagStart < 60000) return null;
  const missing = diagMissing();
  if (!missing.length) return null;
  const choose = v => {
    try { localStorage.setItem('diagAuto', v); } catch {}
    if (v === 'on') sendDiag(true, { sig: diagSignature(missing) });
    else refreshHome();
  };
  return h('div', { class: 'notice' },
    h('p', {}, h('strong', {}, 'PeriphHub n’a pas réussi à se connecter à : ' + missing.map(diagName).join(', ') + '.')),
    h('p', { class: 'muted small' }, 'Envoyer le diagnostic au développeur pour qu’il corrige ? Il contient la liste des appareils USB et ce que PeriphHub a essayé, '
      + 'sans numéro de série ni information personnelle. Modifiable ensuite dans les Options.'),
    h('div', { class: 'row-inline' },
      h('button', { onclick: () => choose('on') }, 'Oui, envoyer (et à l’avenir aussi)'),
      h('button', { class: 'ghost', onclick: () => { try { localStorage.setItem('diagAuto', 'off'); } catch {} sendDiag(false); } }, 'Envoyer juste cette fois'),
      h('button', { class: 'ghost', onclick: () => choose('off') }, 'Non merci')));
}

// ---------- Démarrage ----------

bgSync();
bgLoad();
// Version de PeriphHub sous son nom, en haut de la barre latérale
if (NATIVE) window.__TAURI__.app.getVersion().then(v => { $('appVer').textContent = 'Version ' + v; }, () => {});
// Rechargé pour changer de langue : l'analyse d'avant le rechargement est reprise telle quelle
const keptReport = NATIVE ? keptScan() : null;
if (keptReport) { report = keptReport.report; journal = keptReport.journal || []; $('copyReport').disabled = false; }
showTab((() => { try { return localStorage.getItem('tab'); } catch { return null; } })() || 'home');
if (keptReport) applyReport(); else rescan();
if (window.omApi) [window.omApi.driver, ...(window.omApi.keyboardDrivers || [])].forEach(registerDriver);
driversStart();
// Batterie et état relus régulièrement sur l'accueil (fenêtre visible seulement)
setInterval(() => { if (!document.hidden && !$('home').hidden) refreshHome(); }, 30000);
