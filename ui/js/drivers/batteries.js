// PeriphHub — batterie d'appareils sans fil que PeriphHub ne sait pas (encore) régler : casques JBL,
// Jabra, ROG, Razer BlackShark V3 / Barracuda X, Fractal Scape, MOONDROP, Logitech G435 (dongle 0ADF),
// SteelSeries Arctis Nova Pro (225D), souris Rapoo VT, ROG, MCHOSE, Sprime, RK, Redragon (Areson),
// HECATE, claviers SONiX et ROG, manettes Steam et Flydigi.
//
// LECTURE SEULE : seules des commandes de lecture (état, batterie) sont envoyées, jamais un réglage.
// Protocoles repris de WirelessBattery (github.com/krisgfx9/Wireless-Device-Battery-Monitor, v1.0.6,
// GPL-3.0, comme PeriphHub), qui cite pour chacun ses sources (logiciels officiels, projets libres,
// captures faites sur le matériel).
//
// Indices des octets : comme sous Windows (et dans WirelessBattery), r[0] est l'ID du rapport s'il
// est numéroté ; pour un rapport non numéroté, r[0] est le premier octet de données.

const batNap = ms => new Promise(r => setTimeout(r, ms));
const batSum = (b, from, n) => { let s = 0; for (let i = from; i < from + n; i++) s += b[i]; return s & 0xFF; };
const batXor = (b, from, to) => { let x = 0; for (let i = from; i <= to; i++) x ^= b[i]; return x; };
const batClamp = v => Math.max(0, Math.min(100, Math.round(v)));
// CRC-16/XMODEM (Razer Barracuda X, Logitech G435)
function batCrc16(b) {
  let crc = 0;
  for (const x of b) {
    crc ^= x << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc;
}
const batBytes = d => d instanceof DataView ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : Uint8Array.from(d);
const batFrame = (id, d) => {
  const data = batBytes(d);
  if (!id) return Uint8Array.from(data);
  const b = new Uint8Array(data.length + 1);
  b[0] = id; b.set(data, 1);
  return b;
};

// Canal d'échange avec une interface : rapports reçus mis en file, échanges un par un
function batIo(dev) {
  let queue = [], waiters = [], chain = Promise.resolve();
  const on = e => {
    const r = batFrame(e.reportId, e.data);
    io.last = { r, at: Date.now() };
    const w = waiters.find(x => x.pred(r));
    if (w) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.t); w.resolve(r); return; }
    queue.push(r);
    if (queue.length > 32) queue.shift();
  };
  const io = {
    dev, last: null,
    async open() { await dev.open(); dev.addEventListener('inputreport', on); },
    async close() { dev.removeEventListener('inputreport', on); try { await dev.close(); } catch {} },
    flush() { queue = []; },
    // Prochain rapport qui vérifie `pred` (déjà reçu ou à venir), sinon null après `ms`
    until(pred, ms) {
      const i = queue.findIndex(pred);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise(resolve => {
        const w = { pred, resolve };
        w.t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); resolve(null); }, ms);
        waiters.push(w);
      });
    },
    // Rapports écrits comme sous Windows : [ID, données…] (ID 0 pour un rapport non numéroté)
    write: b => dev.sendReport(b[0], Uint8Array.from(b).slice(1)),
    setOutput: b => dev.sendOutputReport(b[0], Uint8Array.from(b).slice(1)),
    setFeature: b => dev.sendFeatureReport(b[0], Uint8Array.from(b).slice(1)),
    getFeature: async (id, len) => batFrame(id, await dev.receiveFeatureReport(id, len)),
    getInput: async (id, len) => batFrame(id, await dev.receiveInputReport(id, len)),
    // Un échange à la fois sur une interface (lecture périodique et relecture manuelle)
    run: f => (chain = chain.catch(() => {}).then(f)),
  };
  return io;
}
// Écrit `req` puis attend la réponse qui vérifie `pred`
async function batAsk(io, req, pred, ms = 600) {
  io.flush();
  const reply = io.until(pred, ms);
  await io.write(req);
  return reply;
}
const batOn = (dev, page, usage) => dev.collections?.[0]?.usagePage === page && (usage == null || dev.collections[0].usage === usage);
const batIface = dev => dev.info?.interface ?? -1;
const batPath = dev => String(dev.info?.path || '').toLowerCase();

// ---------- Rapoo VT (souris) : état envoyé seul toutes les ~3 s, rien à demander ----------
// Rapport 07 (Nordic 54L) : [1] mode (0 récepteur, 1 Bluetooth, 2 câble), [7] état (1 batterie,
// 2 en charge), [8] %. Ancien rapport des VT3 Pro / VT1 Pro Max : BB B0 … [5] état [6] %.
// Sources : Rapoo Hub (décodeur VT_nrf54L), PyFlat/Device-Battery-Info, captures du ticket #136.
const RAPOO = {
  0x4610: 'VT0', 0x1410: 'VT0', 0x4620: 'VT0 Max', 0x1420: 'VT0 Max', 0x4615: 'VT1', 0x1415: 'VT1',
  0x4644: 'VT1 Max', 0x1444: 'VT1 Max', 0x4622: 'VT2', 0x1422: 'VT2', 0x4623: 'VT2 Max', 0x1423: 'VT2 Max',
  0x4612: 'VT3', 0x1412: 'VT3', 0x4617: 'VT3 Max (Gen 2)', 0x1417: 'VT3 Max (Gen 2)', 0x4B06: 'VT3 Max V2',
  0x1B06: 'VT3 Max V2', 0x4611: 'VT3S', 0x1411: 'VT3S', 0x4621: 'VT3S Max', 0x1421: 'VT3S Max',
  0x4613: 'VT7', 0x1413: 'VT7', 0x4616: 'VT7 Max', 0x1416: 'VT7 Max', 0x4614: 'VT9', 0x1414: 'VT9',
  0x4618: 'VT9 Max', 0x1418: 'VT9 Max', 0x4415: 'VT3 Pro', 0x1215: 'VT3 Pro', 0x4433: 'VT1 Pro Max', 0x1233: 'VT1 Pro Max',
};
const RAPOO_LEGACY = new Set([0x1215, 0x4415, 0x1233, 0x4433]);
function rapooDecode(r, legacy) {
  let state, pct;
  if (!legacy && r[0] === 0x07 && r.length >= 9 && (r[1] & 0x0F) <= 2) { state = r[7]; pct = r[8]; }
  else if (legacy && r[0] === 0xBB && r.length >= 7 && r[1] === 0xB0) { state = r[5]; pct = r[6]; }
  else return null;
  if (state !== 1 && state !== 2) return null; // 0 : transition
  if (pct > 100 && !(legacy && state === 2 && pct === 0x7F)) return null;
  return { level: pct <= 100 ? pct : null, charging: state === 2, cable: !legacy && (r[1] & 0x0F) === 2 };
}

