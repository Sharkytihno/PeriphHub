// PeriphHub — éclairage des casques Razer Kraken filaires (Kraken 7.1, V2, Tournament Edition,
// Ultimate, Kitty V2, Classic), d'après le pilote libre OpenRazer (razerkraken_driver.c, GPL-2.0) :
// protocole réécrit ici, aucun code repris.
//
// Interface 3, rapport de sortie n° 4 (37 octets) : [4, destination, taille, adresse haute, adresse basse, 32 octets].
//   destination 0x00 = lecture : la réponse arrive en rapport d'entrée n° 5 (valeur dans l'octet qui suit l'ID) ;
//   destination 0x40 = écriture dans la mémoire vive du casque (perdue à la déconnexion : PeriphHub la renvoie).
// Octet de mode : bit 0 allumé/fixe, bit 1 respiration, bit 2 cycle de couleurs, bit 3 synchro.
// Seules ces deux adresses (mode et couleur) sont touchées. Aucune commande de firmware.

const KRAKEN_MODELS = {
  // pid : [nom, adresse du mode, adresse de la couleur (null : pas de couleur, seulement allumé/éteint)]
  0x0501: ['Razer Kraken 7.1 Classic', 0x1008, null],
  0x0506: ['Razer Kraken 7.1 Classic', 0x1008, null],
  0x0504: ['Razer Kraken 7.1 Chroma', 0x1008, 0x15DE],
  0x0510: ['Razer Kraken 7.1 V2', 0x172D, 0x1741],
  0x0520: ['Razer Kraken Tournament Edition', 0x172D, 0x1741],
  0x0527: ['Razer Kraken Ultimate', 0x172D, 0x1741],
  0x0560: ['Razer Kraken Kitty V2', 0x172D, 0x1741],
};
const KRAKEN_FX = { off: 0x00, static: 0x01, breathing: 0x0B, spectrum: 0x05 };
const krakenSleep = ms => new Promise(r => setTimeout(r, ms));
const krakenEffect = m => m === 0 ? 'off' : m & 4 ? 'spectrum' : m & 2 ? 'breathing' : m & 1 ? 'static' : 'other';
const krakenHex = (r, g, b) => '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');

class KrakenDevice {
  constructor(dev, model) {
    this.dev = dev;
    [this.name, this.modeAddr, this.rgbAddr] = model;
    this.queue = Promise.resolve();
    this.waiting = null;
    dev.addEventListener('inputreport', e => {
      if (e.reportId !== 5 || !this.waiting) return;
      const w = this.waiting; this.waiting = null;
      w(new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength));
    });
  }

  report(dest, addr, args) {
    const r = new Uint8Array(36);
    r[0] = dest; r[1] = args.length; r[2] = addr >> 8; r[3] = addr & 0xFF;
    r.set(args.slice(0, 32), 4);
    return r;
  }

  // Une commande à la fois (les réponses ne disent pas à quelle question elles répondent)
  run(f) {
    const p = this.queue.then(f, f);
    this.queue = p.catch(() => {});
    return p;
  }

  read(addr, len) {
    return this.run(async () => {
      const got = new Promise((res, rej) => {
        this.waiting = res;
        setTimeout(() => { if (this.waiting === res) { this.waiting = null; rej(new Error('Kraken : pas de réponse')); } }, 400);
      });
      await this.dev.sendReport(4, this.report(0x00, addr, new Array(len).fill(0)));
      return (await got).slice(0, len);
    });
  }

  write(addr, args) {
    return this.run(async () => {
      await this.dev.sendReport(4, this.report(0x40, addr, args));
      await krakenSleep(Math.max(25, args.length * 15)); // délai demandé par le casque (OpenRazer)
    });
  }
}

registerDriver({
  id: 'razer-kraken',
  priority: 5,
  match: d => d.vendorId === 0x1532 && KRAKEN_MODELS[d.productId] != null && d.info?.interface === 3,
  async connect(_dev, group) {
    for (const dev of group.filter(this.match)) {
      try { await dev.open(); } catch { continue; }
      const k = new KrakenDevice(dev, KRAKEN_MODELS[dev.productId]);
      const state = {}, caps = {};
      const refresh = async () => {
        const mode = (await k.read(k.modeAddr, 1))[0];
        let color = state.light?.color || '#00ff00';
        if (k.rgbAddr) { const c = await k.read(k.rgbAddr, 3); color = krakenHex(c[0], c[1], c[2]); }
        state.light = { effect: krakenEffect(mode), color, raw: mode };
      };
      try { await refresh(); } catch { await dev.close().catch(() => {}); continue; }
      caps.light = k.rgbAddr
        ? { effects: ['static', 'breathing', 'spectrum', 'off'], color: true }
        : { effects: ['static', 'off'], labels: { static: 'Allumé' } };
      const inst = {
        key: `drv-${devId(dev).replace(':', '').toLowerCase()}`,
        name: k.name, kind: 'casque', dev, state, caps,
        meta: 'éclairage',
        source: 'Protocole du pilote libre OpenRazer (GPL-2.0), pas encore confirmé sur ce modèle.',
        refresh,
        async set(cap, v) {
          if (cap !== 'light') return;
          // Mode d'origine non standard (respiration à 2 couleurs…) : remis tel quel
          const mode = v.raw != null && krakenEffect(v.raw) === v.effect ? v.raw : KRAKEN_FX[v.effect];
          if (mode == null) throw new Error('effet inconnu');
          if (k.rgbAddr && (mode & 3)) {
            const [r, g, b] = [1, 3, 5].map(i => parseInt((v.color || '#ffffff').slice(i, i + 2), 16));
            await k.write(k.rgbAddr, [r, g, b]);
          }
          await k.write(k.modeAddr, [mode]);
          Object.assign(state.light, v, { raw: mode });
        },
        note: 'Le casque oublie son éclairage quand on le débranche : PeriphHub renvoie votre choix à chaque branchement. '
          + 'Le son (égaliseur, son 7.1) reste géré par Windows.',
      };
      await drvReapply(inst);
      return [inst];
    }
    return [];
  },
});
