// PeriphHub — manettes PlayStation : DualSense, DualSense Edge, DualShock 4 (v1, v2, adaptateur sans fil),
// en USB et en Bluetooth. Couleur et luminosité de la barre lumineuse, voyants joueur (DualSense),
// clignotement (DualShock 4), batterie.
// Protocole d'après le pilote hid-playstation du noyau Linux (Sony / Roderick Colenbrander) :
// structures des rapports, drapeaux, CRC32 du Bluetooth. Réécrit, aucune copie de code.
// Jamais de vibration, de gâchettes adaptatives ni de mise à jour : seulement les voyants.
//
// La manette envoie des centaines de rapports par seconde : PeriphHub ne l'ouvre que le temps
// d'un réglage ou d'une lecture de batterie, puis la referme.

const PS_MODELS = {
  0x0CE6: ['DualSense', 'ds'], 0x0DF2: ['DualSense Edge', 'ds'],
  0x05C4: ['DualShock 4', 'ds4'], 0x09CC: ['DualShock 4', 'ds4'], 0x0BA0: ['DualShock 4 (adaptateur sans fil)', 'ds4'],
};
// Voyants joueur centrés comme sur PS5 (bits 0 à 4, de gauche à droite)
const PS_PLAYERS = [{ v: 0, label: 'Éteints' }, { v: 0x04, label: '1' }, { v: 0x0A, label: '2' }, { v: 0x15, label: '3' }, { v: 0x1B, label: '4' }, { v: 0x1F, label: 'Tous' }];

// CRC32 classique (polynôme 0xEDB88320) d'un octet de graine suivi du rapport : exigé en Bluetooth
const PS_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return bytes => { let c = 0xFFFFFFFF; for (const b of bytes) c = t[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
})();

function psBattery(model, reportId, d) {
  // Octet d'état : DualSense USB n° 1 → 52, Bluetooth n° 0x31 → 53 ; DualShock 4 USB n° 1 → 29, Bluetooth n° 0x11 → 31
  let i;
  if (model === 'ds') i = reportId === 0x01 && d.length >= 63 ? 52 : reportId === 0x31 && d.length >= 77 ? 53 : -1;
  else i = reportId === 0x01 && d.length >= 63 ? 29 : reportId === 0x11 && d.length >= 77 ? 31 : -1;
  if (i < 0) return undefined;
  const st = d[i], cap = st & 0x0F;
  if (model === 'ds') {
    const charge = st >> 4;
    if (charge === 0x2) return { level: 100, charging: false, full: true };
    if (charge > 0x2) return null; // erreur de température / de charge
    return { level: Math.min(cap * 10 + 5, 100), charging: charge === 0x1 };
  }
  // DualShock 4 : adaptateur sans manette appairée → octet suivant, bit 2
  if (d[i + 1] & 0x04 && reportId === 0x01) return { off: true };
  if (st & 0x10) return cap <= 10 ? { level: cap < 10 ? cap * 10 + 5 : 100, charging: true } : cap === 11 ? { level: 100, charging: false, full: true } : null;
  return { level: cap < 10 ? cap * 10 + 5 : 100, charging: false };
}

class PsPad {
  constructor(dev, model) {
    Object.assign(this, { dev, model, seq: 0, setupDone: false });
    const out = dev.collections?.flatMap(c => c.outputReports || []).map(r => r.reportId) || [];
    this.bt = model === 'ds' ? out.includes(0x31) : out.includes(0x11);
  }

  async with(fn) {
    const was = this.dev.opened;
    if (!was) await this.dev.open();
    try { return await fn(); } finally { if (!was) await this.dev.close().catch(() => {}); }
  }

  // Premier rapport complet reçu (Bluetooth : la lecture du rapport de calibration active les rapports complets)
  readBattery() {
    return this.with(async () => {
      if (this.bt) await this.dev.receiveFeatureReport(0x05, 41).catch(() => {});
      return new Promise(resolve => {
        const done = v => { clearTimeout(t); this.dev.removeEventListener('inputreport', on); resolve(v); };
        const on = e => {
          const d = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
          const b = psBattery(this.model, e.reportId, d);
          if (b !== undefined) done(b);
        };
        const t = setTimeout(() => done(undefined), 800);
        this.dev.addEventListener('inputreport', on);
      });
    });
  }