// ---------- ASUS ROG (claviers, souris, casque Pelta) ----------
// Requête [ID][12][sous-commande] : 01 clavier, 07 souris. Réponse : clavier [6] % (Falchion [11]),
// [9] = 1 en charge ; souris [5] niveau (×25 sur les anciennes jauges 0-4), [10] en charge.
// [1..2] = FF AA : l'appareil derrière le récepteur n'a pas répondu (en veille).
// Sources : SteveWang92/peripheral-battery-tray (MIT, d'après G-Helper), 1gcat/BatteryTool.
// Les modèles déjà pris en charge par OpenMouse (Omni Receiver, Harpe Ace…) restent à OpenMouse.
const ROG = [
  // [PID, nom, clavier ?, interface, octet, échelle]
  [0x1A83, 'ROG Azoth', 1, 1, 6, 1], [0x1B3F, 'ROG Azoth Extreme', 1, 1, 6, 1], [0x1CEF, 'ROG Azoth Extreme SE', 1, 1, 6, 1],
  [0x1C25, 'ROG Azoth X', 1, 1, 6, 1], [0x1C24, 'ROG Azoth X', 1, 1, 6, 1], [0x193E, 'ROG Falchion', 1, 1, 11, 1],
  [0x193C, 'ROG Falchion', 1, 1, 11, 1], [0x1B04, 'ROG Falchion RX', 1, -1, 11, 1], [0x1AAE, 'ROG Strix Scope II 96', 1, 1, 6, 1],
  [0x1B78, 'ROG Strix Scope II 96 RX', 1, 1, 6, 1], [0x1A07, 'ROG Strix Scope RX TKL', 1, -1, 6, 1],
  [0x18E5, 'ROG Chakram', 0, 0, 5, 25], [0x18E3, 'ROG Chakram', 0, 0, 5, 25], [0x1A1A, 'ROG Chakram X', 0, 0, 5, 1],
  [0x1A18, 'ROG Chakram X', 0, 0, 5, 1], [0x18A0, 'ROG Gladius II Wireless', 0, 2, 5, 25],
  [0x197F, 'ROG Gladius III Wireless', 0, 0, 5, 1], [0x197D, 'ROG Gladius III Wireless', 0, 0, 5, 1],
  [0x1A72, 'ROG Gladius III Aimpoint', 0, 0, 5, 1], [0x1A70, 'ROG Gladius III Aimpoint', 0, 0, 5, 1],
  [0x1B0C, 'ROG Gladius III Aimpoint EVA-02', 0, 0, 5, 1], [0x1B0A, 'ROG Gladius III Aimpoint EVA-02', 0, 0, 5, 1],
  [0x1B68, 'ROG Harpe Ace Extreme', 0, 0, 5, 1], [0x1B67, 'ROG Harpe Ace Extreme', 0, 0, 5, 1],
  [0x1B65, 'ROG Harpe Ace Mini', 0, 0, 5, 1], [0x1B63, 'ROG Harpe Ace Mini', 0, 0, 5, 1],
  [0x1AD0, 'ROG Harpe II Ace', 0, 0, 5, 1], [0x1C69, 'ROG Harpe II Ace', 0, 0, 5, 1],
  [0x1960, 'ROG Keris Wireless', 0, 0, 5, 25], [0x195E, 'ROG Keris Wireless', 0, 0, 5, 25],
  [0x1A59, 'ROG Keris Wireless EVA Edition', 0, 0, 5, 25], [0x1A57, 'ROG Keris Wireless EVA Edition', 0, 0, 5, 25],
  [0x1A68, 'ROG Keris Wireless Aimpoint', 0, 0, 5, 1], [0x1A66, 'ROG Keris Wireless Aimpoint', 0, 0, 5, 1],
  [0x1B16, 'ROG Keris II Ace', 0, 0, 5, 1], [0x1C0C, 'ROG Keris II Origin', 0, 0, 5, 1], [0x1D4C, 'ROG Keris II Origin KJP', 0, 0, 5, 1],
  [0x1908, 'ROG Pugio II', 0, 0, 5, 25], [0x1906, 'ROG Pugio II', 0, 0, 5, 25], [0x1979, 'ROG Spatha X', 0, 0, 5, 1],
  [0x1977, 'ROG Spatha X', 0, 0, 5, 1], [0x18B4, 'ROG Strix Carry', 0, 1, 7, 25],
  [0x1949, 'ROG Strix Impact II Wireless', 0, 0, 5, 25], [0x1947, 'ROG Strix Impact II Wireless', 0, 0, 5, 25],
];
const ROG_BY_PID = new Map(ROG.map(m => [m[0], m]));
async function rogRead(io, m) {
  const [, , kb, , at, scale] = m, sub = kb ? 0x01 : 0x07;
  // Collections non numérotées : r[0] est déjà le premier octet de données, on rétablit la case de l'ID
  const r0 = await batAsk(io, [0, 0x12, sub], r => (r.length >= 11 && r[0] === 0xFF && r[1] === 0xAA) || (r[0] === 0x12 && r[1] === sub), 500);
  if (!r0) return null;
  const r = [0, ...r0];
  if (r[1] === 0xFF && r[2] === 0xAA) return { asleep: true };
  if (kb) return r[at] <= 100 ? { level: r[at], charging: r[9] === 1 } : { asleep: true };
  const v = r[at] * scale;
  return v > 0 && v <= 100 ? { level: v, charging: r[10] !== 0 } : { asleep: true }; // 0 : inconnu, pas vide
}
// ROG Pelta (dongle 1B84) : rapport CC sur l'interface 3, envoyé par le canal de contrôle.
// CC 12 07 → [6] % (FE = pas encore connu) ; CC 12 08 → [5] = 1 en charge ; FF AA = en veille.
// Sources : jimm0thy/pelta-control (MIT), B1Chat/BatteryWatch (MIT).
async function peltaAsk(io, cmd) {
  io.flush();
  const reply = io.until(r => r[0] === 0xCC && ((r[1] === 0xFF && r[2] === 0xAA) || (r[1] === 0x12 && (r[2] === cmd || (r[5] === 0xFF && r[6] === 0xAA)))), 1200);
  await io.setOutput([0xCC, 0x12, cmd]);
  const r = await reply;
  if (!r) return null;
  if (r[1] === 0xFF || (r[5] === 0xFF && r[6] === 0xAA)) return { asleep: true };
  return { r };
}

