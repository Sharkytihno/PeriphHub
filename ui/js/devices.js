// PeriphHub — pages des appareils pris en charge. Chaque modification est écrite tout de suite
// dans la mémoire du périphérique (comme les configurateurs officiels) : une fois réglé, l'appareil
// garde ses réglages sans aucun logiciel ouvert. Navigation, accueil et analyse : js/shell.js.
const $ = id => document.getElementById(id);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter(k => k != null));
  return el;
};

let mouse = null;

// Nom commercial de l'appareil (data/devices.json), à défaut celui que donne l'USB
const catalog = NATIVE ? nativeInvoke('catalog').catch(() => []) : Promise.resolve([]);
async function deviceName(dev) {
  const hex = n => n.toString(16).toUpperCase().padStart(4, '0');
  // les entrées génériques (pid « * », ex. « Logitech (HID++ 2.0) ») ne donnent pas de nom
  const c = (await catalog).find(d => d.vid === hex(dev.vendorId) && d.pid === hex(dev.productId));
  return (c?.name || dev.productName || '').replace(/\s*\((dongle|filaire)[^)]*\)/i, '');
}
async function setTitle(tab, dev) {
  const name = await deviceName(dev);
  if (name) $(tab + 'Title').textContent = name;
  // modèle reconnu seulement par sa famille (pid « * ») : prévenir que ce n'est pas confirmé
  const hex = n => n.toString(16).toUpperCase().padStart(4, '0');
  const list = await catalog;
  const exact = list.some(d => d.vid === hex(dev.vendorId) && d.pid === hex(dev.productId));
  const head = $(tab + 'Title').closest('.phead')?.querySelector('.pact');
  head?.querySelector('.chip.experimental')?.remove();
  if (!exact && list.some(d => d.vid === hex(dev.vendorId) && d.pid === '*')) {
    head?.prepend(h('span', { class: 'chip experimental', title: 'Même famille que les modèles testés, mais ce modèle précis n’est pas encore confirmé' }, 'Expérimental'));
  }
  if (typeof refreshHome === 'function') refreshHome();
}

function setStatus(id, text, kind = '') {
  const el = $(id);
  el.textContent = text;
  el.className = 'status ' + kind;
  // Voyant de la barre latérale : vert une fois connecté, rouge en cas d'erreur
  const dot = document.querySelector(`nav .dot[data-for="${id}"]`);
  if (dot && (kind === 'err' || /^Connecté/.test(text))) dot.className = 'dot ' + (kind || 'ok');
  else if (dot && /débranché|Non connecté/.test(text)) dot.className = 'dot';
  // L'entrée de la barre latérale apparaît dès que l'appareil est détecté
  const nb = dot?.closest('button');
  if (nb && text && !/^Non connecté/.test(text)) nb.hidden = false;
  if (NATIVE) console.log('[statut]', id, text);
  // Notification pour le résultat d'une action (pas pour les états « Connecté »)
  if (typeof toast === 'function' && (kind === 'err' || (kind === 'ok' && !/^Connecté$/.test(text)))) toast(text, kind);
  if (typeof refreshHome === 'function') refreshHome();
}

// Exécute une écriture, affiche le résultat, relit l'état affiché
async function apply(label, fn) {
  try {
    setStatus('mouseStatus', label + '…');
    await fn();
    setStatus('mouseStatus', label + ' ✔', 'ok');
  } catch (e) {
    console.error('[PeriphHub]', e);
    const asleep = await mouse.isOnline().then(on => !on, () => false);
    setStatus('mouseStatus', asleep ? 'Souris en veille : bougez-la puis recommencez' : 'Erreur : ' + e.message, 'err');
  }
  renderMouse();
}

// ---------- Souris ----------

function segmented(options, current, onPick) {
  return h('div', { class: 'seg' }, options.map(o =>
    h('button', { class: o.v === current ? 'on' : '', onclick: () => o.v !== current && onPick(o.v) }, o.label)));
}

function toggle(label, on, onChange, disabled = false, hint = '') {
  return h('label', { class: 'toggle' + (disabled ? ' disabled' : ''), title: hint },
    h('input', { type: 'checkbox', checked: on, disabled, onchange: e => onChange(e.target.checked) }),
    h('span', { class: 'sw' }), label);
}

function field(label, ...control) {
  return h('div', { class: 'field' }, h('div', { class: 'flabel' }, label), h('div', { class: 'fctl' }, ...control));
}

function renderMouse() {
  const box = $('mouseBody');
  box.replaceChildren();
  if (typeof refreshHome === 'function') refreshHome();
  if (!mouse) return;
  const s = mouse.decode();
  const i = mouse.info;
  $('mouseMeta').replaceChildren(
    `Batterie ${i.battery.level} %${i.battery.charging ? ' (en charge)' : ''} · firmware ${i.version}`);

  box.append(segmented([{ v: 'settings', label: 'Réglages' }, { v: 'buttons', label: 'Boutons' }], msView, v => {
    msRecord(false); msView = v; try { localStorage.setItem('msView', v); } catch {} renderMouse();
  }));
  if (msView === 'buttons') return renderMouseButtons(box);

  const dpiRows = [];
  for (let st = 0; st < s.dpiStages; st++) {
    dpiRows.push(h('div', { class: 'dpi' + (st === s.currentDpiStage ? ' active' : '') },
      h('button', { class: 'dot', title: 'Rendre ce niveau actif', onclick: () => apply('Niveau DPI actif', () => mouse.setCurrentDpi(st)) }, String(st + 1)),
      h('input', {
        type: 'number', min: 50, max: 30000, step: 50, value: s.dpis[st],
        onchange: e => apply('DPI niveau ' + (st + 1), () => mouse.setDpi(st, Number(e.target.value))),
      }),
      h('span', { class: 'muted' }, 'DPI')));
  }

  box.append(
    field('Niveaux de DPI',
      h('div', { class: 'dpis' }, dpiRows),
      h('div', { class: 'row-inline' },
        h('button', { class: 'ghost', disabled: s.dpiStages <= 1, onclick: () => apply('Nombre de niveaux', async () => {
          if (s.currentDpiStage >= s.dpiStages - 1) await mouse.setCurrentDpi(s.dpiStages - 2);
          await mouse.setDpiStages(s.dpiStages - 1);
        }) }, '− niveau'),
        h('button', { class: 'ghost', disabled: s.dpiStages >= 8, onclick: () => apply('Nombre de niveaux', () => mouse.setDpiStages(s.dpiStages + 1)) }, '+ niveau'))),
    field('Polling', segmented(
      SCYROX_REPORT_RATES.filter(r => r.hz <= i.maxReportRate).map(r => ({ v: r.hz, label: r.label })),
      s.reportRate, hz => apply('Polling ' + hz + ' Hz', () => mouse.setReportRate(hz)))),
    field('Distance de levée (LOD)', segmented(SCYROX_LOD, s.lod, v => apply('LOD', () => mouse.setLod(v)))),
    field('Mise en veille', segmented(SCYROX_SLEEP, s.sleepTime, v => apply('Mise en veille', () => mouse.setSleep(v)))),
    field('Capteur', h('div', { class: 'toggles' },
      toggle('Mode compétitif', s.competitive, on => apply('Mode compétitif', async () => {
        if (!on && s.scyrox20k) await mouse.set20K(false);
        await mouse.setCompetitive(on);
      }), false, 'Capteur en performance maximale (consomme plus de batterie)'),
      toggle('20K FPS', s.scyrox20k, on => apply('20K FPS', () => mouse.set20K(on)), !s.competitive, 'Nécessite le mode compétitif'),
      toggle('Motion Sync', s.motionSync, on => apply('Motion Sync', () => mouse.setMotionSync(on))),
      toggle('Ripple Control', s.ripple, on => apply('Ripple Control', () => mouse.setRipple(on))),
      toggle('Angle snapping', s.angleSnapping, on => apply('Angle snapping', () => mouse.setAngleSnapping(on))))),
    field('Angle de la souris',
      h('div', { class: 'row-inline' },
        h('input', { type: 'range', min: -30, max: 30, step: 1, value: s.angleTune,
          oninput: e => { e.target.nextSibling.textContent = e.target.value + '°'; },
          onchange: e => apply('Angle', () => mouse.setAngleTune(Number(e.target.value))) }),
        h('span', { class: 'val' }, s.angleTune + '°'))),
    field('Temps de réponse des boutons',
      h('div', { class: 'row-inline' },
        h('input', { type: 'number', min: 0, max: 30, value: s.debounceTime,
          onchange: e => apply('Temps de réponse', () => mouse.setDebounce(Number(e.target.value))) }),
        h('span', { class: 'muted' }, 'ms'))),
  );
}

// ----- Boutons de la souris -----

var msView = (() => { try { return localStorage.getItem('msView'); } catch { return null; } })() || 'settings';
var msEdit = null;  // bouton en cours d'édition : { i, kind, keys, steps, repeat, name, interval, times }
var msRec = null;   // enregistrement au clavier en cours (raccourci ou macro)

