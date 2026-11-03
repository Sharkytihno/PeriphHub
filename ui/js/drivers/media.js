// PeriphHub — son, webcams et manettes Xbox, par les interfaces standard de Windows
// (src-tauri/src/audio.rs, camera.rs, pads.rs). Aucune marque à connaître : micros USB (HyperX
// QuadCast, Blue Yeti, Rode, Shure, Elgato Wave, Razer Seiren, Fifine…), cartes son, DAC, sorties
// HDMI, webcams UVC (Logitech, Razer Kiyo, Elgato Facecam, AVerMedia…) et manettes XInput.
// Ces réglages remplacent Logi Tune, Elgato Camera Hub, Razer Synapse (Kiyo, Seiren), Shure MOTIV,
// RØDE Central… pour l'essentiel : on peut alors fermer ces logiciels (page Allègement).

const MEDIA_CHIP = { text: 'Windows', title: 'Réglages standard de Windows : fonctionnent avec toutes les marques' };
const mediaLive = new Map(); // clé → instance

// ---------- Son ----------

// Rôle par défaut → libellé
const AUDIO_ROLE = { render: 'Sortie par défaut', 'render-comms': 'Sortie des appels', capture: 'Micro par défaut', 'capture-comms': 'Micro des appels' };
// PKEY_AudioEndpoint_FormFactor : 1 haut-parleurs, 3 casque audio, 4 micro, 5 micro-casque, 9 écran (HDMI / DisplayPort)
const AUDIO_FORM = { 1: 'Haut-parleurs', 2: 'Sortie ligne', 3: 'Casque', 4: 'Micro', 5: 'Micro-casque', 6: 'Combiné', 8: 'Sortie numérique (S/PDIF)', 9: 'Écran' };

// Micros USB courants (ceux qui ont aussi une prise casque, donc une sortie audio)
const AUDIO_MICS = /\b(mic|micro|microphone|quadcast|solocast|duocast|yeti|snowball|seiren|wave[: ]?\d|wave xlr|podcaster|podmic|nt-usb|videomic|mv\d+|ampligame|fifine|samson|at2020|atr2100|hyperx procast|maono|tonor|trust gxt 2\d\d|streamplify|sennheiser profile)\b/i;

// Son intégré au PC ou virtuel : puces de la carte mère (Realtek, y compris celles branchées en USB
// interne sur les cartes ASUS / MSI récentes), sorties HDMI des cartes graphiques, pilotes virtuels.
// Masqués par défaut : seuls les vrais périphériques (casques, micros, DAC, enceintes USB / Bluetooth)
// ont un onglet. Options ▸ Son : « Tout afficher ».
const AUDIO_BUILTIN = /realtek|nvidia|\bamd\b|radeon|intel\(r\)|intel display|high definition audio|hd audio|\bhdmi\b|displayport|steam streaming|virtual|voicemeeter|vb-audio|\bcable (in|out)put|broadcast|sonar|nahimic|oculus|wave link|droidcam|obs\b|microsoft teams/i;
const audioAll = () => { try { return localStorage.getItem('audioAll') === 'on'; } catch { return false; } };

function audioPeripheral(g) {
  const bus = g.eps.map(e => e.bus);
  if (!bus.some(b => b === 'usb' || b === 'bluetooth')) return false; // carte mère ou virtuel
  if (g.eps.every(e => e.form === 9)) return false; // écran
  if (g.vid === 0x0DB0) return false; // son USB interne des cartes mères MSI
  return !AUDIO_BUILTIN.test(g.name);
}