// ---------- Casques Razer (BlackShark V3, V3 X, V2 Pro 2023, Barracuda X) ----------
// BlackShark V3 / V3 Pro (interface 5) : rapport 02 de 64 octets, [62] = XOR des octets 0..61 ;
// classe 21 → [13] %, [14] en charge. Interrogé au plus toutes les 5 minutes : plus souvent, le casque
// perd sa liaison 2,4 GHz. Sources : OpenRazer PR #2794, ReedME/omarchy-blackshark-v3.
function razerV3Packet(dir, cls) {
  const b = new Uint8Array(64);
  b[0] = 0x02; b[2] = 0x60; b[6] = 0x04; b[9] = dir; b[10] = cls;
  b[62] = batXor(b, 0, 61);
  return b;
}
// BlackShark V3 X (interface 0) : feature report 07, [2] numéro d'échange, [62] = XOR de 3..60 ;
// classe 07, commande 80 → [10] %, 84 → [10] en charge ; [1] = 02 réussi, 01 occupé. OpenRazer PR #2899.
let razerTx = 0x40;
async function razerV3xGet(io, cmd) {
  for (let i = 0; i < 4; i++) {
    const req = new Uint8Array(64);
    razerTx = (razerTx + 1) & 0xFF;
    req[0] = 0x07; req[2] = razerTx; req[6] = 0x02; req[7] = 0x07; req[8] = cmd;
    req[62] = batXor(req, 3, 60);
    await io.setFeature(req);
    await batNap(60);
    const r = await io.getFeature(0x07, 63).catch(() => null);
    if (!r || r.length < 63 || r[2] !== razerTx || r[7] !== 0x07 || r[8] !== cmd || r[6] < 2) continue;
    if (r[1] !== 0x02 && r[1] !== 0x01) return null;
    return r[10];
  }
  return null;
}
// BlackShark V2 Pro (2023), dongle 0555 : enveloppe « PA », mode distant activé autour de chaque
// requête ; type 03, commande 21 = %, 2A = en charge. OpenRazer PR #2862, HaloBattery.
const paFrame = (total, inner, type, cmd, flag) => {
  const b = new Uint8Array(64);
  b.set([0x02, 0x80, total, 0, 0, 0x50, 0x41, inner, 0, type, cmd, flag]);
  return b;
};
async function paQuery(io, cmd) {
  const remote = async on => { await io.write(paFrame(0x07, 0x0E, 0x02, 0xE1, on ? 1 : 0)); await batNap(35); };
  io.flush();
  await remote(true); // le premier envoi ne fait que réveiller la liaison
  let v = null;
  for (let i = 0; i < 3 && v == null; i++) {
    await remote(true);
    const r = await batAsk(io, paFrame(0x08, 0x08, 0x03, cmd, 0), r => r[0] === 0x02 && r[12] === cmd && r[13] === 0x01 && r[14] >= 1, 150);
    if (r) v = r[15];
  }
  await remote(false);
  return v;
}
// Barracuda X (2022), récepteur YS-Tech 0550 : trames Airoha « PA » dans des rapports 02 avec
// CRC-16 ; après chaque envoi, le pont répond « O » (pris) ou « F » (occupé) au rapport d'entrée 02
// lu à la demande. Mode distant (groupe 0E) activé le temps d'une requête ; groupe 08, commande
// 21 = %, 2A = câble. Sources : mehdibouchami/razer-barracuda-x-battery, nightdevx/barracuda-x-battery.
function barracudaLink(io) {
  let seq = 0, stream = [];
  const command = async (group, body) => {
    seq = seq % 127 + 1;
    const payload = [0x50, 0x41, group, seq, ...body];
    const f = new Uint8Array(64);
    f[0] = 0x02; f[1] = 0x80; f[2] = payload.length; f.set(payload, 5);
    const crc = batCrc16(f);
    f[3] = crc & 0xFF; f[4] = crc >> 8;
    for (let i = 0; i < 5; i++) {
      if (i) await batNap(50);
      await io.write(f);
      const st = await io.getInput(0x02, 63).catch(() => null);
      if (!st || st.length < 2) return false;
      if (st[1] === 0x4F) return true;  // « O »
      if (st[1] !== 0x46) return false; // ni « O » ni « F » : refusé
    }
    return false;
  };
  const await_ = async (match, ms) => {
    const end = Date.now() + ms;
    for (;;) {
      while (stream.length >= 2) {
        let i = 0;
        while (i + 1 < stream.length && !(stream[i] === 0x50 && stream[i + 1] === 0x49)) i++;
        stream = stream.slice(i);
        if (stream.length < 10) break;
        const len = 10 + (stream[8] | (stream[9] << 8));
        if (stream.length < len) break;
        const f = stream.slice(0, len);
        stream = stream.slice(len);
        if (match(f)) return f;
      }
      const left = end - Date.now();
      if (left <= 0) return null;
      const r = await io.until(r => r[0] === 0x02, left);
      if (!r) return null;
      if (r[1] + 2 <= r.length) stream.push(...r.slice(2, 2 + r[1]));
    }
  };
  return {
    async remote(on) {
      if (!await command(0x0E, [0x02, 0xE1, on ? 1 : 0])) return false;
      const s = seq;
      const f = await await_(r => r.length >= 13 && r[10] === 0x0E && r[11] === (0x80 | s), 800);
      return !!f && f[12] === 0;
    },
    async get(cmd) {
      if (!await command(0x08, [0x03, cmd, 0x00, 0x00])) return null;
      const f = await await_(r => r.length >= 13 && r[2] === 0x08 && r[10] === cmd && r[11] === 0x01, 1000);
      return f && f[12] >= 1 && f.length >= 14 ? f[13] : null;
    },
  };
}

