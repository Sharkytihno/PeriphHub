// PeriphHub — éclairage de tous les appareils connus d'OpenRGB (plus de 1 000 modèles : barrettes de
// mémoire, cartes graphiques, ventilateurs, bandeaux, claviers…), via son serveur SDK local.
// OpenRGB doit être lancé avec « Serveur SDK » activé (src-tauri/src/openrgb.rs).

let orgbInst = null;

function orgbInstance(list) {
  const dev = { vendorId: 0, productId: 0 };
  const inst = {
    key: 'drv-openrgb', name: 'Éclairage OpenRGB', kind: 'rgb', dev, caps: {}, state: { list, colors: {} }, noOrigin: true,
    meta: '', source: 'Passerelle OpenRGB (projet libre, GPL-2.0) : couleur unie appliquée en mode personnalisé. '
      + 'Pour la garder au démarrage sans PeriphHub, enregistrez un profil dans OpenRGB.',
    async set(cap, v) {
      const targets = v.index == null ? inst.state.list.map(d => d.index) : [v.index];
      const rgb = [1, 3, 5].map(i => parseInt(v.color.slice(i, i + 2), 16));
      for (const index of targets) {
        await nativeInvoke('openrgb_color', { index, rgb });
        inst.state.colors[index] = v.color;
      }
    },
    refresh: async () => {},
    rows() {
      const s = inst.state;
      const pick = (label, index, current) => h('div', { class: 'row-inline' },
        SWATCHES.map(col => h('button', { class: 'swatch' + (col === current ? ' on' : ''), style: `background:${col}`, title: col,
          onclick: () => drvSet(inst, label, 'color', { index, color: col }) })),
        h('button', { class: 'mini ghost', onclick: () => drvSet(inst, label + ' éteint', 'color', { index, color: '#000000' }) }, 'Éteindre'),
        h('input', { type: 'color', value: current || '#ffffff', onchange: e => drvSet(inst, label, 'color', { index, color: e.target.value }) }));
      return [
        field('Tous les appareils', pick('Éclairage', null, null)),
        ...s.list.map(d => field(d.name, h('div', { class: 'muted small' }, `${d.kind} · ${d.leds} LED`), pick(d.name, d.index, s.colors[d.index]))),
      ];
    },
  };
  return inst;
}

async function openrgbPoll() {
  if (!NATIVE) return;
  let list = null;
  try { list = await nativeInvoke('openrgb_list'); } catch { list = null; }
  if (!list?.length) {
    if (orgbInst) { drvRelease(orgbInst.dev); orgbInst = null; }
    return;
  }
  if (!orgbInst) {
    orgbInst = orgbInstance(list);
    drvAdd(orgbInst, { id: 'openrgb' });
  } else {
    orgbInst.state.list = list;
  }
  orgbInst.meta = `${list.length} appareil${list.length > 1 ? 's' : ''} pilotés par OpenRGB`;
  drvRender(orgbInst);
}

// OpenRGB lancé ou fermé : vérifié toutes les 30 s (fenêtre visible)
setInterval(() => { if (!document.hidden) openrgbPoll(); }, 30000);
