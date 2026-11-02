// PeriphHub — casques SteelSeries (Arctis), Corsair (Void, Virtuoso), HyperX (Cloud), Logitech (G Pro,
// G733, G935, Astro), Audeze, Sony INZONE, Roccat… via le module HeadsetControl (GPL-3.0) livré avec
// PeriphHub (src-tauri/src/headset.rs : empreinte vérifiée, options en liste blanche).
// La plupart de ces casques ne permettent pas de relire leurs réglages : PeriphHub retient ceux que
// vous choisissez et les renvoie quand le casque se rallume.

const HS_CAPS = {
  sidetone: 'sidetone', lights: 'lights', 'inactive time': 'inactive_time', chatmix: 'chatmix',
  'voice prompts': 'voice_prompts', 'rotate to mute': 'rotate_to_mute', 'equalizer preset': 'equalizer_preset',
  'microphone volume': 'microphone_volume', 'volume limiter': 'volume_limiter', 'microphone noise filter': 'noise_filter', anc: 'anc',
};
const HS_ONOFF = [{ v: 1, label: 'Activé' }, { v: 0, label: 'Désactivé' }];
const hsLive = new Map(); // "vid:pid" → instance

function hsInstance(d) {
  const vid = parseInt(d.id_vendor, 16), pid = parseInt(d.id_product, 16);
  const dev = { vendorId: vid, productId: pid, productName: d.product };
  const caps = {};
  for (const c of d.capabilities_str || []) if (HS_CAPS[c]) caps[HS_CAPS[c]] = true;
  caps.battery = !!d.battery;
  const presets = d.equalizer_presets ? Object.keys(d.equalizer_presets) : null;
  const nPresets = presets?.length || d.equalizer_presets_count || 0;
  if (!nPresets) delete caps.equalizer_preset;
  const inst = {
    key: `drv-hs-${hex4(vid)}${hex4(pid)}`.toLowerCase(),
    name: d.device && !/headset device/i.test(d.device) ? d.device : [d.vendor, d.product].filter(Boolean).join(' ') || 'Casque',
    kind: 'casque', dev, caps, state: {}, noOrigin: true,
    source: `Module HeadsetControl ${'4.2.0'} (projet libre, GPL-3.0), pas encore confirmé sur ce modèle. ` +
      'Ces casques ne permettent pas de relire leurs réglages : PeriphHub retient ceux que vous choisissez et les renvoie quand le casque se rallume.',
    note: null,
    async set(cap, v) {
      const raw = cap === 'sidetone' || cap === 'microphone_volume' ? Math.round(v * 1.28) : v;
      await nativeInvoke('headset_set', { vid, pid, setting: cap, value: raw });
      inst.state[cap] = v;
    },
    // pendant une relecture (réapplication au branchement), pas de relecture imbriquée
    refresh: () => hsPolling ? Promise.resolve() : headsetsPoll(),
    refreshBattery: () => headsetsPoll(),
    rows() {
      const s = inst.state, c = inst.caps;
      const set = (label, cap) => v => drvSet(inst, label, cap, v);
      const audio = [];
      if (c.sidetone) audio.push(h('div', {}, h('div', { class: 'muted small' }, 'Retour micro (entendre sa propre voix)'),
        slider(0, 100, 5, s.sidetone ?? 0, ' %', set('Retour micro', 'sidetone'))));
      if (c.microphone_volume) audio.push(h('div', {}, h('div', { class: 'muted small' }, 'Volume du micro'),
        slider(0, 100, 5, s.microphone_volume ?? 100, ' %', set('Volume du micro', 'microphone_volume'))));
      if (c.noise_filter) audio.push(h('div', {}, h('div', { class: 'muted small' }, 'Filtre de bruit du micro'),
        segmented([{ v: 0, label: 'Désactivé' }, { v: 1, label: 'Faible' }, { v: 2, label: 'Fort' }], s.noise_filter, set('Filtre de bruit', 'noise_filter'))));
      if (c.anc) audio.push(h('div', {}, h('div', { class: 'muted small' }, 'Réduction de bruit active'),
        segmented([{ v: 0, label: 'Désactivée' }, { v: 1, label: 'Réduction de bruit' }, { v: 2, label: 'Transparence' }], s.anc, set('Réduction de bruit', 'anc'))));
      if (c.equalizer_preset) audio.push(h('div', {}, h('div', { class: 'muted small' }, 'Égaliseur'),
        segmented(Array.from({ length: nPresets }, (_, i) => ({ v: i, label: presets?.[i] ? presets[i][0].toUpperCase() + presets[i].slice(1) : `Préréglage ${i + 1}` })),
          s.equalizer_preset, set('Égaliseur', 'equalizer_preset'))));
      const opts = [];
      if (c.lights) opts.push(h('div', {}, h('div', { class: 'muted small' }, 'Éclairage'), segmented(HS_ONOFF, s.lights, set('Éclairage', 'lights'))));
      if (c.voice_prompts) opts.push(h('div', {}, h('div', { class: 'muted small' }, 'Annonces vocales'), segmented(HS_ONOFF, s.voice_prompts, set('Annonces vocales', 'voice_prompts'))));
      if (c.rotate_to_mute) opts.push(h('div', {}, h('div', { class: 'muted small' }, 'Micro coupé en le relevant'), segmented(HS_ONOFF, s.rotate_to_mute, set('Micro relevé', 'rotate_to_mute'))));
      if (c.volume_limiter) opts.push(h('div', {}, h('div', { class: 'muted small' }, 'Limiteur de volume'), segmented(HS_ONOFF, s.volume_limiter, set('Limiteur', 'volume_limiter'))));
      if (c.inactive_time) opts.push(h('div', {}, h('div', { class: 'muted small' }, 'Extinction automatique'),
        segmented([0, 5, 10, 15, 30, 60, 90].map(m => ({ v: m, label: m ? m + ' min' : 'Jamais' })), s.inactive_time, set('Extinction automatique', 'inactive_time'))));
      return [
        audio.length ? field('Son et micro', h('div', { class: 'stack' }, audio)) : null,
        c.chatmix && s.chatmix != null ? field('ChatMix', h('div', { class: 'muted small' }, `Molette en position ${Math.round(s.chatmix / 128 * 100)} % (jeu ↔ discussion), réglée sur le casque.`)) : null,
        opts.length ? field('Options du casque', h('div', { class: 'stack' }, opts)) : null,
      ];
    },
  };
  return inst;
}