// ---------- Logitech G435 sur le dongle 046D:0ADF (pas du HID++) ----------
// Trames de 64 octets [commande][longueur][CRC lo][CRC hi][corps] ; commandes « PA » vers la puce
// radio du casque ; batterie lue en millivolts (GET_BATTERY), convertie selon la courbe de la
// batterie. Session : 84 01, 85 01, init, mode distant (lecture / 01 / lecture), GET_BATTERY, 85 02.
// Sources : portyporty/g435-battery-percentage (MIT), deddroid/logitech-g435-battery.
function g435Frame(cmd, body) {
  const f = new Uint8Array(64);
  f[0] = cmd; f[1] = body.length; f.set(body.slice(0, 60), 4);
  const crc = batCrc16(f);
  f[2] = crc & 0xFF; f[3] = crc >> 8;
  return f;
}
function g435Mv(r) {
  for (let i = 0; i + 8 <= r.length; i++) {
    if (r[i] === 0x00 && r[i + 1] === 0x07 && r[i + 2] === 0x00 && r[i + 3] === 0x06 && r[i + 5] === 0x00) {
      const mv = r[i + 6] | (r[i + 7] << 8);
      if (mv >= 2500 && mv <= 4500) return mv;
    }
  }
  return -1;
}
function g435Percent(mv) {
  const v = [4200, 4150, 4100, 4050, 4000, 3950, 3900, 3850, 3800, 3750, 3700, 3650, 3600, 3550, 3500, 3400];
  const p = [100, 95, 90, 85, 80, 75, 70, 62, 55, 45, 35, 25, 15, 10, 5, 0];
  if (mv >= v[0]) return 100;
  for (let i = 1; i < 16; i++) if (mv >= v[i]) return p[i] + Math.floor(((p[i - 1] - p[i]) * (mv - v[i]) + (v[i - 1] - v[i]) / 2) / (v[i - 1] - v[i]));
  return 0;
}
async function g435Read(io) {
  const tx = async (cmd, body, ms, want) => {
    io.flush();
    const got = want ? io.until(r => g435Mv(r) >= 0, ms) : batNap(ms).then(() => null);
    await io.write([0, ...g435Frame(cmd, body)]);
    return got;
  };
  await tx(0x84, [0x01], 50);
  let mv = -1;
  try {
    await tx(0x85, [0x01], 50);
    await tx(0x80, [0x50, 0x41, 0x06, 0x01, 0x0D, 0x00, 0x25, 0x34, 0x12, 0x5A, 0x5A, 0x01, 0x00, 0x00, 0x00, 0xF0, 0x00, 0x00, 0x00], 450);
    let seq = 2;
    const pa = (cat, len, payload) => { const c = [0x50, 0x41, cat, seq, len, ...payload]; seq = seq % 127 + 1; return c; };
    await tx(0x80, pa(0x0E, 1, [0xE0]), 120);
    await tx(0x80, pa(0x0E, 2, [0xE1, 0x01]), 120);
    await tx(0x80, pa(0x0E, 1, [0xE0]), 120);
    const r = await tx(0x80, pa(0x06, 1, [0x00, 0x31]), 250, true);
    if (r) mv = g435Mv(r);
  } finally {
    await tx(0x85, [0x02], 50).catch(() => {});
  }
  return mv;
}

// ---------- Kysona (HECATE) : rapport 08 de 17 octets, somme de contrôle 0x55 − somme(0..15) ----------
// 03 = en ligne ([6] = 1), 04 = batterie ([6] %, [7] en charge). Source : pilote Linux hid-kysona.
const kysonaSum = b => (0x55 - batSum(b, 0, 16)) & 0xFF;
async function kysonaAsk(io, cmd) {
  const req = new Uint8Array(17);
  req[0] = 0x08; req[1] = cmd; req[16] = kysonaSum(req);
  return batAsk(io, req, r => r.length >= 17 && r[0] === 0x08 && r[1] === cmd && r[16] === kysonaSum(r), 500);
}

