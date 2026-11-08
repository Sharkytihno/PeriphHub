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
const KIND_NAME = { souris: 'Souris', clavier: 'Clavier', casque: 'Casque', rgb: 'Éclairage', micro: 'Micro', audio: 'Son', webcam: 'Webcam', manette: 'Manette', refroidissement: 'Watercooling', autre: 'Appareil' };

// ---------- Connexion automatique ----------

let drvScanning = false;
const drvErrors = new Map(); // « VID:PID » → derniers échecs de pilotes (pour les signalements)
const drvRetry = new Map();  // « VID:PID » → { n essais ratés, at : prochain essai } (appareils muets)

// ---------- Signalement : diagnostic technique, sans numéro de série ni chemin ----------
// Objectif : un seul diagnostic suffit à corriger (système réel, ce que chaque pilote a tenté, échecs
// de réglage, état des échanges avec Windows, derniers rapports échangés avec l'appareil en cause).

const diagJson = (v, max) => {
  let s = '';
  try { s = JSON.stringify(v, (k, x) => typeof x === 'number' && !Number.isInteger(x) ? Math.round(x * 100) / 100 : x) || ''; } catch { s = '?'; }
  return s.length > max ? s.slice(0, max) + '…' : s;
};

// Système réel (Windows 10 ou 11, build), WebView2, version Store ou installeur, droits, Smart App
// Control, arrière-plan, erreurs internes : la WebView annonce « Windows NT 10.0 » même sous Windows 11
async function sysDiag() {
  const lines = [];
  let s = null;
  if (NATIVE) try { s = await nativeInvoke('sys_info'); } catch (e) { lines.push('Infos système indisponibles : ' + (e?.message || e)); }
  const o = s?.os || {};
  lines.unshift(`PeriphHub ${s?.periphhub || report?.version || '?'}${s ? (s.store ? ' (Microsoft Store)' : ' (installeur)') : ''} · `
    + (o.name ? `${o.name} ${o.version || ''} build ${o.build}`.replace(/\s+/g, ' ') : navigator.userAgent.match(/Windows NT [\d.]+/)?.[0] || 'Windows ?')
    + (o.arch ? ' · ' + o.arch : '') + (s?.admin ? ' · lancé en administrateur' : ''));
  if (s) lines.push(`WebView2 ${s.webview2} · Smart App Control : ${s.smart_app_control} · avis de Windows : ${s.notify}`);
  // Matériel (modèles, sans numéro de série) : dit quelles puces de capteurs attendre
  const hw = s?.hardware;
  if (hw) lines.push(`Carte mère : ${hw.board || '?'}${hw.system && hw.system !== hw.board ? ' · système ' + hw.system : ''}${hw.bios ? ' · BIOS ' + hw.bios : ''}`
    + ` · processeur : ${hw.cpu || '?'} · graphique : ${(hw.gpus || []).join(', ') || '?'}`);
  if (typeof sensorsDiag === 'function') try { lines.push(...await sensorsDiag()); } catch (e) { lines.push('Capteurs : ' + (e?.message || e)); }
  const bg = typeof bgInfo !== 'undefined' ? bgInfo : null;
  const up = Math.round(performance.now() / 60000);
  lines.push(`Ouvert depuis ${up >= 60 ? Math.floor(up / 60) + ' h ' : ''}${up % 60} min${bg?.hidden_start ? ' (lancé avec Windows)' : ''}`
    + (bg?.autostart ? ` · démarrage avec Windows : ${bg.autostart}` : '')
    + (typeof bgKeep === 'function' ? ` · fermeture : ${bgKeep() ? 'zone de notification' : 'quitte'}` : '')
    + ` · fenêtre ${document.hidden ? 'cachée' : 'visible'} · langue ${navigator.language}${typeof LANG !== 'undefined' && LANG !== 'fr' ? ' (interface ' + LANG + ')' : ''}`);
  // Réglages Windows de la souris : souvent en cause quand « le curseur accélère » ou « va trop vite »
  const wi = typeof inputInst !== 'undefined' ? inputInst?.state : null;
  if (wi?.speed != null) lines.push(`Souris (Windows) : vitesse ${wi.speed}/20 · accélération ${wi.precision ? 'activée' : 'coupée'}`
    + ` · molette ${wi.lines === 4294967295 ? 'un écran' : wi.lines + ' lignes'} · double-clic ${wi.dblclick} ms${wi.swap ? ' · boutons inversés' : ''}`
    + ` · clavier : délai ${wi.kbdelay}, vitesse ${wi.kbspeed}`);
  // Batteries Bluetooth : type et niveau seulement (le nom peut contenir celui du propriétaire)
  if (typeof btLast !== 'undefined' && btLast.length) lines.push('Batteries Bluetooth : ' + btLast.map(b => `${b.kind} ${b.level} %`).join(', '));
  if (typeof batAlertOn === 'function') lines.push(`Alerte de batterie faible : ${batAlertOn() ? 'activée' : 'désactivée'} · notifications Windows : ${notifState || 'non lues'}`);
  if (s?.errors?.length) lines.push('Erreurs internes récentes (erreurs.log) :', ...s.errors.map(l => '  ' + l));
  return lines;
}

