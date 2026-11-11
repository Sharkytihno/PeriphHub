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
  Storage: 'Disque', AsusAtk: 'Portable ASUS',
};
const SENS_ORDER = ['Cpu', 'GpuNvidia', 'GpuAmd', 'GpuIntel', 'Motherboard', 'SuperIO', 'EmbeddedController', 'AsusAtk', 'Storage'];

// Valeur affichable : une sonde débranchée renvoie souvent 0, -55, 127 ou 255 °C
// Les SSD publient aussi leurs seuils d'alerte comme des « températures » : ce ne sont pas des mesures
const sensTempOk = s => s.k === 'Temperature' && s.v != null && s.v > 0 && s.v < 120 && !/warning|critical|limit|threshold/i.test(s.n);
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

const SENS_LEVEL = { warm: 'Chaud', hot: 'Très chaud' };

// Noms de LibreHardwareMonitor (anglais) → noms parlants
const SENS_NAMES = [
  [/^GPU Hot ?Spot$/i, 'Point chaud'], [/^GPU Memory( Junction)?$/i, 'Mémoire'], [/^GPU Core$/i, 'Puce'],
  [/^Core \(Tctl\/Tdie\)$|^CPU Package$/i, 'Processeur'], [/^Core Max$/i, 'Cœur le plus chaud'], [/^Core Average$/i, 'Moyenne des cœurs'],
  [/^CCD ?(\d+) \(Tdie\)$/i, 'Bloc de cœurs $1'], [/^System ?#?(\d*)$/i, 'Carte mère $1'], [/^CPU$/i, 'Socket du processeur'], [/^PCIe (x\d+)$/i, 'Emplacement PCIe $1'], [/^Chipset$|^PCH$/i, 'Chipset'],
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

// Consommation (W) du composant entier, pas d'un cœur ou d'une partie de la puce.
// Processeur : « Package » (AMD) ou « CPU Package » (Intel). Carte graphique : « GPU Package » (AMD, NVIDIA),
// « GPU Power »… ; à défaut la plus grande valeur publiée (jamais pour le processeur : ce serait un seul cœur).
function sensPower(hw) {
  const ps = hw.s.filter(s => s.k === 'Power' && s.v != null && s.v >= 0 && s.v < 2000);
  const res = hw.k === 'Cpu' ? [/^(CPU )?Package$/i]
    : [/^GPU (Package|Power|PPT|Total|Board Power)$/i, /^GPU Core$/i];
  for (const re of res) { const s = ps.find(x => re.test(x.n)); if (s) return s; }
  return /^Gpu/.test(hw.k) ? [...ps].sort((a, b) => b.v - a.v)[0] || null : null;
}
// Partie graphique du processeur (Ryzen, Intel UHD/Iris, Core Ultra) : sa consommation est déjà comptée
// dans celle du processeur. Les Intel Arc A/B (cartes) portent un numéro de modèle.
const sensIgpu = hw => (hw.k === 'GpuIntel' && !/Arc\(TM\) [AB]\d/i.test(hw.n))
  || (hw.k === 'GpuAmd' && /Radeon\(TM\) Graphics$|^AMD Radeon Graphics$/i.test(hw.n));

const fmtT = v => `${Math.round(v)} °C`;
const fmtW = v => `${Math.round(v)} W`;
let sensPeak = 0; // total le plus haut vu depuis l'ouverture de l'appli
const fmtV = s => s.k === 'Temperature' ? fmtT(s.v)
  : s.k === 'Fan' ? `${Math.round(s.v)} tr/min`
  : s.k === 'Control' || s.k === 'Load' ? `${Math.round(s.v)} %`
  : s.k === 'Power' ? `${s.v.toLocaleString(LOCALE, { maximumFractionDigits: 1 })} W`
  : s.k === 'Clock' ? `${Math.round(s.v)} MHz` : String(s.v);

// Lignes affichées : températures valides, ventilateurs branchés, charge et consommation principales
function sensRows(hw) {
  const main = sensMain(hw);
  // Vitesses des ventilateurs pilotables : en grand dans la section Ventilateurs (js/fancontrol.js)
  const fans = typeof fcShown !== 'function' || !fcShown(hw);
  const rows = hw.s.filter(s => s !== main && (sensTempOk(s) || (fans && sensFanOk(s))
    || (s.k === 'Load' && /^(CPU Total|GPU Core)$/i.test(s.n))));
  // Processeur : une ligne par cœur, c'est trop ; on garde le maximum et la moyenne
  return hw.k === 'Cpu' ? rows.filter(s => !(s.k === 'Temperature' && /^(CPU )?Core #\d+|^CCD\d+ \(|^Core #\d+/i.test(s.n) && !/Max|Average/i.test(s.n))) : rows;
}

function sensRow(hw, s) {
  const lvl = s.k === 'Temperature' ? sensLevel(hw, s.v, s.n) : '';
  return h('div', { class: 'srow' },
    h('span', { class: 'sname', title: s.n }, sensName(s)),
    h('span', { class: 'sval ' + lvl, title: SENS_LEVEL[lvl] || null }, fmtV(s)),
    s.k === 'Temperature' && s.max ? h('span', { class: 'smax muted small', title: 'Maximum relevé depuis que le service tourne' }, 'max ' + fmtT(s.max)) : h('span'));
}

function sensCard(hw, parent) {
  if (hw.k === 'AsusAtk' && typeof fcShown === 'function' && fcShown(hw)) return null;
  const main = sensMain(hw);
  const rows = sensRows(hw);
  // Partie graphique du processeur : sa consommation est déjà dans celle du processeur (et souvent fantaisiste)
  const igpu = sensIgpu(hw);
  const pw = igpu ? null : sensPower(hw);
  if (!main && !rows.length && !pw) return null;
  const kind = igpu ? 'Graphique intégré au processeur' : SENS_KIND[hw.k] || hw.k;
  return h('div', { class: 'card scard' },
    h('div', { class: 'shead' },
      h('div', {}, h('div', { class: 'muted small' }, parent ? `${kind} · ${parent}` : kind), h('strong', {}, hw.n)),
      main || pw ? h('div', { class: 'sside' },
        main ? h('div', { class: 'sbig ' + sensLevel(hw, main.v, main.n), title: sensName(main) }, fmtT(main.v)) : null,
        // Dit en toutes lettres : la couleur seule ne suffit pas (daltonisme, écran mal réglé)
        main && SENS_LEVEL[sensLevel(hw, main.v, main.n)] ? h('div', { class: 'slvl ' + sensLevel(hw, main.v, main.n) }, SENS_LEVEL[sensLevel(hw, main.v, main.n)]) : null,
        pw ? h('div', { class: 'spow', title: 'Consommation électrique en direct' }, fmtW(pw.v)) : null) : null),
    rows.length ? h('div', { class: 'srows' }, rows.map(s => sensRow(hw, s))) : null);
}

// Consommation en direct : processeur + cartes graphiques (la partie graphique du processeur est déjà
// dans le processeur). Le reste du PC n'a pas de capteur : estimation à la prise, annoncée comme telle.
function sensPowerCard(hw) {
  const items = hw.filter(x => !sensIgpu(x)).map(x => ({ hw: x, s: sensPower(x) })).filter(x => x.s);
  if (!items.length) return null;
  const total = items.reduce((a, x) => a + x.s.v, 0);
  sensPeak = Math.max(sensPeak, total);
  // Carte mère, mémoire, disques, ventilateurs ≈ 50 W ; alimentation ≈ 88 % de rendement
  const wall = Math.round((total + 50) / 0.88 / 10) * 10;
  return h('div', { class: 'card scard spower' },
    h('div', { class: 'shead' },
      h('div', {}, h('div', { class: 'muted small' }, 'Consommation en direct'), h('strong', {}, 'Processeur et carte graphique')),
      h('div', { class: 'sside' }, h('div', { class: 'sbig' }, fmtW(total)),
        h('div', { class: 'muted small', title: 'Total le plus haut vu depuis l’ouverture de PeriphHub' }, 'pic ' + fmtW(sensPeak)))),
    h('div', { class: 'srows' }, items.map(({ hw: x, s }) => h('div', { class: 'pwrow' },
      h('div', { class: 'srow' },
        h('span', { class: 'sname', title: x.n }, SENS_KIND[x.k] || x.k),
        h('span', { class: 'sval' }, fmtW(s.v)),
        s.max ? h('span', { class: 'smax muted small', title: 'Maximum relevé depuis que le service tourne' }, 'max ' + fmtW(s.max)) : h('span')),
      h('div', { class: 'pwbar' }, h('i', { style: `width:${total ? Math.max(2, s.v / total * 100) : 0}%` }))))),
    h('div', { class: 'muted small' }, `Le PC entier tire environ ${wall} W à la prise (estimation : carte mère, mémoire, disques, ventilateurs et pertes de l’alimentation ne sont pas mesurés).`));
}

function sensIntro() {
  const i = sensLast?.info || {};
  if (!NATIVE) return h('div', { class: 'card' }, 'Les températures ne s’affichent que dans l’appli PeriphHub.');
  if (i.module === false) return h('div', { class: 'card' }, 'Le module capteurs manque dans cette version de PeriphHub. Réinstallez la dernière version.');
  return h('div', { class: 'card sintro' },
    h('strong', {}, 'Voir les températures de votre PC'),
    h('p', { class: 'muted' }, 'Processeur, carte mère (sondes et ventilateurs), carte graphique et disques, avec la consommation électrique en direct. Windows réserve ces capteurs aux administrateurs : '
      + 'PeriphHub installe une fois pour toutes un petit service (LibreHardwareMonitor et le pilote signé PawnIO). '
      + 'Il ne démarre que quand cette page est ouverte et s’arrête tout seul ensuite. Il ne change rien tant que vous ne réglez pas vous-même un ventilateur.'),
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
      const power = sensPowerCard(hw);
      if (power) parts.push(power);
      if (cards.length) parts.push(h('div', { class: 'sgrid' }, cards));
      else parts.push(h('div', { class: 'card' }, 'Aucun capteur lisible sur ce PC. Envoyez un diagnostic (Options) : il dit quelles puces ont été trouvées.'));
      if (v.info && !v.info.pawnio) parts.push(h('div', { class: 'card warn' }, 'Le pilote PawnIO n’est pas installé : le processeur et la carte mère restent illisibles. ',
        h('button', { disabled: sensBusy, onclick: () => sensAdmin('install') }, 'Réinstaller')));
    }
    const foot = h('div', { class: 'muted small sfoot' }, 'Mesures relues toutes les 2 secondes. ',
      h('button', { class: 'ghost', disabled: sensBusy, onclick: () => sensAdmin('uninstall') }, 'Retirer l’accès aux capteurs'));
    // Sous les ventilateurs (#fanCtl) ; la version perso range elle-même le pied de page
    if ($('tempsFoot') && typeof fcPerso === 'function' && !fcPerso()) $('tempsFoot').replaceChildren(foot); else parts.push(foot);
  }
  if (!v?.installed && $('tempsFoot')) $('tempsFoot').replaceChildren();
  body.replaceChildren(...parts);
  if (typeof fcRender === 'function') fcRender(v);
  const sub = $('tempsSub');
  const cpu = v?.hw?.find(x => x.k === 'Cpu');
  const t = cpu && sensMain(cpu);
  const w = (v?.hw || []).filter(x => !sensIgpu(x)).reduce((a, x) => a + (sensPower(x)?.v || 0), 0);
  if (sub) sub.textContent = t ? 'Processeur ' + fmtT(t.v) + (w ? ' · ' + fmtW(w) : '') : (v?.installed ? 'Activé' : 'Désactivé');
}

async function sensorsPoll() {
  clearTimeout(sensTimer);
  if (!NATIVE) { renderSensors(); return; }
  // Fenêtre fermée (PeriphHub près de l'horloge) avec cette page restée ouverte : plus aucune lecture,
  // sinon le service des capteurs et son pilote ne s'arrêteraient jamais. Reprise au retour de la fenêtre.
  if (document.hidden) return;
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
    const pw = sensPower(hw);
    const pws = hw.s.filter(s => s.k === 'Power' && !/^Core #\d/i.test(s.n)).map(s => `${s.n} ${Math.round(s.v ?? -1)}`).slice(0, 6).join(', ');
    lines.push(`  ${hw.k} « ${hw.n} »${hw.p ? ' (sous ' + hw.p + ')' : ''} : ${n('Temperature')} temp., ${n('Fan')} ventil., ${n('Control')} commandes, ${n('Power')} conso.`
      + (temps ? ` · ${temps}` : '') + (fans ? ` · ventilateurs ${fans}` : '')
      + (pws ? ` · watts ${pws}${pw ? ' (retenu : ' + pw.n + ')' : ' (aucun retenu)'}` : ''));
  }
  if (typeof fcDiag === 'function') lines.push(...fcDiag(v));
  return lines;
}

$('temps') && (() => {
  // Page quittée : plus aucune lecture (l'ouverture est gérée par showTab, js/shell.js)
  new MutationObserver(() => { if ($('temps').hidden) clearTimeout(sensTimer); })
    .observe($('temps'), { attributes: true, attributeFilter: ['hidden'] });
  // Fenêtre cachée puis rouverte sur cette page : les lectures s'arrêtent puis reprennent
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(sensTimer);
    else if (!$('temps').hidden) sensorsPoll();
  });
  // Sous-titre de la barre latérale, sans démarrer le service
  if (NATIVE) nativeInvoke('sensors_info').then(i => {
    if (!sensLast) $('tempsSub').textContent = i?.service && i.service !== 'absent' ? 'Activé' : 'Désactivé';
  }).catch(() => {});
})();
