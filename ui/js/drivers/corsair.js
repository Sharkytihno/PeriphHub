// PeriphHub — souris Corsair (DPI, fréquence, batterie), protocoles réécrits d'après ckb-next
// (GPL-2.0, src/daemon : nxp_proto.h, dpi.c, bragi_proto.h, dpi_bragi.c) et recoupés avec OpenMouse,
// qui a validé le transport NXP sur une NIGHTSWORD (la Nightsword reste à OpenMouse).
//
// Deux familles :
//  • NXP (avant 2019 : M65, Scimitar, Harpoon, Sabre, Glaive, Katar, Ironclaw, Dark Core) :
//    feature report n° 0, 64 octets, collection 0xFFC2 / usage 4. GET = [0x0E, champ, sous-cmd, 0]
//    puis lecture : la réponse recopie ces 4 octets. SET = [0x07, …], sans réponse.
//  • Bragi (M55, Katar Pro, Dark Core RGB Pro, Ironclaw / Harpoon sans fil) :
//    rapport de sortie sans ID, 64 octets, page 0xFF42. Requête [0x08 | emplacement, cmd, propriété, 0,
//    valeur LE] ; réponse en rapport d'entrée [emplacement, cmd, statut (0 = réussi), valeur LE].
//
// Garde-fous : seuls les champs ci-dessous sont envoyés (jamais FW_START 0x0C, RESET 0x02, mode
// logiciel 0x04/0x05 ni BRAGI_MODE 0x03 : en mode logiciel la souris n'applique plus sa mémoire).
// Tout réglage est relu ; s'il n'a pas pris, PeriphHub le dit au lieu de faire semblant.

const CS_NXP = {
  // pid : [nom, DPI max]
  0x1B12: ['Corsair M65 RGB', 8200], 0x1B2E: ['Corsair M65 PRO RGB', 12000], 0x1B5A: ['Corsair M65 RGB ELITE', 18000],
  0x1B14: ['Corsair Sabre RGB (optique)', 6400], 0x1B19: ['Corsair Sabre RGB (laser)', 8200],
  0x1B2F: ['Corsair Sabre RGB', 10000], 0x1B32: ['Corsair Sabre RGB', 10000],
  0x1B1E: ['Corsair Scimitar RGB', 12000], 0x1B3E: ['Corsair Scimitar PRO RGB', 16000], 0x1B8B: ['Corsair Scimitar RGB ELITE', 18000],
  0x1B3C: ['Corsair Harpoon RGB', 6000], 0x1B75: ['Corsair Harpoon RGB PRO', 12000],
  0x1B34: ['Corsair Glaive RGB', 16000], 0x1B74: ['Corsair Glaive RGB PRO', 18000],
  0x1B22: ['Corsair Katar', 8000], 0x1B5D: ['Corsair Ironclaw RGB', 18000],
  0x1B35: ['Corsair Dark Core RGB', 16000], 0x1B4B: ['Corsair Dark Core RGB SE', 16000],
  0x1B64: ['Corsair Dark Core RGB (sans fil)', 16000], 0x1B51: ['Corsair Dark Core RGB SE (sans fil)', 16000],
};
const CS_BRAGI = {
  // pid : [nom, DPI max, emplacement (0 = câble, 1 = souris derrière le récepteur)]
  0x1B70: ['Corsair M55 RGB PRO', 12400, 0], 0x1B93: ['Corsair Katar PRO', 12400, 0], 0x1BAC: ['Corsair Katar PRO XT', 18000, 0],
  0x1B80: ['Corsair Dark Core RGB PRO', 18000, 0], 0x1B81: ['Corsair Dark Core RGB PRO (récepteur)', 18000, 1],
  0x1B7E: ['Corsair Dark Core RGB PRO SE', 18000, 0], 0x1B7F: ['Corsair Dark Core RGB PRO SE (récepteur)', 18000, 1],
  0x1B4C: ['Corsair Ironclaw RGB Wireless', 18000, 0], 0x1B66: ['Corsair Ironclaw RGB Wireless (récepteur)', 18000, 1],
  0x1B5E: ['Corsair Harpoon RGB Wireless', 10000, 0], 0x1B65: ['Corsair Harpoon RGB Wireless (récepteur)', 10000, 1],
};
const CS_NXP_RATES = [1000, 500, 250, 125];                 // période 1, 2, 4, 8 ms
const CS_BRAGI_RATES = { 1: 125, 2: 250, 3: 500, 4: 1000 }; // valeurs de la propriété 0x01
const csSleep = ms => new Promise(r => setTimeout(r, ms));
const csHasCol = (cols, f) => (cols || []).some(c => f(c) || csHasCol(c.children, f));

