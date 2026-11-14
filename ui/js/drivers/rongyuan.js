// PeriphHub — claviers de la plateforme Rongyuan (puces RY5088, YC3121, PAN1086…) : Attack Shark X68HE,
// Cherry, Womier, Ajazz, Aula, Madlions… — la plupart des claviers magnétiques (« Hall Effect ») chinois
// vendus avec le logiciel web qmk.top. Protocole relu dans ce pilote web officiel (qmk.top/v4) : réécrit
// ici, aucun code repris. Les modèles (ui/js/drivers/rongyuan-models.js) sont générés par
// scripts/build-rongyuan.py.
//
// Interface fabricant (page 0xFFFF, usage 2, interface 2 en général) : feature report 0 de 64 octets.
// Chaque commande est envoyée (SET_FEATURE), puis la réponse relue (GET_FEATURE) 10 ms plus tard ; elle
// recopie le numéro de commande dans son premier octet. Somme de contrôle :
//   « Bit7 » : octet 7 = 255 − (somme des octets 0 à 6) ; « Bit8 » : octet 8 = 255 − (somme des octets 0 à 7).
//
//   0x8F [143]            identité : réponse [143, id (uint32 LE), …, version USB (octets 7-8, LE)]
//   0x80 [128]            version radio : [128, version (octets 1-2, LE)]
//   0xE6 [230]            fonctions : [230, 0xAA, précision de la course (0 : 0,01 mm, 1 : 0,005, 2 : 0,001)]
//   0x83 [131] / 0x03     fréquence : octet 2 = 0 (8 kHz), 1 (4 kHz), 2, 3 (1 kHz), 4, 5, 6 (125 Hz)
//   0x87 [135] / 0x07     éclairage : [_, effet, 4 − vitesse, luminosité, option << 4 | 8 (arc-en-ciel)
//                         ou 7 (couleur), R, G, B] — écriture en « Bit8 »
//   0xE5 [229, op, 1, page]  réglages magnétiques par touche (4 pages de 64 octets : 128 valeurs de
//                         2 octets LE ; 2 pages pour les valeurs d'un octet) ; op 0 : point de
//                         déclenchement, 2/3 : sensibilité Rapid Trigger à l'appui / au relâchement,
//                         7 : mode de la touche (bit 0x80 : Rapid Trigger)
//   0x65 [101, op, 1, page, dernière, 0, 0, somme] + 56 octets : écriture des mêmes tableaux ; seule la
//                         dernière page de la dernière série porte « dernière » = 1 (le clavier enregistre)
//
// Les courses sont en unités de 0,1 / 0,01 / 0,005 / 0,001 mm selon le firmware (même règle que le
// logiciel officiel). Tout est gardé par le clavier lui-même (rien à renvoyer au branchement).
// Modèle inconnu de la table : rien n'est écrit, seule l'identité est affichée.

const RY_CMD = { ID: 0x8F, RF: 0x80, FEATURES: 0xE6, GET_RATE: 0x83, SET_RATE: 0x03, GET_LIGHT: 0x87, SET_LIGHT: 0x07, GET_MAG: 0xE5, SET_MAG: 0x65 };
const RY_RATES = [8000, 4000, 2000, 1000, 500, 250, 125]; // code = position dans la liste
const RY_LIGHTS = ['LightOff', 'LightAlwaysOn', 'LightBreath', 'LightNeon', 'LightWave', 'LightRipple', 'LightRaindrop', 'LightSnake',
  'LightPressAction', 'LightConverage', 'LightSineWave', 'LightKaleidoscope', 'LightLineWave', 'LightUserPicture', 'LightLaser',
  'LightCircleWave', 'LightDazzing', 'LightRainDown', 'LightMeteor', 'LightPressActionOff', 'LightMusicFollow3', 'LightScreenColor',
  'LightMusicFollow2', 'LightTrain', 'LightFireWorks', 'LightUserColor'];
