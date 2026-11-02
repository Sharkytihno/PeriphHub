// PeriphHub v0.1 — affichage de l'analyse (lecture seule)
'use strict';

const invoke = window.__TAURI__.core.invoke;
const $ = (id) => document.getElementById(id);
let last = null;

const KIND_ICON = { souris: '🖱️', clavier: '⌨️', casque: '🎧', audio: '🔊', manette: '🎮', rgb: '🌈', ventilateurs: '🌀', autre: '🔌' };
const STATUS = {
  supported: 'Pris en charge',
  partial: 'Pris en charge en partie',
  planned: 'Bientôt pris en charge',
  unknown: 'Pas encore pris en charge',
};

function mo(bytes) {
  const v = bytes / 1048576;
  if (v >= 1024) return (v / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Go';
  return Math.round(v).toLocaleString('fr-FR') + ' Mo';
}

// Construit un élément sans jamais injecter de HTML venant de l'analyse
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const AUTO_LABEL = { run: 'Démarrage', dossier: 'Dossier Démarrage', service: 'Service', 'tâche': 'Tâche planifiée' };

function vendorCard(v) {
  const c = el('article', 'card');
  const head = el('div', 'head');
  const name = el('span', 'name', v.name);
  if (!v.verified) name.append(el('span', 'tag', 'à confirmer'));
  head.append(name, el('span', 'ram', v.bytes ? mo(v.bytes) : 'fermé'));
  c.append(head);

  const nProc = v.processes.reduce((s, p) => s + p.count, 0);
  const parts = [];
  parts.push(nProc ? `${nProc} processus en cours` : 'aucun processus en cours');
  if (v.startup.length) parts.push(`${v.startup.length} lancement(s) automatique(s)`);
  if (v.devices) parts.push(`${v.devices} appareil(s) ${v.brand} branché(s)`);
  c.append(el('div', 'meta', parts.join(' · ')));

  if (v.keeps) c.append(el('p', 'keeps', v.keeps));
  if (v.loses) c.append(el('p', 'loses', v.loses));

  if (v.processes.length || v.startup.length) {
    const d = el('details');
    d.append(el('summary', null, 'Détails'));
    const ul = el('ul');
    for (const p of v.processes) ul.append(el('li', null, `${p.name} ×${p.count} — ${mo(p.bytes)}`));
    for (const s of v.startup) {
      const mode = s.mode ? ` (${s.mode})` : '';
      ul.append(el('li', null, `${AUTO_LABEL[s.kind] || s.kind} : ${s.name}${mode}`));
    }
    d.append(ul);
    c.append(d);
  }
  return c;
}

function deviceRow(d) {
  const r = el('div', 'dev');
  r.append(el('div', 'icon', KIND_ICON[d.kind] || '🔌'));
  const mid = el('div');
  const title = d.product || `Appareil ${d.vid}:${d.pid}`;
  mid.append(el('div', 'title', title));
  const brand = d.brand || d.manufacturer || 'Fabricant inconnu';
  const ids = `${brand} · ${d.kind} · USB ${d.vid}:${d.pid}` + (d.brand_note ? ` · ${d.brand_note}` : '');
  mid.append(el('div', 'ids', ids));
  r.append(mid);
  r.append(el('span', 'status ' + d.status, STATUS[d.status] || d.status));
  return r;
}

// Appareils qui ont des réglages intéressants (le reste : hubs, puces internes…)
const interesting = (d) => d.status !== 'unknown' || ['souris', 'clavier', 'casque', 'manette', 'rgb'].includes(d.kind);

function render(r) {
  last = r;
  $('vendorRam').textContent = mo(r.vendor_bytes);
  const running = r.vendors.filter((v) => v.bytes > 0).length;
  $('vendorHint').textContent = r.vendors.length
    ? `${running} logiciel(s) ouvert(s) sur ${r.vendors.length} trouvé(s)`
    : 'Aucun logiciel constructeur connu trouvé';
  $('selfRam').textContent = mo(r.periphhub_bytes);

  const shown = r.devices.filter((d) => $('showOther').checked || interesting(d));
  $('devCount').textContent = r.devices.filter(interesting).length;
  const ok = r.devices.filter((d) => d.status === 'supported').length;
  $('devHint').textContent = `${ok} entièrement pris en charge`;

  const vs = $('vendors');
  vs.replaceChildren(...r.vendors.map(vendorCard));
  if (!r.vendors.length) vs.append(el('div', 'empty', 'Aucun logiciel constructeur connu : votre PC est déjà léger, ou votre logiciel n\'est pas encore dans la liste.'));

  const ds = $('devices');
  ds.replaceChildren(...shown.map(deviceRow));
  if (!shown.length) ds.append(el('div', 'empty', 'Aucun périphérique détecté.'));
  $('copy').disabled = false;
}

async function scan() {
  $('rescan').disabled = true;
  $('vendorHint').textContent = 'Analyse en cours';
  try {
    render(await invoke('scan'));
  } catch (e) {
    $('vendorHint').textContent = 'Erreur : ' + e;
  } finally {
    $('rescan').disabled = false;
  }
}

$('rescan').addEventListener('click', scan);
$('showOther').addEventListener('change', () => last && render(last));
$('copy').addEventListener('click', async () => {
  if (!last) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(last, null, 2));
    $('copy').textContent = 'Rapport copié ✓';
  } catch {
    $('copy').textContent = 'Copie impossible';
  }
  setTimeout(() => ($('copy').textContent = 'Copier le rapport'), 2000);
});

scan();