const MS_SIMPLE = [
  { name: 'Clics', items: [['m:1', 'Clic gauche'], ['m:2', 'Clic droit'], ['m:4', 'Clic molette'], ['m:8', 'Précédent (page arrière)'], ['m:16', 'Suivant (page avant)']] },
  { name: 'DPI', items: [['d:1', 'DPI suivant (en boucle)'], ['d:2', 'DPI +'], ['d:3', 'DPI −']] },
  { name: 'Défilement', items: [['v:1', 'Défiler vers le haut'], ['v:2', 'Défiler vers le bas'], ['h:1', 'Défiler à gauche'], ['h:2', 'Défiler à droite']] },
  { name: 'Multimédia', items: [['media:205', 'Lecture / pause'], ['media:181', 'Piste suivante'], ['media:182', 'Piste précédente'],
    ['media:183', 'Stop'], ['media:226', 'Muet'], ['media:233', 'Volume +'], ['media:234', 'Volume −'], ['media:387', 'Lecteur multimédia'],
    ['media:402', 'Calculatrice'], ['media:394', 'Messagerie'], ['media:548', 'Navigateur : page précédente'], ['media:549', 'Navigateur : page suivante'],
    ['media:551', 'Navigateur : actualiser']] },
  { name: 'Autres', items: [['p:0', 'Changer le polling'], ['fire', 'Tir rapide…'], ['keys', 'Raccourci clavier…'], ['macro', 'Macro…'], ['0', 'Désactivé']] },
];
const msHid = label => Number(Object.keys(HID_FR).find(k => HID_FR[k] === label));
// Raccourcis tout prêts (codes physiques AZERTY)
const MS_COMBOS = [
  ['Copier', [0xe0, msHid('C')]], ['Coller', [0xe0, msHid('V')]], ['Couper', [0xe0, msHid('X')]], ['Annuler', [0xe0, msHid('Z')]],
  ['Capture d’écran (zone)', [0xe3, 0xe1, msHid('S')]], ['Afficher le bureau', [0xe3, msHid('D')]], ['Vue des tâches', [0xe3, 0x2b]],
  ['Fermer la fenêtre', [0xe2, 0x3d]], ['Nouvel onglet', [0xe0, msHid('T')]], ['Verrouiller le PC', [0xe3, msHid('L')]],
];

const msKeysName = keys => keys.map(rektKeyName).join(' + ');

// Valeur de la liste pour la fonction actuelle d'un bouton
function msValue(b) {
  const T = SCYROX_FN;
  switch (b.type) {
    case T.Disable: return '0';
    case T.Mouse: return 'm:' + b.p1;
    case T.Dpi: return 'd:' + b.p1;
    case T.VScroll: return 'v:' + b.p1;
    case T.HScroll: return 'h:' + b.p1;
    case T.Polling: return 'p:0';
    case T.Fire: return 'fire';
    case T.Macro: return 'macro';
    case T.Shortcut: return b.media != null ? 'media:' + b.media : 'keys';
    default: return null;
  }
}

function msLabel(b) {
  const v = msValue(b);
  if (v === 'keys') return 'Raccourci : ' + (MS_COMBOS.find(c => c[1].join() === b.keys.join())?.[0] || msKeysName(b.keys));
  if (v === 'macro') return 'Macro : ' + (b.macro.name || 'sans nom');
  if (v === 'fire') return `Tir rapide (${b.p2 || '∞'} clic${b.p2 > 1 ? 's' : ''}, toutes les ${b.p1} ms)`;
  return MS_SIMPLE.flatMap(g => g.items).find(it => it[0] === v)?.[1] || (b.type == null ? 'Illisible' : 'Fonction ' + b.type);
}

function msApply(i, label, b) {
  // Il faut toujours garder un clic gauche quelque part
  const left = SCYROX_BUTTONS.some((_, j) => j !== i && mouse._key(j)?.type === SCYROX_FN.Mouse && mouse._key(j)?.p1 === 1);
  if (!left && !(b.type === SCYROX_FN.Mouse && b.p1 === 1)) {
    setStatus('mouseStatus', 'Un bouton doit rester « Clic gauche », sinon la souris devient inutilisable.', 'err');
    return;
  }
  msRecord(false);
  msEdit = null;
  apply(`${SCYROX_BUTTONS[i]} → ${label}`, () => mouse.setButton(i, b));
}

function msPick(i, v) {
  const b = mouse.button(i);
  if (v === 'keys') msEdit = { i, kind: 'keys', keys: b.keys ? [...b.keys] : [] };
  else if (v === 'macro') msEdit = { i, kind: 'macro', name: b.macro?.name || 'Macro ' + SCYROX_BUTTONS[i],
    steps: b.macro ? b.macro.steps.map(s => ({ ...s })) : [], repeat: b.repeat || 1 };
  else if (v === 'fire') msEdit = { i, kind: 'fire', interval: b.type === SCYROX_FN.Fire ? b.p1 : 50, times: b.type === SCYROX_FN.Fire ? b.p2 : 0 };
  else {
    const [k, p] = v.split(':');
    const label = MS_SIMPLE.flatMap(g => g.items).find(it => it[0] === v)[1];
    if (k === 'media') return msApply(i, label, { type: SCYROX_FN.Shortcut, media: Number(p) });
    const type = { 0: SCYROX_FN.Disable, m: SCYROX_FN.Mouse, d: SCYROX_FN.Dpi, v: SCYROX_FN.VScroll, h: SCYROX_FN.HScroll, p: SCYROX_FN.Polling }[k];
    return msApply(i, label, { type, p1: Number(p || 0) });
  }
  renderMouse();
}

function msOnKey(e) {
  if (!msRec || e.repeat) return;
  e.preventDefault();
  e.stopPropagation();
  const kc = CODE_HID[e.code];
  if (!kc) return;
  const now = performance.now();
  if (msEdit.kind === 'keys') {
    // raccourci : les touches enfoncées ensemble, figé au premier relâchement
    if (e.type === 'keydown') {
      if (msRec.done) { msEdit.keys = []; msRec.done = false; }
      if (!msEdit.keys.includes(kc) && msEdit.keys.length < 5) msEdit.keys.push(kc);
    } else msRec.done = true;
  } else {
    const last = msEdit.steps[msEdit.steps.length - 1];
    if (last && msRec.last) last.delay = msRec.delays ? Math.min(65535, Math.round(now - msRec.last)) : 10;
    msRec.last = now;
    if (msEdit.steps.length < 70) msEdit.steps.push({ down: e.type === 'keydown', kc, delay: 10 });
  }
  renderMouse();
}

function msRecord(on, delays = false) {
  if (on && !msRec) {
    msRec = { delays, last: 0, done: false };
    addEventListener('keydown', msOnKey, true);
    addEventListener('keyup', msOnKey, true);
  } else if (!on && msRec) {
    msRec = null;
    removeEventListener('keydown', msOnKey, true);
    removeEventListener('keyup', msOnKey, true);
    if (msEdit?.kind === 'macro') {
      const held = new Set();
      for (const s of msEdit.steps) if (s.down) held.add(s.kc); else held.delete(s.kc);
      for (const kc of held) msEdit.steps.push({ down: false, kc, delay: 10 });
    }
  }
}

const msBox = (...kids) => h('div', { class: 'subedit' }, ...kids);

function msEditor() {
  const e = msEdit, i = e.i, name = SCYROX_BUTTONS[i];
  const close = h('button', { class: 'ghost', onclick: () => { msRecord(false); msEdit = null; renderMouse(); } }, 'Annuler');
  if (e.kind === 'fire') {
    return msBox(
      h('div', { class: 'row-inline' },
        'Clics', h('input', { type: 'number', min: 0, max: 3, value: e.times, onchange: ev => { e.times = Math.max(0, Math.min(3, Number(ev.target.value) || 0)); } }),
        'toutes les', h('input', { type: 'number', min: 10, max: 255, value: e.interval, onchange: ev => { e.interval = Math.max(10, Math.min(255, Number(ev.target.value) || 10)); } }), 'ms'),
      h('div', { class: 'muted small' }, 'Le bouton envoie des clics gauches en rafale. 0 clic = en continu tant que le bouton est maintenu.'),
      h('div', { class: 'row-inline' },
        h('button', { onclick: () => msApply(i, 'tir rapide', { type: SCYROX_FN.Fire, p1: e.interval, p2: e.times }) }, 'Appliquer'), close));
  }
  if (e.kind === 'keys') {
    return msBox(
      h('div', { class: 'effects' }, MS_COMBOS.map(([label, keys]) => h('button', {
        class: 'eff' + (keys.join() === e.keys.join() ? ' on' : ''), title: msKeysName(keys),
        onclick: () => { msRecord(false); e.keys = [...keys]; renderMouse(); } }, label))),
      h('div', { class: 'steps' + (msRec ? ' rec' : '') }, e.keys.length ? h('span', { class: 'step' }, msKeysName(e.keys))
        : h('span', { class: 'muted small' }, msRec ? 'Appuyez sur la combinaison (jusqu’à 5 touches)…' : 'Choisissez un raccourci ci-dessus ou enregistrez le vôtre.')),
      h('div', { class: 'row-inline' },
        msRec ? h('button', { onclick: () => { msRecord(false); renderMouse(); } }, '■ Terminer')
          : h('button', { class: 'ghost', onclick: () => { e.keys = []; msRecord(true); renderMouse(); } }, '● Saisir une combinaison'),
        h('button', { disabled: !e.keys.length || !!msRec, onclick: () => msApply(i, msKeysName(e.keys), { type: SCYROX_FN.Shortcut, keys: e.keys }) }, 'Appliquer'),
        close));
  }
  // macro
  const R = SCYROX_MACRO_REPEAT;
  const mode = Object.values(R).includes(e.repeat) ? e.repeat : 1;
  return msBox(
    h('div', { class: 'row-inline' }, 'Nom', h('input', { type: 'text', maxlength: 30, value: e.name, onchange: ev => { e.name = ev.target.value.trim() || 'Macro'; } })),
    h('div', { class: 'steps' + (msRec ? ' rec' : '') }, e.steps.length ? e.steps.map((s, j) => h('span', { class: 'step' },
      `${rektKeyName(s.kc)} ${s.down ? '↓' : '↑'}`,
      j < e.steps.length - 1 ? h('input', { type: 'number', min: 0, max: 65535, value: s.delay, title: 'Pause après cette étape (ms)',
        onchange: ev => { s.delay = Math.max(0, Math.min(65535, Number(ev.target.value) || 0)); } }) : null,
      h('button', { class: 'x', title: 'Retirer cette étape', onclick: () => { e.steps.splice(j, 1); renderMouse(); } }, '×')))
      : h('span', { class: 'muted small' }, msRec ? 'Tapez la séquence au clavier…' : 'Vide.')),
    h('div', { class: 'muted small' }, `↓ = enfoncée, ↑ = relâchée ; le nombre est la pause en ms avant l’étape suivante. ${e.steps.length} / 70 étapes.`),
    h('div', { class: 'row-inline' },
      msRec ? h('button', { onclick: () => { msRecord(false); renderMouse(); } }, '■ Arrêter l’enregistrement')
        : [h('button', { class: 'ghost', onclick: () => { msRecord(true, false); renderMouse(); } }, '● Enregistrer au clavier'),
          h('button', { class: 'ghost', onclick: () => { msRecord(true, true); renderMouse(); } }, '● Avec les pauses')],
      !msRec && e.steps.length ? h('button', { class: 'ghost', onclick: () => { e.steps = []; renderMouse(); } }, 'Tout effacer') : null),
    h('div', { class: 'row-inline' }, 'Répétition',
      h('select', { onchange: ev => { e.repeat = Number(ev.target.value); renderMouse(); } },
        h('option', { value: 1, selected: mode === 1 }, 'Un nombre de fois'),
        h('option', { value: R.held, selected: mode === R.held }, 'Tant que le bouton est maintenu'),
        h('option', { value: R.toggle, selected: mode === R.toggle }, 'Jusqu’au prochain appui sur ce bouton'),
        h('option', { value: R.untilAny, selected: mode === R.untilAny }, 'Jusqu’à l’appui d’un autre bouton')),
      mode === 1 ? h('input', { type: 'number', min: 1, max: 250, value: e.repeat < 251 ? e.repeat : 1,
        onchange: ev => { e.repeat = Math.max(1, Math.min(250, Number(ev.target.value) || 1)); } }) : null,
      mode === 1 ? 'fois' : null),
    h('div', { class: 'row-inline' },
      h('button', { disabled: !e.steps.length || !!msRec, onclick: () => msApply(i, 'macro « ' + e.name + ' »',
        { type: SCYROX_FN.Macro, macro: { name: e.name, steps: e.steps }, repeat: e.repeat }) }, 'Enregistrer dans la souris'),
      close));
}