async function deviceDiag(vid, pid, { trace = false, probe } = {}) {
  const id = (vid + ':' + pid).toUpperCase();
  const hex = n => '0x' + Number(n).toString(16).toUpperCase().padStart(4, '0');
  const ifs = ('hid' in navigator ? await navigator.hid.getDevices().catch(() => []) : []).filter(d => devId(d) === id);
  if (probe === undefined) probe = NATIVE ? await nativeInvoke('hid_probe').catch(() => null) : null;
  // ID et taille (octets, sans l'ID) de chaque rapport : de quoi écrire un pilote sans le matériel
  const ids = (cs, k) => {
    const m = new Map();
    for (const c of hidAllCollections(cs || [])) for (const r of c[k] || []) {
      const bits = (r.items || []).reduce((n, it) => n + (it.reportSize || 0) * (it.reportCount || 0), 0);
      m.set(r.reportId, Math.max(m.get(r.reportId) || 0, bits));
    }
    return [...m].map(([id, bits]) => '0x' + id.toString(16).toUpperCase().padStart(2, '0') + (bits ? `(${Math.ceil(bits / 8)}o)` : '')).join(',') || '-';
  };
  const lines = [`USB ${id}`];
  // `catalog` = data/devices.json (appareils pris en charge, sans sources) ; le catalogue des projets
  // libres (data/catalog.json : nom, statut, sources) arrive par le rapport d'analyse
  const sup = (await catalog).find(c => (c.vid + ':' + c.pid).toUpperCase() === id);
  const rep = (report?.devices || []).find(d => (d.vid + ':' + d.pid).toUpperCase() === id);
  const via = sup?.plugin || rep?.plugin;
  const src = Array.isArray(rep?.sources) ? rep.sources : [];
  if (sup || rep?.catalog_name) lines.push(`Catalogue : ${sup?.name || rep.catalog_name} · ${rep?.status || sup?.status || '?'}`
    + (via ? ` (${via})` : '') + (src.length ? ' · sources ' + src.join(', ') : ''));
  else lines.push('Absent du catalogue');
  // Un récepteur peut porter plusieurs appareils (Logitech Unifying / Lightspeed…)
  const lives = [...drvLive.values()].filter(i => i.dev && devId(i.dev) === id);
  for (const live of lives) {
    lines.push(`Pilote connecté : ${live.driver?.id || '?'} · ${live.name} · réglages ${Object.keys(live.caps || {}).join(', ') || 'aucun'}${live.off ? ' · éteint' : ''}`);
    if (live.meta) lines.push('  ' + live.meta);
    lines.push('  état ' + diagJson(live.state, 600));
    const want = lsGet(wantKey(live));
    if (want) lines.push('  choisi dans PeriphHub ' + diagJson(want, 400));
  }
  for (const e of drvFails.get(id) || []) lines.push('Échec ' + e);
  for (const e of drvErrors.get(id) || []) lines.push('Échec de connexion ' + e);
  const retry = drvRetry.get(id);
  if (retry) lines.push(`Appareil muet : ${retry.n} essai(s) sans réponse, prochain dans ${Math.max(0, Math.round((retry.at - Date.now()) / 1000))} s`);
  for (const d of ifs) {
    const cs = d.parsed || d.collections;
    const page = d.info?.usage_page ?? cs?.[0]?.usagePage ?? 0;
    const p = probe?.find(p => p.vid === d.vendorId && p.pid === d.productId && p.interface === d.info?.interface
      && p.usage_page === d.info?.usage_page && p.usage === d.info?.usage);
    lines.push(`Interface ${d.info?.interface ?? '?'} · page ${hex(page)} usage ${hex(d.info?.usage ?? cs?.[0]?.usage ?? 0)} · rapports entrée ${ids(cs, 'inputReports')} sortie ${ids(cs, 'outputReports')} fonction ${ids(cs, 'featureReports')}`
      + (d.parsed ? '' : ' (descripteur non lu)') + (d.opened ? ' · ouverte' : '')
      + (p && !/^ok/.test(p.state) ? ' · ' + p.state : '') + (p?.exchanges ? ' · échanges : ' + p.exchanges : ''));
    // Interfaces constructeur d'un appareil sans pilote : descripteur brut (pas de donnée personnelle)
    const desc = d.info?.descriptor;
    if (!lives.length && page >= 0xFF00 && desc?.length && desc.length <= 400)
      lines.push('  descripteur ' + Array.from(desc, b => b.toString(16).padStart(2, '0')).join(''));
    if (trace && d.trace?.length) lines.push(...d.trace.slice(-25).map(t => '  ⇄ ' + t));
  }
  if (!ifs.length) lines.push('Aucune interface HID accessible à PeriphHub');
  return lines.join('\n');
}