// Un appareil physique = les points de terminaison qui partagent le même USB (VID:PID) ou le même adaptateur
function audioGroups(list) {
  const groups = new Map();
  for (const e of list) {
    const key = e.vid != null ? `usb-${hex4(e.vid)}${hex4(e.pid)}` : 'ad-' + (e.adapter || e.name).replace(/^\d+-\s*/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return [...groups].map(([key, eps]) => {
    const adapter = (eps[0].adapter || eps[0].name).replace(/^\d+-\s*/, '');
    const hdmi = eps.every(e => e.form === 9);
    const capture = eps.some(e => e.flow === 'capture'), render = eps.some(e => e.flow === 'render');
    // Les micros USB ont souvent une prise casque (sortie de contrôle) : le nom tranche
    const mic = AUDIO_MICS.test(adapter);
    const kind = mic || (capture && !render) ? 'micro' : eps.some(e => e.form === 3 || e.form === 5) || (capture && render && eps[0].vid != null) ? 'casque' : 'audio';
    const name = hdmi ? `Son des écrans (${adapter.replace(/high definition audio( device)?/i, '').trim() || 'HDMI'})` : adapter;
    eps.sort((a, b) => (a.flow === b.flow ? 0 : a.flow === 'render' ? -1 : 1));
    return { key: 'drv-audio-' + key, name, kind, eps, vid: eps[0].vid, pid: eps[0].pid };
  });
}

const fmtLabel = f => `${(f.rate / 1000).toLocaleString(LOCALE, { maximumFractionDigits: 1 })} kHz · ${f.bits} bits`;

function audioInstance(g) {
  const formats = new Map(); // id → formats acceptés (lus à la demande)
  const inst = {
    key: g.key, name: g.name, kind: g.kind, chip: MEDIA_CHIP, noOrigin: true,
    dev: { vendorId: g.vid ?? 0, productId: g.pid ?? 0, productName: g.name },
    caps: { audio: true }, state: { eps: g.eps },
    source: 'Réglages audio standard de Windows (les mêmes que le panneau Son), valables pour toutes les marques. ' +
      'Windows les garde en mémoire : rien ne tourne en fond pour eux.',
    meta: [...new Set(g.eps.map(e => e.bus).filter(Boolean))].map(b => b === 'usb' ? 'USB' : b === 'bluetooth' ? 'Bluetooth' : 'Carte mère').join(', '),
    async set(cap, v) {
      await nativeInvoke('audio_set', { id: v.id, what: v.what, value: v.value });
    },
    refresh: () => audioPoll(),
    rows() {
      return inst.state.eps.map(e => {
        const set = (label, what, value) => drvSet(inst, label, 'audio', { id: e.id, what, value });
        const roles = (e.default || []).map(r => AUDIO_ROLE[r]);
        const isMain = e.default?.includes(e.flow), isComms = e.default?.includes(e.flow + '-comms');
        const what = e.flow === 'capture' ? 'micro' : 'sortie';
        const fl = formats.get(e.id);
        if (!formats.has(e.id)) {
          formats.set(e.id, null);
          // Une entrée par fréquence et profondeur (24 bits existe parfois en deux conteneurs : on garde le premier)
          nativeInvoke('audio_formats', { id: e.id }).then(f => {
            formats.set(e.id, f.filter((x, i) => f.findIndex(y => y.rate === x.rate && y.bits === x.bits) === i));
            drvRender(inst);
          }, () => formats.set(e.id, []));
        }
        const label = (e.desc && e.desc !== e.name ? e.desc : AUDIO_FORM[e.form] || (e.flow === 'capture' ? 'Entrée' : 'Sortie'));
        return field(label,
          roles.length ? h('div', { class: 'row-inline' }, roles.map(r => h('span', { class: 'chip supported' }, r))) : null,
          e.volume != null ? h('div', {}, h('div', { class: 'muted small' }, e.flow === 'capture' ? 'Niveau du micro' : 'Volume'),
            slider(0, 100, 1, e.volume, ' %', v => set(e.flow === 'capture' ? 'Niveau du micro' : 'Volume', 'volume', v))) : null,
          e.mute != null ? h('div', { class: 'toggles' }, toggle(e.flow === 'capture' ? 'Micro coupé' : 'Son coupé', e.mute, on => set(on ? 'Coupé' : 'Rétabli', 'mute', on))) : null,
          e.balance != null && e.flow === 'render' ? h('div', {}, h('div', { class: 'muted small' }, 'Balance (gauche ↔ droite)'),
            slider(-100, 100, 5, e.balance, '', v => set('Balance', 'balance', v))) : null,
          !isMain || !isComms ? h('div', { class: 'row-inline' },
            !isMain ? h('button', { class: 'mini', onclick: () => set(`${e.name} par défaut`, 'default', 'all') }, `Utiliser comme ${what} par défaut`) : null,
            !isComms ? h('button', { class: 'mini ghost', onclick: () => set('Appels', 'default', 'comms') }, isMain ? 'Aussi pour les appels' : 'Seulement pour les appels') : null) : null,
          fl?.length > 1 ? h('div', {}, h('div', { class: 'muted small' }, 'Qualité (format utilisé par Windows)'),
            h('select', { onchange: ev => { const f = fl[Number(ev.target.value)]; set(fmtLabel(f), 'format', f); } },
              fl.map((f, i) => h('option', { value: i, selected: e.format && f.rate === e.format.rate && f.bits === e.format.bits }, fmtLabel(f))))) :
            e.format ? h('div', { class: 'muted small' }, 'Format : ' + fmtLabel(e.format)) : null);
      });
    },
  };
  return inst;
}

// Casque déjà piloté par un pilote HID (même VID:PID, ex. Razer BlackShark) : ses réglages Windows
// rejoignent la page de ce casque au lieu d'ouvrir un second onglet « Casque » pour le même appareil.
const audioInsts = new Map(); // clé → instance audio, affichée seule ou intégrée
const audioEmbedded = new Map(); // "vid:pid" → instance audio intégrée à la page d'un casque
const devVp = d => `${d.vendorId}:${d.productId}`;

function audioOwner(g) {
  if (g.vid == null) return null;
  const k = `${g.vid}:${g.pid}`;
  if (typeof hs !== 'undefined' && hs?.dev && devVp(hs.dev) === k) return () => renderHeadset();
  for (const i of drvLive.values()) if (!i.chip && i.dev && devVp(i.dev) === k) return () => drvRender(i);
  return null;
}

// Lignes « Son (Windows) » à ajouter à la page d'un casque HID
function audioEmbedRows(dev) {
  const a = dev && audioEmbedded.get(devVp(dev));
  return a ? [h('h3', { class: 'sect' }, 'Son (Windows)'), ...a.rows()] : [];
}

let audioPolling = null;
function audioPoll() {
  if (!NATIVE) return Promise.resolve();
  audioPolling ||= (async () => {
    try {
      const groups = audioGroups(await nativeInvoke('audio_list'));
      const shown = [], embedded = new Map(), redraw = [];
      for (const g of groups) {
        let inst = audioInsts.get(g.key);
        const changed = !inst || JSON.stringify(inst.state.eps) !== JSON.stringify(g.eps);
        if (!inst) audioInsts.set(g.key, inst = audioInstance(g));
        else inst.state.eps = g.eps;
        const owner = audioOwner(g);
        inst.embed = owner;
        if (owner) {
          embedded.set(`${g.vid}:${g.pid}`, inst);
          if (changed || !audioEmbedded.has(`${g.vid}:${g.pid}`)) redraw.push(owner);
          // Affiché seul jusqu'ici : on retire son onglet sans annoncer de débranchement
          if (mediaLive.has(g.key)) { mediaLive.delete(g.key); drvRelease(inst.dev, true); }
        } else if (audioAll() || audioPeripheral(g)) {
          shown.push(inst);
          if (changed && mediaLive.has(g.key)) drvRender(inst);
        }
      }
      for (const k of [...audioInsts.keys()]) if (!groups.some(g => g.key === k)) audioInsts.delete(k);
      audioEmbedded.clear();
      for (const [k, i] of embedded) audioEmbedded.set(k, i);
      mediaSync('drv-audio-', shown);
      redraw.forEach(f => f());
    } catch (e) {
      console.warn('[PeriphHub] son', e);
    } finally {
      audioPolling = null;
    }
  })();
  return audioPolling;
}

// ---------- Webcams ----------

const CAM_LABEL = {
  brightness: 'Luminosité', contrast: 'Contraste', saturation: 'Saturation', sharpness: 'Netteté', gamma: 'Gamma', hue: 'Teinte',
  white_balance: 'Balance des blancs', backlight: 'Compensation du contre-jour', gain: 'Gain', exposure: 'Exposition', focus: 'Mise au point',
  zoom: 'Zoom', pan: 'Cadrage horizontal', tilt: 'Cadrage vertical', roll: 'Rotation', iris: 'Diaphragme', color: 'Couleur',
};
const CAM_ORDER = ['brightness', 'contrast', 'saturation', 'sharpness', 'gamma', 'hue', 'white_balance', 'exposure', 'gain', 'backlight', 'focus', 'zoom', 'pan', 'tilt', 'roll', 'iris'];
const CAM_GROUPS = [['Image', ['brightness', 'contrast', 'saturation', 'sharpness', 'gamma', 'hue', 'color']], ['Lumière', ['white_balance', 'exposure', 'gain', 'backlight']], ['Cadrage', ['zoom', 'pan', 'tilt', 'roll', 'focus', 'iris']]];
const CAM_POWERLINE = [{ v: 1, label: '50 Hz (Europe)' }, { v: 2, label: '60 Hz' }, { v: 3, label: 'Auto' }, { v: 0, label: 'Désactivé' }];

const camKey = c => 'drv-cam-' + (c.vid != null ? hex4(c.vid) + hex4(c.pid) + '-' : '') + c.path.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(-24);

function camInstance(c) {
  const inst = {
    key: camKey(c), name: c.name, kind: 'webcam', chip: MEDIA_CHIP, path: c.path,
    dev: { vendorId: c.vid ?? 0, productId: c.pid ?? 0, productName: c.name },
    caps: {}, state: {}, restoreCaps: [],
    source: 'Réglages vidéo standard des webcams (UVC), annoncés par la caméra elle-même : chaque valeur reste dans ses bornes. ' +
      'Certaines webcams oublient leurs réglages quand on les débranche : PeriphHub les renvoie à chaque branchement.',
    note: 'Si un logiciel (visio, OBS) remet ses propres réglages en ouvrant la caméra, ils l’emportent sur ceux-ci tant qu’il tourne.',
    meta: c.vid != null ? 'USB' : null,
    async set(cap, v) {
      const [control] = cap.split(':');
      await nativeInvoke('camera_set', { path: inst.path, control, value: v.value ?? 0, auto: !!v.auto });
      inst.state[cap] = v;
    },
    refresh: () => camPoll(),
    rows() {
      const s = inst.state, ctl = inst.controls || {};
      const set = (label, k, v) => drvSet(inst, label, k, v);
      const row = k => {
        const d = ctl[k];
        if (!d || d.min == null) return null;
        const st = s[k] || { value: d.value ?? d.default, auto: d.auto };
        const pct = d.max > d.min ? ` (${d.min} à ${d.max})` : '';
        return h('div', {}, h('div', { class: 'muted small' }, CAM_LABEL[k] + pct),
          d.can_auto ? h('div', { class: 'toggles' }, toggle('Automatique', !!st.auto, on => set(CAM_LABEL[k], k, { value: st.value, auto: on }))) : null,
          d.can_manual !== false && d.max > d.min ? slider(d.min, d.max, d.step, st.value ?? d.default, '', v => set(CAM_LABEL[k], k, { value: v, auto: false }), !!st.auto) : null,
          st.value !== d.default || st.auto !== (d.can_auto && d.auto) ? h('button', { class: 'mini ghost', onclick: () => set(CAM_LABEL[k], k, { value: d.default, auto: false }) }, 'Valeur d’usine') : null);
      };
      const out = CAM_GROUPS.map(([title, keys]) => {
        const rows = keys.map(row).filter(Boolean);
        return rows.length ? field(title, h('div', { class: 'stack' }, rows)) : null;
      });
      if (ctl.powerline) out.push(field('Anti-scintillement',
        segmented(CAM_POWERLINE, s.powerline?.value ?? ctl.powerline.value, v => set('Anti-scintillement', 'powerline', { value: v })),
        h('div', { class: 'muted small' }, 'En France, 50 Hz évite les bandes qui défilent sous un éclairage artificiel.')));
      return out;
    },
  };
  camUpdate(inst, c);
  return inst;
}

function camUpdate(inst, c) {
  inst.controls = c.controls;
  for (const [k, d] of Object.entries(c.controls)) {
    inst.caps[k] = true;
    if (!inst.restoreCaps.includes(k)) inst.restoreCaps.push(k);
    inst.state[k] = k === 'powerline' ? { value: d.value } : { value: d.value ?? d.default, auto: !!d.auto };
  }
}

let camPolling = null;
function camPoll() {
  if (!NATIVE) return Promise.resolve();
  camPolling ||= (async () => {
    try {
      const list = await nativeInvoke('camera_list');
      mediaSync('drv-cam-', await Promise.all(list.filter(c => Object.keys(c.controls).length).map(async c => {
        const old = mediaLive.get(camKey(c));
        if (old) {
          const before = JSON.stringify(old.state);
          camUpdate(old, c);
          if (JSON.stringify(old.state) !== before) drvRender(old);
          return old;
        }
        const inst = camInstance(c);
        // Réglages choisis dans PeriphHub renvoyés au branchement (beaucoup de webcams les oublient)
        const want = lsGet(wantKey(inst)) || {};
        for (const [cap, v] of Object.entries(want)) {
          if (inst.caps[cap] && JSON.stringify(inst.state[cap]) !== JSON.stringify(v)) await inst.set(cap, v).catch(() => {});
        }
        return inst;
      })));
    } catch (e) {
      console.warn('[PeriphHub] webcams', e);
    } finally {
      camPolling = null;
    }
  })();
  return camPolling;
}

// ---------- Manettes Xbox (XInput) ----------

// Niveau XInput : 0 vide, 1 faible, 2 moyen, 3 plein
const PAD_LEVEL = [{ level: 5, label: 'Batterie presque vide' }, { level: 30, label: 'Batterie faible' }, { level: 65, label: 'Batterie moyenne' }, { level: 100, label: 'Batterie pleine' }];

function padInstance(p) {
  const inst = {
    key: 'drv-xinput-' + p.slot, name: `Manette Xbox (joueur ${p.slot + 1})`, kind: 'manette', chip: MEDIA_CHIP, noOrigin: true,
    dev: { vendorId: 0x045E, productId: 0, productName: 'Manette XInput' },
    caps: { rumble: true }, state: {},
    source: 'XInput, l’interface manettes de Windows : manettes Xbox One / Series / Elite et compatibles (8BitDo, PowerA, Nacon…). ' +
      'Windows ne donne que quatre paliers de batterie.',
    async set(cap, v) { if (cap === 'rumble') await nativeInvoke('pads_rumble', { slot: p.slot, strength: v }); },
    refresh: () => Promise.resolve(),
    rows() {
      return [field('Vibrations', h('div', { class: 'row-inline' },
        [30, 70, 100].map(v => h('button', { class: 'mini ghost', onclick: () => inst.set('rumble', v).catch(e => toast('Erreur : ' + e, 'err')) }, `Tester ${v} %`))),
        h('div', { class: 'muted small' }, 'Fait vibrer la manette une demi-seconde pour vérifier qu’elle répond.'))];
    },
  };
  padUpdate(inst, p);
  return inst;
}

function padUpdate(inst, p) {
  const b = p.battery;
  inst.meta = p.wireless ? 'Sans fil' : 'Filaire';
  // Type 1 = filaire (pas de batterie), 0 = déconnectée
  if (b && b.type >= 2 && b.type !== 0xFF) inst.state.battery = { ...PAD_LEVEL[Math.min(b.level, 3)] };
  else delete inst.state.battery;
}

let padPolling = null;
function padPoll() {
  if (!NATIVE) return Promise.resolve();
  padPolling ||= (async () => {
    try {
      const list = await nativeInvoke('pads_list');
      mediaSync('drv-xinput-', list.map(p => {
        const old = mediaLive.get('drv-xinput-' + p.slot);
        if (old) {
          const before = JSON.stringify([old.state, old.meta]);
          padUpdate(old, p);
          if (JSON.stringify([old.state, old.meta]) !== before) drvRender(old);
          return old;
        }
        return padInstance(p);
      }));
    } catch (e) {
      console.warn('[PeriphHub] manettes', e);
    } finally {
      padPolling = null;
    }
  })();
  return padPolling;
}

// ---------- Commun ----------

// Ajoute les nouvelles instances d'une famille (préfixe de clé), retire celles qui ont disparu
function mediaSync(prefix, insts) {
  const seen = new Set();
  for (const inst of insts) {
    seen.add(inst.key);
    if (!mediaLive.has(inst.key)) {
      mediaLive.set(inst.key, inst);
      drvAdd(inst, { id: 'windows' });
    }
  }
  for (const [key, inst] of mediaLive) {
    if (key.startsWith(prefix) && !seen.has(key)) { mediaLive.delete(key); drvRelease(inst.dev); }
  }
}

function mediaPoll() {
  audioPoll();
  camPoll();
  padPoll();
}
// Branchements : pas d'événement Windows côté interface, on relit régulièrement (fenêtre visible)
setInterval(() => { if (!document.hidden) mediaPoll(); }, 10000);
if (typeof window !== 'undefined') window.addEventListener('focus', () => mediaPoll());
