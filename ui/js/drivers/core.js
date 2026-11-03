// PeriphHub — pilotes génériques (familles entières d'appareils : Logitech HID++, Razer…).
//
// Un pilote décrit ce que sait faire l'appareil (ses « capacités ») ; la page de réglages est
// construite à partir de là. Ajouter une marque = écrire un pilote, pas une page.
//
//   registerDriver({
//     id: 'logitech-hidpp',                       // = champ "plugin" de data/devices.json
//     match: dev => bool,                          // interfaces HID que le pilote sait ouvrir
//     connect: async (dev, group) => [instance],   // group : toutes les interfaces du même appareil
//   })
//
//   instance = {
//     key, name, kind ('souris' | 'clavier' | 'casque' | …), meta (texte), dev,
//     state: { battery?: {level, charging}, dpi?, dpiList?, rate?, rates?, wheel?, light?… },
//     caps: { battery, dpi: {min, max, step, presets}, rate: [Hz], smartshift, hires, invert,
//             light: {effects, color, brightness} },
//     refresh(), set(capacité, valeur), note? (avertissement propre au modèle)
//   }
//
// Chaque réglage est écrit tout de suite dans l'appareil. Avant la première modification,
// l'état d'origine est gardé (localStorage) pour « Remettre d'origine ».

const DRIVERS = [];
const drvLive = new Map(); // clé → instance connectée
const drvBusy = new Set(); // chemins HID en cours d'ouverture ou déjà pris

function registerDriver(d) { DRIVERS.push(d); }

const hex4 = n => n.toString(16).toUpperCase().padStart(4, '0');
const devId = dev => hex4(dev.vendorId) + ':' + hex4(dev.productId);

// Appareils dont une page dédiée s'occupe déjà (js/devices.js) : jamais pris par un pilote générique
const DEDICATED = new Set(['3554:F5F7', '3554:F5F6', '373B:1194', '1532:0565', '1532:056E', '048D:5702']);

const KIND_ICON_TAB = { souris: 'mouse', clavier: 'keyboard', casque: 'headset', rgb: 'rgb' };
const KIND_NAME = { souris: 'Souris', clavier: 'Clavier', casque: 'Casque', rgb: 'Éclairage', micro: 'Micro', audio: 'Son', webcam: 'Webcam', manette: 'Manette', autre: 'Appareil' };

// ---------- Connexion automatique ----------

let drvScanning = false;
const drvErrors = new Map(); // « VID:PID » → derniers échecs de pilotes (pour les signalements)
const drvRetry = new Map();  // « VID:PID » → { n essais ratés, at : prochain essai } (appareils muets)

// ---------- Signalement : diagnostic technique, sans numéro de série ni chemin ----------
async function deviceDiag(vid, pid, extra = []) {
  const id = (vid + ':' + pid).toUpperCase();
  const hex = n => '0x' + Number(n).toString(16).toUpperCase().padStart(4, '0');
  const ifs = ('hid' in navigator ? await navigator.hid.getDevices().catch(() => []) : []).filter(d => devId(d) === id);
  const ids = (cs, k) => [...new Set(hidAllCollections(cs || []).flatMap(c => (c[k] || []).map(r => r.reportId)))].join(',') || '-';
  const lines = [`USB ${id}`, `PeriphHub ${report?.version || '?'} · ${navigator.userAgent.match(/Windows NT [\d.]+/)?.[0] || 'Windows'}`];
  const cat = (await catalog).find(c => (c.vid + ':' + c.pid).toUpperCase() === id);
  if (cat) lines.push(`Catalogue : ${cat.name} · ${cat.status}${cat.via ? ' (' + cat.via + ')' : ''} · sources ${cat.src.join(', ')}`);
  else lines.push('Absent du catalogue');
  const live = [...drvLive.values()].find(i => i.dev && devId(i.dev) === id);
  if (live) lines.push(`Pilote connecté : ${live.driver?.id || '?'} · réglages ${Object.keys(live.caps || {}).join(', ') || 'aucun'}`);
  for (const e of drvErrors.get(id) || []) lines.push('Échec ' + e);
  for (const d of ifs) {
    const cs = d.parsed || d.collections;
    lines.push(`Interface ${d.info?.interface ?? '?'} · page ${hex(d.info?.usage_page ?? cs?.[0]?.usagePage ?? 0)} usage ${hex(d.info?.usage ?? cs?.[0]?.usage ?? 0)} · rapports entrée ${ids(cs, 'inputReports')} sortie ${ids(cs, 'outputReports')} fonction ${ids(cs, 'featureReports')}`);
  }
  if (!ifs.length) lines.push('Aucune interface HID accessible à PeriphHub');
  return [...lines, ...extra].join('\n');
}

