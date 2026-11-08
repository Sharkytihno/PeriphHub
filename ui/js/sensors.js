// PeriphHub — page Températures : processeur, carte mère (sondes et ventilateurs), cartes graphiques, disques.
// Les mesures viennent du service des capteurs (src-tauri/src/sensors.rs, sensors/PeriphHubSensors.cs),
// installé une fois avec une validation Windows, démarré seulement quand cette page est ouverte.

let sensLast = null;      // dernière réponse de sensors_read
let sensErr = '';
let sensBusy = false;     // installation en cours
let sensTimer = 0;

const SENS_KIND = {
  Cpu: 'Processeur', GpuNvidia: 'Carte graphique', GpuAmd: 'Carte graphique', GpuIntel: 'Carte graphique',
  Motherboard: 'Carte mère', SuperIO: 'Sondes de la carte mère', EmbeddedController: 'Contrôleur de la carte mère',
  Storage: 'Disque',
};
const SENS_ORDER = ['Cpu', 'GpuNvidia', 'GpuAmd', 'GpuIntel', 'Motherboard', 'SuperIO', 'EmbeddedController', 'Storage'];

// Valeur affichable : une sonde débranchée renvoie souvent 0, -55, 127 ou 255 °C
const sensTempOk = s => s.k === 'Temperature' && s.v != null && s.v > 0 && s.v < 120;
const sensFanOk = s => s.k === 'Fan' && s.v != null && (s.v > 0 || (s.max || 0) > 0) && s.v < 20000;

// Seuils (°C) « chaud » et « trop chaud » : un point chaud de carte graphique à 90 °C est normal, un SSD à 70 non
function sensLevel(hw, t, name = '') {
  const [warm, hot] = hw.k === 'Storage' ? [55, 70]
    : /hot ?spot|junction|memory|mémoire/i.test(name) ? [90, 100]
    : /^Gpu/.test(hw.k) ? [75, 88]
    : hw.k === 'Cpu' ? [75, 90]
    : [65, 85]; // sondes de la carte mère (VRM, chipset…)
  return t >= hot ? 'hot' : t >= warm ? 'warm' : 'ok';
}

