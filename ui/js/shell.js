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
  autre: 'M9 2v6M15 2v6M7 8h10v4a5 5 0 0 1-10 0zM12 17v5',
  chip: 'M6 6h12v12H6zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4',
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
  if (name === 'options') renderOptions();
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
  // Appareils pris en charge détectés : leur page apparaît dans la barre latérale
  for (const d of report?.devices || []) {
    const tab = PLUGIN_TAB[d.plugin];
    if (tab && d.status !== 'unknown') document.querySelector(`nav [data-tab="${tab}"]`).hidden = false;
  }
  if (!$('slim').hidden) renderSlim();
  refreshHome();
}

// Appareils qui ont des réglages (le reste : hubs, puces internes, webcams…)
const interesting = d => d.status !== 'unknown' || ['souris', 'clavier', 'casque', 'manette', 'rgb'].includes(d.kind);

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
function countUp(el, bytes) {
  if (document.body.classList.contains('settled') || matchMedia('(prefers-reduced-motion: reduce)').matches || !bytes) return el;
  const t0 = performance.now(), dur = 700;
  const step = t => {
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = mo(bytes * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return el;
}

function ramHero() {
  const r = report;
  if (!r) return h('div', { class: 'hero' }, h('div', { class: 'muted' }, NATIVE ? 'Analyse du PC…' : 'L’analyse ne fonctionne que dans l’appli PeriphHub.'));
  const running = r.vendors.filter(v => v.bytes > 0);
  const max = Math.max(r.vendor_bytes, r.periphhub_bytes, 1);
  const bar = (cls, label, bytes) => h('div', { class: 'hbar ' + cls },
    h('div', { class: 'hbl' }, h('span', {}, label), h('strong', {}, mo(bytes))),
    h('div', { class: 'htrack' }, h('i', { style: `width:${Math.max(1.5, bytes / max * 100)}%` })));
  return h('div', { class: 'hero' },
    h('div', { class: 'hleft' },
      h('div', { class: 'hlabel' }, 'Mémoire des logiciels constructeurs'),
      countUp(h('div', { class: 'hvalue' + (r.vendor_bytes ? '' : ' zero') }, mo(r.vendor_bytes)), r.vendor_bytes),
      h('div', { class: 'muted small' }, running.length
        ? `${plural(running.length, 'logiciel ouvert', 'logiciels ouverts')} en arrière-plan : ${running.map(v => v.name).join(', ')}.`
        : 'Aucun logiciel constructeur connu ne tourne : votre PC est déjà léger.'),
      gained() > 0 ? h('div', { class: 'gain' }, `${mo(gained())} libérés grâce à l’allègement`) : null,
      running.length && $('slim').hidden ? h('button', { class: 'cta', onclick: () => showTab('slim') }, 'Voir comment alléger') : null),
    h('div', { class: 'hright' },
      bar('vendor', 'Logiciels constructeurs', r.vendor_bytes),
      bar('self', 'PeriphHub (cette fenêtre)', r.periphhub_bytes),
      h('div', { class: 'muted small' }, 'Mémoire privée, mesurée comme dans le Gestionnaire des tâches.')));
}

const STATUS = { supported: 'Pris en charge', experimental: 'Expérimental', partial: 'En partie', planned: 'Bientôt', rgb: 'Éclairage via OpenRGB',
  known: 'Reconnu, pas encore réglable', unknown: 'Pas encore pris en charge' };

// Configurateurs web officiels (seulement ceux dont l'adresse est sûre)
const WEB_TOOL = { '31E3': 'wootility.io', '03EB': 'wootility.io', '3434': 'launcher.keychron.com' };

// Ce que l'utilisateur peut faire pour un appareil que PeriphHub ne règle pas (encore)
function deviceHint(d) {
  return [h('div', { class: 'muted small' }, deviceHintText(d)), deviceTool(d)];
}

function deviceTool(d) {
  const web = WEB_TOOL[d.vid] || (d.plugin === 'via' ? 'usevia.app' : '');
  // Phrase à part : chaque nœud texte est traduit séparément
  return web ? h('div', { class: 'muted small' }, `Réglages aussi possibles sur ${web}, le configurateur officiel dans le navigateur.`) : '';
}

function deviceHintText(d) {
  if (d.status === 'experimental') return 'Un pilote expérimental le connaît, mais la connexion n’a pas abouti. Fermez son logiciel d’origine, rebranchez-le, puis Actualiser. Si ça ne marche toujours pas : « Signaler » envoie le diagnostic pour qu’on corrige.';
  if (d.status === 'rgb') return 'Son éclairage est réglable avec OpenRGB (lancé avec le serveur SDK). Ses autres réglages restent dans son logiciel d’origine.';
  if (d.status === 'planned') return 'Prise en charge prévue : son logiciel d’origine reste nécessaire pour l’instant.';
  return 'Son logiciel d’origine reste nécessaire pour le régler.';
}

function otherDevices() {
  if (!report) return null;
  const others = report.devices.filter(d => interesting(d) && !(PLUGIN_TAB[d.plugin] && d.status !== 'unknown') && !driverHas(d.vid, d.pid));
  if (!others.length) return null;
  return h('section', { class: 'block' },
    h('div', { class: 'bhead' }, h('h3', {}, 'Autres appareils détectés'),
      h('span', { class: 'muted small' }, 'Pas de réglages complets dans PeriphHub pour l’instant : voici ce qu’il est possible d’en faire.')),
    h('div', { class: 'devlist' }, others.map(d => h('div', { class: 'dev' },
      h('div', { class: 'tico' }, kindIcon(d.kind)),
      h('div', { class: 'dmain' },
        h('div', { class: 'dname' }, d.product || `Appareil ${d.vid}:${d.pid}`),
        h('div', { class: 'muted small' }, [d.brand || d.manufacturer || 'Fabricant inconnu', d.kind, `USB ${d.vid}:${d.pid}`].join(' · ')),
        ...deviceHint(d)),
      h('div', { class: 'dside' },
        h('span', { class: 'chip ' + d.status }, STATUS[d.status] || d.status),
        NATIVE ? h('button', { class: 'mini ghost', title: 'Ouvre un ticket GitHub prérempli avec le diagnostic de cet appareil',
          onclick: () => reportDevice(d.product || `Appareil ${d.vid}:${d.pid}`, d.vid, d.pid) }, 'Signaler') : null)))));
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
  $('devGroup').hidden = !drvLive.size && ![...document.querySelectorAll('nav [data-tab]')].some(b => PLUGIN_TAB_VALUES.has(b.dataset.tab) && !b.hidden);
  if (report) {
    sub('slimSub', report.vendor_bytes ? mo(report.vendor_bytes) + ' en fond' : 'Rien à alléger');
    const n = report.vendors.filter(v => v.bytes > 0).length;
    $('slimBadge').hidden = !n;
    $('slimBadge').textContent = n;
  }
  if ($('home').hidden) return;

  const hour = new Date().getHours();
  $('homeTitle').textContent = hour < 6 || hour >= 18 ? 'Bonsoir' : 'Bonjour';
  const tiles = deviceTiles();
  const live = [mouse, kb, hs, rgb].filter(Boolean).length + drvLive.size;
  $('homeLead').textContent = live ? `${plural(live, 'appareil connecté', 'appareils connectés')} · réglages enregistrés dans les appareils eux-mêmes`
    : 'Tous vos périphériques, d’un coup d’œil.';
  $('homeBody').replaceChildren(...[
    updateNotice(),
    hidBlockedNotice(),
    ramHero(),
    h('section', { class: 'block' },
      h('div', { class: 'bhead' }, h('h3', {}, 'Mes appareils')),
      tiles.length ? h('div', { class: 'tiles' }, tiles)
        : h('div', { class: 'empty' }, report ? 'Aucun appareil pris en charge n’est branché. Les appareils reconnus apparaissent ici tout seuls.' : 'Recherche des appareils…')),
    otherDevices()].filter(Boolean));
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
    if (manual) toast(upd.store ? 'Mises à jour assurées par le Microsoft Store'
      : upd.available ? `PeriphHub ${upd.version} est disponible` : 'PeriphHub est à jour');
  } catch (e) {
    if (manual) toast('Vérification impossible : ' + e, 'err');
  } finally {
    updBusy = false;
  }
  refreshHome();
  if (!$('options').hidden) renderOptions();
}

async function installUpdate(btn) {
  btn.disabled = true;
  btn.textContent = 'Téléchargement…';
  try {
    // PeriphHub se ferme : l'installeur le relance une fois la mise à jour faite
    await nativeInvoke('update_install');
  } catch (e) {
    toast('Mise à jour impossible : ' + e, 'err');
    btn.disabled = false;
    btn.textContent = 'Mettre à jour';
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
  return h('div', { class: 'vact' }, h('button', { onclick: () => slimWizard(v) }, 'Alléger…'));
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
  const esc = e => { if (e.key === 'Escape' && !ov.querySelector('.spin')) close(); };
  ov.addEventListener('click', e => { if (e.target === ov && !ov.querySelector('.spin')) close(); });
  document.addEventListener('keydown', esc);
  document.body.append(ov);
  return { close, box: ov.firstChild };
}

async function slimWizard(v) {
  const m = modal(h('div', { class: 'wbusy' }, h('div', { class: 'spin' }), h('div', { class: 'muted' }, 'Préparation…')));
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
    m.box.replaceChildren(h('div', { class: 'wbusy' }, h('div', { class: 'spin' }), h('div', {}, 'Allègement de ' + plan.name + '…'),
      h('div', { class: 'muted small' }, 'Acceptez la fenêtre de validation Windows si elle apparaît.')));
    let r;
    try {
      r = await nativeInvoke('slim_apply', { vendor: v.id, ids: [...picked], close });
    } catch (e) {
      console.error('[PeriphHub]', e);
      m.close();
      return toast('Allègement impossible : ' + e, 'err');
    }
    const freed = Math.max(0, (r.before_bytes || 0) - (r.after_bytes || 0));
    m.box.replaceChildren(h('div', { class: 'wdone' },
      h('div', { class: 'big' }, freed ? mo(freed) : '✓'),
      h('div', {}, freed ? 'de mémoire libérée, mesurés à l’instant.' : plural(r.done || 0, 'modification faite', 'modifications faites') + '.'),
      r.cancelled ? h('p', { class: 'warnline' }, 'Validation Windows refusée : seules les modifications possibles sans elle ont été faites.') : null,
      r.failed?.length ? h('p', { class: 'warnline' }, 'Pas modifié : ' + r.failed.join(', ')) : null,
      h('p', { class: 'muted small' }, `Besoin de ${plan.name} pour un réglage ? « Ouvrir pour un réglage » sur sa carte, puis « Refermer ».`),
      h('button', { onclick: m.close }, 'Terminer')));
    rescan();
  };

  const draw = () => {
    const admin = plan.items.some(i => i.admin && picked.has(i.id)) || close;
    m.box.replaceChildren(
      h('header', { class: 'dhead' }, h('h3', {}, 'Alléger ' + plan.name),
        h('button', { class: 'x', title: 'Fermer', onclick: m.close }, '×')),
      step(1, 'Ce qui change',
        v.keeps ? h('div', { class: 'vkeep' }, h('strong', {}, 'Continue sans lui'), h('span', {}, LANG === 'en' && v.keeps_en || v.keeps)) : null,
        v.loses ? h('div', { class: 'vlose' }, h('strong', {}, 'S’arrête sans lui'), h('span', {}, LANG === 'en' && v.loses_en || v.loses)) : null,
        devs.length ? h('ul', { class: 'wdevs' }, devs.map(d => h('li', {},
          h('span', { class: 'chip ' + d.status }, d.status === 'supported' ? 'Réglable dans PeriphHub' : 'Pas encore dans PeriphHub'), ' ',
          d.product || d.vid + ':' + d.pid))) : null,
        devs.some(d => d.status !== 'supported') ? h('p', { class: 'muted small' },
          `Pour les appareils pas encore réglables ici, gardez ${plan.name} installé : vous l’ouvrirez à la demande depuis cette page, le temps d’un réglage.`) : null),
      step(2, 'Ce que PeriphHub va faire',
        plan.items.map(i => check(picked.has(i.id), ITEM_LABEL[i.kind]?.(i.name) || i.name, i.admin ? 'validation Windows' : '',
          on => { if (on) picked.add(i.id); else picked.delete(i.id); draw(); })),
        plan.running ? check(close, `Fermer ${plan.name} maintenant`, `${plural(plan.running, 'processus', 'processus')} · ${mo(plan.bytes)}`,
          on => { close = on; draw(); }) : null,
        !plan.items.length && !plan.running ? h('p', { class: 'muted' }, 'Rien à faire : ce logiciel ne tourne pas et ne démarre plus avec Windows.') : null,
        h('p', { class: 'muted small' }, 'Rien n’est supprimé ni désinstallé. Chaque modification est notée : « Annuler l’allègement » remet tout comme avant.')),
      h('footer', { class: 'dfoot' },
        admin ? h('span', { class: 'muted small' }, 'Windows vous demandera une validation (droits administrateur).') : h('span'),
        h('div', { class: 'row-inline' },
          h('button', { class: 'ghost', onclick: m.close }, 'Annuler'),
          h('button', { disabled: !picked.size && !close, onclick: go }, 'Alléger'))));
  };
  draw();
}

function renderSlim() {
  const box = $('slimBody');
  if (!report) return box.replaceChildren(h('div', { class: 'empty' }, NATIVE ? 'Analyse en cours…' : 'L’analyse ne fonctionne que dans l’appli PeriphHub.'));
  box.replaceChildren(
    ramHero(),
    h('section', { class: 'block' },
      h('div', { class: 'bhead' }, h('h3', {}, 'Logiciels constructeurs trouvés'),
        h('span', { class: 'muted small' }, 'Les réglages enregistrés dans un appareil continuent de fonctionner quand son logiciel est fermé.')),
      report.vendors.length ? h('div', { class: 'vcards' }, report.vendors.map(vendorCard))
        : h('div', { class: 'empty' }, 'Aucun logiciel constructeur connu sur ce PC. Le vôtre manque ? Copiez le rapport et ouvrez un ticket sur GitHub.')));
}

$('copyReport').onclick = async () => {
  if (!report) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    toast('Rapport copié : collez-le dans un ticket GitHub');
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
      segmented(Object.entries(LANGS).map(([v, label]) => ({ v, label })), LANG, v => { if (v !== LANG) setLang(v); })),
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
    field('Sauvegardes',
      h('div', { class: 'muted small' }, 'Avant la première modification d’un appareil, PeriphHub garde une copie de ses réglages d’origine : ' +
        'chaque page propose « Remettre d’origine ». Les réglages vivent dans la mémoire des appareils, pas dans PeriphHub.')),
    field('À propos',
      h('div', {}, h('strong', {}, 'PeriphHub ' + (report?.version || '')), h('span', { class: 'muted' }, ' · logiciel libre, licence GPL-3.0')),
      h('div', { class: 'muted small' }, 'Code source, appareils pris en charge et signalements : github.com/Sharkytihno/PeriphHub'),
      h('div', { class: 'muted small' }, 'Protocoles réimplémentés à partir de projets libres (OpenRazer, OpenRGB, VIA…) et de l’observation des appareils. ' +
        'PeriphHub n’écrit jamais de firmware.')));
}

// ---------- Démarrage ----------

showTab((() => { try { return localStorage.getItem('tab'); } catch { return null; } })() || 'home');
rescan();
if (window.omApi) [window.omApi.driver, ...(window.omApi.keyboardDrivers || [])].forEach(registerDriver);
driversStart();
// Batterie et état relus régulièrement sur l'accueil (fenêtre visible seulement)
setInterval(() => { if (!document.hidden && !$('home').hidden) refreshHome(); }, 30000);
