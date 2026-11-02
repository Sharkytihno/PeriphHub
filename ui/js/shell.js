// PeriphHub — coquille de l'interface : navigation, accueil, allègement, options, notifications.
// Chargé en dernier : utilise mouse, kb, hs, rgb, h, $, setStatus (js/devices.js).

// ---------- Outils ----------

function mo(bytes) {
  const v = (bytes || 0) / 1048576;
  if (v >= 1024) return (v / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Go';
  return Math.round(v).toLocaleString('fr-FR') + ' Mo';
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

function showTab(name) {
  if (!$(name) || document.querySelector(`nav [data-tab="${name}"]`)?.hidden) name = 'home';
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
let scanning = false;

async function rescan() {
  if (!NATIVE || scanning) return;
  scanning = true;
  $('rescan').disabled = true;
  setStatus('slimStatus', 'Analyse…');
  try {
    report = await nativeInvoke('scan');
    setStatus('slimStatus', '');
    $('copyReport').disabled = false;
  } catch (e) {
    console.error('[PeriphHub]', e);
    setStatus('slimStatus', 'Analyse impossible : ' + e, 'err');
  } finally {
    scanning = false;
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
  return tiles;
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
      h('div', { class: 'hvalue' + (r.vendor_bytes ? '' : ' zero') }, mo(r.vendor_bytes)),
      h('div', { class: 'muted small' }, running.length
        ? `${plural(running.length, 'logiciel ouvert', 'logiciels ouverts')} en arrière-plan : ${running.map(v => v.name).join(', ')}.`
        : 'Aucun logiciel constructeur connu ne tourne : votre PC est déjà léger.'),
      running.length ? h('button', { class: 'cta', onclick: () => showTab('slim') }, 'Voir comment alléger') : null),
    h('div', { class: 'hright' },
      bar('vendor', 'Logiciels constructeurs', r.vendor_bytes),
      bar('self', 'PeriphHub (cette fenêtre)', r.periphhub_bytes),
      h('div', { class: 'muted small' }, 'Mémoire privée, mesurée comme dans le Gestionnaire des tâches.')));
}

const STATUS = { supported: 'Pris en charge', partial: 'En partie', planned: 'Bientôt', unknown: 'Pas encore pris en charge' };

function otherDevices() {
  if (!report) return null;
  const others = report.devices.filter(d => interesting(d) && !(PLUGIN_TAB[d.plugin] && d.status !== 'unknown'));
  if (!others.length) return null;
  return h('section', { class: 'block' },
    h('div', { class: 'bhead' }, h('h3', {}, 'Autres appareils détectés'),
      h('span', { class: 'muted small' }, 'Pas encore de réglages dans PeriphHub : leur logiciel d’origine reste nécessaire pour les modifier.')),
    h('div', { class: 'devlist' }, others.map(d => h('div', { class: 'dev' },
      h('div', { class: 'tico' }, kindIcon(d.kind)),
      h('div', { class: 'dmain' },
        h('div', { class: 'dname' }, d.product || `Appareil ${d.vid}:${d.pid}`),
        h('div', { class: 'muted small' }, [d.brand || d.manufacturer || 'Fabricant inconnu', d.kind, `USB ${d.vid}:${d.pid}`].join(' · '))),
      h('span', { class: 'chip ' + d.status }, STATUS[d.status] || d.status)))));
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
  $('devGroup').hidden = ![...document.querySelectorAll('nav [data-tab]')].some(b => PLUGIN_TAB_VALUES.has(b.dataset.tab) && !b.hidden);
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
  const live = [mouse, kb, hs, rgb].filter(Boolean).length;
  $('homeLead').textContent = live ? `${plural(live, 'appareil connecté', 'appareils connectés')} · réglages enregistrés dans les appareils eux-mêmes`
    : 'Tous vos périphériques, d’un coup d’œil.';
  $('homeBody').replaceChildren(...[
    ramHero(),
    h('section', { class: 'block' },
      h('div', { class: 'bhead' }, h('h3', {}, 'Mes appareils')),
      tiles.length ? h('div', { class: 'tiles' }, tiles)
        : h('div', { class: 'empty' }, report ? 'Aucun appareil pris en charge n’est branché. Les appareils reconnus apparaissent ici tout seuls.' : 'Recherche des appareils…')),
    otherDevices()].filter(Boolean));
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
      v.keeps ? h('div', { class: 'vkeep' }, h('strong', {}, 'Continue sans lui'), h('span', {}, v.keeps)) : null,
      v.loses ? h('div', { class: 'vlose' }, h('strong', {}, 'S’arrête sans lui'), h('span', {}, v.loses)) : null),
    v.processes.length || v.startup.length ? h('details', {},
      h('summary', {}, 'Détails techniques'),
      h('ul', {},
        v.processes.map(p => h('li', {}, `${p.name} ×${p.count} — ${mo(p.bytes)}`)),
        v.startup.map(s => h('li', {}, `${AUTO_LABEL[s.kind] || s.kind} : ${s.name}${s.mode ? ` (${s.mode})` : ''}`)))) : null);
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
// Batterie et état relus régulièrement sur l'accueil (fenêtre visible seulement)
setInterval(() => { if (!document.hidden && !$('home').hidden) refreshHome(); }, 30000);