function renderMouseButtons(box) {
  const rows = SCYROX_BUTTONS.map((name, i) => {
    const b = mouse.button(i);
    const v = msEdit?.i === i ? msEdit.kind : msValue(b);
    const [dt, dp] = SCYROX_DEFAULT_KEYS[i];
    const isDefault = b.type === dt && b.p1 === dp;
    const sel = h('select', { onchange: e => msPick(i, e.target.value) },
      v ? null : h('option', { value: '', selected: true }, msLabel(b)),
      MS_SIMPLE.map(g => h('optgroup', { label: g.name }, g.items.map(([val, label]) =>
        h('option', { value: val, selected: val === v }, ['keys', 'macro', 'fire'].includes(val) && val === msValue(b) ? msLabel(b) : label)))));
    return field(name, h('div', { class: 'row-inline' }, sel,
      ['keys', 'macro', 'fire'].includes(v) && msEdit?.i !== i ? h('button', { class: 'ghost', onclick: () => msPick(i, v) }, 'Modifier') : null,
      isDefault ? null : h('button', { class: 'ghost', title: 'Fonction d’usine', onclick: () => {
        msEdit = null; apply(`${name} remis d’usine`, () => mouse.resetButton(i));
      } }, 'Remettre d’usine')),
      msEdit?.i === i ? msEditor() : null);
  });
  put(box,
    h('p', { class: 'muted small' }, 'Chaque bouton peut faire un autre clic, changer le DPI, défiler, piloter la musique, taper un raccourci ou rejouer une macro. C’est enregistré dans la souris.'),
    rows);
}

let connecting = false;

async function connectMouse(dev) {
  if (connecting || mouse) return;
  connecting = true;
  try {
    setStatus('mouseStatus', 'Connexion…');
    const m = new ScyroxMouse(dev);
    await m.open();
    // Souris en veille : on attend qu'elle se réveille (on bouge la souris)
    while (!m.info.online) {
      setStatus('mouseStatus', 'Souris en veille : bougez-la pour la réveiller…');
      await new Promise(r => setTimeout(r, 1500));
      if (await m.isOnline()) await m.open();
    }
    await m.readFlash(0, 256);
    await m.readButtons();
    mouse = m;
    setTitle('mouse', dev);
    window.periph = { ...window.periph, mouse };
    $('mouseConnect').hidden = true;
    setStatus('mouseStatus', 'Connectée', 'ok');
    renderMouse();
  } catch (e) {
    console.error('[PeriphHub]', e);
    setStatus('mouseStatus', 'Erreur : ' + e.message, 'err');
  } finally {
    connecting = false;
  }
}

$('mouseConnect').onclick = async () => {
  if (!('hid' in navigator)) return setStatus('mouseStatus', 'WebHID indisponible : ouvrir dans Chrome ou Edge.', 'err');
  const dev = ScyroxMouse.pick(await navigator.hid.requestDevice({ filters: ScyroxMouse.filters }));
  if (dev) connectMouse(dev);
  else setStatus('mouseStatus', 'Aucune interface de configuration trouvée.', 'err');
};

// ---------- Clavier ----------

let kb = null;
let kbSel = new Set();
let kbUndo = null; // état d'avant la dernière modification (bouton « Annuler »)

const mm = c => (c / 100).toFixed(2);
const mmFr = c => (LANG === 'en' ? mm(c) : mm(c).replace('.', ',')) + ' mm';

// Réglages rapides, appliqués à toutes les touches (centièmes de mm)
const KB_PRESETS = [
  { name: 'Jeu', desc: 'Réactif, pour viser et se déplacer', act: 150, rt: { on: true, trigger: 50, reset: 50 } },
  { name: 'Compétition', desc: 'Le plus réactif possible (contre-strafe)', act: 100, rt: { on: true, trigger: 20, reset: 20 } },
  { name: 'Frappe', desc: 'Moins de fautes en écrivant', act: 200, rt: { on: false } },
];

// Groupes de sélection (codes HID = position physique)
const KB_GROUPS = [
  { name: 'Zone de jeu', codes: [0x29, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x2b, 0x14, 0x1a, 0x08, 0x15, 0x17, 0x39, 0x04, 0x16, 0x07,
    0x09, 0x0a, 0xe1, 0x1d, 0x1b, 0x06, 0x19, 0xe0, 0xe2, 0x2c] },
  { name: 'Lettres', codes: [...Array(26).keys()].map(i => 0x04 + i).concat(0x33) },
];

async function kbApply(label, fn) {
  const before = { act: kb.act.slice(), rt: kb.rt.map(x => ({ ...x })) };
  try {
    setStatus('kbStatus', label + '…');
    await fn();
    kbUndo = before;
    setStatus('kbStatus', label + ' ✔', 'ok');
  } catch (e) {
    console.error('[PeriphHub]', e);
    setStatus('kbStatus', 'Erreur : ' + e.message, 'err');
  }
  renderKeyboard();
}

// Réécrit un état complet (annulation ou retour à l'état d'origine)
function kbRestore(label, state) {
  return kbApply(label, async () => {
    await kb.writeAct(state.act);
    await kb.writeRt(state.rt);
  });
}

// État d'origine gardé dans le navigateur au premier branchement (filet de sécurité)
function kbOrigin() {
  try { return JSON.parse(localStorage.getItem('kbOrigin')); } catch { return null; }
}

// Valeur commune à la sélection, ou '' si elles diffèrent
function common(values) {
  return values.length && values.every(v => v === values[0]) ? values[0] : '';
}

function kbPresetActive(keys, p) {
  return keys.every(i => kb.act[i] === p.act && !!kb.rt[i]?.on === p.rt.on &&
    (!p.rt.on || (kb.rt[i].trigger === p.rt.trigger && kb.rt[i].reset === p.rt.reset)));
}

let kbView = (() => { try { return localStorage.getItem('kbView'); } catch { return null; } })() || 'travel';
let kbLayer = 0;   // couche affichée dans « Touches » (0 normale, 1 avec Fn)
let kbKey = null;  // touche choisie pour la réaffectation

// Plan du clavier : 15 colonnes, la barre d'espace absorbe les trous de sa ligne.
// keyFn(i) → { cls, title, onclick, kids } pour chaque touche
function kbGrid(keyFn) {
  const grid = h('div', { class: 'kbd' });
  for (let r = 0; r < REKT_ROWS; r++) {
    const row = [...Array(REKT_COLS).keys()].map(c => r * REKT_COLS + c);
    const space = row.find(i => kb.layout[i] === 0x2c);
    for (let c = 0; c < REKT_COLS; c++) {
      const i = row[c];
      if (!kb.isKey(i)) {
        if (space == null) grid.append(h('div', { class: 'hole' }));
        continue;
      }
      const span = i === space ? row.filter(j => !kb.isKey(j)).length + 1 : 1;
      const k = keyFn(i);
      grid.append(h('button', { class: 'key' + (k.cls || ''), style: span > 1 ? `grid-column: span ${span}` : null,
        title: k.title, onclick: k.onclick }, k.kids));
    }
  }
  return grid;
}

// append sans les éléments absents (null)
const put = (box, ...kids) => box.append(...kids.flat().filter(k => k != null));

