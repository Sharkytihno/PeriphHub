// Casque Razer BlackShark V2 HyperSpeed (casque 1532:056E, dongle 1532:0565)
// Protocole « Odessa T2 Wireless » lu dans le module JS de Synapse 4 :
// report 2, 64 octets = [2, statut, transaction+96, 0,0,0, longueur, 0,0, cible,
//                         commande(3), données…, …, checksum XOR des octets 0..61]
// cible : 0x80 = le casque (relayé par le dongle), 0 = le dongle lui-même.
// Commande = [classe, 0, longueur] ; la réponse attendue est [classe, 1, n] suivie
// de n octets. Écriture = classe | 0x80. Statut de réponse 2 = succès.

const RAZER_VID = 0x1532;
const RAZER_REPORT = 2;
const RAZER_LEN = 64;

// Classes de commande (lecture ; écriture = classe | 0x80)
const RZ = {
  firmware: 0x02,       // 24 octets : 6 versions a.b.c.d, la première = MCU
  eqPreset: 0x13,       // 0 défaut, 7 jeu, 8 musique, 9 film, 255 personnalisé
  eqBands: 0x15,        // 10 bandes, int8
  micPreset: 0x16,
  micBands: 0x17,
  sidetone: 0x18,       // 0/1
  sidetoneLevel: 0x19,  // 0..15
  eqGroup: 0x1d,
  eqGroupOn: 0x1e,
  wireless: 0x20,       // dongle : état de la liaison
  battery: 0x21,        // %
  dnd: 0x27,
  charging: 0x2a,
  autoOff: 0x2c,        // minutes, 0 = jamais
  micMute: 0x55,
  micMode: 0x56,
  micGain: 0x57,
  dongleLed: 0x66,
};

const RAZER_EQ_PRESETS = [
  { v: 0, label: 'Par défaut' }, { v: 7, label: 'Jeu' }, { v: 8, label: 'Musique' },
  { v: 9, label: 'Film' }, { v: 255, label: 'Personnalisé' },
];
const RAZER_AUTO_OFF = [
  { v: 0, label: 'Jamais' }, { v: 15, label: '15 min' }, { v: 30, label: '30 min' }, { v: 60, label: '1 h' },
];
const RAZER_EQ_READ_OFFSET = 5;
const RAZER_EQ_FREQS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];

class RazerHeadset {
  static filters = [{ vendorId: RAZER_VID, productId: 0x0565 }, { vendorId: RAZER_VID, productId: 0x056e }];

  // Collection de configuration : celle qui a un report de sortie n° 2 (interface 3)
  static pick(devices) {
    return devices.find(d => d.vendorId === RAZER_VID &&
      d.collections.some(c => c.outputReports?.some(r => r.reportId === RAZER_REPORT)));
  }

  constructor(dev) {
    this.dev = dev;
    this.tx = 0;
    this.queue = Promise.resolve();
    this.pending = null;
    this.state = {};
    this._onInput = e => {
      if (e.reportId !== RAZER_REPORT || !this.pending) return;
      const r = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
      this.pending(r);
    };
  }

  async open() {
    if (!this.dev.opened) await this.dev.open();
    this.dev.removeEventListener('inputreport', this._onInput);
    this.dev.addEventListener('inputreport', this._onInput);
  }

  // Paquet sans l'ID de report (WebHID l'ajoute) : indices décalés de -1 par rapport à Synapse
  _packet(cmd, data, toDongle) {
    this.tx = this.tx === 31 ? 1 : this.tx + 1;
    const a = new Uint8Array(RAZER_LEN).fill(0);
    a[0] = RAZER_REPORT;
    a[2] = this.tx + 96;
    a[6] = cmd.length + (data?.length || 0) + 1;
    a[9] = toDongle ? 0 : 0x80;
    a.set(cmd, 10);
    if (data) a.set(data, 10 + cmd.length);
    let x = 0;
    for (let i = 0; i < RAZER_LEN - 2; i++) x ^= a[i];
    a[RAZER_LEN - 2] = x;
    return a.subarray(1);
  }

