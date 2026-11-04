// PeriphHub — watercoolings NZXT Kraken Z, 2023 et 2024 (Elite, Plus) : température du liquide,
// vitesse de la pompe et des ventilateurs, profils de vitesse et luminosité de l'écran. D'après le
// pilote libre liquidctl (liquidctl/driver/kraken3.py, GPL-3.0) : protocole réécrit ici, aucun code repris.
// L'éclairage reste à OpenRGB (onglet Éclairage), qui le pilote déjà.
//
// Rapports de 64 octets, le premier est le numéro du rapport :
//   0x10 0x01 → 0x11 0x01 : firmware (octets 17 à 19)
//   0x74 0x01 → 0x75 0x01 : état (liquide °C = [15] + [16]/10, pompe tr/min [17..18] et % [19],
//                            ventilateurs tr/min [23..24] et % [25])
//   0x30 0x01 → 0x31 0x01 : écran (luminosité [24], orientation [26])
//   0x30 0x02 0x01 luminosité 0 0 1 orientation : luminosité de l'écran
//   0x72 canal(3) + 40 pourcentages : courbe de vitesse selon la température du liquide, de 20 à 59 °C
// Le watercooling ne garde pas ces réglages hors tension : PeriphHub renvoie le profil choisi à chaque
// branchement. Aucune commande de firmware, l'image de l'écran n'est jamais touchée.

const NZXT_KRAKEN = {
  // pid : [nom, canal de la pompe, canal des ventilateurs]
  0x3008: ['NZXT Kraken Z (Z53, Z63, Z73)', [0x1, 0x0, 0x0], [0x2, 0x0, 0x0]],
  0x300E: ['NZXT Kraken 2023', [0x1, 0x1, 0x0], [0x2, 0x1, 0x1]],
  0x3012: ['NZXT Kraken 2024 Elite RGB', [0x1, 0x1, 0x0], [0x2, 0x1, 0x1]],
  0x3014: ['NZXT Kraken 2024 Plus', [0x1, 0x1, 0x0], [0x2, 0x1, 0x1]],
};

// Profils : [température du liquide °C, vitesse %]. Tous montent à 100 % à 45 °C de liquide (le
// liquide d'un PC dépasse rarement 40 °C). Pompe jamais sous 50 %, ventilateurs jamais sous 25 %.
const KRAKEN_PROFILES = {
  pump: {
    silent: [[20, 50], [35, 60], [40, 80], [45, 100]],
    balanced: [[20, 60], [35, 75], [40, 90], [45, 100]],
    max: [[20, 100]],
  },
  fan: {
    silent: [[20, 25], [30, 30], [35, 50], [40, 75], [45, 100]],
    balanced: [[20, 35], [30, 45], [35, 60], [40, 80], [45, 100]],
    max: [[20, 60], [30, 70], [35, 85], [40, 100]],
  },
};
const KRAKEN_MIN = { pump: 50, fan: 25 };
const KRAKEN_PROFILE_LABEL = { silent: 'Silencieux', balanced: 'Équilibré', max: 'Performance' };

// Courbe de 40 points (20 à 59 °C), interpolée entre les points du profil, comme liquidctl
function krakenCurve(points, min) {
  const out = [];
  for (let t = 20; t < 60; t++) {
    let d = points[points.length - 1][1];
    if (t <= points[0][0]) d = points[0][1];
    else for (let i = 1; i < points.length; i++) {
      const [t0, d0] = points[i - 1], [t1, d1] = points[i];
      if (t <= t1) { d = d0 + (d1 - d0) * (t - t0) / (t1 - t0); break; }
    }
    out.push(Math.max(min, Math.min(100, Math.round(d))));
  }
  return out;
}

class KrakenCooler {
  constructor(dev) {
    this.dev = dev;
    this.queue = Promise.resolve();
    this.waiting = null;
    this.onInput = e => {
      const d = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
      // Numéro du rapport séparé (rapports numérotés) ou en tête des données (descripteur sans numéro)
      const msg = e.reportId ? Uint8Array.from([e.reportId, ...d]) : d;
      if (this.waiting && msg[0] === this.waiting.id && msg[1] === this.waiting.sub) {
        const w = this.waiting; this.waiting = null;
        w.resolve(msg);
      }
    };
    dev.addEventListener('inputreport', this.onInput);
  }

  // Une commande à la fois : la réponse se reconnaît à ses deux premiers octets
  run(f) {
    const p = this.queue.then(f, f);
    this.queue = p.catch(() => {});
    return p;
  }

  send(bytes) {
    const data = new Uint8Array(63);
    data.set(bytes.slice(1, 64));
    return this.dev.sendReport(bytes[0], data);
  }

  ask(bytes, reply) {
    return this.run(async () => {
      const got = new Promise((resolve, reject) => {
        this.waiting = { id: reply[0], sub: reply[1], resolve };
        setTimeout(() => { if (this.waiting?.resolve === resolve) { this.waiting = null; reject(new Error('Kraken : pas de réponse')); } }, 800);
      });
      await this.send(bytes);
      return got;
    });
  }

  write(bytes) { return this.run(() => this.send(bytes)); }

  async status() {
    const m = await this.ask([0x74, 0x01], [0x75, 0x01]);
    return {
      liquid: m[15] === 0xFF && m[16] === 0xFF ? null : m[15] + m[16] / 10,
      pumpRpm: m[18] << 8 | m[17], pumpDuty: m[19],
      fanRpm: m[24] << 8 | m[23], fanDuty: m[25],
    };
  }
}