// ---------- Table des appareils ----------
// read(io, ctx) → { level, charging } | { asleep: true } (récepteur présent, appareil en veille ou
// éteint) | null (aucune réponse). ctx : { pid, dev, group, open(pred) → canal d'une autre interface }
const BAT_FAMILIES = [
  {
    id: 'rapoo', vid: 0x24AE, kind: 'souris', pids: Object.keys(RAPOO).map(Number),
    name: pid => 'Rapoo ' + RAPOO[pid],
    pick: d => batOn(d, 0xFF00, 0x0002),
    async read(io, { pid }) {
      const legacy = RAPOO_LEGACY.has(pid);
      // Rapport envoyé seul toutes les ~3 s : le dernier reçu suffit s'il est récent
      const last = io.last && Date.now() - io.last.at < 10000 ? rapooDecode(io.last.r, legacy) : null;
      const b = last || rapooDecode(await io.until(r => !!rapooDecode(r, legacy), 5000) || [], legacy);
      if (!b) return null;
      return b.level == null ? { asleep: true } : { level: b.level, charging: b.charging };
    },
  },
  {
    id: 'rog', vid: 0x0B05, kind: pid => ROG_BY_PID.get(pid)?.[2] ? 'clavier' : 'souris', pids: ROG.map(m => m[0]),
    name: pid => ROG_BY_PID.get(pid)[1],
    pick: (d, pid) => { const m = ROG_BY_PID.get(pid); return d.collections?.[0]?.usagePage >= 0xFF00 && (m[3] < 0 || batIface(d) === m[3]); },
    read: (io, { pid }) => rogRead(io, ROG_BY_PID.get(pid)),
  },
  {
    id: 'rog-pelta', vid: 0x0B05, kind: 'casque', pids: [0x1B84], name: () => 'ROG Pelta',
    pick: d => batIface(d) === 3 && batOn(d, 0xFF00, 0x0001),
    async read(io) {
      const a = await peltaAsk(io, 0x07);
      if (!a || a.asleep) return a;
      if (a.r[6] > 100) return { asleep: true }; // FE : niveau pas encore connu
      const c = await peltaAsk(io, 0x08);
      return { level: a.r[6], charging: c?.r?.[5] === 1 };
    },
  },
  {
    id: 'jbl', vid: 0x0ECB, kind: 'casque',
    pids: [0x2125, 0x2126, 0x213B, 0x213D, 0x2127, 0x2128, 0x213E, 0x2140, 0x218D, 0x218E, 0x21A7, 0x21A9, 0x219A, 0x219B],
    name: pid => 'JBL Quantum ' + ({ 0x2125: '650', 0x2126: '650', 0x213B: '650X', 0x213D: '650X', 0x2127: '950', 0x2128: '950', 0x213E: '950X',
      0x2140: '950X', 0x218D: '520', 0x218E: '520', 0x21A7: '520X', 0x21A9: '520X', 0x219A: '850', 0x219B: '850' })[pid] + ' Wireless',
    pick: d => batOn(d, 0xFF12),
    // Protocole « HIDV3 » (JBL QuantumENGINE) : feature 88 « infos de l'appareil », caractéristique
    // 000D = batterie (bit 7 en charge, bits 0-6 %) ; réponse en rapport d'entrée 86. Casque éteint :
    // le dongle ne répond pas du tout.
    async read(io) {
      io.flush();
      const reply = io.until(r => r.length >= 16 && r[0] === 0x86 && r[1] === 0x00 && r[2] === 0xDD && r[3] === 0x01 && r[4] === 0x00 && r[5] === 0x01
        && ((r[10] & 0x80) || (r[11] === 0x0D && r[12] === 0x00 && (r[13] || r[14]))), 800);
      await io.setFeature([0x88, 0x00, 0xDD, 0x01, 0x00, 0x01, 0x00, 0x02, 0x00, 0x0D, 0x00]);
      const r = await reply;
      if (!r || (r[10] & 0x80) || (r[15] & 0x7F) > 100) return null;
      return { level: r[15] & 0x7F, charging: !!(r[15] & 0x80) };
    },
  },
  {
    id: 'jabra', vid: 0x0B0E, kind: 'casque', pids: [0x24C7, 0x24C8, 0x24C9, 0x24CA, 0x24E9, 0x2E50, 0x2E51, 0x2E56, 0x2E57],
    name: () => 'Casque Jabra',
    pick: d => batOn(d, 0xFF00),
    // Protocole GNP des dongles Jabra Link 380 / 390 : rapport 05, adresse 04 = le casque ;
    // classe 12 / op 02 = batterie ([0] bit 0 en charge, [1] %), classe 02 / op 00 = nom ;
    // FE (NAK) : casque éteint ou hors de portée. Source : Watchdog0x/jabridge.
    async read(io, ctx) {
      const ask = async (cls, op, ms) => {
        ctx.seq = ((ctx.seq ?? 0x1F) + 1) & 0xFF;
        const s = ctx.seq;
        const r = await batAsk(io, [0x05, 0x04, 0x00, s, 0x46, cls, op],
          r => r.length >= 6 && r[0] === 0x05 && r[1] === 0x00 && r[2] === 0x04 && r[3] === s && (r[4] & 0xC0) === 0xC0, ms);
        if (!r) return null;
        if (r[5] === 0xFE) return 'nak';
        const len = r[4] & 0x3F;
        if (r.length < 7 || r[5] !== cls || r[6] !== op || len < 6 || len + 1 > r.length) return null;
        return r.slice(7, len + 1);
      };
      const p = await ask(0x12, 0x02, 700);
      if (p === 'nak') return { asleep: true };
      if (!p || p.length < 2) return null;
      if (!ctx.named) {
        ctx.named = true;
        const n = await ask(0x02, 0x00, 400);
        if (n && n !== 'nak' && n[0] && n[0] + 1 <= n.length) {
          try { ctx.name = new TextDecoder().decode(n.slice(1, 1 + n[0])).trim() || null; } catch {}
        }
      }
      return { level: p[1] <= 100 ? p[1] : null, charging: !!(p[0] & 1), name: ctx.name };
    },
  },
  {
    id: 'razer-v3', vid: 0x1532, kind: 'casque', pids: [0x0576, 0x0577, 0x0579, 0x057A], every: 300000,
    name: pid => pid <= 0x0577 ? 'Razer BlackShark V3 Pro' : 'Razer BlackShark V3',
    pick: d => batIface(d) === 5,
    async read(io) {
      // Poignée de main attendue avant les lectures
      for (const [dir, cls] of [[0x00, 0x02], [0x00, 0x2A], [0x80, 0x2A]]) await io.write(razerV3Packet(dir, cls)).catch(() => {});
      await batNap(250);
      const r = await batAsk(io, razerV3Packet(0x80, 0x21), r => r.length >= 15 && r[0] === 0x02 && r[2] === 0x60 && r[10] === 0x21, 600);
      if (!r || r[13] > 100) return null;
      return { level: r[13], charging: r[14] !== 0 };
    },
  },
  {
    id: 'razer-v3x', vid: 0x1532, kind: 'casque', pids: [0x057D, 0x057C], every: 300000,
    name: () => 'Razer BlackShark V3 X',
    pick: d => batIface(d) === 0 && d.collections?.[0]?.usagePage >= 0xFF00,
    async read(io) {
      const level = await razerV3xGet(io, 0x80);
      if (level == null || level > 100) return null;
      return { level, charging: await razerV3xGet(io, 0x84) === 1 };
    },
  },
  {
    id: 'razer-v2pro', vid: 0x1532, kind: 'casque', pids: [0x0555], name: () => 'Razer BlackShark V2 Pro (2023)',
    pick: d => batOn(d, 0xFF00),
    async read(io) {
      const level = await paQuery(io, 0x21);
      if (level == null || level > 100) return null;
      return { level, charging: (await paQuery(io, 0x2A) ?? 0) > 0 };
    },
  },
  {
    id: 'razer-barracuda', vid: 0x1532, kind: 'casque', pids: [0x0550], name: () => 'Razer Barracuda X (2022)',
    pick: d => batOn(d, 0xFF00, 0x0001),
    async read(io) {
      const link = barracudaLink(io);
      // Pas de réponse au mode distant : casque éteint, hors de portée ou en Bluetooth
      if (!await link.remote(true)) return { asleep: true };
      const level = await link.get(0x21);
      const cable = level != null ? await link.get(0x2A) : null;
      await link.remote(false).catch(() => {});
      if (level == null || level > 100) return null;
      return { level, charging: cable === 1 };
    },
  },
  {
    id: 'arctis-nova-pro', vid: 0x1038, kind: 'casque', pids: [0x225D], name: () => 'SteelSeries Arctis Nova Pro Wireless',
    pick: d => batIface(d) === 4,
    // 06 B0 → [6] niveau 0-8, [15] 01 = casque absent, 02 = en charge (comme l'ancien dongle 12E0)
    async read(io) {
      const r = await batAsk(io, [0x06, 0xB0], r => r.length >= 16 && r[0] === 0x06 && r[1] === 0xB0, 1000);
      if (!r) return null;
      if (r[15] === 0x01) return { asleep: true };
      return { level: batClamp(r[6] / 8 * 100), charging: r[15] === 0x02 };
    },
  },
  {
    id: 'g435', vid: 0x046D, kind: 'casque', pids: [0x0ADF], name: () => 'Logitech G435',
    pick: d => batOn(d, 0xFF00, 0x0001),
    async read(io) {
      const mv = await g435Read(io);
      return mv < 0 ? { asleep: true } : { level: g435Percent(mv), charging: false };
    },
  },
  {
    id: 'fractal', vid: 0x36BC, kind: 'casque', pids: [0x0001, 0x2001], name: () => 'Fractal Scape',
    pick: d => batOn(d, 0xFF00, 0x0001),
    // Rapport 02 [type][21] (GET_DEVICE_STATE) ; type 11 = dongle ([4] = 1 casque relié), F1 = casque
    // ([15] %, [23] = 1 sur câble). Source : configurateur officiel Adjust Pro.
    async read(io, { pid }) {
      const state = type => batAsk(io, [0x02, type, 0x21], r => r.length >= 24 && r[0] === 0x02 && r[1] === type && r[2] === 0x21, 1000);
      if (pid === 0x0001) {
        const d = await state(0x11);
        if (!d) return null;
        if (d[4] !== 1) return { asleep: true };
      }
      const r = await state(0xF1);
      if (!r || r[15] > 100) return null;
      return { level: r[15], charging: r[23] === 1 };
    },
  },
  {
    id: 'moondrop', vid: 0x35D8, kind: 'casque', pids: [0x0133], name: () => 'MOONDROP GM01 Pro',
    // Dongle : canal de contrôle WalkPlay sur l'interface 3 (plusieurs collections) ; sur câble, une
    // seule collection, sans niveau lisible
    pick: d => batIface(d) === 3 && batOn(d, 0x000C) && batPath(d).includes('&col'),
    // 4B 80 27 00 → [8] = 01 casque relié, [9] % ; 4B 80 31 00 → [4] = 00 : casque sur câble
    async read(io) {
      const ask = cmd => batAsk(io, [0x4B, 0x80, cmd, 0x00], r => r.length >= 5 && r[0] === 0x4B && r[1] === 0x80 && r[2] === cmd, 400);
      const r = await ask(0x27);
      if (r && r.length >= 10 && r[3] >= 6 && r[8] !== 0 && r[9] <= 100) return { level: r[9], charging: false };
      const l = await ask(0x31);
      return l ? { asleep: true } : null;
    },
  },
  {
    id: 'mchose', vid: 0x5253, kind: 'souris', pids: '*', name: (pid, d) => d.productName || 'Souris MCHOSE',
    pick: d => batOn(d, 0xFF01, 0x0001),
    // Feature 12 de 65 octets, CHAQUE octet inversé (^ FF) : [06 00…] ; réponse [12][F9][données
    // inversées] : vid, modèle, firmware, [8] drapeaux, [9] %, [10] en charge. Données toutes à 0 :
    // souris en veille. Source : alexfrih/mchose-linux (d'après le logiciel M HUB).
    async read(io) {
      const req = new Uint8Array(65).fill(0xFF);
      req[0] = 0x12; req[1] = 0x06 ^ 0xFF;
      let best = null;
      for (let i = 0; i < 5; i++) {
        if (i) await batNap(100);
        await io.setFeature(req);
        await batNap(120);
        const r = await io.getFeature(0x12, 64).catch(() => null);
        if (!r || r.length < 13 || r[0] !== 0x12 || r[1] !== (0x06 ^ 0xFF)) continue;
        const p = Array.from(r.slice(2, 13), x => x ^ 0xFF);
        if (p.every(x => !x)) { best = { asleep: true }; continue; }
        if ((p[0] | (p[1] << 8)) !== 0x5253 || p[9] > 100) continue;
        return { level: p[9], charging: !!p[10] };
      }
      return best;
    },
  },
  {
    id: 'mchose-g3', vid: 0x3837, kind: 'souris', pids: [0x4245, 0x418C], name: () => 'MCHOSE G3 V2',
    pick: d => batOn(d, 0xFF01, 0x0010),
    // Rapport non numéroté [55 30 A5 0B 2E 01 01 01] → [AA 30 … [8] % [9] en charge]. Jstdi001/MCHOSE-Monitor.
    async read(io) {
      const r = await batAsk(io, [0x00, 0x55, 0x30, 0xA5, 0x0B, 0x2E, 0x01, 0x01, 0x01, 0x00, 0x00], r => r.length >= 10 && r[0] === 0xAA && r[1] === 0x30, 1000);
      if (!r || r[8] < 1 || r[8] > 100) return null;
      return { level: r[8], charging: r[9] === 1 };
    },
  },
  {
    id: 'sprime', vid: 0x1915, kind: 'souris', pids: [0xAC11, 0xAC12, 0xAC13, 0xAC1C, 0xAD8C], name: () => 'Sprime PM1',
    pick: d => batOn(d, 0xFFA0, 0x0001),
    // Feature 05 [15 00 00 01] puis lecture : [9] %, [10] en charge, [11] pleine, [12] en ligne.
    // Source : pilote web officiel (sprime.pro), même protocole que la Ninjutso Sora V2.
    async read(io, { pid }) {
      const cable = pid <= 0xAC13;
      const req = new Uint8Array(32);
      req.set([0x05, 0x15, 0x00, 0x00, 0x01]);
      let seen = false;
      for (let i = 0; i < 4; i++) {
        if (i) await batNap(90);
        await io.setFeature(req);
        await batNap(15);
        const r = await io.getFeature(0x05, 31).catch(() => null);
        if (!r || r.length < 13 || r[0] !== 0x05 || r[1] !== 0x15 || r[9] > 100) continue;
        seen = true;
        if (!cable && !r[12]) continue; // récepteur présent, souris éteinte ou hors de portée
        const full = !!r[11];
        return { level: full ? 100 : r[9], charging: !!r[10] && !full };
      }
      return seen ? { asleep: true } : null;
    },
  },
  {
    id: 'rk', vid: 0x2E3C, kind: 'souris', pids: [0x00A5, 0x00A6, 0x00E5, 0x00E6], name: () => 'RK MG6 Pro',
    pick: (d, pid) => batOn(d, pid === 0x00A5 || pid === 0x00E5 ? 0xFFF2 : 0xFF00, 0x0001),
    // Protocole « QiWang » du pilote web RK : [01 01 02 01] (paramètre système, tension de batterie, lecture)
    // → [3] bit 4 = la souris a répondu, [4..5] mV, [6..7] %, [10] câble branché.
    async read(io, { pid }) {
      let seen = false;
      for (let i = 0; i < 3; i++) {
        if (i) await batNap(100);
        const r = await batAsk(io, [0x00, 0x01, 0x01, 0x02, 0x01], r => r.length >= 11 && (r[0] & 0x1F) === 0x01 && (r[1] & 0x0F) === 0x01 && r[2] === 0x02, 600);
        if (!r) continue;
        seen = true;
        const p = r[6] | (r[7] << 8);
        if (!((r[3] >> 4) & 1) || p > 100) continue;
        return { level: p, charging: !!r[10] || pid === 0x00A5 || pid === 0x00E5 };
      }
      return seen ? { asleep: true } : null;
    },
  },
  {
    id: 'areson', vid: 0x25A7, kind: 'souris', pids: [0xFA07, 0xFA08], name: () => 'Souris Redragon sans fil',
    pick: d => batIface(d) === 1 && batOn(d, 0xFF02, 0x0002),
    // GetPower : feature 08 [04 …][0x55 − somme] sur FF02:0002, réponse en rapport d'entrée sur FF01:0000
    // [09 04 00 … [6] niveau 0-10, [7] en charge], le tout sommant à 0x55. Sources : Qehbr/m913-ctl,
    // capture du logiciel Redragon (M915RGB-WL). Les récepteurs FA7B/FA7C comptent autrement : exclus.
    async read(io, ctx) {
      const rx = await ctx.open(d => batIface(d) === 1 && batOn(d, 0xFF01, 0x0000));
      if (!rx) return null;
      const req = new Uint8Array(17);
      req[0] = 0x08; req[1] = 0x04; req[16] = (0x55 - batSum(req, 0, 16)) & 0xFF;
      for (let i = 0; i < 2; i++) {
        if (i) await batNap(200);
        rx.flush();
        const reply = rx.until(r => r.length >= 17 && batSum(r, 0, r.length) === 0x55 && r[0] === 0x09 && r[1] === 0x04 && r[2] === 0x00 && r[6] <= 10, 1800);
        await io.setFeature(req);
        const r = await reply;
        if (r) return { level: batClamp(r[6] * 10), charging: r[7] !== 0 };
      }
      return null;
    },
  },
  {
    id: 'sonix', vid: [0x05AC, 0x0C45], kind: 'clavier', pids: { 0x05AC: [0x024F], 0x0C45: [0xFEFE] },
    name: (pid, d) => (d.productName || '').replace(/ 2\.4G$/, '') || 'Clavier sans fil',
    pick: d => batIface(d) === 3 && batOn(d, 0xFF60, 0x0061),
    // Dongles 2,4 GHz SONiX (AJAZZ AK820 MAX, AK980 V2, AULA F108 Pro) : [20 01 00 … somme] → [3] %.
    // 0 : clavier éteint ou dans un autre mode. Source : donglover69/sonix-keyboard-studio.
    async read(io) {
      const req = new Uint8Array(33);
      req[1] = 0x20; req[2] = 0x01; req[32] = batSum(req, 1, 31);
      for (let i = 0; i < 2; i++) {
        const r = await batAsk(io, req, r => r.length >= 32 && r[0] === 0x20 && r[1] === 0x01 && r[31] === batSum(r, 0, 31), 500);
        if (!r) continue;
        return r[3] >= 1 && r[3] <= 100 ? { level: r[3], charging: false } : { asleep: true };
      }
      return null;
    },
  },
  {
    id: 'hecate', vid: 0x35BB, kind: 'souris', pids: '*', name: () => 'Souris HECATE',
    pick: d => d.collections?.[0]?.usagePage >= 0xFF00,
    order: d => (batOn(d, 0xFF02, 0x0002) ? 0 : 1),
    async read(io) {
      const on = await kysonaAsk(io, 0x03);
      if (on && !on[6]) return { asleep: true };
      const r = await kysonaAsk(io, 0x04);
      if (!r) return on ? { asleep: true } : null;
      return { level: r[6] <= 100 ? r[6] : null, charging: r[7] !== 0 };
    },
  },
  {
    id: 'steam', vid: 0x28DE, kind: 'manette', pids: [0x1142, 0x1302, 0x1303, 0x1304, 0x1305], name: () => 'Manette Steam',
    pick: (d, pid) => batOn(d, 0xFF00) && (pid !== 0x1304 || d.collections[0].usage === 0x01),
    // Rapports d'état envoyés seuls. Ancien récepteur (1142) : 01 00 04 0B … [14] % ; nouveaux : 43 [1] = 2
    // en charge, [2] %. Source : pilote Linux hid-steam.
    async read(io, { pid }) {
      const legacy = pid === 0x1142;
      const ok = legacy ? r => r.length >= 15 && r[0] === 0x01 && r[1] === 0x00 && r[2] === 0x04 && r[3] === 11 && r[14] <= 100
        : r => r.length >= 3 && r[0] === 0x43 && r[2] <= 100;
      const r = io.last && Date.now() - io.last.at < 5000 && ok(io.last.r) ? io.last.r : await io.until(ok, 5000);
      if (!r) return null;
      return legacy ? { level: r[14], charging: false } : { level: r[2], charging: r[1] === 2 };
    },
  },
  {
    id: 'flydigi', vid: 0x37D7, kind: 'manette', pids: [0x2401], name: () => 'Flydigi Vader 5 Pro',
    pick: d => batOn(d, 0xFFA0, 0x0001),
    // Requêtes d'information seulement (pas de prise de contrôle) : 5A A5 07 (architecture), 5A A5 01 02
    // → [5] = 130 (Vader 5 Pro), [6] connexion, [11] : bits 4-7 état (1 en charge, 2 pleine), bits 0-3
    // niveau 0-5. Sources : SDL (SDL_hidapi_flydigi.c), traces du ticket HaloBattery #191.
    async read(io) {
      const fix = r => (r.length >= 4 && r[0] === 0x04 && r[1] === 0x5A && r[2] === 0xA5 ? r.slice(1) : r);
      const ask = (req, cmd) => batAsk(io, req, r => { const x = fix(r); return x.length >= 5 && x[0] === 0x5A && x[1] === 0xA5 && x[2] === cmd; }, 800).then(r => r && fix(r));
      const a = await ask([0, 0x5A, 0xA5, 0x07, 0, 0], 0x07);
      const modern = !!a && a[3] === 1 && a[4] === 0;
      const r = await ask([0, 0x5A, 0xA5, 0x01, 2, 0], 0x01);
      if (!r || r.length < 12 || r[5] !== 130) return null;
      const level = r[11] & 0x0F, state = r[11] >> 4, conn = r[6];
      if (state > 2 || level > 5) return null;
      if (modern ? conn > 1 : conn !== 1 && conn !== 2) return { asleep: true };
      return { level: state === 2 ? 100 : level * 20, charging: state === 1 };
    },
  },
];