  // Envoie une commande et attend la réponse portant le même n° de transaction
  _xfer(cmd, data, expect, toDongle = false) {
    const run = async () => {
      let lastErr;
      for (let attempt = 0; attempt < 3; attempt++) {
        const pkt = this._packet(cmd, data, toDongle);
        const tx = pkt[1];
        const reply = new Promise((resolve, reject) => {
          const t = setTimeout(() => { this.pending = null; reject(new Error('pas de réponse')); }, 600);
          this.pending = r => {
            if (r[1] !== tx || r[9] !== expect[0] || r[10] !== expect[1]) return;
            clearTimeout(t);
            this.pending = null;
            resolve(r);
          };
        });
        await this.dev.sendReport(RAZER_REPORT, pkt);
        try {
          const r = await reply;
          if (r[0] === 2) return Array.from(r.subarray(9 + expect.length, 9 + expect.length + expect[2]));
          lastErr = new Error('statut ' + r[0]);
          if (r[0] !== 1 && r[0] !== 3) break; // 1 = occupé, 3 = à renvoyer
        } catch (e) { lastErr = e; }
        await new Promise(res => setTimeout(res, 60));
      }
      throw lastErr;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  get(cls, n, toDongle = false) { return this._xfer([cls, 0, 0], null, [cls, 1, n], toDongle); }
  set(cls, bytes) { return this._xfer([cls | 0x80, 0, bytes.length], bytes, [cls | 0x80, 1, 1]); }

  // ---- Réglages matériels (stockés dans le casque) ----
  // Changer de preset change aussi les bandes : on relit celles du nouveau preset
  async setEqPreset(v) {
    await this.set(RZ.eqPreset, [v]);
    this.state.eqPreset = v;
    this.state.eqBands = await this.readEqBands();
  }
  // Le casque renvoie les bandes avec sa marge interne de -5 dB (0 écrit → -5 relu, +12 → +6, -12 → -9) :
  // on rajoute 5 pour afficher l'échelle écrite (celle de Synapse), sinon une relecture réécrite décale tout
  async readEqBands() {
    return (await this.get(RZ.eqBands, 10)).map(v => Math.max(-12, Math.min(12, ((v << 24) >> 24) + RAZER_EQ_READ_OFFSET)));
  }
  // Égaliseur personnalisé : bandes int8 (même échelle que la lecture), active le preset 255
  async setEqBands(bands) {
    const b = bands.map(v => Math.max(-12, Math.min(12, Math.round(v))) & 0xff);
    if (this.state.eqPreset !== 255) await this.setEqPreset(255);
    await this.set(RZ.eqBands, b);
    this.state.eqBands = bands.map(v => Math.max(-12, Math.min(12, Math.round(v))));
  }
  async setSidetone(on) { await this.set(RZ.sidetone, [on ? 1 : 0]); this.state.sidetone = on ? 1 : 0; }
  async setSidetoneLevel(v) { v = Math.max(0, Math.min(15, v)); await this.set(RZ.sidetoneLevel, [v]); this.state.sidetoneLevel = v; }
  async setAutoOff(min) { await this.set(RZ.autoOff, [min]); this.state.autoOff = min; }
  async refreshBattery() {
    this.state.battery = (await this.get(RZ.battery, 1))[0];
    this.state.charging = (await this.get(RZ.charging, 1))[0];
  }

  // Lecture seule de tout ce que le casque expose ; une valeur illisible reste undefined
  async readAll() {
    const s = {};
    const tryGet = async (key, fn) => { try { s[key] = await fn(); } catch (e) { s[key + 'Err'] = e.message; } };
    await tryGet('link', async () => (await this.get(RZ.wireless, 1, true))[0]);
    await tryGet('dongleFw', async () => (await this.get(RZ.firmware, 24, true)).slice(0, 4).join('.'));
    await tryGet('fw', async () => (await this.get(RZ.firmware, 24)).slice(0, 4).join('.'));
    await tryGet('battery', async () => (await this.get(RZ.battery, 1))[0]);
    await tryGet('charging', async () => (await this.get(RZ.charging, 1))[0]);
    await tryGet('eqGroup', async () => (await this.get(RZ.eqGroup, 1))[0]);
    await tryGet('eqGroupOn', async () => (await this.get(RZ.eqGroupOn, 1))[0]);
    await tryGet('eqPreset', async () => (await this.get(RZ.eqPreset, 1))[0]);
    await tryGet('eqBands', async () => await this.readEqBands());
    await tryGet('sidetone', async () => (await this.get(RZ.sidetone, 1))[0]);
    await tryGet('sidetoneLevel', async () => (await this.get(RZ.sidetoneLevel, 1))[0]);
    await tryGet('autoOff', async () => (await this.get(RZ.autoOff, 1))[0]);
    await tryGet('micGain', async () => (await this.get(RZ.micGain, 1))[0]);
    await tryGet('micMute', async () => (await this.get(RZ.micMute, 1))[0]);
    await tryGet('dnd', async () => (await this.get(RZ.dnd, 1))[0]);
    this.state = s;
    return s;
  }
}

// ---- Effets THX (pilote audio Windows, via la DLL THX de Razer : appli uniquement) ----
// Ne fonctionne que si le casque est la sortie audio par défaut de Windows.

const THX_GENERAL = { 'Game Mode': 'Jeu', 'Game Hyperlocator Mode': 'Jeu – localisation', 'Game Grand': 'Jeu – grand espace',
  'Music Mode': 'Musique', 'Cinema Mode': 'Cinéma', 'Voice Mode': 'Voix', 'Flat / Live': 'Neutre', 'Custom': 'Personnalisé' };
const THX_MUSIC = { Acoustic: 'Acoustique', Classical: 'Classique', EDM: 'Électro', 'Hip Hop': 'Hip-hop', Jazz: 'Jazz',
  Pop: 'Pop', 'R&B': 'R&B', Rock: 'Rock' };
const THX_GAME_KIND = { imm: 'immersif', cmm: 'compétitif', esp: 'e-sport' };

// « ApexLegends_cmm » → « Apex Legends (compétitif) »
function thxPresetLabel(name) {
  if (THX_GENERAL[name] || THX_MUSIC[name]) return THX_GENERAL[name] || THX_MUSIC[name];
  const m = /^(.*)_(imm|cmm|esp)$/.exec(name);
  if (!m) return name;
  const game = m[1].replace(/_/g, ' ').replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return `${game} (${THX_GAME_KIND[m[2]]})`;
}

const Thx = {
  // État à plat : { ok, spatial, preset, presets[], eq[], micEqGains[], … } ou { ok: false, error }
  async read() {
    try {
      const s = await nativeInvoke('thx_state');
      return { ...s, ok: true, preset: s.preset?.name, presets: s.presets?.presets || [], eq: s.eq?.eq || [], micEqGains: s.micEqGains?.eq || [] };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  },
  async set(func, value) {
    if (!await nativeInvoke('thx_set', { func, value })) throw new Error('THX a refusé le réglage');
  },
};