// ---------- NXP ----------
class CorsairNxp {
  constructor(dev, max) { this.dev = dev; this.max = max; this.queue = Promise.resolve(); this.le = null; }
  run(f) { const p = this.queue.then(f, f); this.queue = p.catch(() => {}); return p; }
  packet(bytes) { const r = new Uint8Array(64); r.set(bytes); return r; }
  send(bytes) {
    return this.run(async () => { await this.dev.sendFeatureReport(0, this.packet(bytes)); await csSleep(20); });
  }
  get(bytes) {
    return this.run(async () => {
      const req = this.packet(bytes);
      for (let i = 0; i < 3; i++) {
        await this.dev.sendFeatureReport(0, req);
        await csSleep(20);
        const v = await this.dev.receiveFeatureReport(0);
        let b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
        if (b.length === 65 && b[0] === 0 && b[1] === req[0]) b = b.subarray(1);
        if (b[0] === req[0] && b[1] === req[1] && b[2] === req[2] && b[3] === req[3]) return b;
      }
      throw new Error('Corsair : pas de réponse');
    });
  }
  // L'ordre des octets du DPI relu diffère selon les sources (ckb-next : petit-boutiste ; OpenMouse,
  // relevé sur Nightsword : gros-boutiste) : on garde la lecture cohérente avec les bornes, puis celle
  // qui a confirmé la dernière écriture
  dpiOf(b) {
    const le = b[5] | (b[6] << 8), be = (b[5] << 8) | b[6];
    if (this.le != null) return this.le ? le : be;
    const ok = v => v >= 100 && v <= this.max;
    return ok(be) && !ok(le) ? be : ok(le) && !ok(be) ? le : be;
  }
  async ident() { const b = await this.get([0x0E, 0x01, 0, 0]); return { fw: b[8] | (b[9] << 8), poll: b[16] }; }
  async stage() { return (await this.get([0x0E, 0x13, 0x02, 0]))[4]; }
  async readDpi() { const s = await this.stage(); return this.dpiOf(await this.get([0x0E, 0x13, 0xD0 | (s % 6), 0])); }
  async writeDpi(dpi) {
    const s = (await this.stage()) % 6;
    // Profil en direct (octet 3 = 0) : la souris l'oublie hors tension, PeriphHub le renvoie au branchement
    await this.send([0x07, 0x13, 0xD0 | s, 0, 0, dpi & 0xFF, dpi >> 8, dpi & 0xFF, dpi >> 8]);
    const b = await this.get([0x0E, 0x13, 0xD0 | s, 0]);
    const le = b[5] | (b[6] << 8), be = (b[5] << 8) | b[6];
    if (le === dpi) this.le = true;
    else if (be === dpi) this.le = false;
    else throw new Error('la souris n’a pas pris ce DPI (mémoire intégrée active ?)');
  }
  async writeRate(hz) { await this.send([0x07, 0x0A, 0, 0, Math.round(1000 / hz)]); }
}

// ---------- Bragi ----------
class CorsairBragi {
  constructor(dev, slot) {
    this.dev = dev; this.slot = slot; this.queue = Promise.resolve(); this.waiting = null;
    dev.addEventListener('inputreport', e => {
      if (!this.waiting) return;
      const b = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
      if (this.waiting(b)) this.waiting = null;
    });
  }
  run(f) { const p = this.queue.then(f, f); this.queue = p.catch(() => {}); return p; }
  call(cmd, prop, value = []) {
    return this.run(() => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting = null; reject(new Error('Corsair : pas de réponse')); }, 500);
      this.waiting = b => {
        if (b[1] !== cmd) return false;
        clearTimeout(timer);
        if (b[2]) reject(new Error(b[2] === 5 ? 'réglage non pris en charge par ce modèle' : 'Corsair : statut ' + b[2]));
        else resolve(b.slice(3));
        return true;
      };
      const r = new Uint8Array(64);
      r.set([0x08 | this.slot, cmd, prop, 0, ...value]);
      this.dev.sendReport(0, r).catch(e => { clearTimeout(timer); this.waiting = null; reject(e); });
    }));
  }
  async get(prop) { const v = await this.call(0x02, prop); return v[0] | (v[1] << 8); }
  set(prop, v) { return this.call(0x01, prop, [v & 0xFF, v >> 8]); }
}