// Noms de LibreHardwareMonitor (anglais) → noms parlants
const SENS_NAMES = [
  [/^GPU Hot ?Spot$/i, 'Point chaud'], [/^GPU Memory( Junction)?$/i, 'Mémoire'], [/^GPU Core$/i, 'Puce'],
  [/^Core \(Tctl\/Tdie\)$|^CPU Package$/i, 'Processeur'], [/^Core Max$/i, 'Cœur le plus chaud'], [/^Core Average$/i, 'Moyenne des cœurs'],
  [/^CCD ?(\d+) \(Tdie\)$/i, 'Bloc de cœurs $1'], [/^System #?(\d*)$/i, 'Carte mère $1'], [/^Chipset$|^PCH$/i, 'Chipset'],
  [/^Temperature$/i, 'Température'], [/^Temperature #?(\d+)$/i, 'Capteur $1'], [/^Composite Temperature$/i, 'Température'],
  [/^CPU (Optional )?Fan( #?(\d+))?$/i, 'Ventilateur processeur $3'], [/^(System|Chassis) Fan #?(\d*)$/i, 'Ventilateur boîtier $2'],
  [/pump/i, 'Pompe'], [/^GPU Fan( #?(\d+))?$/i, 'Ventilateur $2'], [/^Fan #?(\d+)$/i, 'Ventilateur $1'],
];
function sensName(s) {
  if (s.k === 'Load') return 'Charge';
  if (s.k === 'Power') return 'Consommation';
  const m = SENS_NAMES.find(([re]) => re.test(s.n));
  return m ? s.n.replace(m[0], m[1]).replace(/\s+$/, '') : s.n;
}

// Mesure principale d'un composant : celle que les gens regardent
function sensMain(hw) {
  const temps = hw.s.filter(sensTempOk);
  const pick = res => temps.find(s => res.some(r => r.test(s.n)));
  if (hw.k === 'Cpu') return pick([/Tctl|Tdie/i, /^CPU Package$/i, /^Core \(Tctl/i, /^Package/i]) || temps.find(s => /Core Max|Core Average/i.test(s.n)) || temps[0];
  if (/^Gpu/.test(hw.k)) return pick([/^GPU Core$/i, /^GPU Hot ?Spot$/i]) || temps[0];
  if (hw.k === 'Storage') return pick([/^Temperature$/i, /Composite/i]) || temps[0];
  return null;
}

const fmtT = v => `${Math.round(v)} °C`;
const fmtV = s => s.k === 'Temperature' ? fmtT(s.v)
  : s.k === 'Fan' ? `${Math.round(s.v)} tr/min`
  : s.k === 'Control' || s.k === 'Load' ? `${Math.round(s.v)} %`
  : s.k === 'Power' ? `${s.v.toLocaleString(LOCALE, { maximumFractionDigits: 1 })} W`
  : s.k === 'Clock' ? `${Math.round(s.v)} MHz` : String(s.v);

// Lignes affichées : températures valides, ventilateurs branchés, charge et consommation principales
function sensRows(hw) {
  const main = sensMain(hw);
  const rows = hw.s.filter(s => s !== main && (sensTempOk(s) || sensFanOk(s)
    || (s.k === 'Load' && /^(CPU Total|GPU Core)$/i.test(s.n))
    || (s.k === 'Power' && /^(CPU Package|Package|GPU Package|GPU Power|GPU Core)$/i.test(s.n) && s.v > 0)));
  // Processeur : une ligne par cœur, c'est trop ; on garde le maximum et la moyenne
  return hw.k === 'Cpu' ? rows.filter(s => !(s.k === 'Temperature' && /^(CPU )?Core #\d+|^CCD\d+ \(|^Core #\d+/i.test(s.n) && !/Max|Average/i.test(s.n))) : rows;
}

function sensRow(hw, s) {
  const lvl = s.k === 'Temperature' ? sensLevel(hw, s.v, s.n) : '';
  return h('div', { class: 'srow' },
    h('span', { class: 'sname', title: s.n }, sensName(s)),
    h('span', { class: 'sval ' + lvl }, fmtV(s)),
    s.k === 'Temperature' && s.max ? h('span', { class: 'smax muted small', title: 'Maximum depuis l’ouverture de la page' }, 'max ' + fmtT(s.max)) : h('span'));
}

function sensCard(hw, parent) {
  const main = sensMain(hw);
  const rows = sensRows(hw);
  if (!main && !rows.length) return null;
  const kind = SENS_KIND[hw.k] || hw.k;
  return h('div', { class: 'card scard' },
    h('div', { class: 'shead' },
      h('div', {}, h('div', { class: 'muted small' }, parent ? `${kind} · ${parent}` : kind), h('strong', {}, hw.n)),
      main ? h('div', { class: 'sbig ' + sensLevel(hw, main.v, main.n), title: sensName(main) }, fmtT(main.v)) : null),
    rows.length ? h('div', { class: 'srows' }, rows.map(s => sensRow(hw, s))) : null);
}

function sensIntro() {
  const i = sensLast?.info || {};
  if (!NATIVE) return h('div', { class: 'card' }, 'Les températures ne s’affichent que dans l’appli PeriphHub.');
  if (i.module === false) return h('div', { class: 'card' }, 'Le module capteurs manque dans cette version de PeriphHub. Réinstallez la dernière version.');
  return h('div', { class: 'card sintro' },
    h('strong', {}, 'Voir les températures de votre PC'),
    h('p', { class: 'muted' }, 'Processeur, carte mère (sondes et ventilateurs), carte graphique et disques. Windows réserve ces capteurs aux administrateurs : '
      + 'PeriphHub installe une fois pour toutes un petit service en lecture seule (LibreHardwareMonitor et le pilote signé PawnIO). '
      + 'Il ne démarre que quand cette page est ouverte et s’arrête tout seul ensuite. Il ne touche à aucun réglage.'),
    h('button', { class: 'lg', disabled: sensBusy, onclick: () => sensAdmin('install') }, sensBusy ? 'Installation…' : 'Activer (une validation Windows)'));
}

function renderSensors() {
  const body = $('tempsBody');
  if (!body) return;
  const v = sensLast;
  const parts = [];
  if (sensErr) parts.push(h('div', { class: 'card err' }, sensErr));
  if (!NATIVE || !v || !v.installed) {
    parts.push(v || !NATIVE ? sensIntro() : h('div', { class: 'card muted' }, 'Lecture des capteurs…'));
  } else {
    if (v.info?.stale) parts.push(h('div', { class: 'card warn' }, 'Le module capteurs date d’une version précédente de PeriphHub. ',
      h('button', { disabled: sensBusy, onclick: () => sensAdmin('install') }, 'Mettre à jour (une validation Windows)')));
    if (v.error) parts.push(h('div', { class: 'card err' }, 'Le service des capteurs a rencontré une erreur : ' + v.error));
    if (!v.ready) parts.push(h('div', { class: 'card muted' }, 'Préparation des capteurs (quelques secondes au premier affichage)…'));
    else {
      const hw = [...(v.hw || [])].sort((a, b) => SENS_ORDER.indexOf(a.k) - SENS_ORDER.indexOf(b.k));
      const byId = new Map(hw.map(x => [x.id, x]));
      const cards = hw.map(x => sensCard(x, x.p ? byId.get(x.p)?.n : '')).filter(Boolean);
      if (cards.length) parts.push(h('div', { class: 'sgrid' }, cards));
      else parts.push(h('div', { class: 'card' }, 'Aucun capteur lisible sur ce PC. Envoyez un diagnostic (Options) : il dit quelles puces ont été trouvées.'));
      if (v.info && !v.info.pawnio) parts.push(h('div', { class: 'card warn' }, 'Le pilote PawnIO n’est pas installé : le processeur et la carte mère restent illisibles. ',
        h('button', { disabled: sensBusy, onclick: () => sensAdmin('install') }, 'Réinstaller')));
    }
    parts.push(h('div', { class: 'muted small sfoot' }, 'Mesures relues toutes les 2 secondes, en lecture seule. ',
      h('button', { class: 'ghost', disabled: sensBusy, onclick: () => sensAdmin('uninstall') }, 'Retirer l’accès aux capteurs')));
  }
  body.replaceChildren(...parts);
  const sub = $('tempsSub');
  const cpu = v?.hw?.find(x => x.k === 'Cpu');
  const t = cpu && sensMain(cpu);
  if (sub) sub.textContent = t ? 'Processeur ' + fmtT(t.v) : (v?.installed ? 'Activé' : 'Désactivé');
}

async function sensorsPoll() {
  clearTimeout(sensTimer);
  if (!NATIVE) { renderSensors(); return; }
  try {
    sensLast = await nativeInvoke('sensors_read');
    sensErr = '';
  } catch (e) {
    sensErr = String(e?.message || e);
  }
  if (!$('temps').hidden) renderSensors();
  // Relu tant que la page est ouverte : le service s'arrête de lui-même quand plus personne ne lit
  if (!$('temps').hidden && sensLast?.installed) sensTimer = setTimeout(sensorsPoll, sensLast.ready ? 2000 : 1000);
}

async function sensAdmin(action) {
  sensBusy = true;
  renderSensors();
  try {
    const ok = await nativeInvoke('sensors_admin', { action });
    if (!ok) toast('Validation Windows refusée : rien n’a été changé.', 'err');
    else toast(action === 'install' ? 'Capteurs activés' : 'Accès aux capteurs retiré');
  } catch (e) {
    toast(String(e?.message || e), 'err');
  }
  sensBusy = false;
  sensLast = null;
  sensorsPoll();
}

// Diagnostic : puces trouvées et ce qu'elles mesurent (noms et nombres, pas de valeurs à rallonge)
async function sensorsDiag() {
  if (!NATIVE) return [];
  let v = sensLast;
  // Service installé mais page jamais ouverte : une lecture pour le diagnostic (le démarre au besoin)
  if (!v?.hw) try {
    const i = await nativeInvoke('sensors_info');
    v = i.service !== 'absent' ? await nativeInvoke('sensors_read') : { info: i };
    for (let n = 0; n < 6 && v.installed && !v.ready; n++) { await new Promise(r => setTimeout(r, 1000)); v = await nativeInvoke('sensors_read'); }
  } catch (e) { return ['Capteurs : ' + (e?.message || e)]; }
  const i = v.info || {};
  const lines = [`Capteurs : module ${i.module ? 'livré' : 'absent'} · service ${i.service || '?'}${i.stale ? ' (ancienne version)' : ''} · PawnIO ${i.pawnio ? 'installé' : 'absent'}`];
  if (v.error) lines.push('  erreur du service : ' + v.error);
  for (const hw of v.hw || []) {
    const n = k => hw.s.filter(s => s.k === k).length;
    const temps = hw.s.filter(sensTempOk).map(s => `${s.n} ${Math.round(s.v)}`).slice(0, 12).join(', ');
    const fans = hw.s.filter(s => s.k === 'Fan').map(s => `${s.n} ${Math.round(s.v ?? -1)}`).slice(0, 10).join(', ');
    lines.push(`  ${hw.k} « ${hw.n} »${hw.p ? ' (sous ' + hw.p + ')' : ''} : ${n('Temperature')} temp., ${n('Fan')} ventil., ${n('Control')} commandes`
      + (temps ? ` · ${temps}` : '') + (fans ? ` · ventilateurs ${fans}` : ''));
  }
  return lines;
}

$('temps') && (() => {
  // Page ouverte : lecture immédiate puis toutes les 2 s ; quittée : plus rien
  new MutationObserver(() => { if (!$('temps').hidden) sensorsPoll(); else clearTimeout(sensTimer); })
    .observe($('temps'), { attributes: true, attributeFilter: ['hidden'] });
  // Sous-titre de la barre latérale, sans démarrer le service
  if (NATIVE) nativeInvoke('sensors_info').then(i => {
    if (!sensLast) $('tempsSub').textContent = i?.service && i.service !== 'absent' ? 'Activé' : 'Désactivé';
  }).catch(() => {});
})();
