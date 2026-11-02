// PeriphHub — pilote générique Razer (souris et claviers), d'après OpenRazer (GPL-2.0).
// Chaque commande est un feature report n° 0 de 90 octets :
//   [statut, id de transaction, 0, 0, 0, taille, classe, commande, 80 octets d'arguments, CRC, 0]
// CRC = XOR des octets 2 à 87. Réponse lue au même endroit ; statut 2 = réussi.
// Les casques Razer (pages dédiées) ne passent pas par ici. Aucune commande de firmware.

const RZ_VARSTORE = 0x01;
const RZ_STATUS = { 1: 'occupé', 3: 'échec', 4: 'délai dépassé', 5: 'commande non prise en charge' };
const RZ_RATE = { 1: 1000, 2: 500, 8: 125 };

const rzSleep = ms => new Promise(r => setTimeout(r, ms));

class RazerDevice {
  constructor(dev) {
    this.dev = dev;
    this.tid = 0x1F;
    this.state = {}; this.caps = {};
    this.queue = Promise.resolve();
  }

  command(cls, cmd, size, args = []) {
    const run = async () => {
      const r = new Uint8Array(90);
      r[1] = this.tid; r[5] = size; r[6] = cls; r[7] = cmd;
      r.set(args.slice(0, 80), 8);
      let crc = 0;
      for (let i = 2; i < 88; i++) crc ^= r[i];
      r[88] = crc;
      await this.dev.sendFeatureReport(0, r);
      for (let attempt = 0; attempt < 8; attempt++) {
        await rzSleep(attempt ? 40 : 25);
        const v = await this.dev.receiveFeatureReport(0, 90);
        const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
        if (b[0] === 1 || b[6] !== cls || b[7] !== cmd) continue; // occupé / pas encore la réponse
        if (b[0] !== 2) throw new Error('Razer : ' + (RZ_STATUS[b[0]] || 'statut ' + b[0]));
        return b.slice(8, 88);
      }
      throw new Error('Razer : pas de réponse');
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  // Selon les modèles, l'id de transaction attendu est 0x1F, 0x3F ou 0xFF
  async handshake() {
    for (const tid of [0x1F, 0x3F, 0xFF]) {
      this.tid = tid;
      try {
        const fw = await this.command(0x00, 0x81, 0x02);
        this.fw = `${fw[0]}.${fw[1]}`;
        return true;
      } catch {}
    }
    return false;
  }

  async refreshBattery() {
    if (!this.caps.battery) return;
    const lvl = (await this.command(0x07, 0x80, 0x02))[1];
    const chg = (await this.command(0x07, 0x84, 0x02).catch(() => [0, 0]))[1];
    this.state.battery = { level: Math.round(lvl / 255 * 100), charging: !!chg };
  }

  async probe() {
    const ok = async f => { try { await f(); return true; } catch { return false; } };
    this.caps.battery = true;
    this.caps.battery = await ok(() => this.refreshBattery());
    // Souris filaires : la batterie répond parfois 0 % ; on l'ignore
    if (this.caps.battery && this.state.battery.level === 0 && !this.state.battery.charging) { this.caps.battery = false; delete this.state.battery; }
    if (this.kind === 'souris' && await ok(() => this.command(0x04, 0x85, 0x07, [RZ_VARSTORE]))) {
      this.caps.dpi = { min: 100, max: 16000, step: 50, presets: [400, 800, 1600, 3200, 6400] };
    }
    if (await ok(() => this.command(0x00, 0x85, 0x01))) this.caps.rate = [125, 500, 1000];
    this.led = this.kind === 'clavier' ? 0x05 : 0x00;
    if (await ok(() => this.command(0x0F, 0x84, 0x03, [RZ_VARSTORE, this.led]))) {
      this.caps.light = { effects: ['static', 'spectrum', 'breathing', 'off'], color: true, brightness: true };
      // L'effet en cours ne se relit pas : inconnu tant qu'on n'en a pas choisi un
      this.state.light = { effect: null, color: '#00ff00', brightness: 100 };
    }
    await this.refresh();
  }

  async refresh() {
    const s = this.state;
    if (this.caps.dpi) { const r = await this.command(0x04, 0x85, 0x07, [RZ_VARSTORE]); s.dpi = (r[1] << 8) | r[2]; }
    if (this.caps.rate) s.rate = RZ_RATE[(await this.command(0x00, 0x85, 0x01))[0]] || null;
    if (this.caps.light) s.light.brightness = Math.round((await this.command(0x0F, 0x84, 0x03, [RZ_VARSTORE, this.led]))[2] / 255 * 100);
    if (this.caps.battery) await this.refreshBattery().catch(() => {});
  }

  async set(cap, v) {
    if (cap === 'dpi') {
      const d = Math.max(100, Math.min(this.caps.dpi.max, Math.round(v)));
      await this.command(0x04, 0x05, 0x07, [RZ_VARSTORE, d >> 8, d & 0xFF, d >> 8, d & 0xFF, 0, 0]);
    } else if (cap === 'rate') {
      const code = Number(Object.keys(RZ_RATE).find(k => RZ_RATE[k] === v));
      await this.command(0x00, 0x05, 0x01, [code]);
    } else if (cap === 'light') {
      const cur = this.state.light;
      if (v.brightness !== cur.brightness) await this.command(0x0F, 0x04, 0x03, [RZ_VARSTORE, this.led, Math.round(v.brightness / 100 * 255)]);
      if (v.effect && (v.effect !== cur.effect || v.color !== cur.color)) {
        const [r, g, b] = [1, 3, 5].map(i => parseInt((v.color || '#ffffff').slice(i, i + 2), 16));
        const fx = {
          off: [0x06, [RZ_VARSTORE, this.led, 0x00]],
          static: [0x09, [RZ_VARSTORE, this.led, 0x01, 0, 0, 0x01, r, g, b]],
          breathing: [0x09, [RZ_VARSTORE, this.led, 0x02, 0x01, 0, 0x01, r, g, b]],
          spectrum: [0x06, [RZ_VARSTORE, this.led, 0x03]],
        }[v.effect];
        await this.command(0x0F, 0x02, fx[0], fx[1]);
      }
      Object.assign(cur, v);
    }
  }
}

registerDriver({
  id: 'razer-chroma',
  // Collections de l'interface 0 (souris ou clavier) : c'est là qu'écoute le microcontrôleur
  match: d => d.vendorId === 0x1532 && d.info?.interface === 0 && d.collections[0].usagePage === 0x01,
  async connect(_dev, group) {
    const tries = group.filter(this.match)
      .sort((a, b) => (b.collections[0].usage === 2 || b.collections[0].usage === 6) - (a.collections[0].usage === 2 || a.collections[0].usage === 6));
    for (const dev of tries) {
      try { await dev.open(); } catch { continue; }
      const d = new RazerDevice(dev);
      // Type d'après l'interface 0 (une souris Razer expose aussi un « clavier » pour ses macros, ailleurs)
      const u0 = group.filter(this.match).map(g => g.collections[0].usage);
      d.kind = u0.includes(2) ? 'souris' : u0.includes(6) ? 'clavier' : 'autre';
      if (!await d.handshake()) { await dev.close().catch(() => {}); continue; }
      await d.probe();
      const name = ((await deviceName(dev)) || 'Appareil Razer').replace(/^(?!razer)/i, 'Razer ');
      const inst = {
        key: `drv-${devId(dev).replace(':', '').toLowerCase()}`,
        name, kind: d.kind, dev,
        meta: `firmware ${d.fw}`,
        state: d.state, caps: d.caps,
        refresh: () => d.refresh(), set: (c, v) => d.set(c, v), refreshBattery: () => d.refreshBattery(),
        note: 'Les réglages sont enregistrés dans la mémoire de l’appareil : ils restent sans Razer Synapse. '
          + 'Les modèles à 4 000 / 8 000 Hz (HyperPolling) et les effets avancés demandent encore Synapse.',
      };
      await drvReapply(inst);
      return [inst];
    }
    return [];
  },
});