registerDriver({
  id: 'nzxt-kraken',
  priority: 5,
  match: d => d.vendorId === 0x1E71 && NZXT_KRAKEN[d.productId] != null && d.collections?.some(c => c.usagePage === 0xFF00),
  async connect(_dev, group) {
    for (const dev of group.filter(this.match)) {
      try { await dev.open(); } catch { continue; }
      const [name, pumpCh, fanCh] = NZXT_KRAKEN[dev.productId];
      const k = new KrakenCooler(dev);
      const state = { pump: null, fan: null, lcd: null, status: null };
      let fw = null;
      try {
        // Mise en route, comme liquidctl à chaque démarrage : état envoyé toutes les 0,5 s
        await k.write([0x70, 0x02, 0x01, 0xB8, 0x01]);
        await k.write([0x70, 0x01]);
        const f = await k.ask([0x10, 0x01], [0x11, 0x01]);
        fw = `${f[17]}.${f[18]}.${f[19]}`;
        state.status = await k.status();
      } catch {
        dev.removeEventListener('inputreport', k.onInput);
        await dev.close().catch(() => {});
        continue;
      }
      const readLcd = async () => {
        const m = await k.ask([0x30, 0x01], [0x31, 0x01]);
        state.lcd = { brightness: m[24], orientation: m[26] };
      };
      await readLcd().catch(() => {});
      const fmt = s => !s ? 'lecture…' : [
        s.liquid != null ? `Liquide ${s.liquid.toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C` : 'Liquide : capteur illisible',
        `pompe ${s.pumpRpm} tr/min (${s.pumpDuty} %)`,
        `ventilateurs ${s.fanRpm} tr/min (${s.fanDuty} %)`].join(' · ');
      const live = () => document.getElementById(inst.key + '-live');
      const timer = setInterval(async () => {
        const el = live();
        if (!el || el.closest('[hidden]')) return; // page fermée : rien n'est demandé
        try { state.status = await k.status(); el.textContent = fmt(state.status); } catch { el.textContent = 'Kraken : pas de réponse'; }
      }, 3000);
      const inst = {
        key: `drv-${devId(dev).replace(':', '').toLowerCase()}`,
        name, kind: 'refroidissement', navLabel: 'Watercooling', dev, state,
        caps: { pump: true, fan: true, ...(state.lcd ? { lcd: true } : {}) },
        meta: fw ? `firmware ${fw}` : '',
        noOrigin: true,
        source: 'Protocole du pilote libre liquidctl (GPL-3.0), pas encore confirmé sur ce modèle. Seuls les profils de vitesse et la luminosité de l’écran sont écrits.',
        async refresh() { state.status = await k.status(); if (state.lcd) await readLcd().catch(() => {}); },
        async set(cap, v) {
          if (cap === 'pump' || cap === 'fan') {
            const points = KRAKEN_PROFILES[cap][v];
            if (!points) throw new Error('profil inconnu');
            await k.write([0x72, ...(cap === 'pump' ? pumpCh : fanCh), ...krakenCurve(points, KRAKEN_MIN[cap])]);
            state[cap] = v;
          } else if (cap === 'lcd') {
            const b = Math.max(0, Math.min(100, Math.round(v.brightness)));
            await k.write([0x30, 0x02, 0x01, b, 0x0, 0x0, 0x1, state.lcd?.orientation ?? 0]);
            state.lcd = { ...state.lcd, brightness: b };
          }
        },
        rows() {
          const profile = cap => segmented(Object.keys(KRAKEN_PROFILES[cap]).map(p => ({ v: p, label: KRAKEN_PROFILE_LABEL[p] })),
            state[cap], p => drvSet(this, cap === 'pump' ? 'Pompe' : 'Ventilateurs', cap, p));
          return [
            field('En direct', h('div', { id: this.key + '-live' }, fmt(state.status)),
              h('div', { class: 'muted small' }, 'Relu toutes les 3 secondes tant que cette page est ouverte.')),
            field('Pompe', profile('pump'), h('div', { class: 'muted small' },
              state.pump ? 'Vitesse selon la température du liquide, 100 % dès 45 °C.' : 'Courbe actuelle du watercooling, gardée tant que vous ne choisissez rien.')),
            field('Ventilateurs du radiateur', profile('fan'), h('div', { class: 'muted small' },
              state.fan ? 'Vitesse selon la température du liquide, 100 % dès 45 °C.' : 'Courbe actuelle du watercooling, gardée tant que vous ne choisissez rien.')),
            state.lcd ? field('Écran : luminosité', slider(0, 100, 5, state.lcd.brightness, ' %', v => drvSet(this, 'Luminosité de l’écran', 'lcd', { brightness: v }))) : null,
            state.pump || state.fan ? field('Courbe d’origine', h('button', { class: 'ghost', onclick: () => {
              lsSet(wantKey(this), null);
              state.pump = state.fan = null;
              drvRender(this);
              toast('Profils oubliés : la courbe d’origine revient quand le PC est complètement éteint puis rallumé');
            } }, 'Ne plus renvoyer ces profils'), h('div', { class: 'muted small' },
              'Le watercooling n’a pas de commande pour reprendre sa courbe d’origine tout de suite : elle revient au prochain démarrage à froid.')) : null,
          ];
        },
        release() { clearInterval(timer); dev.removeEventListener('inputreport', k.onInput); },
        note: 'Le watercooling oublie ces réglages quand il n’est plus alimenté : PeriphHub renvoie votre choix à chaque démarrage. '
          + 'Pour retrouver sa courbe d’origine : « Ne plus renvoyer ces profils », puis éteignez complètement le PC. '
          + 'NZXT CAM ouvert en même temps réécrit ses propres réglages : fermez-le. L’éclairage se règle dans l’onglet Éclairage (OpenRGB).',
      };
      await drvReapply(inst);
      return [inst];
    }
    return [];
  },
});