// Diagnostic de tout le PC, pour « Un appareil manque ou ne marche pas ? » : chaque appareil USB
// branché (sans numéro de série ni chemin), ce que PeriphHub en sait et pourquoi il ne l'a pas connecté.
async function globalDiag(probe) {
  const lines = await sysDiag();
  if (!report) lines.push('Analyse non terminée');
  if (report?.hid_blocked || nativeHid.blocked) lines.push('Liste USB bloquée par un appareil qui ne répond pas');
  const ifs = 'hid' in navigator ? await navigator.hid.getDevices().catch(e => (lines.push('Liste HID : ' + e), [])) : [];
  lines.push(`${(report?.devices || []).length} appareils USB/HID à l’analyse, ${ifs.length} interfaces HID accessibles`);
  const devs = (report?.devices || []).slice().sort((a, b) => (a.status === 'unknown') - (b.status === 'unknown'));
  const hidden = [];
  for (const d of devs) {
    const id = d.vid + ':' + d.pid;
    if (d.status === 'unknown' && !['souris', 'clavier', 'casque', 'manette'].includes(d.kind)) { hidden.push(id); continue; }
    const live = [...drvLive.values()].find(i => i.dev && devId(i.dev) === id);
    const n = ifs.filter(x => devId(x) === id).length;
    lines.push(`- ${id} ${d.product || d.catalog_name || '?'} · ${d.kind} · ${d.status}${d.plugin ? ' (' + d.plugin + ')' : ''} · ${n} interfaces`
      + (d.vendor_page === false ? ' · aucune page constructeur (standard)' : '')
      + (live ? ` · connecté (${live.driver?.id || '?'})` : ''));
    for (const e of drvErrors.get(id) || []) lines.push('  échec ' + e);
    for (const e of drvFails.get(id) || []) lines.push('  échec ' + e);
  }
  // Identifiants seulement (pas de nom : un appareil Bluetooth peut porter celui de son propriétaire)
  if (hidden.length) lines.push(`Autres appareils sans réglages (hubs, puces internes…) : ${hidden.join(', ')}`);
  if (typeof hsStatus !== 'undefined') lines.push('Module casques : ' + hsStatus);
  // Son Windows : casques en jack, Bluetooth ou USB (nom des appareils Bluetooth omis : il peut porter celui du propriétaire)
  if (NATIVE && typeof audioGroups === 'function') try {
    const groups = audioGroups(await nativeInvoke('audio_list'));
    lines.push(`Son (Windows) : ${groups.length} appareils`);
    for (const g of groups) {
      const bus = g.eps[0]?.bus || '?';
      lines.push(`  ${bus === 'bluetooth' ? 'appareil Bluetooth' : g.name} · ${g.kind} · ${bus}${g.jack ? ' · prise jack' : ''}${audioPeripheral(g) ? '' : ' · masqué'}`
        + ' · ' + g.eps.map(e => [e.flow === 'capture' ? 'entrée' : 'sortie', AUDIO_FORM[e.form] || e.form, (e.default || []).join('+'),
          typeof jackText === 'function' ? jackText(e) : '', e.boost ? `ampli ${e.boost.db}/${e.boost.max} dB` : '', e.listen ? 'retour micro' : ''].filter(Boolean).join(' ')).join(' ; '));
    }
  } catch (e) { lines.push('Son (Windows) : ' + e); }
  let orgb = null;
  if (NATIVE) try { orgb = await nativeInvoke('openrgb_info'); } catch {}
  lines.push('OpenRGB : ' + (typeof orgbInst !== 'undefined' && orgbInst ? orgbInst.state.list.length + ' appareils'
    : orgb ? (orgb.server ? 'serveur joignable, 0 appareil' : orgb.ours ? 'lancé par PeriphHub, détection en cours' : orgb.running ? 'ouvert SANS serveur SDK' : orgb.installed ? 'installé, fermé' : 'non installé')
    : 'non joignable')
    + (orgb ? (orgb.bundled ? ' · copie livrée intacte' : ' · copie livrée : ' + (orgb.bundledError || 'absente')) + (orgb.ours ? ' · lancé par PeriphHub' : '')
      + ` · service ${orgb.service || '?'}${orgb.serviceStale ? ' (à mettre à jour)' : ''} · PawnIO ${orgb.pawnio ? 'installé' : 'absent'}` : ''));
  // Appareils vus par OpenRGB : sans eux, impossible de savoir lequel ne réagit pas
  if (typeof orgbInst !== 'undefined' && orgbInst) {
    for (const d of orgbInst.state.list)
      lines.push(`  #${d.index} ${d.name} · ${d.kind} · ${d.leds} LED · effet ${d.modes?.[d.active]?.name || '?'} (${(d.modes || []).map(m => m.name).join(', ')})`
        + ((d.zones || []).length ? ' · zones ' + d.zones.map(z => `${z.name} ${z.count}${z.max > z.min ? `/${z.min}-${z.max}` : ''}`).join(', ') : ''));
  }
  if (typeof hsNativeIds !== 'undefined' && hsNativeIds.size) lines.push('Casques en pilote intégré : ' + [...hsNativeIds].join(', '));
  const running = (report?.vendors || []).filter(v => v.bytes > 0).map(v => v.name);
  lines.push('Logiciels constructeurs ouverts : ' + (running.join(', ') || 'aucun'));
  // Interfaces HID vues par Windows et sort de chacune : dit si la liste est vide, refusée, bloquée ou filtrée
  if (NATIVE) {
    const shown = new Set(devs.map(d => d.vid + ':' + d.pid));
    const hx = n => Number(n).toString(16).toUpperCase().padStart(4, '0');
    try {
      if (!probe) probe = await nativeInvoke('hid_probe');
      lines.push(`Interfaces HID vues par Windows : ${probe.length}`);
      for (const p of probe.filter(p => shown.has(hx(p.vid) + ':' + hx(p.pid))))
        lines.push(`  ${hx(p.vid)}:${hx(p.pid)} MI ${p.interface} · page 0x${hx(p.usage_page)} usage 0x${hx(p.usage)} · ${p.state}${p.exchanges ? ' · échanges : ' + p.exchanges : ''}`);
      // Interfaces figées d'appareils absents de la liste : c'est souvent elles qui bloquent les autres
      for (const p of probe.filter(p => !shown.has(hx(p.vid) + ':' + hx(p.pid)) && /bloquée|refusée|illisible|ouverture/.test(p.state)))
        lines.push(`  ${hx(p.vid)}:${hx(p.pid)} ${p.product || '?'} MI ${p.interface} · page 0x${hx(p.usage_page)} · ${p.state}`);
    } catch (e) { lines.push('Interfaces HID : ' + e); }
  }
  return lines.join('\n');
}