const batFamily = (vid, pid) => BAT_FAMILIES.find(f => {
  if (Array.isArray(f.vid) ? !f.vid.includes(vid) : f.vid !== vid) return false;
  const pids = Array.isArray(f.pids) || f.pids === '*' ? f.pids : f.pids[vid];
  return pids === '*' || pids.includes(pid);
});

registerDriver({
  id: 'batteries',
  // Avant les pilotes « toute la marque » (Razer Chroma, Logitech HID++, OpenMouse, VIA) : seuls les
  // modèles de la table sont concernés
  priority: 30,
  match: d => { const f = batFamily(d.vendorId, d.productId); return !!f && f.pick(d, d.productId); },
  async connect(dev, group) {
    const pid = dev.productId, f = batFamily(dev.vendorId, pid);
    const cands = group.filter(d => f.pick(d, pid)).sort((a, b) => (f.order?.(a) ?? 0) - (f.order?.(b) ?? 0));
    let found = null;
    for (const d of cands) {
      const io = batIo(d);
      const extra = [];
      const ctx = {
        pid, dev: d, group,
        // Autre interface du même appareil (Areson : requête et réponse sur deux collections)
        async open(pred) {
          const o = group.find(x => x !== d && pred(x));
          if (!o) return null;
          const oi = batIo(o);
          await oi.open();
          extra.push(oi);
          return oi;
        },
      };
      try {
        await io.open();
        const r = await io.run(() => f.read(io, ctx));
        if (r) { found = { io, ctx, r, extra }; break; }
      } catch (e) {
        console.warn('[PeriphHub] batterie', f.id, e?.message || e);
      }
      await io.close();
      for (const x of extra) await x.close();
    }
    if (!found) throw new Error('aucune réponse');
    const { io, ctx, extra } = found;
    const kind = typeof f.kind === 'function' ? f.kind(pid) : f.kind;
    let lastAt = 0;
    const inst = {
      key: `drv-bat-${hex4(dev.vendorId)}${hex4(pid)}`.toLowerCase(),
      name: f.name(pid, dev), kind, dev: io.dev, devs: [io.dev, ...extra.map(x => x.dev)],
      caps: { battery: true }, state: {}, noOrigin: true, meta: '',
      source: 'Batterie seulement : PeriphHub lit son niveau sans rien régler sur l’appareil. Protocole repris du projet libre '
        + 'WirelessBattery (GPL-3.0), pas encore confirmé sur ce modèle.',
      note: null,
      apply(r) {
        if (r.name) inst.name = r.name;
        if (r.asleep) { inst.meta = 'En veille ou éteint (le récepteur est branché)'; return false; }
        if (r.level != null) inst.state.battery = { level: batClamp(r.level), charging: !!r.charging };
        inst.meta = 'Batterie seulement';
        lastAt = Date.now();
        return true;
      },
      async refreshBattery() {
        // Certains casques perdent leur liaison si on les interroge trop souvent (BlackShark V3)
        if (f.every && inst.state.battery && Date.now() - lastAt < f.every) return;
        const r = await io.run(() => f.read(io, ctx));
        if (!r) throw new Error('pas de réponse');
        if (!inst.apply(r)) throw new Error('en veille');
      },
      refresh() { return inst.refreshBattery().catch(() => {}); },
      async set() { throw new Error('lecture seule'); },
      rows: () => [],
      release() { for (const x of extra) x.close(); },
    };
    inst.apply(found.r);
    return [inst];
  },
});