// Diagnostic de tout le PC, pour « Un appareil manque ou ne marche pas ? » : chaque appareil USB
// branché (sans numéro de série ni chemin), ce que PeriphHub en sait et pourquoi il ne l'a pas connecté.
async function globalDiag() {
  const lines = [`PeriphHub ${report?.version || '?'} · ${navigator.userAgent.match(/Windows NT [\d.]+/)?.[0] || 'Windows'}`];
  if (!report) lines.push('Analyse non terminée');
  if (report?.hid_blocked || nativeHid.blocked) lines.push('Liste USB bloquée par un appareil qui ne répond pas');
  const ifs = 'hid' in navigator ? await navigator.hid.getDevices().catch(e => (lines.push('Liste HID : ' + e), [])) : [];
  lines.push(`${(report?.devices || []).length} appareils USB/HID à l’analyse, ${ifs.length} interfaces HID accessibles`);
  const devs = (report?.devices || []).slice().sort((a, b) => (a.status === 'unknown') - (b.status === 'unknown'));
  let hidden = 0;
  for (const d of devs) {
    const id = d.vid + ':' + d.pid;
    if (d.status === 'unknown' && !['souris', 'clavier', 'casque', 'manette'].includes(d.kind)) { hidden++; continue; }
    const live = [...drvLive.values()].find(i => i.dev && devId(i.dev) === id);
    const n = ifs.filter(x => devId(x) === id).length;
    lines.push(`- ${id} ${d.product || d.catalog_name || '?'} · ${d.kind} · ${d.status}${d.plugin ? ' (' + d.plugin + ')' : ''} · ${n} interfaces`
      + (live ? ` · connecté (${live.driver?.id || '?'})` : ''));
    for (const e of drvErrors.get(id) || []) lines.push('  échec ' + e);
  }
  if (hidden) lines.push(`(+ ${hidden} autres appareils sans réglages : hubs, puces internes…)`);
  if (typeof hsStatus !== 'undefined') lines.push('Module casques : ' + hsStatus);
  lines.push('OpenRGB : ' + (typeof orgbInst !== 'undefined' && orgbInst ? orgbInst.state.list.length + ' appareils' : 'non joignable (lancé avec « Serveur SDK » ?)'));
  // Interfaces HID vues par Windows et sort de chacune : dit si la liste est vide, refusée, bloquée ou filtrée
  if (NATIVE) {
    const shown = new Set(devs.map(d => d.vid + ':' + d.pid));
    const hx = n => Number(n).toString(16).toUpperCase().padStart(4, '0');
    try {
      const probe = await nativeInvoke('hid_probe');
      lines.push(`Interfaces HID vues par Windows : ${probe.length}`);
      for (const p of probe.filter(p => shown.has(hx(p.vid) + ':' + hx(p.pid))))
        lines.push(`  ${hx(p.vid)}:${hx(p.pid)} MI ${p.interface} · page 0x${hx(p.usage_page)} usage 0x${hx(p.usage)} · ${p.state}`);
    } catch (e) { lines.push('Interfaces HID : ' + e); }
  }
  return lines.join('\n');
}

