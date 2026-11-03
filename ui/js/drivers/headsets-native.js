// PeriphHub — casques pilotés directement par PeriphHub, sans le module HeadsetControl.
//
// Pourquoi : HeadsetControl interroge TOUS les appareils HID du PC pour trouver les casques. Un seul
// appareil figé (dongle, puce générique…) le bloque, et plus aucun casque n'a de réglages. Ici, chaque
// casque est ouvert seul, par la couche HID de PeriphHub (un appareil figé n'y bloque que lui-même).
// Protocoles repris de HeadsetControl (https://github.com/Sapd/HeadsetControl, GPL-3.0, comme
// PeriphHub). Un casque de cette liste n'est plus demandé à HeadsetControl tant qu'il est connecté ici.
//
// HyperX Cloud Alpha Wireless (03F0:098D, interface 3, page 0xFF43) : rapport 0x21 de 30 octets,
//   [0xBB, commande, valeur] ; réponse [0xBB, commande, valeur].
//   0x03 connexion (1 = casque absent)  0x0C en charge (1 = oui)  0x0B batterie (%)
//   0x10 retour micro marche/arrêt  0x11 niveau 0-128  0x12 extinction (min)  0x13 annonces vocales

const HS_NATIVE = {
  '03F0:098D': {
    name: 'HyperX Cloud Alpha Wireless',
    page: 0xFF43,
    report: 0x21,
    size: 30,
    caps: ['sidetone', 'inactive time', 'voice prompts'],
  },
};
var hsNativeIds = new Set(); // casques connectés ici : HeadsetControl les ignore (drivers/headsets.js)

registerDriver({
  id: 'headset-native',
  priority: 12,
  match: d => {
    const m = HS_NATIVE[devId(d)];
    return !!m && (d.collections || []).some(c => c.usagePage === m.page);
  },
  async connect(dev) {
    const id = devId(dev), m = HS_NATIVE[id];
    await dev.open();
    // Requêtes une par une ; la réponse est le premier rapport qui reprend la commande
    let chain = Promise.resolve();
    const send = (cmd, val = 0) => dev.sendReport(m.report, Uint8Array.from({ length: m.size }, (_, i) => [0xBB, cmd, val][i] ?? 0));
    const ask = (cmd, timeout = 2000) => (chain = chain.catch(() => {}).then(() => new Promise((resolve, reject) => {
      const done = (fn, x) => { clearTimeout(t); dev.removeEventListener('inputreport', on); fn(x); };
      const on = e => {
        if (e.reportId !== m.report) return;
        const b = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
        if (b[0] === 0xBB && b[1] === cmd) done(resolve, b[2]);
      };
      const t = setTimeout(() => done(reject, new Error('le casque ne répond pas')), timeout);
      dev.addEventListener('inputreport', on);
      send(cmd).catch(e => done(reject, e));
    })));

    // HeadsetControl l'affichait peut-être déjà : on reprend la main
    const prev = typeof hsLive !== 'undefined' && hsLive.get(id);
    if (prev) { hsLive.delete(id); drvRelease(prev.dev, true); }
    hsNativeIds.add(id);

    const inst = hsInstance({ id_vendor: id.slice(0, 4), id_product: id.slice(5), device: m.name, capabilities_str: m.caps, battery: true });
    let lastLevel = null, timer = null;
    Object.assign(inst, {
      dev,
      source: 'Protocole du projet libre HeadsetControl (GPL-3.0), intégré à PeriphHub, pas encore confirmé sur ce modèle. '
        + 'Ces casques ne permettent pas de relire leurs réglages : PeriphHub retient ceux que vous choisissez et les renvoie quand le casque se rallume.',
      async set(cap, v) {
        if (cap === 'sidetone') {
          const raw = Math.max(0, Math.min(128, Math.round(v * 1.28)));
          await send(0x10, raw ? 1 : 0);
          if (raw) await send(0x11, raw);
        } else if (cap === 'inactive_time') await send(0x12, Math.max(0, Math.min(255, v | 0)));
        else if (cap === 'voice_prompts') await send(0x13, v ? 1 : 0);
        else throw new Error('réglage inconnu');
        inst.state[cap] = v;
      },
      async refresh() {
        const wasOff = inst.off;
        try {
          inst.off = (await ask(0x03)) === 1;
          if (inst.off) delete inst.state.battery;
          else if ((await ask(0x0C)) === 1) inst.state.battery = lastLevel != null ? { level: lastLevel, charging: true } : { label: 'En charge', charging: true };
          else inst.state.battery = { level: lastLevel = await ask(0x0B), charging: false };
        } catch (e) {
          console.warn('[PeriphHub] casque', id, e.message);
        }
        inst.meta = inst.off ? 'Casque éteint ou hors de portée (le récepteur est branché)' : 'Pilote intégré';
        if (wasOff && !inst.off) await hsReapply(inst); // casque rallumé : réglages renvoyés
        drvRender(inst);
      },
      release() { clearInterval(timer); hsNativeIds.delete(id); },
    });
    inst.refreshBattery = inst.refresh;
    inst.off = false;
    await inst.refresh();
    await hsReapply(inst);
    timer = setInterval(() => { if (!document.hidden) inst.refresh(); }, 30000);
    return [inst];
  },
});