let hsPolling = null;

// Renvoie au casque les réglages choisis (il ne les relit pas : on les renvoie tous)
async function hsReapply(inst) {
  const want = lsGet(wantKey(inst)) || {};
  for (const k of Object.keys(want)) delete inst.state[k];
  await drvReapply(inst).catch(() => {});
  for (const [k, v] of Object.entries(want)) inst.state[k] ??= v;
}

function headsetsPoll() {
  if (!NATIVE) return Promise.resolve();
  hsPolling ||= (async () => {
    try {
      const r = await nativeInvoke('headset_list');
      const seen = new Set();
      for (const d of r.devices || []) {
        const id = `${d.id_vendor}:${d.id_product}`.replace(/0x/g, '').toUpperCase();
        if (DEDICATED.has(id)) continue;
        seen.add(id);
        let inst = hsLive.get(id);
        const fresh = !inst;
        if (fresh) {
          inst = hsInstance(d);
          hsLive.set(id, inst);
        }
        const b = d.battery;
        const on = b && b.status !== 'BATTERY_UNAVAILABLE' && b.status !== 'BATTERY_ERROR' && b.level >= 0;
        const wasOff = !fresh && inst.off;
        inst.off = b ? !on : false;
        if (on) inst.state.battery = { level: b.level, charging: b.status === 'BATTERY_CHARGING' };
        else delete inst.state.battery;
        if (d.chatmix != null) inst.state.chatmix = d.chatmix;
        inst.meta = inst.off ? 'Casque éteint ou hors de portée (le récepteur est branché)' : 'Via HeadsetControl';
        if (fresh) { await hsReapply(inst); drvAdd(inst, { id: 'headsetcontrol' }); }
        else {
          if (wasOff && !inst.off) await hsReapply(inst); // casque rallumé : réglages renvoyés
          drvRender(inst);
        }
      }
      for (const [id, inst] of hsLive) if (!seen.has(id)) { hsLive.delete(id); drvRelease(inst.dev); }
    } catch (e) {
      // module absent (compilation sans HeadsetControl) ou aucun casque : rien à afficher
      if (!/absent/.test(String(e))) console.warn('[PeriphHub] casques', e);
    } finally {
      hsPolling = null;
    }
  })();
  return hsPolling;
}

// Branchement d'un récepteur : relu toutes les 20 s (fenêtre visible), plus à chaque « Actualiser »
setInterval(() => { if (!document.hidden) headsetsPoll(); }, 20000);