// ---------- Batterie HID standard (toutes marques) ----------
// Appareils qu'aucun pilote PeriphHub ne prend mais qui déclarent un champ de batterie normalisé
// (src-tauri/src/generic_hid.rs : lecture seule, tablettes à stylet exclues). Relu toutes les 5 min.
const hidBatLive = new Map(); // « vid:pid » → page
let hidBatAt = 0, hidBatPolling = null;
const hidBatId = (v, p) => hex4(v).toLowerCase() + ':' + hex4(p).toLowerCase();
function hidBatKind(f) {
  if (f.usagePage === 1 && f.usage === 2) return 'souris';
  if (f.usagePage === 1 && f.usage === 6) return 'clavier';
  if (f.usagePage === 1 && (f.usage === 4 || f.usage === 5)) return 'manette';
  if (f.usagePage === 0x0C || f.usagePage === 0x0B) return 'casque';
  return typeof btKind === 'function' ? btKind(f.name || '') : 'autre';
}
function hidBatPoll(force = false) {
  if (!NATIVE || (!force && Date.now() - hidBatAt < 290000)) return hidBatPolling || Promise.resolve();
  hidBatAt = Date.now();
  hidBatPolling ||= (async () => {
    try {
      // Déjà pris : appareils ouverts par un pilote et pages des pilotes
      const skip = new Set();
      for (const d of nativeHid.byHandle.values()) skip.add(hidBatId(d.vendorId, d.productId));
      for (const i of drvLive.values()) {
        if (i.key.startsWith('drv-hidbat-')) continue;
        for (const d of [i.dev, ...(i.devs || [])]) if (d?.vendorId) skip.add(hidBatId(d.vendorId, d.productId));
      }
      const list = await nativeInvoke('hid_batteries', { skip: [...skip] });
      const keep = new Set();
      for (const f of list) {
        const id = hidBatId(f.vid, f.pid), name = (f.name || '').trim() || 'Appareil sans fil';
        // Même appareil déjà affiché avec sa batterie Bluetooth
        if ([...drvLive.values()].some(i => !i.key.startsWith('drv-hidbat-') && i.state?.battery && typeof btSame === 'function' && btSame(i.name, name))) continue;
        keep.add(id);
        let inst = hidBatLive.get(id);
        if (!inst) {
          inst = {
            key: 'drv-hidbat-' + id.replace(':', ''), name, kind: hidBatKind(f), chip: MEDIA_CHIP, noOrigin: true, diagId: null,
            dev: { vendorId: f.vid, productId: f.pid, productName: name },
            caps: {}, state: {}, meta: 'Batterie HID standard',
            source: 'Niveau de batterie que l’appareil déclare lui-même dans un champ HID normalisé (toutes marques), lu sans rien lui envoyer. ' +
              'Méthode reprise du projet libre WirelessBattery (GPL-3.0).',
            async set() {},
            refresh: () => hidBatPoll(true),
            reapply: () => Promise.resolve(),
            rows: () => [field('Batterie', h('strong', {}, inst.state.battery.level + ' %'), meter(inst.state.battery.level))],
          };
          inst.state.battery = { level: f.level };
          hidBatLive.set(id, inst);
          drvAdd(inst, { id: 'windows' });
        } else if (inst.state.battery?.level !== f.level) {
          inst.state.battery = { level: f.level };
          drvRender(inst);
        }
      }
      for (const [id, inst] of hidBatLive) {
        if (keep.has(id)) continue;
        hidBatLive.delete(id);
        drvRelease(inst.dev, false);
      }
    } catch (e) {
      console.warn('[PeriphHub] batterie HID standard', e);
    } finally {
      hidBatPolling = null;
    }
  })();
  return hidBatPolling;
}