// Diagnostic complet, à coller tel quel dans Discord (ou n'importe quelle messagerie) :
// pas besoin de compte GitHub. Sans numéro de série ni chemin de périphérique.
//   onlyId  : un seul appareil (« VID:PID »), sans la liste du PC
//   comment : ce que l'utilisateur dit du problème (en tête du diagnostic)
//   focus   : appareils en cause (« VID:PID ») : en premier, avec leurs derniers échanges
const DIAG_MAX = 36000; // le relais (server/diag-relay) refuse au-delà de 40 000 caractères
async function fullDiag(onlyId, { comment = '', focus = [] } = {}) {
  const head = [];
  const note = String(comment || '').trim().slice(0, 1500);
  if (note) head.push('Message de l’utilisateur :\n' + note.split(/\r?\n/).map(l => '> ' + l).join('\n'));
  const probe = NATIVE ? await nativeInvoke('hid_probe').catch(() => null) : null;
  head.push(onlyId ? (await sysDiag()).join('\n') : await globalDiag(probe));
  const want = new Set([...(focus || []), ...(onlyId ? [onlyId] : [])].map(x => String(x).toUpperCase()));
  const ids = onlyId ? [onlyId.toUpperCase()] : [...new Set([...want, ...(report?.devices || [])
    .filter(d => d.status !== 'unknown' || ['souris', 'clavier', 'casque', 'manette', 'rgb'].includes(d.kind))
    .map(d => (d.vid + ':' + d.pid).toUpperCase())])];
  const devs = [];
  for (const id of ids) {
    const [vid, pid] = id.split(':');
    const hot = want.has(id) || drvErrors.has(id) || drvFails.has(id) || drvRetry.has(id);
    devs.push({ focus: want.has(id), lines: (await deviceDiag(vid, pid, { trace: hot, probe })).split('\n') });
  }
  devs.sort((a, b) => b.focus - a.focus);
  const log = (typeof nativeHid !== 'undefined' ? nativeHid.log : [])
    .filter(l => !onlyId || l.includes(onlyId) || /OpenMouse|HID\+\+|Logitech/i.test(l)).slice(-25);
  const tail = log.length ? ['Journal :\n' + log.join('\n')] : [];
  // Trop long : on retire d'abord les échanges, puis les descripteurs bruts, des appareils hors de cause
  const build = level => [...head, ...devs.map(d => d.lines.filter(l => d.focus
    || !((level >= 1 && l.startsWith('  ⇄ ')) || (level >= 2 && l.startsWith('  descripteur ')))).join('\n')), ...tail].join('\n\n');
  let text = build(0);
  if (text.length > DIAG_MAX) text = build(1);
  if (text.length > DIAG_MAX) text = build(2);
  if (text.length > DIAG_MAX) text = text.slice(0, DIAG_MAX) + '\n… (coupé)';
  return '```\n' + text.replace(/```/g, "'''") + '\n```';
}

async function copyDiag(onlyId, opts) {
  try {
    await navigator.clipboard.writeText(await fullDiag(onlyId, opts));
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
        // Rien ne correspond : on le note quand même, sinon le diagnostic reste muet. Sauf si son éclairage
        // est confié à OpenRGB (carte mère ASUS Aura…) : aucun pilote maison n'est attendu, ce n'est pas un
        // échec (l'accueil affichait « Dernier essai : aucun pilote… » sous « réglable avec OpenRGB »)
        const viaOpenrgb = (report?.devices || []).some(r => (r.vid + ':' + r.pid).toUpperCase() === id && r.status === 'rgb');
        // Pareil s'il est déjà piloté autrement (casque par HeadsetControl : Arctis Nova 5, ticket #13)
        const liveOther = [...drvLive.values()].some(i => i.dev && devId(i.dev) === id);
        if (liveOther && drvErrors.get(id)?.[0] === 'aucun pilote ne correspond à ses interfaces') drvErrors.delete(id);
        if (!viaOpenrgb && !liveOther && !drvErrors.has(id)) drvErrors.set(id, ['aucun pilote ne correspond à ses interfaces']);
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
    try { inst.release?.(); } catch {} // effets animés, minuteries du pilote
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
    h('span', { class: 'nl' }, inst.navLabel || KIND_NAME[inst.kind] || 'Appareil', h('small', { title: inst.name }, inst.navSub || inst.name)),
    inst.system ? null : h('span', { class: 'dot ok' }));
  // Page système (réglages de Windows, pas un appareil) : avec Accueil et Allègement
  if (inst.system) $('devGroup').before(nb);
  else { document.querySelector('nav .nfoot').before(nb); $('devGroup').hidden = false; }
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

// Réglages choisis dans PeriphHub, réappliqués au branchement (appareils sans mémoire intégrée).
// Seuls ceux qui diffèrent de l'état relu sont renvoyés (pas d'écriture inutile dans l'appareil).
async function drvReapply(inst) {
  const want = lsGet(wantKey(inst));
  if (!want) return;
  for (const [cap, v] of Object.entries(want)) {
    if (!inst.caps[cap] || JSON.stringify(inst.state[cap]) === JSON.stringify(v)) continue;
    try { await inst.set(cap, v); } catch (e) { drvFail(inst, cap, e, 'réapplication'); }
  }
  await inst.refresh().catch(() => {});
}

// Échecs de réglage, gardés pour le diagnostic (« VID:PID » → derniers échecs)
const drvFails = new Map();
function drvFail(inst, cap, e, what = 'réglage') {
  const id = inst.dev ? devId(inst.dev) : inst.key;
  const msg = `${new Date().toTimeString().slice(0, 8)} ${what} ${cap} : ${e?.message || e}`;
  console.warn('[PeriphHub]', inst.key, msg);
  drvFails.set(id, [...(drvFails.get(id) || []), msg].slice(-6));
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
    drvFail(inst, cap, e);
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
      // diagId null : pas de VID:PID propre (réglages de Windows, batterie Bluetooth) → diagnostic complet
      NATIVE && inst.dev ? h('div', { class: 'row-inline' },
        h('button', { class: 'ghost', title: 'Envoie le diagnostic de cet appareil au développeur, avec ce qui ne marche pas', onclick: () => diagDialog(drvDiagId(inst) || '') }, 'Signaler un problème'),
        h('button', { class: 'ghost', title: 'À coller dans un message (Discord…) pour dire si ça marche ou pas', onclick: () => copyDiag(drvDiagId(inst) || undefined) }, 'Copier le diagnostic')) : null)));
}