  async send(light, players) {
    const k = (light.effect === 'off' ? 0 : (light.brightness ?? 100)) / 100;
    const rgb = [1, 3, 5].map(i => Math.round((parseInt((light.color || '#ffffff').slice(i, i + 2), 16) || 0) * k));
    await this.with(async () => {
      if (this.model === 'ds') {
        const c = new Uint8Array(47);
        if (!this.setupDone) {
          // Libère la barre de l'animation de démarrage (Bluetooth), sans effet gênant en USB
          c[38] = 0x02; c[41] = 0x02;
          await this.write(c);
          c[38] = 0; c[41] = 0;
          this.setupDone = true;
        }
        c[1] = 0x04 | (players != null ? 0x10 : 0); // barre lumineuse + voyants joueur
        c[43] = players ?? 0;
        c.set(rgb, 44);
        await this.write(c);
      } else {
        const c = new Uint8Array(10);
        c[0] = 0x02 | 0x04; // couleur + clignotement (0/0 = fixe)
        c.set(rgb, 5);
        if (light.effect === 'blink') { c[8] = 50; c[9] = 50; } // 0,5 s allumé, 0,5 s éteint
        await this.write(c);
      }
    });
  }

  async write(common) {
    if (this.model === 'ds') {
      if (!this.bt) return this.dev.sendReport(0x02, Uint8Array.from([...common, ...new Array(15).fill(0)]));
      const r = new Uint8Array(78);
      r[0] = 0x31; r[1] = (this.seq << 4) & 0xF0; r[2] = 0x10;
      this.seq = (this.seq + 1) & 0x0F;
      r.set(common, 3);
      return this.dev.sendReport(0x31, this.crc(r).slice(1));
    }
    if (!this.bt) return this.dev.sendReport(0x05, Uint8Array.from([...common, ...new Array(21).fill(0)]));
    const r = new Uint8Array(78);
    r[0] = 0x11; r[1] = 0xC0 | 4; // données HID + CRC, interrogation toutes les 4 ms (valeur du noyau)
    r.set(common, 3);
    return this.dev.sendReport(0x11, this.crc(r).slice(1));
  }

  crc(r) {
    const v = PS_CRC([0xA2, ...r.slice(0, r.length - 4)]);
    r.set([v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, v >>> 24], r.length - 4);
    return r;
  }
}

registerDriver({
  id: 'playstation',
  priority: 9,
  match: d => d.vendorId === 0x054C && !!PS_MODELS[d.productId] && (d.collections?.[0]?.usagePage ?? 1) === 0x01,
  async connect(dev) {
    const [label, model] = PS_MODELS[dev.productId];
    const pad = new PsPad(dev, model);
    const ds = model === 'ds';
    const inst = {
      key: `drv-ps-${hex4(dev.productId)}-${(dev.info?.path || '').replace(/[^a-z0-9]/gi, '').slice(-12)}`.toLowerCase(),
      name: 'Sony ' + label, kind: 'manette', dev,
      caps: {
        light: { effects: ds ? ['static', 'off'] : ['static', 'blink', 'off'], labels: { blink: 'Clignotement' }, color: true, brightness: true },
        ...(ds ? { players: true } : {}),
      },
      state: { light: { effect: 'static', color: ds ? '#0050ff' : '#0040ff', brightness: 100 }, ...(ds ? { players: 0x04 } : {}) },
      meta: pad.bt ? 'Bluetooth' : 'USB',
      source: 'Protocole du pilote PlayStation du noyau Linux (réécrit). Seuls les voyants sont commandés : ni vibration, ni gâchettes, ni mise à jour. ' +
        'La manette ne garde pas ses couleurs une fois éteinte : PeriphHub les renvoie à chaque connexion.',
      note: 'Steam (Steam Input) ou DS4Windows peuvent eux aussi piloter la barre lumineuse quand ils tournent : le dernier qui écrit l’emporte.',
      async set(cap, v) {
        if (cap === 'light') { await pad.send(v, ds ? inst.state.players : null); inst.state.light = { ...v }; }
        else if (cap === 'players') { await pad.send(inst.state.light, v); inst.state.players = v; }
        else throw new Error('réglage inconnu');
      },
      refresh: () => Promise.resolve(),
      async refreshBattery() {
        const b = await pad.readBattery().catch(() => undefined);
        if (b === undefined) return;
        inst.off = !!b?.off;
        if (b && !b.off) inst.state.battery = { level: b.level, charging: b.charging, ...(b.full ? { label: 'Batterie pleine' } : {}) };
        else delete inst.state.battery;
        inst.meta = inst.off ? 'Aucune manette appairée à l’adaptateur' : pad.bt ? 'Bluetooth' : 'USB';
      },
      rows() {
        if (!ds) return [];
        return [field('Voyants joueur', segmented(PS_PLAYERS, inst.state.players, v => drvSet(inst, 'Voyants joueur', 'players', v)))];
      },
    };
    await inst.refreshBattery();
    await drvReapply(inst);
    return [inst];
  },
});