const RY_LIGHT_LABEL = {
  LightOff: 'Éteint', LightAlwaysOn: 'Fixe', LightBreath: 'Respiration', LightNeon: 'Néon', LightWave: 'Vague', LightRipple: 'Ondulation',
  LightRaindrop: 'Gouttes', LightSnake: 'Serpent', LightPressAction: 'Touches allumées à la frappe', LightConverage: 'Convergence',
  LightSineWave: 'Sinusoïde', LightKaleidoscope: 'Kaléidoscope', LightLineWave: 'Ligne', LightUserPicture: 'Dessin personnalisé',
  LightLaser: 'Laser', LightCircleWave: 'Cercles', LightDazzing: 'Scintillement', LightRainDown: 'Pluie', LightMeteor: 'Météore',
  LightPressActionOff: 'Touches éteintes à la frappe', LightMusicFollow3: 'Musique', LightScreenColor: 'Couleur de l’écran',
  LightMusicFollow2: 'Musique', LightTrain: 'Train', LightFireWorks: 'Feu d’artifice', LightUserColor: 'Couleurs personnalisées',
};
// Effets qui ont besoin du logiciel du fabricant (dessin envoyé touche par touche, son, écran) : affichés
// s'ils sont actifs, mais pas proposés
const RY_HOST_ONLY = new Set(['LightUserPicture', 'LightMusicFollow3', 'LightMusicFollow2', 'LightScreenColor', 'LightUserColor']);
const RY_OPTION_LABEL = {
  '向右': 'Vers la droite', '向左': 'Vers la gauche', '向下': 'Vers le bas', '向上': 'Vers le haut', 'Z字形': 'Zigzag', '回形': 'Spirale',
  '向外': 'Vers l’extérieur', '向内': 'Vers l’intérieur', '顺时针': 'Sens horaire', '逆时针': 'Sens antihoraire',
  '图案1': 'Motif 1', '图案2': 'Motif 2', '图案3': 'Motif 3', '图案4': 'Motif 4', '图案5': 'Motif 5',
  intersect: 'Croisés', separate: 'Séparés', upright: 'Vertical',
};
const RY_COMMONCOLOR = { 0: 0xFF0000, 1: 0xFF8000, 2: 0xFFFF00, 3: 0x00FF00, 4: 0x00FFFF, 5: 0x0000FF, 6: 0xFF00FF };

// Somme de contrôle du fabricant ; les commandes de moins de 9 octets sont complétées par des zéros
function ryEncode(bytes, bit8 = false) {
  const a = new Uint8Array(Math.max(9, bytes.length));
  a.set(bytes);
  const n = bit8 ? 8 : 7;
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i];
  a[n] = 255 - (s & 255);
  return a;
}
const ryFilter = d => RY_FILTERS.find(f => f[0] === d.vendorId && f[1] === d.productId
  && f[2] === (d.info?.usage_page ?? d.collections?.[0]?.usagePage) && f[3] === (d.info?.usage ?? d.collections?.[0]?.usage)
  && (f[4] < 0 || f[4] === d.info?.interface));
const ryHex = n => '#' + (n & 0xFFFFFF).toString(16).padStart(6, '0');
const ryNum = hex => parseInt(String(hex || '#ffffff').slice(1, 7), 16) || 0;
const ryRound = (v, step) => Math.round(Math.round(v / step) * step * 1000) / 1000;
const ryMm = v => (Math.round(v * 1000) / 1000).toLocaleString(typeof LOCALE === 'string' ? LOCALE : 'fr-FR') + ' mm';
const rySleep = ms => new Promise(r => setTimeout(r, ms));

// Valeur la plus fréquente (réglage « global » quand les touches diffèrent)
function ryMode(values) {
  const c = new Map();
  for (const v of values) c.set(v, (c.get(v) || 0) + 1);
  let best = values[0], n = 0;
  for (const [v, k] of c) if (k > n) { best = v; n = k; }
  return best;
}