// ---------- Accueil ----------

const drvDiagId = inst => 'diagId' in inst ? inst.diagId : devId(inst.dev);
// Appareils (sans les pages de réglages de Windows)
const drvDevices = () => [...drvLive.values()].filter(i => !i.system);

function driverTiles() {
  return drvDevices().map(inst => {
    const s = inst.state;
    const stats = [];
    if (s.battery) stats.push(['Batterie', s.battery.level + ' %' + (s.battery.charging ? ' ⚡' : '')]);
    if (s.dpi) stats.push(['DPI', String(s.dpi)]);
    if (s.rate) stats.push(['Fréquence', s.rate + ' Hz']);
    return tile(inst.key, inst.name, true, inst.chip ? 'Connecté · ' + inst.chip.text : 'Connecté · expérimental', stats, s.battery ? meter(s.battery.level) : null);
  });
}

const driverHas = (vid, pid) => [...drvLive.values()].some(i => devId(i.dev) === vid + ':' + pid);

// Batterie relue toutes les 2 minutes, fenêtre visible ; toutes les 10 minutes dans la zone de
// notification (infobulle de l'icône)
let batTick = 0;
setInterval(() => {
  if (document.hidden && ++batTick % 5) return;
  for (const inst of drvLive.values()) inst.refreshBattery?.().then(() => drvRender(inst), () => {});
  refreshHome();
}, 120000);