// Écriture simple (touches, éclairage) avec message d'état puis réaffichage
async function kbDo(label, fn) {
  try {
    setStatus('kbStatus', label + '…');
    await fn();
    setStatus('kbStatus', label + ' ✔', 'ok');
  } catch (e) {
    console.error('[PeriphHub]', e);
    setStatus('kbStatus', 'Erreur : ' + e.message, 'err');
  }
  renderKeyboard();
}

function kbSaved(name) {
  try { return JSON.parse(localStorage.getItem(name)); } catch { return null; }
}

function renderKeyboard() {
  const box = $('kbBody');
  box.replaceChildren();
  if (!kb) return;
  box.append(segmented([{ v: 'travel', label: 'Course et rapid trigger' }, { v: 'keys', label: 'Touches' },
    { v: 'macros', label: 'Macros' }, { v: 'light', label: 'Éclairage' }],
    kbView, v => { kbRecord(false); kbView = v; try { localStorage.setItem('kbView', v); } catch {} renderKeyboard(); }));
  if (kbView === 'keys') renderKbKeys(box);
  else if (kbView === 'macros') renderKbMacros(box);
  else if (kbView === 'light') renderKbLight(box);
  else renderKbTravel(box);
}

// ----- Réaffectation des touches -----

function renderKbKeys(box) {
  const origin = kbSaved('kbOriginKeys');
  const cur = kb.layers[kbLayer];
  const changed = i => !!origin && origin.layers[kbLayer][i] !== cur[i];
  const diffs = origin ? [0, 1].flatMap(l => kb.layers[l].flatMap((c, i) => c !== origin.layers[l][i] ? [[l, i]] : [])) : [];
  const grid = kbGrid(i => ({
    cls: (kbKey === i ? ' sel' : '') + (changed(i) ? ' changed' : ''),
    title: `${rektKeyLabel(kb.layout[i])} → ${rektKeyName(cur[i])}`,
    onclick: () => { kbKey = kbKey === i ? null : i; renderKeyboard(); },
    kids: [h('span', { class: 'kl' }, rektKeyLabel(kb.layout[i])),
      h('span', { class: 'kv' + (changed(i) ? ' hi' : '') }, kbLayer === 0 && cur[i] === kb.layout[i] ? '' : rektKeyLabel(cur[i]))],
  }));

  let editor = h('p', { class: 'muted small' }, 'Cliquez sur une touche pour choisir ce qu’elle fait.');
  if (kbKey != null) {
    const code = cur[kbKey];
    const name = rektKeyLabel(kb.layout[kbKey]);
    const isFn = code >= 0x5220 && code <= 0x523f;
    const groups = REKT_KEY_GROUPS;
    const known = groups.some(g => g.codes.includes(code));
    const sel = h('select', { id: 'kbKeySel' },
      known ? null : h('option', { value: code, selected: true }, 'Actuel : ' + rektKeyName(code)),
      groups.map(g => h('optgroup', { label: g.name }, g.codes.map(c => h('option', { value: c, selected: c === code }, kbCodeName(c))))));
    editor = field(`Touche ${name}` + (kbLayer ? ' (avec Fn)' : ''),
      isFn ? h('div', { class: 'muted small' }, 'C’est la touche Fn : elle n’est pas réaffectable ici, sinon la couche Fn deviendrait inaccessible.')
        : h('div', { class: 'row-inline' }, sel,
          h('button', { onclick: () => {
            const v = Number($('kbKeySel').value);
            kbDo(`${name} → ${rektKeyName(v)}`, () => kb.setKey(kbLayer, kbKey, v));
          } }, 'Appliquer'),
          changed(kbKey) ? h('button', { class: 'ghost', onclick: () =>
            kbDo(`${name} remise d’origine`, () => kb.setKey(kbLayer, kbKey, origin.layers[kbLayer][kbKey])) }, 'Remettre d’origine') : null),
      h('div', { class: 'muted small' }, kbLayer
        ? '▽ = transparente : avec Fn, la touche fait la même chose que sans Fn.'
        : 'Le changement est enregistré dans le clavier (il marche aussi sans PeriphHub).'));
  }

  put(box,
    h('p', { class: 'muted small' }, 'Sous chaque touche : ce qu’elle fait si ce n’est pas sa fonction d’origine. En orange : modifiée.'),
    segmented([{ v: 0, label: 'Couche normale' }, { v: 1, label: 'Avec Fn maintenue' }], kbLayer, v => { kbLayer = v; renderKeyboard(); }),
    grid,
    editor,
    diffs.length ? h('div', { class: 'row-inline' },
      h('span', { class: 'muted small' }, `${diffs.length} touche(s) modifiée(s) depuis le ${new Date(origin.date).toLocaleDateString(LOCALE)}`),
      h('button', { class: 'ghost', onclick: () => kbDo('Retour aux touches d’origine', async () => {
        for (const [l, i] of diffs) await kb.setKey(l, i, origin.layers[l][i]);
      }) }, 'Tout remettre d’origine')) : null,
  );
}

// ----- Éclairage du clavier -----

const kbLightTimer = { t: 0 };
// Les curseurs et la palette envoient en continu : on regroupe les écritures
function kbLightSet(patch, rerender = false) {
  Object.assign(kb.light, patch);
  clearTimeout(kbLightTimer.t);
  kbLightTimer.t = setTimeout(() => {
    kb.writeLight({}).then(() => setStatus('kbStatus', 'Éclairage appliqué ✔', 'ok'),
      e => { console.error('[PeriphHub]', e); setStatus('kbStatus', 'Erreur : ' + e.message, 'err'); });
  }, 80);
  if (rerender) renderKeyboard();
}

function renderKbLight(box) {
  const l = kb.light;
  if (!l) return box.append(h('p', { class: 'muted' }, 'Éclairage illisible.'));
  const origin = kbSaved('kbOriginLight');
  const animated = ![0x00, 0x01, 0x02, 0x1f].includes(l.effect);
  put(box,
    h('h3', { class: 'sect' }, 'Effet'),
    h('div', { class: 'effects' }, REKT_EFFECTS.filter(e => e.v !== 0x01 || l.effect === 0x01).map(e =>
      h('button', { class: 'eff' + (e.v === l.effect ? ' on' : ''), onclick: () => kbLightSet({ effect: e.v }, true) }, e.label))),
    l.effect ? field('Couleur',
      h('div', { class: 'row-inline' },
        h('input', { type: 'color', value: l.color, oninput: e => kbLightSet({ color: e.target.value }) }),
        RGB_SWATCHES.map(c => h('button', { class: 'swatch' + (c === l.color ? ' on' : ''), style: `background:${c}`, title: c,
          onclick: () => kbLightSet({ color: c }, true) }))),
      h('div', { class: 'muted small' }, 'Utilisée par les effets unis (Couleur fixe, Respiration, Monochrome…) ; les effets arc-en-ciel l’ignorent.')) : null,
    l.effect ? field('Luminosité', slider(0, 100, 5, Math.round(l.brightness / REKT_MAX_BRIGHT * 100), ' %',
      v => kbLightSet({ brightness: Math.round(v / 100 * REKT_MAX_BRIGHT) }))) : null,
    l.effect && animated ? field('Vitesse', slider(0, 100, 5, Math.round(l.speed / 2.55), ' %',
      v => kbLightSet({ speed: Math.round(v * 2.55) }))) : null,
    origin && JSON.stringify(origin.light) !== JSON.stringify(l) ? h('div', { class: 'row-inline' },
      h('button', { class: 'ghost', onclick: () => kbLightSet({ ...origin.light }, true) },
        'Revenir à l’éclairage du ' + new Date(origin.date).toLocaleDateString(LOCALE))) : null,
  );
}

// ----- Macros du clavier -----

// Touche physique (KeyboardEvent.code) → code HID, pour enregistrer une macro au clavier
const CODE_HID = (() => {
  const m = {
    Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c, Minus: 0x2d, Equal: 0x2e, BracketLeft: 0x2f,
    BracketRight: 0x30, Backslash: 0x31, Semicolon: 0x33, Quote: 0x34, Backquote: 0x35, Comma: 0x36, Period: 0x37, Slash: 0x38,
    CapsLock: 0x39, PrintScreen: 0x46, ScrollLock: 0x47, Pause: 0x48, Insert: 0x49, Home: 0x4a, PageUp: 0x4b, Delete: 0x4c,
    End: 0x4d, PageDown: 0x4e, ArrowRight: 0x4f, ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52, IntlBackslash: 0x64,
    ContextMenu: 0x65, ControlLeft: 0xe0, ShiftLeft: 0xe1, AltLeft: 0xe2, MetaLeft: 0xe3, ControlRight: 0xe4,
    ShiftRight: 0xe5, AltRight: 0xe6, MetaRight: 0xe7,
  };
  for (let i = 0; i < 26; i++) m['Key' + String.fromCharCode(65 + i)] = 0x04 + i;
  for (let i = 1; i <= 9; i++) m['Digit' + i] = 0x1d + i;
  m.Digit0 = 0x27;
  for (let i = 1; i <= 12; i++) m['F' + i] = 0x39 + i;
  return m;
})();

var kbMacro = 0;          // macro affichée
var kbDrafts = {};        // brouillons non enregistrés, par numéro de macro : { steps }
var kbDraft = null;       // brouillon de la macro affichée : { steps, dirty }
var kbRec = null;         // enregistrement au clavier en cours : { last, delays } (var : showTab l'arrête dès le chargement)

const kbMacroNames = () => kbSaved('kbMacroNames') || {};
const kbMacroName = n => kbMacroNames()[n] || 'Macro ' + (n + 1);
// Nom d'un code dans les listes : les macros portent le nom choisi par l'utilisateur
const kbCodeName = c => c >= 0x7700 && c <= 0x771f ? kbMacroName(c - 0x7700) : rektKeyName(c);