registerDriver({
  id: 'rongyuan',
  priority: 13, // avant OpenMouse (10) : ces claviers partagent le VID 0x3151 avec des souris
  match: d => !!ryFilter(d),
  async connect(dev) {
    const filter = ryFilter(dev);
    await dev.open();
    let chain = Promise.resolve();
    // Une seule commande à la fois (rafraîchissement et réglage ne doivent pas se croiser)
    const locked = f => { const p = chain.then(f, f); chain = p.catch(() => {}); return p; };
    const send = async (bytes, bit8 = false) => {
      await rySleep(10);
      const r = new Uint8Array(64);
      r.set(ryEncode(bytes, bit8).slice(0, 64));
      await dev.sendFeatureReport(0, r);
    };
    const ask = async bytes => {
      await send(bytes);
      await rySleep(10);
      const v = await dev.receiveFeatureReport(0, 64);
      return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    };

    // Identité (trois essais, comme le logiciel officiel)
    let id, usb;
    for (let i = 0; i < 3 && id === undefined; i++) {
      const r = await ask([RY_CMD.ID]).catch(() => null);
      if (r && r[0] === RY_CMD.ID && r.length >= 9) {
        id = (r[1] | r[2] << 8 | r[3] << 16 | r[4] << 24) >>> 0;
        usb = (r[8] << 8 | r[7]) || undefined;
      } else await rySleep(500);
    }
    if (id === undefined) throw new Error('le clavier ne répond pas à la commande d’identité');
    const rfR = await ask([RY_CMD.RF]).catch(() => null);
    const rf = rfR && rfR[0] === RY_CMD.RF ? ((rfR[2] << 8 | rfR[1]) || undefined) : undefined;
    const ver = rf || usb;
    const model = RY_MODELS[id];
    const name = model ? `${model.c && !/rongyuan/i.test(model.c) ? model.c.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^[a-z]/, x => x.toUpperCase()) + ' ' : ''}${model.n}` : (dev.productName || 'Clavier Rongyuan');
    const layout = model?.l ? RY_LAYOUTS[model.l] : null;
    const NORMAL = model?.x?.NORMAL ?? 7, DAZZLE = model?.x?.DAZZLE ?? 8;
    const COMMON = model?.x?.COMMONCOLOR || RY_COMMONCOLOR;

    // Fréquence : même règle que le logiciel officiel (fréquence max connue > 1000 Hz, puis liste
    // blanche du fabricant ou firmware >= 1024)
    const rateOk = !!model && filter[5] > 1000 && model.r !== 0 && (model.r === 1 || (ver !== undefined && ver >= 1024));
    const rates = rateOk ? RY_RATES.filter(r => r <= filter[5]).reverse() : [];

    // Course : unité selon la précision annoncée par le firmware, sinon d'après sa version
    let mult = 0, step = 0.1, tb = null, rtb = null, slots = 0, keys = [];
    if (model?.m) {
      const f = await ask([RY_CMD.FEATURES]).catch(() => null);
      if (f && f[1] === 0xAA) mult = { 0: 100, 1: 200, 2: 1000 }[f[2]] || 100;
      else if (ver === undefined) mult = 10;
      else if (ver >= 768 && ver < 1280) mult = 100;
      else if (ver >= 1280) mult = model.t?.travel?.step === 0.01 ? 100 : 200;
      else mult = 10;
      const defStep = ver >= 1280 ? 0.005 : ver >= 768 ? 0.01 : 0.1;
      const t = model.t || {};
      step = Math.max(t.travel?.step || defStep, 1 / mult);
      tb = { min: Math.max(t.travel?.min ?? 0.1, 1 / mult), max: t.travel?.max ?? (ver !== undefined && ver < 768 ? 4 : 3.3), step };
      const rStep = Math.max(t.firePress?.step || defStep, 1 / mult);
      rtb = { min: Math.max(t.firePress?.min || defStep, 1 / mult), max: t.firePress?.max ?? (ver !== undefined && ver < 768 ? 2.5 : 2), step: rStep };
      slots = model.s;
      const mask = BigInt('0x' + model.k);
      for (let i = 0; i < slots; i++) if ((mask >> BigInt(i)) & 1n) keys.push(i);
    }

    const state = {};
    let mag = null; // derniers tableaux relus : modes, course, sensibilités RT
    const readArray = async (op, pages, two) => {
      let out = [];
      for (let p = 0; p < pages; p++) {
        const r = await ask([RY_CMD.GET_MAG, op, 1, p]).catch(() => null);
        out = out.concat(r && r.length >= 64 ? [...r.slice(0, 64)] : new Array(64).fill(0));
      }
      if (!two) return out.slice(0, slots);
      const v = [];
      for (let i = 0; i < slots; i++) v.push(out[i * 2] | out[i * 2 + 1] << 8);
      return v;
    };
    const writeArray = async (op, values, two, last) => {
      const data = two ? values.flatMap(v => [v & 255, v >> 8 & 255]) : values.map(v => v & 255);
      const pages = Math.ceil(data.length / 56);
      for (let p = 0; p < pages; p++) await send([RY_CMD.SET_MAG, op, 1, p, last && p === pages - 1 ? 1 : 0, 0, 0, 0, ...data.slice(p * 56, p * 56 + 56)]);
    };

    async function refresh() {
      if (rates.length) {
        const r = await ask([RY_CMD.GET_RATE]);
        if (r[0] === RY_CMD.GET_RATE && RY_RATES[r[2]]) state.rate = RY_RATES[r[2]];
      }
      if (layout) {
        const r = await ask([RY_CMD.GET_LIGHT]);
        const type = RY_LIGHTS[r[1]];
        if (r[0] === RY_CMD.GET_LIGHT && type) {
          const low = r[4] & 15;
          let rgb = r[5] << 16 | r[6] << 8 | r[7];
          if (rgb === 0xFAFFFA) rgb = 0xFFFFFF;
          if (type !== 'LightMusicFollow2' && type !== 'LightScreenColor' && low !== DAZZLE && low !== NORMAL && COMMON[low] !== undefined) rgb = COMMON[low];
          const music = type === 'LightMusicFollow3' || type === 'LightMusicFollow2';
          state.light = { effect: type, brightness: r[3], speed: Math.max(0, 4 - r[2]), option: r[4] >> 4, color: ryHex(rgb), dazzle: music ? low === 0 : low === DAZZLE };
        }
      }
      if (mult) {
        const modes = await readArray(7, 2, false);
        const travel = await readArray(0, 4, true);
        const press = await readArray(2, 4, true);
        const lift = await readArray(3, 4, true);
        mag = { modes, travel, press, lift };
        const k = keys.length ? keys : modes.map((_, i) => i);
        const rtOn = k.filter(i => modes[i] & 0x80).length;
        const tv = k.map(i => travel[i]);
        state.travel = { mm: ryMode(tv) / mult, mixed: new Set(tv).size > 1 };
        state.rt = {
          on: rtOn * 2 > k.length, mixed: rtOn > 0 && rtOn < k.length,
          press: (ryMode(k.map(i => press[i])) / mult) || 0.2, lift: (ryMode(k.map(i => lift[i])) / mult) || 0.2,
        };
      }
    }

    async function setLight(v) {
      const type = RY_LIGHTS.includes(v.effect) ? v.effect : null;
      if (!type) throw new Error('effet inconnu');
      const info = layout.find(t => t.type === type);
      const bright = Math.max(0, Math.min(info?.maxValue ?? 4, Math.round(Number(v.brightness ?? 4))));
      const speed = Math.max(0, Math.min(4, Math.round(Number(v.speed ?? 2))));
      // Sens de l'effet : remis au premier quand le nouvel effet n'en a pas autant
      let option = Math.max(0, Math.min(15, Math.round(Number(v.option) || 0)));
      if (!info?.options || option >= info.options.length || info.options[option] == null) option = 0;
      let a = option << 4 | (v.dazzle ? DAZZLE : NORMAL);
      if (type === 'LightUserPicture') a = option << 4;
      if (type === 'LightMusicFollow3' || type === 'LightMusicFollow2') a = option << 4 | (v.dazzle ? 0 : 4);
      if (type === 'LightScreenColor') a = 0;
      let rgb = ryNum(v.color);
      if (rgb === 0xFFFFFF) rgb = 0xFAFFFA; // le blanc pur est envoyé ainsi par le logiciel officiel
      const b = new Array(64).fill(0);
      b.splice(0, 8, RY_CMD.SET_LIGHT, RY_LIGHTS.indexOf(type), 4 - speed, bright, a, rgb >> 16 & 255, rgb >> 8 & 255, rgb & 255);
      if (type === 'LightUserPicture') b.splice(5, 3, 0, 200, 200);
      await send(b, true);
      await rySleep(100);
    }

    // Réglages magnétiques : toutes les touches présentes reçoivent la même valeur ; les autres
    // emplacements gardent ce qui a été relu
    async function setMagnet(next) {
      if (!mag) await refresh();
      const k = keys.length ? keys : mag.modes.map((_, i) => i);
      const raw = mm => Math.round(mm * mult);
      const modes = mag.modes.slice(), travel = mag.travel.slice(), press = mag.press.slice(), lift = mag.lift.slice();
      for (const i of k) {
        if (next.travel != null) travel[i] = raw(next.travel);
        if (next.rt != null) modes[i] = (modes[i] & 0x7F) | (next.rt ? 0x80 : 0);
        if (next.press != null) press[i] = raw(next.press);
        if (next.lift != null) lift[i] = raw(next.lift);
      }
      // Même ordre que le logiciel officiel : modes, puis course, puis sensibilités
      const jobs = [];
      if (modes.some((v, i) => v !== mag.modes[i])) jobs.push([7, modes, false]);
      if (travel.some((v, i) => v !== mag.travel[i])) jobs.push([0, travel, true]);
      if (press.some((v, i) => v !== mag.press[i])) jobs.push([2, press, true]);
      if (lift.some((v, i) => v !== mag.lift[i])) jobs.push([3, lift, true]);
      for (let j = 0; j < jobs.length; j++) await writeArray(jobs[j][0], jobs[j][1], jobs[j][2], j === jobs.length - 1);
      if (jobs.length) await rySleep(600);
    }

    const caps = {};
    if (rates.length) caps.rate = rates;
    if (layout) {
      const fx = layout.map(t => t.type).filter(t => !RY_HOST_ONLY.has(t));
      caps.light = { effects: fx, labels: RY_LIGHT_LABEL, color: false, brightness: false };
    }
    if (mult) { caps.travel = tb; caps.rt = rtb; }

    const inst = {
      key: `drv-${devId(dev).replace(':', '').toLowerCase()}-ry`,
      name, kind: 'clavier', dev, state, caps,
      meta: [model ? (mult ? 'clavier magnétique' : 'clavier') : `modèle ${id} inconnu`, ver ? `firmware ${(ver >> 8).toString(16)}.${(ver & 255).toString(16).padStart(2, '0')}` : null].filter(Boolean).join(' · '),
      restoreCaps: ['travel', 'rt'],
      source: 'Protocole relu dans le logiciel web officiel du fabricant (qmk.top), pas encore confirmé sur ce modèle dans PeriphHub. '
        + 'Les réglages sont enregistrés par le clavier lui-même ; l’état d’origine est gardé avant la première modification.',
      note: model ? 'Fermez le logiciel du fabricant (qmk.top ou celui de la marque) pendant les réglages : deux logiciels à la fois se contredisent.'
        : `Ce clavier Rongyuan (identifiant ${id}) n’est pas encore dans la liste de PeriphHub : rien n’est modifié. Envoyez le diagnostic avec « Signaler un problème ».`,
      refresh: () => locked(refresh),
      set: (cap, v) => locked(async () => {
        if (cap === 'rate') {
          const code = RY_RATES.indexOf(Number(v));
          if (code < 0 || !rates.includes(Number(v))) throw new Error('fréquence non prise en charge');
          await send([RY_CMD.SET_RATE, 0, code]);
          await rySleep(100);
        } else if (cap === 'light' && layout) {
          await setLight(v);
        } else if (cap === 'travel' && mult) {
          const mm = Math.max(tb.min, Math.min(tb.max, ryRound(Number(v.mm), tb.step)));
          await setMagnet({ travel: mm });
        } else if (cap === 'rt' && mult) {
          const clamp = x => Math.max(rtb.min, Math.min(rtb.max, ryRound(Number(x), rtb.step)));
          await setMagnet({ rt: !!v.on, press: clamp(v.press), lift: clamp(v.lift) });
        } else throw new Error('réglage non pris en charge');
        await refresh();
      }),
      rows() {
        const out = [];
        const l = state.light, info = l && layout?.find(t => t.type === l.effect);
        if (info) {
          const setL = (label, patch) => drvSet(inst, label, 'light', { ...l, ...patch });
          if (info.options?.some(o => o != null)) {
            out.push(field('Sens de l’effet', segmented(info.options.map((o, i) => o == null ? null : { v: i, label: RY_OPTION_LABEL[o] || o }).filter(Boolean), l.option, v => setL('Sens', { option: v }))));
          }
          if (info.maxValue) {
            out.push(field('Luminosité', segmented(Array.from({ length: info.maxValue + 1 }, (_, i) => ({ v: i, label: i === 0 ? 'Éteint' : String(i) })), l.brightness, v => setL('Luminosité', { brightness: v }))));
          }
          if (info.maxSpeed) {
            out.push(field('Vitesse', segmented(Array.from({ length: info.maxSpeed + 1 }, (_, i) => ({ v: i, label: i === 0 ? 'Lente' : i === info.maxSpeed ? 'Rapide' : String(i) })), l.speed, v => setL('Vitesse', { speed: v }))));
          }
          if (info.rgb) {
            const pick = h('div', { class: 'row-inline' },
              SWATCHES.map(col => h('button', { class: 'swatch' + (!l.dazzle && col === l.color ? ' on' : ''), style: `background:${col}`, title: col, onclick: () => setL('Couleur', { color: col, dazzle: false }) })),
              h('input', { type: 'color', value: l.color || '#ffffff', onchange: e => setL('Couleur', { color: e.target.value, dazzle: false }) }));
            out.push(field('Couleur', info.dazzle ? h('div', { class: 'toggles' }, toggle('Arc-en-ciel', !!l.dazzle, on => setL('Couleur', { dazzle: on }))) : null, l.dazzle ? null : pick));
          }
        }
        if (state.travel && caps.travel) {
          const t = caps.travel;
          out.push(field('Point de déclenchement',
            slider(t.min, t.max, t.step, state.travel.mm, ' mm', v => drvSet(inst, `Déclenchement à ${ryMm(v)}`, 'travel', { mm: v })),
            h('div', { class: 'muted small' }, `Profondeur à laquelle la touche s’active, de ${ryMm(t.min)} à ${ryMm(t.max)}. Appliqué à toutes les touches.`
              + (state.travel.mixed ? ' Les touches ont aujourd’hui des réglages différents : la valeur affichée est la plus courante.' : ''))));
        }
        if (state.rt && caps.rt) {
          const r = state.rt, b = caps.rt;
          const setR = (label, patch) => drvSet(inst, label, 'rt', { ...r, ...patch });
          out.push(field('Rapid Trigger',
            h('div', { class: 'toggles' }, toggle('Activé sur toutes les touches', r.on, on => setR(on ? 'Rapid Trigger activé' : 'Rapid Trigger désactivé', { on }))),
            r.on ? h('div', { class: 'muted small' }, 'Sensibilité à l’appui') : null,
            r.on ? slider(b.min, b.max, b.step, r.press, ' mm', v => setR('Sensibilité à l’appui', { press: v })) : null,
            r.on ? h('div', { class: 'muted small' }, 'Sensibilité au relâchement') : null,
            r.on ? slider(b.min, b.max, b.step, r.lift, ' mm', v => setR('Sensibilité au relâchement', { lift: v })) : null,
            h('div', { class: 'muted small' }, 'La touche se réactive dès qu’elle redescend de la distance choisie, et se relâche dès qu’elle remonte, sans attendre le point de déclenchement.'
              + (r.mixed ? ' Il est aujourd’hui activé sur une partie des touches seulement.' : ''))));
        }
        return out;
      },
    };
    await inst.refresh();
    return [inst];
  },
});