// Diagnostic complet, à coller tel quel dans Discord (ou n'importe quelle messagerie) :
// pas besoin de compte GitHub. Sans numéro de série ni chemin de périphérique.
async function fullDiag(onlyId) {
  const parts = [];
  if (!onlyId) parts.push(await globalDiag());
  const ids = onlyId ? [onlyId] : [...new Set((report?.devices || [])
    .filter(d => d.status !== 'unknown' || ['souris', 'clavier', 'casque', 'manette', 'rgb'].includes(d.kind))
    .map(d => d.vid + ':' + d.pid))];
  for (const id of ids) {
    const [vid, pid] = id.split(':');
    parts.push((await deviceDiag(vid, pid)).split('\n').filter((l, i) => !(i === 1 && /^PeriphHub /.test(l))).join('\n'));
  }
  const log = (typeof nativeHid !== 'undefined' ? nativeHid.log : [])
    .filter(l => !onlyId || l.includes(onlyId) || /OpenMouse|HID\+\+|Logitech/i.test(l)).slice(-25);
  if (log.length) parts.push('Journal :\n' + log.join('\n'));
  if (onlyId) parts.unshift(`PeriphHub ${report?.version || '?'}`);
  return '```\n' + parts.join('\n\n').replace(/```/g, "'''") + '\n```';
}

async function copyDiag(onlyId) {
  try {
    await navigator.clipboard.writeText(await fullDiag(onlyId));
    toast('Diagnostic copié : collez-le dans un message Discord (Ctrl+V) et envoyez-le.', 'ok');
  } catch (e) {
    toast('Copie impossible : ' + (e.message || e), 'err');
  }
}

async function reportProblem() {
  try {
    await nativeInvoke('report_device', { model: 'Appareil manquant ou qui ne marche pas', version: report?.version || '', report: await globalDiag() });
    toast('Formulaire ouvert dans le navigateur : dites quels appareils vous avez et ce qui ne marche pas, puis publiez.', 'ok');
  } catch (e) {
    toast('Erreur : ' + (e.message || e), 'err');
  }
}

// Ouvre le formulaire GitHub prérempli : l'utilisateur relit et publie lui-même
async function reportDevice(name, vid, pid) {
  try {
    await nativeInvoke('report_device', { model: name, version: report?.version || '', report: await deviceDiag(vid, pid) });
    toast('Formulaire ouvert dans le navigateur : dites ce qui marche ou pas, puis publiez.', 'ok');
  } catch (e) {
    toast('Erreur : ' + (e.message || e), 'err');
  }
}
async function driversScan() {
  if (!('hid' in navigator) || drvScanning) return;
  drvScanning = true;
  try {
    const all = await navigator.hid.getDevices();
    const groups = new Map();
    for (const d of all) {
      if (DEDICATED.has(devId(d))) continue;
      if (!groups.has(devId(d))) groups.set(devId(d), []);
      groups.get(devId(d)).push(d);
    }
    // Pilotes essayés du plus précis au plus général : le premier qui répond garde l'appareil
    const order = DRIVERS.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
    for (const [id, group] of groups) {
      if (group.some(d => drvBusy.has(d.info?.path))) continue;
      const retry = drvRetry.get(id);
      if (retry && Date.now() < retry.at) continue;
      const candidates = order.filter(x => { try { return group.some(x.match); } catch { return false; } });
      if (!candidates.length) {
        // Rien ne correspond : on le note quand même, sinon le diagnostic reste muet
        if (!drvErrors.has(id)) drvErrors.set(id, ['aucun pilote ne correspond à ses interfaces']);
        continue;
      }
      group.forEach(d => drvBusy.add(d.info?.path));
      drvErrors.delete(id);
      let ok = false, waiting = false;
      for (const drv of candidates) {
        const t0 = Date.now();
        try {
          const list = await drv.connect(group.find(drv.match), group).catch(e => {
            throw Object.assign(e instanceof Error ? e : new Error(String(e)), { ms: Date.now() - t0 });
          });
          if (!list?.length) throw new Error('aucune réponse');
          for (const inst of list) drvAdd(inst, drv);
          ok = true;
          break;
        } catch (e) {
          console.warn('[PeriphHub] pilote', drv.id, devId(group[0]), e.message);
          drvErrors.set(id, [...(drvErrors.get(id) || []), `${drv.id} : ${e.message}${e.ms != null ? ` (${(e.ms / 1000).toFixed(1)} s)` : ''}`].slice(-8));
          // Le pilote garde l'appareil ouvert et attend qu'il se réveille (souris sans fil en veille
          // derrière son récepteur) : ne rien essayer d'autre, il s'ajoutera lui-même
          if (e.waiting) { waiting = true; break; }
        }
      }
      if (ok || waiting) { drvRetry.delete(id); continue; }
      // Aucun pilote n'a eu de réponse : souvent un appareil sans fil éteint ou en veille.
      // Nouvel essai plus tard (1 min, puis de plus en plus espacé, au plus toutes les 10 min)
      const n = (retry?.n || 0) + 1;
      drvRetry.set(id, { n, at: Date.now() + Math.min(600000, 60000 * 2 ** (n - 1)) });
      group.forEach(d => drvBusy.delete(d.info?.path));
    }
  } finally {
    drvScanning = false;
  }
}

function drvRelease(dev, quiet = false) {
  for (const [key, inst] of drvLive) {
    if (inst.dev !== dev && !inst.devs?.includes(dev)) continue;
    drvLive.delete(key);
    const visible = $(key) && !$(key).hidden;
    document.querySelector(`nav [data-tab="${CSS.escape(key)}"]`)?.remove();
    $(key)?.remove();
    if (visible) showTab('home');
    if (!quiet) toast(`${inst.name} débranché`);
  }
  drvBusy.delete(dev.info?.path);
  refreshHome();
}

// ---------- Page de l'appareil ----------

function drvAdd(inst, drv) {
  inst.driver = drv;
  drvLive.set(inst.key, inst);
  const tab = KIND_ICON_TAB[inst.kind];
  const icon = tab ? document.querySelector(`nav [data-tab="${tab}"] svg`).cloneNode(true) : kindIcon(inst.kind);
  const nb = h('button', { 'data-tab': inst.key, onclick: () => showTab(inst.key) }, icon,
    h('span', { class: 'nl' }, KIND_NAME[inst.kind] || 'Appareil', h('small', { title: inst.name }, inst.name)),
    h('span', { class: 'dot ok' }));
  document.querySelector('nav .nfoot').before(nb);
  $('devGroup').hidden = false;
  document.querySelector('main').append(h('section', { class: 'page', id: inst.key, hidden: true },
    h('header', { class: 'phead' },
      h('div', { class: 'ptitle' }, h('h2', {}, inst.name), h('div', { class: 'muted small drvmeta' })),
      h('div', { class: 'pact' }, h('span', { class: 'status drvstatus' }), inst.chip ? h('span', { class: 'chip supported', title: inst.chip.title }, inst.chip.text) : h('span', { class: 'chip experimental', title: 'Pilote pas encore confirmé sur ce modèle précis' }, 'Expérimental'))),
    h('div', { class: 'pbody drvbody' })));
  drvRender(inst);
  refreshHome();
  if (!inst.chip) audioPoll(); // un casque HID peut accueillir ses réglages son Windows
}

function drvStatus(inst, text, kind = '') {
  const el = $(inst.key)?.querySelector('.drvstatus');
  if (el) { el.textContent = text; el.className = 'status drvstatus ' + kind; }
  if (kind === 'err' || (kind === 'ok' && text)) toast(text, kind);
}

const origKey = inst => 'orig:' + inst.key;
const wantKey = inst => 'want:' + inst.key;
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// Réglages choisis dans PeriphHub, réappliqués au branchement (appareils sans mémoire intégrée)
async function drvReapply(inst) {
  const want = lsGet(wantKey(inst));
  if (!want) return;
  for (const [cap, v] of Object.entries(want)) {
    if (!inst.caps[cap] || JSON.stringify(inst.state[cap]) === JSON.stringify(v)) continue;
    try { await inst.set(cap, v); } catch (e) { console.warn('[PeriphHub] réapplication', inst.key, cap, e.message); }
  }
  await inst.refresh().catch(() => {});
}
const drvOrigin = inst => lsGet(origKey(inst));

async function drvSet(inst, label, cap, value) {
  // État d'origine gardé avant la toute première modification
  if (!drvOrigin(inst)) {
    lsSet(origKey(inst), { date: Date.now(), state: structuredClone(inst.state) });
  }
  drvStatus(inst, label + '…');
  try {
    await inst.set(cap, value);
    lsSet(wantKey(inst), { ...lsGet(wantKey(inst)), [cap]: value });
    await inst.refresh();
    drvStatus(inst, label + ' ✔', 'ok');
  } catch (e) {
    console.error('[PeriphHub]', e);
    drvStatus(inst, 'Erreur : ' + e.message, 'err');
  }
  drvRender(inst);
}

async function drvRestore(inst) {
  const o = drvOrigin(inst);
  if (!o) return;
  drvStatus(inst, 'Retour aux réglages d’origine…');
  try {
    for (const cap of ['dpi', 'rate', 'smartshift', 'hires', 'invert', 'light', ...(inst.restoreCaps || [])]) {
      if (o.state[cap] != null && inst.caps[cap] && JSON.stringify(o.state[cap]) !== JSON.stringify(inst.state[cap])) await inst.set(cap, structuredClone(o.state[cap]));
    }
    await inst.refresh();
    lsSet(origKey(inst), null);
    lsSet(wantKey(inst), null);
    drvStatus(inst, 'Réglages d’origine remis', 'ok');
  } catch (e) {
    drvStatus(inst, 'Erreur : ' + e.message, 'err');
  }
  drvRender(inst);
}

const SWATCHES = ['#ff2a2a', '#ff7a00', '#ffd400', '#2bff4f', '#00e5ff', '#2a5bff', '#a020ff', '#ff3ccf', '#ffffff'];
const LIGHT_LABEL = { off: 'Éteint', static: 'Fixe', spectrum: 'Cycle de couleurs', breathing: 'Respiration' };

function drvRender(inst) {
  if (inst.embed) return inst.embed(); // réglages intégrés à la page d'un autre appareil (son d'un casque HID)
  const sec = $(inst.key);
  if (!sec) return;
  const s = inst.state, c = inst.caps;
  sec.querySelector('.drvmeta').textContent = [
    s.battery ? (s.battery.label || `Batterie ${s.battery.level} %${s.battery.charging ? ' (en charge)' : ''}`) : null, inst.meta].filter(Boolean).join(' · ');
  const box = sec.querySelector('.drvbody');
  const rows = [];
  if (c.dpi && s.dpi != null) {
    const d = c.dpi;
    rows.push(field('Sensibilité (DPI)',
      h('div', { class: 'row-inline' }, ...(d.presets || []).filter(p => p >= d.min && p <= d.max).map(p =>
        h('button', { class: 'mini ' + (p === s.dpi ? '' : 'ghost'), onclick: () => p !== s.dpi && drvSet(inst, `${p} DPI`, 'dpi', p) }, String(p)))),
      slider(d.min, d.max, d.step, s.dpi, ' DPI', v => drvSet(inst, `${v} DPI`, 'dpi', v)),
      h('div', { class: 'muted small' }, `De ${d.min} à ${d.max} DPI, par pas de ${d.step}.`)));
  }
  if (c.rate?.length && s.rate) {
    rows.push(field('Fréquence d’interrogation',
      segmented(c.rate.map(r => ({ v: r, label: r >= 1000 ? (r / 1000) + ' kHz' : r + ' Hz' })), s.rate, v => drvSet(inst, `${v} Hz`, 'rate', v)),
      h('div', { class: 'muted small' }, 'Plus elle est haute, plus le curseur est fluide (et plus la batterie s’use vite).')));
  }
  const wheel = [];
  if (c.smartshift && s.smartshift) wheel.push(toggle('Molette crantée (SmartShift)', s.smartshift.mode === 2, on => drvSet(inst, 'Molette', 'smartshift', { ...s.smartshift, mode: on ? 2 : 1 })));
  if (c.hires && s.hires != null) wheel.push(toggle('Défilement haute résolution', s.hires, on => drvSet(inst, 'Défilement', 'hires', on)));
  if (c.invert && s.invert != null) wheel.push(toggle('Défilement inversé', s.invert, on => drvSet(inst, 'Défilement', 'invert', on)));
  if (wheel.length) rows.push(field('Molette', h('div', { class: 'toggles' }, wheel)));
  if (c.light && s.light) {
    const l = s.light;
    rows.push(field('Éclairage',
      segmented(c.light.effects.map(v => ({ v, label: c.light.labels?.[v] || LIGHT_LABEL[v] || v })), l.effect, v => drvSet(inst, 'Éclairage', 'light', { ...l, effect: v })),
      c.light.color && l.effect === 'static' ? h('div', { class: 'row-inline' },
        SWATCHES.map(col => h('button', { class: 'swatch' + (col === l.color ? ' on' : ''), style: `background:${col}`, title: col,
          onclick: () => drvSet(inst, 'Couleur', 'light', { ...l, color: col }) })),
        h('input', { type: 'color', value: l.color || '#ffffff', onchange: e => drvSet(inst, 'Couleur', 'light', { ...l, color: e.target.value }) })) : null,
      c.light.brightness && l.brightness != null ? slider(0, 100, 1, l.brightness, ' %', v => drvSet(inst, 'Luminosité', 'light', { ...l, brightness: v })) : null));
  }
  if (inst.rows) rows.push(...inst.rows().filter(Boolean));
  if (!inst.chip) rows.push(...audioEmbedRows(inst.dev));
  if (!rows.length) rows.push(h('p', { class: 'muted' }, 'Aucun réglage reconnu sur ce modèle pour l’instant. Ouvrez un ticket sur GitHub avec le rapport (page Allègement) : c’est comme ça que la prise en charge s’étend.'));
  const o = drvOrigin(inst);
  box.replaceChildren(...rows,
    // replaceChildren écrirait « null » en texte : pas d'élément vide ici
    ...(inst.note ? [h('div', { class: 'notice' }, h('p', { class: 'muted small' }, inst.note))] : []),
    h('div', { class: 'field' }, h('div', { class: 'flabel' }, 'Sécurité'), h('div', { class: 'fctl' },
      h('div', { class: 'muted small' }, inst.source || ('Pilote expérimental : réécrit à partir de projets libres (Solaar, OpenRazer…), pas encore confirmé sur ce modèle. ' +
        'Les réglages d’origine sont gardés avant la première modification.')),
      o && !inst.noOrigin ? h('button', { class: 'ghost', onclick: () => drvRestore(inst) }, `Remettre les réglages du ${new Date(o.date).toLocaleDateString(LOCALE)}`) : null,
      NATIVE && inst.dev ? h('button', { class: 'ghost', title: 'À coller dans un message (Discord…) pour dire si ça marche ou pas', onclick: () => copyDiag(devId(inst.dev)) }, 'Copier le diagnostic') : null)));
}

// ---------- Accueil ----------

function driverTiles() {
  return [...drvLive.values()].map(inst => {
    const s = inst.state;
    const stats = [];
    if (s.battery) stats.push(['Batterie', s.battery.level + ' %' + (s.battery.charging ? ' ⚡' : '')]);
    if (s.dpi) stats.push(['DPI', String(s.dpi)]);
    if (s.rate) stats.push(['Fréquence', s.rate + ' Hz']);
    return tile(inst.key, inst.name, true, inst.chip ? 'Connecté · ' + inst.chip.text : 'Connecté · expérimental', stats, s.battery ? meter(s.battery.level) : null);
  });
}

const driverHas = (vid, pid) => [...drvLive.values()].some(i => devId(i.dev) === vid + ':' + pid);

// Batterie relue toutes les 2 minutes (fenêtre visible)
setInterval(() => {
  if (document.hidden) return;
  for (const inst of drvLive.values()) inst.refreshBattery?.().then(() => drvRender(inst), () => {});
  refreshHome();
}, 120000);

function driversStart() {
  // Nouveau branchement : on retente tout de suite, y compris les appareils restés muets
  navigator.hid?.addEventListener('connect', () => { drvRetry.forEach(r => { r.at = 0; }); driversScan(); });
  // Appareils muets (sans fil en veille…) : nouvel essai quand leur délai est passé, fenêtre visible
  setInterval(() => {
    if (!document.hidden && [...drvRetry.values()].some(r => Date.now() >= r.at)) driversScan();
  }, 30000);
  navigator.hid?.addEventListener('disconnect', e => drvRelease(e.device));
  driversScan();
  if (typeof headsetsPoll === 'function') headsetsPoll();
  if (typeof openrgbPoll === 'function') openrgbPoll();
  if (typeof mediaPoll === 'function') mediaPoll();
}