function kbStepLabel(s) {
  if (s.t === 'delay') return `Pause ${s.ms} ms`;
  if (s.t === 'text') return `Texte « ${s.ch} »`;
  const k = rektKeyName(s.kc);
  return s.t === 'tap' ? k : s.t === 'down' ? `${k} ↓ enfoncée` : `${k} ↑ relâchée`;
}

// Regroupe « enfoncer X » immédiatement suivi de « relâcher X » en un appui simple
function kbCompact(steps) {
  const out = [];
  for (const s of steps) {
    const p = out[out.length - 1];
    if (s.t === 'up' && p && p.t === 'down' && p.kc === s.kc) out[out.length - 1] = { t: 'tap', kc: s.kc };
    else out.push(s);
  }
  return out;
}

function kbOnKey(e) {
  if (!kbRec || e.repeat) return;
  const kc = CODE_HID[e.code];
  e.preventDefault();
  e.stopPropagation();
  if (!kc) return;
  const now = performance.now();
  if (kbRec.delays && kbRec.last && now - kbRec.last >= 30) kbDraft.steps.push({ t: 'delay', ms: Math.min(9999, Math.round(now - kbRec.last)) });
  kbRec.last = now;
  kbDraft.steps.push({ t: e.type === 'keydown' ? 'down' : 'up', kc });
  kbDraft.dirty = true;
  if (e.type === 'keyup') { kbDraft.steps = kbCompact(kbDraft.steps); renderKeyboard(); }
}

function kbRecord(on, delays = false) {
  if (on && !kbRec) {
    kbRec = { last: 0, delays };
    addEventListener('keydown', kbOnKey, true);
    addEventListener('keyup', kbOnKey, true);
  } else if (!on && kbRec) {
    kbRec = null;
    removeEventListener('keydown', kbOnKey, true);
    removeEventListener('keyup', kbOnKey, true);
    // une touche restée enfoncée à l'arrêt : on la relâche dans la macro
    if (kbDraft) {
      const held = new Set();
      for (const s of kbDraft.steps) if (s.t === 'down') held.add(s.kc); else if (s.t === 'up') held.delete(s.kc);
      for (const kc of held) kbDraft.steps.push({ t: 'up', kc });
      kbDraft.steps = kbCompact(kbDraft.steps);
    }
  }
}

function renderKbMacros(box) {
  if (!kb.macros) return box.append(h('p', { class: 'muted' }, 'Macros illisibles.'));
  kbDraft = kbDrafts[kbMacro] ||= { steps: kb.macros[kbMacro].map(s => ({ ...s })), dirty: false };
  const steps = kbDraft.steps;
  const all = kb.macros.map((m, i) => kbDrafts[i]?.dirty ? kbDrafts[i].steps : m);
  const pending = Object.values(kbDrafts).filter(d => d.dirty).length;
  const used = RektKeyboard.macroBytes(all).length;
  // touches qui lancent cette macro
  const keys = [0, 1].flatMap(l => kb.layers[l].flatMap((c, i) => c === 0x7700 + kbMacro && kb.isKey(i)
    ? [(l ? 'Fn + ' : '') + rektKeyLabel(kb.layout[i])] : []));

  const list = h('div', { class: 'effects' }, kb.macros.map((m, i) => h('button', {
    class: 'eff' + (i === kbMacro ? ' on' : '') + (all[i].length ? '' : ' empty'),
    onclick: () => { kbRecord(false); kbMacro = i; renderKeyboard(); },
  }, kbMacroName(i) + (kbDrafts[i]?.dirty ? ' •' : ''))));

  const stepEls = steps.map((s, i) => h('span', { class: 'step' + (s.t === 'delay' ? ' delay' : '') },
    s.t === 'delay'
      ? h('input', { type: 'number', min: 1, max: 9999, value: s.ms, title: 'Durée de la pause en millisecondes',
        onchange: e => { s.ms = Math.max(1, Math.min(9999, Number(e.target.value) || 1)); kbDraft.dirty = true; renderKeyboard(); } })
      : null,
    s.t === 'delay' ? ' ms' : kbStepLabel(s),
    h('button', { class: 'x', title: 'Retirer cette étape', onclick: () => { steps.splice(i, 1); kbDraft.dirty = true; renderKeyboard(); } }, '×')));

  put(box,
    h('p', { class: 'muted small' }, 'Une macro rejoue une suite de touches quand on appuie sur la touche à laquelle elle est affectée. Elle est enregistrée dans le clavier.'),
    list,
    field('Nom', h('input', { type: 'text', value: kbMacroName(kbMacro), maxlength: 30, onchange: e => {
      const names = kbMacroNames();
      const v = e.target.value.trim();
      if (v) names[kbMacro] = v; else delete names[kbMacro];
      try { localStorage.setItem('kbMacroNames', JSON.stringify(names)); } catch {}
      renderKeyboard();
    } })),
    field('Séquence',
      h('div', { class: 'steps' + (kbRec ? ' rec' : '') },
        stepEls.length ? stepEls : h('span', { class: 'muted small' }, kbRec ? 'Tapez la séquence au clavier…' : 'Vide.')),
      h('div', { class: 'row-inline' },
        kbRec
          ? h('button', { onclick: () => { kbRecord(false); renderKeyboard(); } }, '■ Arrêter l’enregistrement')
          : [h('button', { onclick: () => { kbRecord(true, false); renderKeyboard(); } }, '● Enregistrer au clavier'),
            h('button', { class: 'ghost', title: 'Garde aussi le temps entre les touches', onclick: () => { kbRecord(true, true); renderKeyboard(); } }, '● Enregistrer avec les pauses')],
        kbRec ? null : h('button', { class: 'ghost', onclick: () => { steps.push({ t: 'delay', ms: 100 }); kbDraft.dirty = true; renderKeyboard(); } }, '+ Pause'),
        !kbRec && steps.length ? h('button', { class: 'ghost', onclick: () => { steps.length = 0; kbDraft.dirty = true; renderKeyboard(); } }, 'Tout effacer') : null),
      h('div', { class: 'muted small' }, kbRec
        ? 'Les touches tapées ici sont capturées par PeriphHub (elles n’agissent pas sur la fenêtre). La touche Windows et les raccourcis système ne peuvent pas être capturés.'
        : `Mémoire du clavier : ${used} / ${kb.macroSize} octets.`)),
    field('Touche',
      h('div', { class: 'muted small' }, keys.length
        ? 'Lancée par : ' + keys.join(', ') + '.'
        : 'Affectée à aucune touche : dans « Touches », choisissez une touche (par exemple avec Fn) puis cette macro dans la liste.')),
    h('div', { class: 'row-inline' },
      h('button', { disabled: !!kbRec || !pending || used > kb.macroSize, onclick: () =>
        kbDo(pending > 1 ? `${pending} macros enregistrées` : 'Macro enregistrée', async () => { await kb.writeMacros(all); kbDrafts = {}; }) },
        'Enregistrer dans le clavier'),
      kbDraft.dirty && !kbRec ? h('button', { class: 'ghost', onclick: () => { delete kbDrafts[kbMacro]; renderKeyboard(); } }, 'Annuler les changements') : null,
      pending ? h('span', { class: 'muted small' }, pending > 1 ? `${pending} macros modifiées (•) pas encore enregistrées` : 'Modifications pas encore enregistrées') : null),
  );
}

// ----- Course et rapid trigger -----

