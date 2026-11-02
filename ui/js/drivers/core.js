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
const KIND_NAME = { souris: 'Souris', clavier: 'Clavier', casque: 'Casque', rgb: 'Éclairage', autre: 'Appareil' };

// ---------- Connexion automatique ----------

let drvScanning = false;
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
    for (const [, group] of groups) {
      if (group.some(d => drvBusy.has(d.info?.path))) continue;
      const drv = DRIVERS.find(x => group.some(x.match));
      if (!drv) continue;
      group.forEach(d => drvBusy.add(d.info?.path));
      try {
        const list = await drv.connect(group.find(drv.match), group);
        if (!list?.length) throw new Error('aucune réponse');
        for (const inst of list) drvAdd(inst, drv);
      } catch (e) {
        console.warn('[PeriphHub] pilote', drv.id, devId(group[0]), e.message);
        // On ne réessaie qu'au prochain branchement (pas en boucle)
      }
    }
  } finally {
    drvScanning = false;
  }
}

function drvRelease(dev) {
  for (const [key, inst] of drvLive) {
    if (inst.dev !== dev && !inst.devs?.includes(dev)) continue;
    drvLive.delete(key);
    const visible = $(key) && !$(key).hidden;
    document.querySelector(`nav [data-tab="${CSS.escape(key)}"]`)?.remove();
    $(key)?.remove();
    if (visible) showTab('home');
    toast(`${inst.name} débranché`);
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
      h('div', { class: 'pact' }, h('span', { class: 'status drvstatus' }), h('span', { class: 'chip experimental', title: 'Pilote pas encore confirmé sur ce modèle précis' }, 'Expérimental'))),
    h('div', { class: 'pbody drvbody' })));
  drvRender(inst);
  refreshHome();
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
    for (const cap of ['dpi', 'rate', 'smartshift', 'hires', 'invert', 'light']) {
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
  const sec = $(inst.key);
  if (!sec) return;
  const s = inst.state, c = inst.caps;
  sec.querySelector('.drvmeta').textContent = [
    s.battery ? `Batterie ${s.battery.level} %${s.battery.charging ? ' (en charge)' : ''}` : null, inst.meta].filter(Boolean).join(' · ');
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
  if (!rows.length) rows.push(h('p', { class: 'muted' }, 'Aucun réglage reconnu sur ce modèle pour l’instant. Ouvrez un ticket sur GitHub avec le rapport (page Allègement) : c’est comme ça que la prise en charge s’étend.'));
  const o = drvOrigin(inst);
  box.replaceChildren(...rows,
    inst.note ? h('div', { class: 'notice' }, h('p', { class: 'muted small' }, inst.note)) : null,
    h('div', { class: 'field' }, h('div', { class: 'flabel' }, 'Sécurité'), h('div', { class: 'fctl' },
      h('div', { class: 'muted small' }, inst.source || ('Pilote expérimental : réécrit à partir de projets libres (Solaar, OpenRazer…), pas encore confirmé sur ce modèle. ' +
        'Les réglages d’origine sont gardés avant la première modification.')),
      o && !inst.noOrigin ? h('button', { class: 'ghost', onclick: () => drvRestore(inst) }, `Remettre les réglages du ${new Date(o.date).toLocaleDateString('fr-FR')}`) : null)));
}

// ---------- Accueil ----------

function driverTiles() {
  return [...drvLive.values()].map(inst => {
    const s = inst.state;
    const stats = [];
    if (s.battery) stats.push(['Batterie', s.battery.level + ' %' + (s.battery.charging ? ' ⚡' : '')]);
    if (s.dpi) stats.push(['DPI', String(s.dpi)]);
    if (s.rate) stats.push(['Fréquence', s.rate + ' Hz']);
    return tile(inst.key, inst.name, true, 'Connecté · expérimental', stats, s.battery ? meter(s.battery.level) : null);
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
  navigator.hid?.addEventListener('connect', driversScan);
  navigator.hid?.addEventListener('disconnect', e => drvRelease(e.device));
  driversScan();
  if (typeof headsetsPoll === 'function') headsetsPoll();
  if (typeof openrgbPoll === 'function') openrgbPoll();
}