registerDriver({
  id: 'corsair',
  priority: 8, // après OpenMouse (10), qui garde la Nightsword et l'Ironclaw sans fil qu'il a validées
  match: d => d.vendorId === 0x1B1C && !!(
    (CS_NXP[d.productId] && csHasCol(d.collections, c => c.usagePage === 0xFFC2 && c.usage === 4)) ||
    (CS_BRAGI[d.productId] && csHasCol(d.collections, c => c.usagePage === 0xFF42))),
  async connect(dev) {
    await dev.open();
    const state = {}, caps = {}, inst = {};
    let p, name, setDpi, setRate, refresh;
    if (CS_NXP[dev.productId]) {
      const [n, max] = CS_NXP[dev.productId];
      name = n;
      p = new CorsairNxp(dev, max);
      const id = await p.ident().catch(() => null);
      if (!id) { await dev.close().catch(() => {}); return []; }
      caps.dpi = { min: 100, max, step: 50, presets: [400, 800, 1600, 3200, 6400].filter(v => v <= max) };
      caps.rate = CS_NXP_RATES.slice().reverse();
      state.rate = id.poll ? Math.round(1000 / id.poll) : null;
      refresh = async () => { state.dpi = await p.readDpi(); };
      setDpi = v => p.writeDpi(v);
      setRate = async v => { await p.writeRate(v); state.rate = v; }; // la souris se reconnecte
      inst.meta = `firmware ${(id.fw >> 8).toString(16)}.${(id.fw & 0xFF).toString(16).padStart(2, '0')}`;
    } else {
      const [n, max, slot] = CS_BRAGI[dev.productId];
      name = n;
      p = new CorsairBragi(dev, slot);
      try { await p.get(0x12); } catch { await dev.close().catch(() => {}); return []; } // PID : la souris répond
      caps.dpi = { min: 100, max, step: 50, presets: [400, 800, 1600, 3200, 6400].filter(v => v <= max) };
      caps.rate = [125, 250, 500, 1000];
      if (slot || /sans fil|Wireless/i.test(n)) caps.battery = await p.get(0x0F).then(() => true, () => false);
      refresh = async () => {
        state.dpi = await p.get(0x21);
        state.rate = CS_BRAGI_RATES[await p.get(0x01).catch(() => 0)] || null;
        if (caps.battery) await inst.refreshBattery().catch(() => {});
      };
      inst.refreshBattery = async () => {
        const lvl = await p.get(0x0F), st = await p.get(0x10).catch(() => 0);
        state.battery = { level: Math.round(lvl / 10), charging: st === 1 };
      };
      setDpi = async v => {
        await p.set(0x21, v); await p.set(0x22, v);
        if (await p.get(0x21) !== v) throw new Error('la souris n’a pas pris ce DPI (mémoire intégrée active ?)');
      };
      setRate = async v => {
        const code = Number(Object.keys(CS_BRAGI_RATES).find(k => CS_BRAGI_RATES[k] === v));
        await p.set(0x01, code);
      };
    }
    try { await refresh(); } catch { await dev.close().catch(() => {}); return []; }
    Object.assign(inst, {
      key: `drv-${devId(dev).replace(':', '').toLowerCase()}`,
      name, kind: 'souris', dev, state, caps, refresh,
      async set(cap, v) {
        if (cap === 'dpi') {
          const d = Math.max(100, Math.min(caps.dpi.max, Math.round(v / 50) * 50));
          await setDpi(d);
          state.dpi = d;
        } else if (cap === 'rate') {
          if (!caps.rate.includes(v)) throw new Error('fréquence non prise en charge');
          await setRate(v);
        }
      },
      source: 'Protocole du pilote libre ckb-next (GPL-2.0), recoupé avec OpenMouse ; pas encore confirmé sur ce modèle.',
      note: 'Réglages appliqués en direct, sans toucher au mode de la souris ni à sa mémoire : PeriphHub les renvoie à chaque branchement. '
        + 'L’éclairage passe par OpenRGB. Si un réglage est refusé, la souris applique sans doute un profil iCUE enregistré dans sa mémoire.',
    });
    await drvReapply(inst);
    return [inst];
  },
});