function renderKbTravel(box) {
  const keys = [...Array(REKT_KEYS).keys()].filter(i => kb.isKey(i));

  const grid = kbGrid(i => {
    const rt = kb.rt[i] || {};
    return {
      cls: kbSel.has(i) ? ' sel' : '',
      title: `Activation à ${mmFr(kb.act[i])} · rapid trigger ${rt.on ? `${mmFr(rt.trigger)} / ${mmFr(rt.reset)}` : 'désactivé'}`,
      onclick: () => { kbSel.has(i) ? kbSel.delete(i) : kbSel.add(i); renderKeyboard(); },
      kids: [h('span', { class: 'kl' }, rektKeyLabel(kb.layout[i])),
        h('span', { class: 'kv' }, mm(kb.act[i])),
        h('span', { class: 'kv rt' + (rt.on ? '' : ' off') }, rt.on ? 'RT ' + mm(rt.trigger) : 'RT off')],
    };
  });

  const sel = [...kbSel];
  const selAct = common(sel.map(i => kb.act[i]));
  const selRt = sel.map(i => kb.rt[i]);
  const rtOn = common(selRt.map(r => r.on));
  const rtTrig = common(selRt.map(r => r.trigger));
  const rtReset = common(selRt.map(r => r.reset));
  const num = (value, [lo, hi], id) => h('input', { type: 'number', id, min: lo / 100, max: hi / 100, step: 0.05,
    value: value === '' ? '' : mm(value), placeholder: value === '' ? 'mixte' : null });
  const read = id => Math.round(Number($(id).value) * 100);
  const none = sel.length === 0;
  const pickGroup = codes => { kbSel = new Set(keys.filter(i => codes.includes(kb.layout[i]))); renderKeyboard(); };
  const origin = kbOrigin();

  box.append(
    h('h3', { class: 'sect' }, 'Réglage rapide'),
    h('p', { class: 'muted small' }, 'Un clic règle toutes les touches. « Annuler » remet l’état d’avant.'),
    h('div', { class: 'presets' }, KB_PRESETS.map(p => h('button', {
      class: 'preset' + (kbPresetActive(keys, p) ? ' on' : ''),
      onclick: () => kbApply('Réglage « ' + p.name + ' »', async () => {
        await kb.applyAct(keys, p.act);
        await kb.applyRt(keys, p.rt.on ? p.rt : { on: false });
      }),
    }, h('strong', {}, p.name), h('span', { class: 'small' }, p.desc),
      h('span', { class: 'small muted' }, `Activation ${mmFr(p.act)} · ` + (p.rt.on ? `rapid trigger ${mmFr(p.rt.trigger)}` : 'sans rapid trigger'))))),
    h('div', { class: 'row-inline' },
      h('button', { class: 'ghost', disabled: !kbUndo, onclick: () => kbRestore('Annulation', kbUndo) }, '↶ Annuler la dernière modification'),
      origin ? h('button', { class: 'ghost', onclick: () => kbRestore('Retour aux réglages d’origine', origin) },
        'Revenir aux réglages du ' + new Date(origin.date).toLocaleDateString(LOCALE)) : null),

    h('h3', { class: 'sect' }, 'Réglage touche par touche'),
    h('p', { class: 'muted small' }, 'Cliquez sur des touches (ou choisissez un groupe), puis réglez-les en dessous. Sur chaque touche : profondeur d’activation en mm, et rapid trigger (RT).'),
    h('div', { class: 'row-inline kbtools' },
      h('button', { class: 'ghost', onclick: () => { kbSel = new Set(keys); renderKeyboard(); } }, 'Toutes'),
      KB_GROUPS.map(g => h('button', { class: 'ghost', onclick: () => pickGroup(g.codes) }, g.name)),
      h('button', { class: 'ghost', onclick: () => { kbSel.clear(); renderKeyboard(); } }, 'Aucune'),
      h('span', { class: 'muted small' }, sel.length ? `${sel.length} touche(s) sélectionnée(s)` : 'aucune touche sélectionnée')),
    grid,
    field('Profondeur d’activation',
      h('div', { class: 'row-inline' }, num(selAct, REKT_LIMITS.act, 'kbAct'), h('span', { class: 'muted' }, 'mm'),
        h('button', { disabled: none, onclick: () => kbApply('Activation', () => kb.applyAct(sel, read('kbAct'))) }, 'Appliquer')),
      h('div', { class: 'muted small' }, 'À quelle profondeur la touche compte (0,10 à 3,40 mm). Petit = plus réactif, grand = moins de fautes de frappe.')),
    field('Rapid trigger',
      h('div', { class: 'rtbox' },
        toggle('Activé', rtOn === true, on => { if (!none) kbApply(on ? 'Rapid trigger activé' : 'Rapid trigger désactivé', () => kb.applyRt(sel, { on })); }, none),
        h('div', { class: 'row-inline' }, h('span', { class: 'muted rtl' }, 'Ré-appui après'), num(rtTrig, REKT_LIMITS.rt, 'kbTrig'), h('span', { class: 'muted' }, 'mm')),
        h('div', { class: 'row-inline' }, h('span', { class: 'muted rtl' }, 'Relâché après'), num(rtReset, REKT_LIMITS.rt, 'kbReset'), h('span', { class: 'muted' }, 'mm')),
        h('button', { disabled: none, onclick: () => {
          const patch = {};
          if ($('kbTrig').value !== '') patch.trigger = read('kbTrig');
          if ($('kbReset').value !== '') patch.reset = read('kbReset');
          kbApply('Rapid trigger', () => kb.applyRt(sel, patch));
        } }, 'Appliquer')),
      h('div', { class: 'muted small' }, 'La touche se relâche dès qu’elle remonte un peu, et se réactive dès qu’elle redescend, n’importe où dans sa course. Idéal en jeu.')),
  );
}

async function connectKeyboard(dev) {
  if (kb) return;
  try {
    setStatus('kbStatus', 'Lecture du clavier…');
    const k = new RektKeyboard(dev);
    await k.open();
    await k.readAll();
    kb = k;
    setTitle('keyboard', dev);
    if (!kbOrigin()) {
      try { localStorage.setItem('kbOrigin', JSON.stringify({ date: Date.now(), act: k.act, rt: k.rt })); } catch {}
    }
    // États d'origine des touches et de l'éclairage (filets de sécurité pour « remettre d'origine »)
    try {
      if (!kbSaved('kbOriginKeys')) localStorage.setItem('kbOriginKeys', JSON.stringify({ date: Date.now(), layers: k.layers }));
      if (!kbSaved('kbOriginLight')) localStorage.setItem('kbOriginLight', JSON.stringify({ date: Date.now(), light: k.light }));
      if (!kbSaved('kbOriginMacros')) localStorage.setItem('kbOriginMacros', JSON.stringify({ date: Date.now(), macros: k.macros }));
    } catch {}
    window.periph = { ...window.periph, kb };
    $('kbConnect').hidden = true;
    setStatus('kbStatus', 'Connecté', 'ok');
    renderKeyboard();
  } catch (e) {
    console.error('[PeriphHub]', e);
    setStatus('kbStatus', 'Erreur : ' + e.message, 'err');
  }
}

$('kbConnect').onclick = async () => {
  if (!('hid' in navigator)) return setStatus('kbStatus', 'WebHID indisponible : ouvrir dans Chrome ou Edge.', 'err');
  const dev = RektKeyboard.pick(await navigator.hid.requestDevice({ filters: RektKeyboard.filters }));
  if (dev) connectKeyboard(dev);
  else setStatus('kbStatus', 'Interface de configuration introuvable.', 'err');
};

// ---------- Casque ----------

let hs = null;
let thx = null; // état THX (Thx.read), null = pas encore lu

async function hsApply(label, fn) {
  try {
    setStatus('hsStatus', label + '…');
    await fn();
    setStatus('hsStatus', label + ' ✔', 'ok');
  } catch (e) {
    console.error('[PeriphHub]', e);
    setStatus('hsStatus', 'Erreur : ' + e.message, 'err');
  }
  renderHeadset();
}

// Écrit un réglage THX puis met à jour l'état local (ou relit tout : un preset change l'EQ)
function thxApply(label, func, value, patch) {
  return hsApply(label, async () => {
    await Thx.set(func, value);
    if (patch) Object.assign(thx, patch);
    else thx = await Thx.read();
  });
}

async function loadThx() {
  thx = NATIVE ? await Thx.read() : { ok: false, browser: true };
  renderHeadset();
}


function slider(min, max, step, value, unit, onCommit, disabled = false) {
  const out = h('span', { class: 'val' }, value + unit);
  return h('div', { class: 'row-inline' },
    h('input', { type: 'range', min, max, step, value, disabled,
      oninput: e => { out.textContent = e.target.value + unit; },
      onchange: e => onCommit(Number(e.target.value)) }), out);
}

// Interrupteur + intensité (le curseur est grisé quand l'effet est coupé)
function levelRow(label, on, level, onToggle, onLevel, { min = 0, max = 100, step = 1, unit = ' %', hint = '' } = {}) {
  return h('div', { class: 'lvl' }, toggle(label, on, onToggle, false, hint), slider(min, max, step, Math.round(level), unit, onLevel, !on));
}

const fmtDb = v => (v > 0 ? '+' : '') + v + ' dB';

// Égaliseur 10 bandes ±12 dB ; chaque relâchement envoie les 10 valeurs
function eqEditor(bands, onCommit) {
  const vals = RAZER_EQ_FREQS.map((_, i) => bands[i] ?? 0);
  return h('div', { class: 'eq' }, RAZER_EQ_FREQS.map((f, i) => {
    const out = h('span', { class: 'eqv' }, fmtDb(vals[i]));
    return h('div', { class: 'eqb' }, out,
      h('input', { type: 'range', class: 'vert', min: -12, max: 12, step: 1, value: vals[i],
        oninput: e => { out.textContent = fmtDb(Number(e.target.value)); },
        onchange: e => { vals[i] = Number(e.target.value); onCommit([...vals]); } }),
      h('span', { class: 'muted small' }, f));
  }));
}

function thxPresetSelect(cur, presets, onPick) {
  const opt = p => h('option', { value: p, selected: p === cur }, thxPresetLabel(p));
  const games = presets.filter(p => !THX_GENERAL[p] && !THX_MUSIC[p])
    .sort((a, b) => thxPresetLabel(a).localeCompare(thxPresetLabel(b)));
  return h('select', { onchange: e => onPick(e.target.value) },
    h('optgroup', { label: 'Général' }, presets.filter(p => THX_GENERAL[p]).map(opt)),
    h('optgroup', { label: 'Musique' }, presets.filter(p => THX_MUSIC[p]).map(opt)),
    h('optgroup', { label: 'Profils de jeux' }, games.map(opt)));
}

function renderHsMeta() {
  const s = hs?.state || {};
  $('hsMeta').textContent = !hs ? '' : [
    s.battery != null ? `Batterie ${s.battery} %${s.charging ? ' (en charge)' : ''}` : null,
    s.fw ? `firmware ${s.fw}` : null].filter(Boolean).join(' · ');
  if (typeof refreshHome === 'function') refreshHome();
}

// Effets THX : message clair quand ils ne sont pas joignables
function thxUnavailable() {
  if (!thx) return h('p', { class: 'muted' }, 'Lecture des effets THX…');
  if (thx.browser) return h('p', { class: 'muted' }, 'Les effets THX ne sont réglables que dans l’appli PeriphHub (pas dans le navigateur).');
  // Moteur THX absent : il est installé avec Razer Synapse (PeriphHub ne le redistribue pas)
  if (/introuvable|refusée/.test(thx.error || '')) return h('div', { class: 'notice' },
    h('p', {}, 'Effets THX indisponibles : ils utilisent le moteur audio THX installé avec Razer Synapse. ',
      h('span', { class: 'muted' }, 'Installez Synapse une fois (vous pourrez ensuite le fermer et l’empêcher de démarrer) : PeriphHub réglera THX sans lui. ' +
        'Tous les autres réglages du casque fonctionnent sans Synapse.')),
    h('button', { class: 'ghost', onclick: () => { thx = null; renderHeadset(); loadThx(); } }, 'Réessayer'));
  return h('div', { class: 'notice' },
    h('p', {}, 'Effets THX indisponibles : le casque doit être la sortie audio par défaut de Windows ',
      h('span', { class: 'muted' }, '(icône haut-parleur de la barre des tâches ▸ choisir le casque).')),
    h('button', { class: 'ghost', onclick: () => { thx = null; renderHeadset(); loadThx(); } }, 'Réessayer'));
}

