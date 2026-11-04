// PeriphHub — éclairage des claviers Ranked (Nova 60 %, Master 65 %, Guardian 65 %), puce RY Micro (VID 0x3532).
// Protocole relevé dans le logiciel d'origine (Ranked Utility, OemDrv.exe 1.2.6) et dans ses fichiers
// de configuration par modèle : rien n'est copié, seuls l'ordre des octets et les plages sont repris.
//
// Collection vendeur (page 0xFF00), rapport de sortie 4 (63 octets après l'ID) ; le clavier répond
// sur le rapport d'entrée 4 en reprenant le 1er octet de la commande.
//   A0 02 00 01            : lecture du « PSD » (identifiant du modèle, octets 1 à 3 de la réponse)
//   AE 01 00 00 e v l c    : effet e (index matériel), vitesse v, luminosité l, couleur c
//        c : 0 multicolore, 1 rouge, 2 vert, 3 bleu, 4 jaune, 5 magenta, 6 cyan, 7 blanc
// Rien d'autre n'est envoyé : ni la commande de mise à jour (passage en bootloader), ni les touches,
// ni les macros. Le clavier garde l'éclairage en mémoire, même PeriphHub fermé.

const RK_REPORT = 4;
const RK_COLORS = [
  { v: 0, label: 'Multicolore' }, { v: 1, label: 'Rouge', css: '#ff2a2a' }, { v: 2, label: 'Vert', css: '#2bff4f' },
  { v: 3, label: 'Bleu', css: '#2a5bff' }, { v: 4, label: 'Jaune', css: '#ffd400' }, { v: 5, label: 'Magenta', css: '#ff3ccf' },
  { v: 6, label: 'Cyan', css: '#00e5ff' }, { v: 7, label: 'Blanc', css: '#ffffff' },
];
// Effets par famille : [index matériel, nom, vitesse réglable, couleur au choix, multicolore possible]
// (colonnes « speed / color / random » des fichiers LedOpt du logiciel d'origine)
const RK_FX_NOVA = [
  [0, 'Éteint', 0, 0, 0], [6, 'Fixe', 0, 1, 0], [4, 'Respiration', 1, 1, 1], [1, 'Vortex', 1, 0, 0],
  [2, 'Vague vers la droite', 1, 0, 0], [3, 'Touche pressée', 1, 1, 1], [5, 'Ondulation', 1, 1, 1],
  [7, 'Spectre en vague', 1, 1, 1], [8, 'Vague depuis le centre', 1, 0, 0], [9, 'Serpent central', 1, 0, 0],
  [10, 'Poisson lumineux', 1, 0, 0], [11, 'Cœur', 1, 0, 0], [12, 'Fontaine colorée', 1, 0, 0],
  [13, 'Circulation', 1, 0, 0], [14, 'Serpent glouton', 1, 0, 0], [15, 'Danse sauvage', 1, 1, 1],
  [16, 'Vague en croix', 1, 0, 0], [17, 'Spectre', 1, 0, 0], [18, 'Fontaine aléatoire', 1, 0, 0],
];
// Guardian : 21 effets dans un autre ordre, noms non publiés ; seuls « éteint » et « fixe » sont sûrs
const RK_FX_GUARDIAN = [[0, 'Éteint', 0, 0, 0], [7, 'Fixe', 0, 1, 0],
  ...[1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map((e, i) => [e, `Effet ${i + 1}`, 1, [3, 5, 6, 8, 16].includes(e) ? 1 : 0, [3, 5, 6, 8, 16].includes(e) ? 1 : 0])];
// PID → [nom, effets, nombre de niveaux de luminosité]
const RK_NOVA = ['Ranked Nova 60 %', RK_FX_NOVA, 10];
const RK_MODELS = {
  0xA0A1: RK_NOVA, 0xA0B1: RK_NOVA, 0xA0A2: RK_NOVA, 0xA0A3: RK_NOVA, 0xA0A4: RK_NOVA, 0xA0A5: RK_NOVA, 0xA0A6: RK_NOVA, 0xA0A7: RK_NOVA,
  0xA0B2: RK_NOVA, 0xA0B3: RK_NOVA, 0xA0B4: RK_NOVA, 0xA0B5: RK_NOVA, 0xA0B6: RK_NOVA, 0xA0B7: RK_NOVA,
  0xB0A1: ['Ranked Master 65 %', RK_FX_NOVA, 10], 0xB0A2: ['Ranked Master 65 %', RK_FX_NOVA, 10],
  0xA0C1: ['Ranked Guardian 65 %', RK_FX_GUARDIAN, 5], 0xA0C2: ['Ranked Guardian 65 %', RK_FX_GUARDIAN, 5],
};
const RK_SPEEDS = 10;

function rkPacket(...head) {
  const b = new Uint8Array(63);
  b.set(head);
  return b;
}

registerDriver({
  id: 'ranked',
  priority: 12,
  match: d => d.vendorId === 0x3532 && RK_MODELS[d.productId] != null && (d.collections || []).some(c => c.usagePage === 0xFF00),
  async connect(dev) {
    await dev.open();
    const [model, effects, lights] = RK_MODELS[dev.productId];
    // Commande puis réponse (le clavier reprend l'octet 0) ; au plus 1 s, comme le logiciel d'origine
    const send = (bytes, wait = 1000) => new Promise(resolve => {
      let t;
      const on = e => {
        if (e.reportId !== RK_REPORT || e.data.byteLength < 1 || e.data.getUint8(0) !== bytes[0]) return;
        clearTimeout(t); dev.removeEventListener('inputreport', on);
        resolve(new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength));
      };
      dev.addEventListener('inputreport', on);
      t = setTimeout(() => { dev.removeEventListener('inputreport', on); resolve(null); }, wait);
      dev.sendReport(RK_REPORT, rkPacket(...bytes)).catch(() => { clearTimeout(t); dev.removeEventListener('inputreport', on); resolve(null); });
    });
    const psd = await send([0xA0, 0x02, 0x00, 0x01]);
    const state = { rkled: null };
    const inst = {
      key: `drv-${devId(dev).replace(':', '').toLowerCase()}`,
      name: model, kind: 'clavier', dev, state,
      caps: { rkled: true },
      meta: psd ? 'éclairage' : 'éclairage (pas de réponse du clavier à la connexion)',
      noOrigin: true,
      source: 'Protocole relevé dans le logiciel d’origine Ranked Utility, pas encore confirmé sur ce modèle dans PeriphHub. '
        + 'Seul l’éclairage est écrit : jamais le firmware, les touches ni les macros.',
      note: 'Ce clavier ne sait pas indiquer son éclairage actuel : PeriphHub affiche le dernier choix fait ici, et le clavier le garde '
        + 'en mémoire. Fermez Ranked Utility, sinon il réimpose le sien.',
      refresh: async () => {},
      async set(cap, v) {
        const fx = effects.find(f => f[0] === v?.effect);
        if (cap !== 'rkled' || !fx) throw new Error('effet inconnu');
        const light = Math.max(0, Math.min(lights - 1, Math.round(Number(v.light ?? lights - 1))));
        const speed = Math.max(0, Math.min(RK_SPEEDS - 1, Math.round(Number(v.speed ?? 5))));
        let color = Math.max(0, Math.min(7, Math.round(Number(v.color ?? 7))));
        if (!fx[4] && color === 0) color = 7; // multicolore impossible sur cet effet
        if (!fx[3] && !fx[4]) color = 0;
        const r = await send([0xAE, 0x01, 0x00, 0x00, fx[0], speed, light, color]);
        if (!r) throw new Error('le clavier n’a pas répondu');
        state.rkled = { effect: fx[0], speed, light, color };
      },
      rows() {
        const l = state.rkled || { effect: null, speed: 5, light: lights - 1, color: 7 };
        const fx = effects.find(f => f[0] === l.effect);
        const put = (label, patch) => drvSet(inst, label, 'rkled', { ...l, effect: l.effect ?? 6, ...patch });
        const rows = [field('Éclairage', h('select', { onchange: e => put('Éclairage', { effect: Number(e.target.value) }) },
          ...(l.effect == null ? [h('option', { value: '', selected: true, disabled: true }, 'Choisir un effet…')] : []),
          ...effects.map(f => h('option', { value: f[0], selected: f[0] === l.effect }, f[1]))))];
        if (!fx || fx[0] === 0) return rows;
        rows.push(field('Luminosité', slider(1, lights, 1, l.light + 1, ` / ${lights}`, v => put('Luminosité', { light: v - 1 }))));
        if (fx[2]) rows.push(field('Vitesse', slider(1, RK_SPEEDS, 1, l.speed + 1, ` / ${RK_SPEEDS}`, v => put('Vitesse', { speed: v - 1 }))));
        if (fx[3]) rows.push(field('Couleur', h('div', { class: 'row-inline' },
          RK_COLORS.filter(c => c.v || fx[4]).map(c => h('button', {
            class: 'swatch' + (c.v === l.color ? ' on' : ''), title: c.label,
            style: c.css ? `background:${c.css}` : 'background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red)',
            onclick: () => put('Couleur', { color: c.v }),
          })))));
        return rows;
      },
    };
    await drvReapply(inst);
    return [inst];
  },
});
