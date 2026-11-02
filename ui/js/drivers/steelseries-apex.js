// PeriphHub — éclairage des claviers SteelSeries Apex 3 et Apex 3 TKL, d'après le pilote libre
// OpenRGB (SteelSeriesApexTZoneController / SteelSeriesApex8ZoneController, GPL-2.0) :
// protocole réécrit ici, aucun code repris.
//
// Apex 3 (1038:161A, interface 3) : rapports de 32 octets, ID 0.
//   [0x0A, 0x00, luminosité 0-100]           luminosité
//   [0x0B, 0x00, R,G,B × 10 zones]           couleurs, en direct
// Apex 3 TKL (1038:1622, interface 1, page 0xFFC0) : rapports de 64 octets, ID 0.
//   [0x23, luminosité 0-16]                  luminosité
//   [0x21, 0xFF, R,G,B × 8 zones]            couleurs, en direct
//
// Ces claviers ne savent pas dire leur éclairage actuel : PeriphHub n'écrit JAMAIS dans leur
// mémoire (pas de commande d'enregistrement). Débrancher puis rebrancher le clavier lui rend
// son éclairage d'origine ; PeriphHub renvoie le choix de l'utilisateur à chaque branchement.

const APEX_MODELS = {
  // pid : [nom, interface, page d'usage (null : peu importe), zones, taille du rapport, luminosité max]
  0x161A: ['SteelSeries Apex 3', 3, null, 10, 32, 100],
  0x1622: ['SteelSeries Apex 3 TKL', 1, 0xFFC0, 8, 64, 16],
};
const apexModel = d => d.vendorId === 0x1038 ? APEX_MODELS[d.productId] : null;
const apexRgb = hex => [1, 3, 5].map(i => parseInt(String(hex || '#ffffff').slice(i, i + 2), 16) || 0);

registerDriver({
  id: 'steelseries-apex',
  priority: 12, // avant OpenMouse (10), qui accepte tout appareil SteelSeries puis abandonne
  match: d => {
    const m = apexModel(d);
    return !!m && d.info?.interface === m[1] && (m[2] == null || d.collections?.some(c => c.usagePage === m[2]));
  },
  async connect(dev) {
    const [name, , , zones, size, bmax] = apexModel(dev);
    await dev.open();
    const tkl = zones === 8;
    const send = async bytes => {
      const r = new Uint8Array(size);
      r.set(bytes);
      await dev.sendReport(0, r);
    };
    // Au départ, le clavier affiche son propre éclairage (inconnu de PeriphHub)
    const state = { light: { effect: 'keyboard', color: '#ffffff', brightness: null } };
    const inst = {
      key: `drv-${devId(dev).replace(':', '').toLowerCase()}`,
      name, kind: 'clavier', dev, state,
      caps: { light: { effects: ['keyboard', 'static', 'off'], labels: { keyboard: 'Celui du clavier' }, color: true, brightness: true } },
      meta: 'éclairage',
      noOrigin: true, // rien n'est enregistré dans le clavier : le rebrancher suffit
      source: 'Protocole du logiciel libre OpenRGB (GPL-2.0), pas encore confirmé sur ce modèle dans PeriphHub. '
        + 'PeriphHub n’écrit rien dans la mémoire du clavier.',
      note: 'Ce clavier ne sait pas indiquer son éclairage actuel. PeriphHub l’applique en direct sans rien enregistrer '
        + 'dans le clavier, et le renvoie à chaque branchement. Pour retrouver l’éclairage d’origine : choisissez « Celui du clavier », '
        + 'puis débranchez et rebranchez le clavier. Fermez SteelSeries GG, sinon il réimpose le sien.',
      refresh: async () => {},
      async set(cap, v) {
        if (cap !== 'light' || !v || !['keyboard', 'static', 'off'].includes(v.effect)) throw new Error('effet inconnu');
        if (v.effect === 'keyboard') {
          // Rien à envoyer : le clavier reprend son éclairage au prochain branchement
          if (state.light.effect !== 'keyboard') toast('Débranchez et rebranchez le clavier pour retrouver son éclairage.', 'ok');
          Object.assign(state.light, { effect: 'keyboard', brightness: null });
          return;
        }
        const pct = Math.max(0, Math.min(100, Math.round(Number(v.brightness ?? 100))));
        const rgb = v.effect === 'off' ? [0, 0, 0] : apexRgb(v.color);
        const colors = Array.from({ length: zones }, () => rgb).flat();
        if (tkl) {
          await send([0x21, 0xFF, ...colors]);
          await send([0x23, Math.round(pct * bmax / 100)]);
        } else {
          await send([0x0A, 0x00, Math.round(pct * bmax / 100)]);
          await send([0x0B, 0x00, ...colors]);
        }
        Object.assign(state.light, v, { brightness: pct });
      },
    };
    await drvReapply(inst);
    return [inst];
  },
});