// ----- Profils du casque -----

// Champs THX (état lu par Thx.read) → fonction d'écriture
const THX_FIELDS = [
  ['spatial', 'SetRenderSpatialProcessing'], ['bassBoost', 'SetRenderBassBoost'], ['bassBoostLevel', 'SetRenderBassBoostLevel'],
  ['normalization', 'SetRenderNormalization'], ['normalizationLevel', 'SetRenderNormalizationLevel'],
  ['vocalClarity', 'SetRenderVocalClarity'], ['vocalClarityLevel', 'SetRenderVocalClarityLevel'],
  ['micNoiseReduction', 'SetCaptureNoiseReduction'], ['micNoiseReductionLevel', 'SetCaptureNoiseReductionLevel'],
  ['micVocalClarity', 'SetCaptureVocalClarity'], ['micVocalClarityLevel', 'SetCaptureVocalClarityLevel'],
  ['micNormalization', 'SetCaptureNormalization'], ['micNormalizationLevel', 'SetCaptureNormalizationLevel'],
  ['micVoiceGate', 'SetCaptureVoiceGate'], ['micVoiceGateLevel', 'SetCaptureVoiceGateLevel'],
  ['micHighpass', 'SetCaptureHighpass'], ['micHighpassLevel', 'SetCaptureHighpassLevel'],
  ['micEq', 'SetCaptureEQ'],
];

const HS_PROFILES = [{
  name: 'Polyvalent : jeu + Discord',
  desc: 'Stéréo propre (pas de 7.1 virtuel : positionnement précis et voix Discord naturelles), pas fins et voix mis en avant, '
    + 'explosions adoucies ; micro débarrassé du clavier et du souffle, voix au volume constant, sans porte de bruit '
    + '(Discord a déjà la sienne : deux portes coupent les débuts de phrases), et vous vous entendez un peu pour ne pas crier.',
  hw: { eqBands: [2, 2, 1, -1, -2, 0, 2, 3, 2, 1], sidetone: 1, sidetoneLevel: 4 },
  thx: {
    spatial: false, bassBoost: false,
    normalization: true, normalizationLevel: 40,
    vocalClarity: true, vocalClarityLevel: 30,
    micNoiseReduction: true, micNoiseReductionLevel: 60,
    micVocalClarity: true, micVocalClarityLevel: 30,
    micNormalization: true, micNormalizationLevel: 50,
    micVoiceGate: false,
    micHighpass: true, micHighpassLevel: 100,
    micEq: false,
  },
}];

function hsSnapshot() {
  const s = hs.state;
  return {
    date: Date.now(),
    eqScale: 2, // bandes dans l'échelle écrite (avant : relues avec la marge de -5 dB du casque)
    hw: { eqPreset: s.eqPreset, eqBands: s.eqBands ? [...s.eqBands] : null, sidetone: s.sidetone, sidetoneLevel: s.sidetoneLevel },
    thx: thx?.ok ? Object.fromEntries(THX_FIELDS.map(([k]) => [k, thx[k]]).filter(([, v]) => v != null)) : {},
  };
}

// Applique un profil (ou un instantané) : casque d'abord, puis THX ; les niveaux après les interrupteurs
async function hsApplyProfile(p) {
  const hw = { ...p.hw };
  // Instantané d'avant la correction de lecture : bandes décalées de -5
  if (p.date && p.eqScale !== 2 && hw.eqBands) hw.eqBands = hw.eqBands.map(v => Math.min(12, v + RAZER_EQ_READ_OFFSET));
  if (hw.eqPreset != null && hw.eqPreset !== 255) await hs.setEqPreset(hw.eqPreset);
  else if (hw.eqBands) await hs.setEqBands(hw.eqBands);
  if (hw.sidetone != null) await hs.setSidetone(!!hw.sidetone);
  if (hw.sidetoneLevel != null) await hs.setSidetoneLevel(hw.sidetoneLevel);
  if (thx?.ok) {
    for (const [k, func] of THX_FIELDS) if (k in p.thx && !k.endsWith('Level')) await Thx.set(func, p.thx[k]);
    for (const [k, func] of THX_FIELDS) if (k in p.thx && k.endsWith('Level')) await Thx.set(func, p.thx[k]);
    thx = await Thx.read();
  }
}

function hsProfilesField() {
  const before = kbSaved('hsBeforeProfile');
  return field('Profil',
    h('div', { class: 'row-inline' }, HS_PROFILES.map(p => h('button', { title: p.desc, onclick: () => hsApply(p.name, async () => {
      try { localStorage.setItem('hsBeforeProfile', JSON.stringify(hsSnapshot())); } catch {}
      await hsApplyProfile(p);
    }) }, 'Appliquer « ' + p.name + ' »')),
      before ? h('button', { class: 'ghost', onclick: () => hsApply('Réglage précédent', async () => {
        await hsApplyProfile(before);
        try { localStorage.removeItem('hsBeforeProfile'); } catch {}
      }) }, 'Revenir au réglage du ' + new Date(before.date).toLocaleString(LOCALE, { dateStyle: 'short', timeStyle: 'short' })) : null),
    h('div', { class: 'muted small' }, HS_PROFILES[0].desc));
}

function renderHeadset() {
  const box = $('hsBody');
  box.replaceChildren();
  renderHsMeta();
  if (!hs) return;
  const s = hs.state;
  const t = thx?.ok ? thx : null;

  const sound = [
    field('Égaliseur du casque',
      segmented(RAZER_EQ_PRESETS, s.eqPreset, v => hsApply('Égaliseur', () => hs.setEqPreset(v))),
      s.eqBands ? eqEditor(s.eqBands, b => hsApply('Égaliseur personnalisé', () => hs.setEqBands(b))) : null,
      h('div', { class: 'muted small' }, 'Enregistré dans le casque : s’applique partout (PC, console, téléphone). Toucher une bande passe en « Personnalisé ».')),
  ];
  if (t) sound.push(
    field('THX Spatial Audio', toggle('Son spatial 7.1', t.spatial,
      on => thxApply(on ? 'THX Spatial activé' : 'THX Spatial désactivé', 'SetRenderSpatialProcessing', on, { spatial: on }))),
    t.spatial ? field('Mode THX', thxPresetSelect(t.preset, t.presets, p => thxApply('Mode ' + thxPresetLabel(p), 'SetRenderPreset', p))) : null,
    t.spatial ? field('Égaliseur THX', eqEditor(t.eq, b => thxApply('Égaliseur THX', 'SetRenderEQGains', b, { eq: b })),
      h('button', { class: 'ghost', onclick: () => thxApply('Égaliseur d’origine du mode', 'ResetRenderPreset', t.preset) },
        'Rétablir l’égaliseur d’origine du mode')) : null,
    field('Améliorations', h('div', { class: 'lvls' },
      levelRow('Renfort des basses', t.bassBoost, t.bassBoostLevel,
        on => thxApply('Renfort des basses', 'SetRenderBassBoost', on, { bassBoost: on }),
        v => thxApply('Renfort des basses', 'SetRenderBassBoostLevel', v, { bassBoostLevel: v })),
      levelRow('Normalisation du son', t.normalization, t.normalizationLevel,
        on => thxApply('Normalisation', 'SetRenderNormalization', on, { normalization: on }),
        v => thxApply('Normalisation', 'SetRenderNormalizationLevel', v, { normalizationLevel: v }),
        { hint: 'Réduit les écarts de volume (explosions fortes, dialogues faibles)' }),
      levelRow('Clarté vocale', t.vocalClarity, t.vocalClarityLevel,
        on => thxApply('Clarté vocale', 'SetRenderVocalClarity', on, { vocalClarity: on }),
        v => thxApply('Clarté vocale', 'SetRenderVocalClarityLevel', v, { vocalClarityLevel: v }),
        { hint: 'Fait ressortir les voix (coéquipiers, dialogues)' }))),
  );
  else sound.push(field('Effets THX', thxUnavailable()));

  const mic = [
    field('Retour micro', levelRow('S’entendre parler', !!s.sidetone, s.sidetoneLevel ?? 0,
      on => hsApply('Retour micro', () => hs.setSidetone(on)),
      v => hsApply('Niveau du retour micro', () => hs.setSidetoneLevel(v)),
      { max: 15, unit: ' / 15' })),
  ];
  if (t) mic.push(
    field('Traitement du micro', h('div', { class: 'lvls' },
      levelRow('Réduction du bruit', t.micNoiseReduction, t.micNoiseReductionLevel,
        on => thxApply('Réduction du bruit', 'SetCaptureNoiseReduction', on, { micNoiseReduction: on }),
        v => thxApply('Réduction du bruit', 'SetCaptureNoiseReductionLevel', v, { micNoiseReductionLevel: v }),
        { hint: 'Retire clavier, ventilateurs, bruits de fond' }),
      levelRow('Clarté vocale', t.micVocalClarity, t.micVocalClarityLevel,
        on => thxApply('Clarté vocale du micro', 'SetCaptureVocalClarity', on, { micVocalClarity: on }),
        v => thxApply('Clarté vocale du micro', 'SetCaptureVocalClarityLevel', v, { micVocalClarityLevel: v })),
      levelRow('Normalisation', t.micNormalization, t.micNormalizationLevel,
        on => thxApply('Normalisation du micro', 'SetCaptureNormalization', on, { micNormalization: on }),
        v => thxApply('Normalisation du micro', 'SetCaptureNormalizationLevel', v, { micNormalizationLevel: v }),
        { hint: 'Volume de votre voix constant, que vous parliez fort ou doucement' }),
      levelRow('Porte de bruit', t.micVoiceGate, t.micVoiceGateLevel,
        on => thxApply('Porte de bruit', 'SetCaptureVoiceGate', on, { micVoiceGate: on }),
        v => thxApply('Porte de bruit', 'SetCaptureVoiceGateLevel', v, { micVoiceGateLevel: v }),
        { min: -70, max: -20, unit: ' dB', hint: 'Le micro reste muet tant que le son est sous ce seuil' }),
      levelRow('Filtre passe-haut', t.micHighpass, t.micHighpassLevel,
        on => thxApply('Filtre passe-haut', 'SetCaptureHighpass', on, { micHighpass: on }),
        v => thxApply('Filtre passe-haut', 'SetCaptureHighpassLevel', v, { micHighpassLevel: v }),
        { min: 75, max: 400, step: 5, unit: ' Hz', hint: 'Coupe les graves sous cette fréquence (souffle, vibrations du bureau)' }))),
    field('Égaliseur du micro',
      toggle('Activé', t.micEq, on => thxApply('Égaliseur du micro', 'SetCaptureEQ', on, { micEq: on })),
      t.micEq ? eqEditor(t.micEqGains, b => thxApply('Égaliseur du micro', 'SetCaptureEQGains', b, { micEqGains: b })) : null),
  );

  box.append(
    hsProfilesField(),
    h('h3', { class: 'sect' }, 'Son'), ...sound.filter(Boolean),
    h('h3', { class: 'sect' }, 'Micro'), ...mic,
    h('h3', { class: 'sect' }, 'Casque'),
    field('Arrêt automatique', segmented(RAZER_AUTO_OFF, s.autoOff, v => hsApply('Arrêt automatique', () => hs.setAutoOff(v)))),
    ...audioEmbedRows(hs.dev),
  );
}