function driversStart() {
  // Nouveau branchement : on retente tout de suite, y compris les appareils restés muets
  navigator.hid?.addEventListener('connect', () => { drvRetry.forEach(r => { r.at = 0; }); driversScan(); });
  // Appareils muets (sans fil en veille…) : nouvel essai quand leur délai est passé, y compris
  // PeriphHub en arrière-plan (c'est là qu'un appareil rallumé doit retrouver ses réglages)
  setInterval(() => {
    if ([...drvRetry.values()].some(r => Date.now() >= r.at)) driversScan();
  }, 30000);
  // Sortie de veille : chaque appareil connecté est relu, et ce qui a changé est renvoyé (pas de
  // réécriture inutile dans la mémoire des appareils). Ceux qui ne savent pas relire leurs réglages
  // (casques) fournissent `reapply`, qui les renvoie tous. Puis les appareils muets sont réessayés.
  if (typeof nativeHid !== 'undefined') nativeHid.events.addEventListener('resume', async () => {
    for (const inst of [...drvLive.values()]) {
      if (inst.off) continue; // casque éteint : il les recevra en se rallumant
      try {
        if (inst.reapply) await inst.reapply();
        else { await inst.refresh(); await drvReapply(inst); }
      } catch (e) { drvFail(inst, 'tout', e, 'sortie de veille'); }
      drvRender(inst);
    }
    drvRetry.forEach(r => { r.at = 0; });
    driversScan();
  });
  navigator.hid?.addEventListener('disconnect', e => drvRelease(e.device));
  driversScan();
  if (typeof headsetsPoll === 'function') headsetsPoll();
  if (typeof openrgbPoll === 'function') openrgbPoll();
  if (typeof mediaPoll === 'function') mediaPoll();
}