async function connectHeadset(dev) {
  if (hs) return;
  try {
    setStatus('hsStatus', 'Lecture du casque…');
    const x = new RazerHeadset(dev);
    await x.open();
    await x.readAll();
    hs = x;
    setTitle('headset', dev);
    window.periph = { ...window.periph, hs };
    loadThx();
    $('hsConnect').hidden = true;
    setStatus('hsStatus', 'Connecté', 'ok');
    renderHeadset();
    audioPoll(); // réglages son Windows du même casque, intégrés à cette page
  } catch (e) {
    console.error('[PeriphHub]', e);
    setStatus('hsStatus', 'Erreur : ' + e.message, 'err');
  }
}

$('hsConnect').onclick = async () => {
  if (!('hid' in navigator)) return setStatus('hsStatus', 'WebHID indisponible : ouvrir dans Chrome ou Edge.', 'err');
  const dev = RazerHeadset.pick(await navigator.hid.requestDevice({ filters: RazerHeadset.filters }));
  if (dev) connectHeadset(dev);
  else setStatus('hsStatus', 'Interface de configuration introuvable.', 'err');
};

// Batterie relue chaque minute (en-tête seulement : ne gêne pas un curseur en cours)
setInterval(() => {
  if (hs && !document.hidden) hs.refreshBattery().then(renderHsMeta, () => {});
}, 60000);
// Retour sur la fenêtre après avoir changé la sortie audio : on retente THX
window.addEventListener('focus', () => { if (hs && thx && !thx.ok && !thx.browser) loadThx(); });

// ---------- Éclairage (carte mère) ----------

let rgb = null;
// Le contrôleur ne se relit pas : on garde le dernier réglage choisi ici
let rgbZones = (() => { try { return JSON.parse(localStorage.getItem('rgbZones')) || {}; } catch { return {}; } })();
const RGB_SWATCHES = ['#ff2a2a', '#ff7a00', '#ffd400', '#2bff4f', '#00e5ff', '#2a5bff', '#a020ff', '#ff3ccf', '#ffffff'];

async function rgbApply(label, fn) {
  try {
    setStatus('rgbStatus', label + '…');
    await fn();
    setStatus('rgbStatus', label + ' ✔', 'ok');
  } catch (e) {
    console.error('[PeriphHub]', e);
    setStatus('rgbStatus', 'Erreur : ' + e.message, 'err');
  }
}

// Envoie le réglage d'une zone (les modifications rapprochées sont regroupées)
const rgbTimers = {};
function rgbSet(idx, patch, now = false) {
  const z = rgbZones[idx] = { effect: 1, color: '#ffffff', speed: 4, brightness: 255, ...rgbZones[idx], ...patch };
  try { localStorage.setItem('rgbZones', JSON.stringify(rgbZones)); } catch {}
  clearTimeout(rgbTimers[idx]);
  const send = () => rgbApply('Éclairage', async () => {
    await rgb.enableBuiltinEffects();
    await rgb.setEffect(idx, z);
    await rgb.apply();
  });
  if (now) send(); else rgbTimers[idx] = setTimeout(send, 60);
}

function renderRgb() {
  const box = $('rgbBody');
  box.replaceChildren();
  $('rgbMeta').textContent = rgb?.info ? `Contrôleur ${rgb.info.name} · zones de la B650 EAGLE AX` : '';
  if (!rgb) return;
  const zoneField = zone => {
    const z = rgbZones[zone.idx];
    const animated = z && [2, 3, 4, 6].includes(z.effect);
    const colored = z && [1, 2, 3].includes(z.effect);
    return field(h('span', {}, zone.name, h('div', { class: 'muted small' }, zone.desc)),
      segmented(FUSION2_EFFECTS, z?.effect, v => { rgbSet(zone.idx, { effect: v }, true); renderRgb(); }),
      !z ? h('div', { class: 'muted small' }, 'Réglage actuel inconnu (choisi dans Gigabyte Control Center). Choisissez un effet pour le remplacer.') : null,
      colored ? h('div', { class: 'row-inline' },
        h('input', { type: 'color', value: z.color, oninput: e => rgbSet(zone.idx, { color: e.target.value }) }),
        RGB_SWATCHES.map(c => h('button', { class: 'swatch' + (c === z.color ? ' on' : ''), style: `background:${c}`, title: c,
          onclick: () => { rgbSet(zone.idx, { color: c }, true); renderRgb(); } }))) : null,
      z && z.effect ? h('div', { class: 'lvls' },
        h('div', { class: 'lvl' }, h('span', { class: 'muted' }, 'Luminosité'),
          slider(0, 100, 5, Math.round(z.brightness / 2.55), ' %', v => rgbSet(zone.idx, { brightness: Math.round(v * 2.55) }, true))),
        animated ? h('div', { class: 'lvl' }, h('span', { class: 'muted' }, 'Vitesse'),
          slider(1, 10, 1, 10 - z.speed, '', v => rgbSet(zone.idx, { speed: 10 - v }, true))) : null) : null);
  };
  box.append(
    h('h3', { class: 'sect' }, 'Zones'),
    ...FUSION2_ZONES.map(zoneField),
    h('h3', { class: 'sect' }, 'Garder cet éclairage'),
    field('Enregistrer dans la carte',
      h('button', { onclick: () => rgbApply('Enregistrement dans la carte', () => rgb.save()) }, 'Enregistrer'),
      h('div', { class: 'muted small' }, 'Sans enregistrement, la carte reprend son ancien éclairage au prochain démarrage. Enregistré, il reste actif sans PeriphHub ni Gigabyte Control Center.')),
  );
}

async function connectRgb(dev) {
  if (rgb) return;
  try {
    setStatus('rgbStatus', 'Lecture du contrôleur…');
    const g = new GigabyteRgb(dev);
    await g.open();
    await g.readInfo();
    rgb = g;
    setTitle('rgb', dev);
    setStatus('rgbStatus', 'Connecté', 'ok');
    renderRgb();
  } catch (e) {
    console.error('[PeriphHub]', e);
    setStatus('rgbStatus', 'Erreur : ' + e.message, 'err');
  }
}

// ---------- Connexion automatique ----------

async function autoConnect() {
  if (!('hid' in navigator)) return;
  const granted = await navigator.hid.getDevices();
  // Les autres souris à puce CompX que reconnaît OpenMouse ont leur page générique (drivers/openmouse.js)
  const m = ScyroxMouse.pick(granted.filter(d => d.vendorId === 0x3554 && !window.omApi?.claims(d, granted)));
  if (m && !mouse) connectMouse(m);
  const k = RektKeyboard.pick(granted);
  if (k && !kb) connectKeyboard(k);
  const c = RazerHeadset.pick(granted);
  if (c && !hs) connectHeadset(c);
  const g = GigabyteRgb.pick(granted);
  if (g && !rgb) connectRgb(g);
}


navigator.hid?.addEventListener('connect', autoConnect);
navigator.hid?.addEventListener('disconnect', e => {
  if (mouse && e.device === mouse.dev) {
    mouse = null;
    $('mouseConnect').hidden = false;
    $('mouseMeta').textContent = '';
    setStatus('mouseStatus', 'Dongle débranché');
    renderMouse();
  }
  if (kb && e.device === kb.dev) {
    kb = null;
    $('kbConnect').hidden = false;
    setStatus('kbStatus', 'Clavier débranché');
    renderKeyboard();
  }
  if (rgb && e.device === rgb.dev) {
    rgb = null;
    setStatus('rgbStatus', 'Contrôleur débranché');
    renderRgb();
  }
  if (hs && e.device === hs.dev) {
    hs = null;
    thx = null;
    $('hsConnect').hidden = false;
    setStatus('hsStatus', 'Dongle débranché');
    renderHeadset();
    audioPoll();
  }
});
autoConnect();
