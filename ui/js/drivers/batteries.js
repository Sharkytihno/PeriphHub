// PeriphHub — batterie d'appareils sans fil que PeriphHub ne sait pas (encore) régler : casques JBL,
// Jabra, ROG, Razer BlackShark V3 / Barracuda X, Fractal Scape, MOONDROP, Logitech G435 (dongle 0ADF),
// SteelSeries Arctis Nova Pro (225D), souris Rapoo VT, ROG, MCHOSE, Sprime, RK, Redragon (Areson),
// HECATE, Arbiter, Darmoshark, Machenike, MSI, NZXT Lift, Niceboy, claviers SONiX, ROG, CHERRY, ATK,
// Semico, casques ASTRO A50 Gen 3 / A20, Alienware AW920H, Arctis Nova Elite, ROG Delta II / Cetra,
// JBL Quantum 350, manettes Steam, Flydigi, 8BitDo, BEITONG et Switch Pro, micro MAONO PD200W.
//
// LECTURE SEULE : seules des commandes de lecture (état, batterie) sont envoyées, jamais un réglage.
// Protocoles repris de WirelessBattery (github.com/krisgfx9/Wireless-Device-Battery-Monitor, v1.0.8+,
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
  0x4613: 'VT7', 0x1413: 'VT7', 0x4616: 'VT7 Max', 0x1416: 'VT7 Max', 0x4614: 'VT9', 0x1414: 'VT9 (Gen 2)',
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
  try { await io.setOutput([0xCC, 0x12, cmd]); } catch { await io.write([0xCC, 0x12, cmd]).catch(() => {}); }
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
// Récepteur 0552 (« Barracuda X 2.4 », FF00:0000) : pont Macronix, passé d'abord en mode application
// ([01 40] → [01 40 01 01]) ; trames [01 80 long charge…] sans CRC ni « O »/« F ». Ticket WirelessBattery #277.
function barracudaLink(io, macronix = false) {
  let seq = 0, stream = [];
  const command = async (group, body) => {
    seq = seq % 127 + 1;
    const payload = [0x50, 0x41, group, seq, ...body];
    if (macronix) {
      const m = new Uint8Array(64);
      m[0] = 0x01; m[1] = 0x80; m[2] = payload.length; m.set(payload, 3);
      await io.write(m);
      return true;
    }
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
      const r = await io.until(r => (macronix ? r[0] === 0x01 && r[1] === 0x80 : r[0] === 0x02), left);
      if (!r) return null;
      if (macronix) { if (r.length >= 3 && r[2] + 3 <= r.length) stream.push(...r.slice(3, 3 + r[2])); }
      else if (r[1] + 2 <= r.length) stream.push(...r.slice(2, 2 + r[1]));
    }
  };
  return {
    async app() {
      if (!macronix) return true;
      const r = await batAsk(io, [0x01, 0x40], r => r.length >= 4 && r[0] === 0x01 && r[1] === 0x40, 500);
      return !!r && r[2] === 0x01 && r[3] === 0x01;
    },
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

// ---------- BEITONG : chaque octet chiffré par quartets ----------
// enc(x) = S[x >> 4] << 4 | ((x & 0x0F) ^ 0x08). Vérifié par WirelessBattery sur plus de 32 000 octets.
const BEITONG_S = [0x0, 0xA, 0x6, 0xF, 0x1, 0xC, 0x2, 0x9, 0xE, 0x3, 0x7, 0xD, 0x4, 0xB, 0x5, 0x8];
const beitongEnc = x => (BEITONG_S[x >> 4] << 4) | ((x & 0x0F) ^ 0x08);
const beitongDec = x => (BEITONG_S.indexOf(x >> 4) << 4) | ((x & 0x0F) ^ 0x08);

// ---------- 8BitDo : [nom, feature 06 à lire avant d'écouter (Pro 2/3, SN30, SF30)] ----------
const EIGHTBITDO = {
  0x310B: ['8BitDo Ultimate 2 Wireless'], 0x6012: ['8BitDo Ultimate 2'], 0x6013: ['8BitDo Ultimate 2 Wireless'],
  0x202F: ['8BitDo Ultimate 3-mode'], 0x202E: ['8BitDo Ultimate 3-mode'],
  0x301B: ['8BitDo Ultimate 2C Wireless'], 0x301A: ['8BitDo Ultimate 2C Wireless'], 0x310A: ['8BitDo Ultimate 2C Wireless'],
  0x3012: ['8BitDo Ultimate 2.4G'], 0x3013: ['8BitDo Ultimate 2.4G'], 0x3109: ['8BitDo Ultimate 2.4G'],
  0x6007: ['8BitDo Ultimate Bluetooth'], 0x6009: ['8BitDo Pro 3', true], 0x6003: ['8BitDo Pro 2', true],
  0x6006: ['8BitDo Pro 2', true], 0x6001: ['8BitDo SN30 Pro', true], 0x6101: ['8BitDo SN30 Pro', true],
  0x6000: ['8BitDo SF30 Pro', true], 0x6100: ['8BitDo SF30 Pro', true],
};

// ---------- Souris MSI : [nom, page, usage] (interface 1) ----------
const MSI_MICE = {
  0x9E22: ['MSI VERSA 300 ELITE WIRELESS', 0xFF0D, 0x00B0],
  0x0D3C: ['MSI Clutch GM31 Lightweight Wireless', 0xFF00, 0x0001],
  0x0D3B: ['MSI Clutch GM31 Lightweight Wireless', 0xFF00, 0x0001],
  0x0D4C: ['MSI Clutch GM41 Lightweight Wireless', 0xFF10, 0x0006],
  0x0D4B: ['MSI Clutch GM41 Lightweight Wireless', 0xFF10, 0x0006],
};

// Numéro de séquence des requêtes ATK V75X (repris dans la réponse)
let atkSeq = 0;

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
    id: 'rog-pelta', vid: 0x0B05, kind: 'casque', pids: [0x1B84, 0x1AFA], name: pid => pid === 0x1AFA ? 'ROG Delta II' : 'ROG Pelta',
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
    id: 'rog-cetra-open', vid: 0x0B05, kind: 'casque', pids: [0x1CAC], name: () => 'ROG Cetra Open Wireless',
    pick: d => batIface(d) === 3 && batOn(d, 0xFF00, 0x0001),
    // Même canal que le Pelta, sous-commande 12 : [5] gauche % [6] droite % [7] boîtier % (0 = inconnu) ;
    // le niveau affiché est celui de l'écouteur le plus bas. Vérifié face à Armoury Crate (WirelessBattery).
    async read(io) {
      const a = await peltaAsk(io, 0x12);
      if (!a || a.asleep) return a;
      const lv = i => (a.r[i] > 0 && a.r[i] <= 100 ? a.r[i] : -1);
      const l = lv(5), r = lv(6);
      if (l < 0 && r < 0) return { asleep: true };
      return { level: l < 0 ? r : r < 0 ? l : Math.min(l, r), charging: false };
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
    id: 'jbl-350', vid: 0x0ECB, kind: 'casque', pids: [0x206B], name: () => 'JBL Quantum 350 Wireless',
    pick: d => batIface(d) === 3 && batOn(d, 0x0001, 0x0000),
    // Lecture seule (QuantumENGINE 2.9.4, « HIDV1 ») : feature 68 = liaison (1 relié), feature 49 = %.
    async read(io) {
      const one = async id => { const r = await io.getFeature(id, 2).catch(() => null); return r && r.length >= 2 && r[0] === id ? r[1] : null; };
      const linked = await one(0x68);
      if (linked == null) return null;
      if (linked !== 1) return { asleep: true };
      const pct = await one(0x49);
      return pct != null && pct <= 100 ? { level: pct, charging: false } : null;
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
    id: 'razer-v2pro-2020', vid: 0x1532, kind: 'casque', pids: [0x0528], name: () => 'Razer BlackShark V2 Pro (2020)',
    pick: d => batIface(d) === 3 && batOn(d, 0xFF00, 0x0001),
    // Feature FF : [FF 0A 00 FD 04 12 F1 02 05], puis relecture (~100 ms, comme Synapse) jusqu'à
    // [FF 0F 05 FE 12 04 1F 08 05 .. .. [11] 09 en charge [12..13] mV [14] %]. [FF 01 00 …] : casque éteint.
    // Sources : OpenRazer #1280, HaloBattery (MIT). Le récepteur affiche 80 % dès la mise en charge : % ignoré.
    async read(io) {
      const fresh = [0xFF, 0x0F, 0x05, 0xFE, 0x12, 0x04, 0x1F, 0x08, 0x05];
      const stale = [0xFF, 0x01, 0x00, 0xFE, 0x12, 0x04, 0x1F, 0x08, 0x05];
      const req = new Uint8Array(64);
      req.set([0xFF, 0x0A, 0x00, 0xFD, 0x04, 0x12, 0xF1, 0x02, 0x05]);
      await io.setFeature(req);
      for (let i = 0; i < 5; i++) {
        await batNap(100);
        const r = await io.getFeature(0xFF, 64).catch(() => null);
        if (!r || r.length < 15) continue;
        if (fresh.every((v, k) => r[k] === v)) {
          if (!((r[12] << 8) | r[13])) return { asleep: true };
          const charging = r[11] === 0x09;
          return charging || r[14] > 100 ? { level: null, charging: true } : { level: r[14], charging: false };
        }
        if (i === 4 && stale.every((v, k) => r[k] === v)) return { asleep: true };
      }
      return null;
    },
  },
  {
    id: 'razer-barracuda', vid: 0x1532, kind: 'casque', pids: [0x0550, 0x0552], name: () => 'Razer Barracuda X (2022)',
    pick: (d, pid) => batOn(d, 0xFF00, pid === 0x0552 ? 0x0000 : 0x0001),
    async read(io, { pid }) {
      const link = barracudaLink(io, pid === 0x0552);
      if (!await link.app()) return null;
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
    id: 'mchose', vid: 0x5253, kind: 'souris', pids: '*', name: (pid, d) => d.productName || 'Souris MCHOSE', fields: [0x5253],
    pick: d => batOn(d, 0xFF01, 0x0001),
    // Feature 12 de 65 octets, CHAQUE octet inversé (^ FF) : [06 00…] ; réponse [12][F9][données
    // inversées] : vid, modèle, firmware, [8] drapeaux, [9] %, [10] en charge. Données toutes à 0 :
    // souris en veille. Source : alexfrih/mchose-linux (d'après le logiciel M HUB).
    async read(io, ctx) {
      const fields = this?.fields || ctx?.fields || [0x5253];
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
        if (!fields.includes(p[0] | (p[1] << 8)) || p[9] > 100) continue;
        return { level: p[9], charging: !!p[10] };
      }
      return best;
    },
  },
  {
    id: 'mchose-3837', vid: 0x3837, kind: 'souris', pids: [0x100C, 0x100B, 0x100A, 0x1001, 0x1012],
    name: (pid, d) => d.productName || 'Souris MCHOSE', fields: [0x41E4, 0x3837],
    pick: d => batOn(d, 0xFF01, 0x0001),
    // Même protocole sur les dongles Realtek 3837 (A5 V2 Ultra 100C vérifié, K7 Ultra 1001) ; le champ
    // vid de la réponse vaut 41E4 ou 3837. Liste fermée : claviers et G3 V2 du même vid parlent autre chose.
    read(io, ctx) { return BAT_FAMILIES.find(f => f.id === 'mchose').read.call(this, io, ctx); },
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
    id: 'hecate', vid: 0x35BB, kind: 'souris', pids: [0xD3FA, 0xD3FB, 0xD3FC, 0xD3FD], name: () => 'Souris HECATE',
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
    id: 'flydigi', vid: 0x37D7, kind: 'manette', pids: [0x2401, 0x2501], name: pid => pid === 0x2501 ? 'Flydigi Apex 5' : 'Flydigi Vader 5 Pro',
    pick: d => batOn(d, 0xFFA0, 0x0001),
    // Requêtes d'information seulement (pas de prise de contrôle) : 5A A5 07 (architecture), 5A A5 01 02
    // → [5] = 130 (Vader 5 Pro), [6] connexion, [11] : bits 4-7 état (1 en charge, 2 pleine), bits 0-3
    // niveau 0-5. Sources : SDL (SDL_hidapi_flydigi.c), traces du ticket HaloBattery #191.
    // Apex 5 (2501) : rapport de sortie 03 au lieu de 00, modèles 128/129/133/134/135.
    async read(io, { pid }) {
      const rid = pid === 0x2501 ? 0x03 : 0x00, ids = pid === 0x2501 ? [128, 129, 133, 134, 135] : [130];
      const fix = r => (r.length >= 4 && r[0] === 0x04 && r[1] === 0x5A && r[2] === 0xA5 ? r.slice(1) : r);
      const ask = (req, cmd) => batAsk(io, req, r => { const x = fix(r); return x.length >= 5 && x[0] === 0x5A && x[1] === 0xA5 && x[2] === cmd; }, 800).then(r => r && fix(r));
      const a = await ask([rid, 0x5A, 0xA5, 0x07, 0, 0], 0x07);
      const modern = !!a && a[3] === 1 && a[4] === 0;
      const r = await ask([rid, 0x5A, 0xA5, 0x01, 2, 0], 0x01);
      if (!r || r.length < 12 || !ids.includes(r[5])) return null;
      const level = r[11] & 0x0F, state = r[11] >> 4, conn = r[6];
      if (state > 2 || level > 5) return null;
      if (modern ? conn > 1 : conn !== 1 && conn !== 2) return { asleep: true };
      return { level: state === 2 ? 100 : level * 20, charging: state === 1 };
    },
  },
  // ----- Ajouts de WirelessBattery 1.0.7 / 1.0.8 (novembre 2026) -----
  {
    id: 'alienware', vid: 0x413C, kind: 'casque', pids: [0xA515], name: () => 'Alienware AW920H',
    pick: d => batIface(d) === 5 && batOn(d, 0xFF13, 0x0001),
    // Sortie 06 [C0 0A] par le canal de contrôle, réponse lue en rapport d'entrée 07 :
    // [07 C0 0A 09 00 relié % en charge critique .. .. %critique mode XOR(3..12)]. [6] = 0 : refusée.
    // Source : Alienware Command Center (journal AlienFX, extension AW920H).
    async read(io) {
      const ok = r => {
        if (!r || r.length < 14 || r[0] !== 0x07 || r[1] !== 0xC0 || r[2] !== 0x0A || r[3] !== 0x09) return null;
        if (batXor(r, 3, 12) !== r[13] || r[6] === 0) return null;
        const pct = r[8] === 1 ? r[11] : r[6];
        return pct <= 100 ? { level: pct, charging: r[7] === 1 } : null;
      };
      const req = new Uint8Array(62);
      req.set([0x06, 0xC0, 0x0A]);
      // Environ une requête sur cent reste sans réponse : on la renvoie
      for (let i = 0; i < 3; i++) {
        io.flush();
        const pushed = io.until(r => !!ok(r), 180);
        await io.setOutput(req);
        for (let t = 0; t < 10; t++) {
          await batNap(15);
          const r = ok(await io.getInput(0x07, 61).catch(() => null));
          if (r) return r;
        }
        const p = ok(await pushed);
        if (p) return p;
      }
      return null;
    },
  },
  {
    id: 'arbiter', vid: 0x373E, kind: 'souris', pids: [0x0009, 0x000A, 0x0038, 0x0039, 0x0066, 0x0067],
    name: pid => 'Arbiter Studio Akitsu' + ({ 0x0038: ' 3950', 0x0039: ' 3950', 0x0066: ' Medium', 0x0067: ' Medium' }[pid] || ''),
    pick: d => batOn(d, 0xFFFF),
    order: d => (batOn(d, 0xFFFF, 0x0000) ? 0 : 1),
    // DriverCore (Arbiter Web HUB, « IsNewProtocol ») : feature 0 [00 00 02 02 00 83], puis lecture :
    // [état A1/A2 répondu, A0 en veille][..][..][02][..][83][en charge][%]. Un récepteur à 0 % : souris éteinte.
    async read(io, { pid }) {
      const cable = [0x0009, 0x0038, 0x0066].includes(pid);
      const req = new Uint8Array(65);
      req.set([0x00, 0x00, 0x00, 0x02, 0x02, 0x00, 0x83]);
      for (let i = 0; i < 2; i++) {
        await io.setFeature(req);
        for (let t = 0; t < 3; t++) {
          await batNap(t ? 60 : 100);
          const r = await io.getFeature(0x00, 64).catch(() => null);
          if (!r) return null;
          // Avec ou sans l'octet d'ID en tête
          const o = r.length >= 9 && r[4] === 0x02 && r[6] === 0x83 ? 1 : r.length >= 8 && r[3] === 0x02 && r[5] === 0x83 ? 0 : -1;
          if (o < 0) continue;
          const st = r[o], chg = r[o + 6], lv = r[o + 7];
          if (st === 0xA0) return { asleep: true };
          if ((st !== 0xA1 && st !== 0xA2) || lv > 100) continue;
          if (!cable && lv === 0) return { asleep: true };
          return { level: lv, charging: chg === 1 };
        }
      }
      return null;
    },
  },
  {
    id: 'barracuda-pro', vid: 0x1532, kind: 'casque', pids: [0x053A], name: () => 'Razer Barracuda Pro',
    pick: d => batOn(d, 0xFF00),
    // Protocole « PA » de Razer : mode distant activé le temps d'une lecture (comme Synapse, rien n'est
    // enregistré dans le casque), puis commandes 21 (%) et 2A (en charge) ; réponse [13] écho, [16] valeur.
    // Source : HaloBattery (MIT), d'après une capture de Synapse.
    async read(io) {
      const frame = head => { const b = new Uint8Array(64); b.set(head); return b; };
      const remote = on => io.write(frame([0x01, 0x80, 0x07, 0x50, 0x41, 0x0E, 0x08, 0x02, 0xE1, on ? 1 : 0]));
      const ask = async cmd => {
        for (let i = 0; i < 4; i++) {
          const r = await batAsk(io, frame([0x01, 0x80, 0x08, 0x50, 0x41, 0x08, 0x08, 0x03, cmd]),
            r => r.length >= 17 && r[13] === cmd && (r[14] === 1 || r[14] === 2) && r[15] > 0 && r[15] <= 32, 900);
          if (r) return r[16];
        }
        return -1;
      };
      await remote(true);
      let level = -1, charging = -1;
      try {
        await batNap(50);
        level = await ask(0x21);
        if (level >= 0) charging = await ask(0x2A);
      } finally {
        await batNap(40);
        await remote(false).catch(() => {});
      }
      if (level < 0 || level > 100) return { asleep: true };
      return { level, charging: charging > 0 };
    },
  },
  {
    id: 'beitong', vid: 0x20BC, kind: 'manette', pids: [0x5128, 0x515C],
    name: pid => pid === 0x515C ? 'BEITONG KP40D' : 'BEITONG KP20',
    pick: d => batOn(d, 0x00FF, 0x0003),
    // Requête « infos de base » de BEITONG iControl, chiffrée octet par octet (quartets) : [02 15] →
    // [02 15 % 00 état]. Source : WirelessBattery (rétro-ingénierie de iControl 1.0.5 et captures USB).
    async read(io, { pid }) {
      const r = await batAsk(io, [0x02, beitongEnc(0x15)], r => r.length >= 5 && r[0] === 0x02 && beitongDec(r[1]) === 0x15, 800);
      if (!r) return null;
      const level = beitongDec(r[2]);
      if (level > 100) return null;
      let st = beitongDec(r[4]);
      if (pid === 0x515C) st &= 0x0F;
      return { level, charging: st === 1 };
    },
  },
  {
    id: 'cherry', vid: 0x046A, kind: 'clavier', pids: [0x00E3, 0x00EA], name: () => 'CHERRY MX 3.0S Wireless',
    pick: d => batOn(d, 0xFF1C, 0x0092),
    // Rapport 04 : [04][somme LE de 3..63][1A][03 00 00 55] → [04 .. .. 1A .. .. .. .. % alimenté].
    // Source : B1Chat/BatteryWatch (MIT), vérifié sur le récepteur CHERRY PIXIU 75.
    async read(io) {
      const q = new Uint8Array(64);
      q.set([0x04, 0, 0, 0x1A, 0x03, 0x00, 0x00, 0x55]);
      let s = 0;
      for (let i = 3; i < 64; i++) s += q[i];
      q[1] = s & 0xFF; q[2] = (s >> 8) & 0xFF;
      for (let i = 0; i < 2; i++) {
        const r = await batAsk(io, q, r => r.length >= 10 && r[0] === 0x04 && r[3] === 0x1A, 400);
        if (!r) continue;
        return r[8] <= 100 ? { level: r[8], charging: r[9] !== 0 } : { asleep: true };
      }
      return null;
    },
  },
  {
    id: 'darmoshark', vid: 0x248A, kind: 'souris', pids: [0xFF30, 0xFF31],
    name: pid => pid === 0xFF31 ? 'Darmoshark M3S' : 'Darmoshark M3',
    pick: d => batIface(d) === 1 && batOn(d, 0x008C, 0x0001),
    // Feature 51 : [51 03] (souris appairée : vid, pid, [7] liée) puis [51 06] (identification : [11] %).
    // Un rapport d'entrée [54 E4 02] signale un refus. Source : Barba2k2/darmoshark-m3-configurator.
    async read(io, { pid }) {
      const mouse = pid === 0xFF31 ? 0xFF18 : 0xFF12;
      const id = (r, o) => r[o] | (r[o + 1] << 8);
      const q = async op => {
        io.flush();
        await io.setFeature([0x51, op]);
        for (let t = 0; t < 12; t++) {
          await batNap(20);
          if (io.last && Date.now() - io.last.at < 60 && io.last.r[0] === 0x54 && io.last.r[1] === 0xE4 && io.last.r[2] === 2) return null;
          const r = await io.getFeature(0x51, 1000).catch(() => null);
          if (r && r.length >= 12 && r[0] === 0x51 && r[1] === op) return r;
        }
        return null;
      };
      for (let i = 0; i < 2; i++) {
        const b = await q(0x03);
        if (!b || id(b, 3) !== 0x248A || id(b, 5) !== mouse) continue;
        if (!b[7]) return { asleep: true };
        const r = await q(0x06);
        if (r && r[2] === 1 && id(r, 4) === 0x248A && id(r, 6) === mouse && r[11] <= 100) return { level: r[11], charging: false };
      }
      return null;
    },
  },
  {
    id: '8bitdo', vid: 0x2DC8, kind: 'manette', pids: Object.keys(EIGHTBITDO).map(Number),
    name: (pid, d) => EIGHTBITDO[pid]?.[0] || '8BitDo ' + (d.productName || 'Wireless Controller'),
    pick: d => ((batOn(d, 0xFF7A, 0x0001) || batOn(d, 0xFFA0, 0x0001)) || batOn(d, 0x0001, 0x0005) || batOn(d, 0x0001, 0x0004)),
    order: d => (d.collections[0].usagePage >= 0xFF00 ? 0 : 1),
    // 1. Canal du configurateur (FF7A/FFA0) : [81 04 20 01] → [18] liée ; [81 04 21 01 00 00 06] → [18] %
    //    (bit 7 en charge) ; [81 04 00 01] → [22..23] modèle interne (6013/3109 : récepteur seul).
    //    Source : MiguelSanzBr/8bitdo-ultimate2-linux. Le récepteur 2,4 GHz se fait passer pour une manette
    //    Xbox filaire : Windows ne connaît pas sa batterie.
    // 2. Mode D-input / Bluetooth : rapport d'entrée 01 ou 04 de la manette, [14] % (bit 7 en charge),
    //    simplement écouté (rien n'est envoyé ; les Pro 2/3, SN30, SF30 demandent d'abord la feature 06).
    //    Source : SDL (SDL_hidapi_8bitdo.c).
    async read(io, { pid, dev }) {
      if (dev.collections[0].usagePage >= 0xFF00) {
        const ask = (cmd, sub, extra = []) => batAsk(io, [0x81, 0x04, cmd, sub, ...extra],
          r => r.length >= 19 && r[0] === 0x02 && r[1] === 0x04 && r[4] === cmd && r[5] === sub, 300);
        const l = await ask(0x20, 0x01);
        if (!l || l[18]) {
          const r = await ask(0x21, 0x01, [0x00, 0x00, 0x06]);
          const pct = r ? r[18] & 0x7F : 0;
          if (pct > 0 && pct <= 100) return { level: pct, charging: !!(r[18] & 0x80) && pct < 100 };
        }
        const info = await ask(0x00, 0x01);
        if (info && info.length >= 24) {
          const inner = info[22] | (info[23] << 8);
          return inner !== 0x6013 && inner !== 0x3109 ? { level: null, charging: true } : { asleep: true };
        }
        return pid === 0x6013 || pid === 0x3109 ? { asleep: true } : null;
      }
      if (EIGHTBITDO[pid]?.[1]) await io.getFeature(0x06, 63).catch(() => null);
      const min = pid === 0x6012 ? 34 : 15;
      const ok = r => r.length >= min && (r[0] === 0x01 || r[0] === 0x04) && (r[14] & 0x7F) <= 100;
      const last = io.last && Date.now() - io.last.at < 2000 && ok(io.last.r) ? io.last.r : null;
      const r = last || await io.until(ok, 600);
      if (!r) return null;
      const pct = r[14] & 0x7F;
      return { level: pct, charging: !!(r[14] & 0x80) && pct < 100 };
    },
  },
  {
    id: 'machenike', vid: 0x248A, kind: 'souris', pids: [0xFF4C, 0xFF4E], name: () => 'Machenike L7 Arctic / L7 Mix',
    pick: (d, pid) => batIface(d) === (pid === 0xFF4E ? 2 : 1) && batOn(d, 0x008C, 0x0001) && (d.productName || 'L7 Mix') === 'L7 Mix',
    // Feature 51 [51 06] → [51 06 .. .. 8A 24 4E FF .. .. [10] liaison (bits 0-2 : 0 câble, 1 récepteur ;
    // bit 3 souris reliée) [11] % [12] en charge]. Source : logiciel officiel L7 Mix 1.0.0.8.
    async read(io, { pid }) {
      const cable = pid === 0xFF4E;
      await io.setFeature([0x51, 0x06, ...new Array(19).fill(0)]);
      for (let t = 0; t < 20; t++) {
        await batNap(10);
        const r = await io.getFeature(0x51, 1000).catch(() => null);
        if (!r || r.length < 21 || r[0] !== 0x51 || r[1] !== 0x06 || r[4] !== 0x8A || r[5] !== 0x24 || r[6] !== 0x4E || r[7] !== 0xFF) continue;
        if ((r[10] & 7) !== (cable ? 0 : 1)) continue;
        if (!cable && !(r[10] & 8)) return { asleep: true };
        if (r[11] > 100 || r[12] > 1) continue;
        return { level: r[11], charging: r[12] === 1 };
      }
      return null;
    },
  },
  {
    id: 'maono', vid: 0x352F, kind: 'autre', pids: [0x040E], name: () => 'Micro MAONO PD200W',
    pick: d => batIface(d) === 3 && batOn(d, 0x000C, 0x0001),
    // Lecture du registre 0x0042 : [C4 09 00 00 04 42 00 somme LE] (somme = 0x10000 − total des octets) →
    // [C4 long 00 00 04 (registre, valeur)… somme]. Aucune écriture (commande 03) n'est envoyée. Testé
    // par un propriétaire du micro ; pas d'indication de charge. Source : WirelessBattery, maomao, maono.
    async read(io) {
      const ck = (b, n) => { let s = 0; for (let i = 0; i < n; i++) s += b[i]; return (0x10000 - (s & 0xFFFF)) & 0xFFFF; };
      const req = new Uint8Array(64);
      req.set([0xC4, 9, 0, 0, 0x04, 0x42, 0x00]);
      const c = ck(req, 7);
      req[7] = c & 0xFF; req[8] = c >> 8;
      const parse = r => {
        if (r.length < 11 || r[0] !== 0xC4) return null;
        const len = r[1];
        if (len < 11 || len > r.length || r[2] || r[3] || r[4] !== 0x04) return null;
        const end = len - 2;
        if ((end - 5) % 4 || (r[end] | (r[end + 1] << 8)) !== ck(r, end)) return null;
        for (let o = 5; o < end; o += 4) {
          if ((r[o] | (r[o + 1] << 8)) !== 0x0042) continue;
          const v = r[o + 2] | (r[o + 3] << 8);
          return v <= 100 ? v : null;
        }
        return null;
      };
      const r = await batAsk(io, req, r => parse(r) != null, 1000);
      return r ? { level: parse(r), charging: false } : null;
    },
  },
  {
    id: 'mchose-v9', vid: 0x3837, kind: 'casque', pids: [0x6011], name: (pid, d) => d.productName || 'MCHOSE V9 Pro 2',
    pick: d => batOn(d, 0xFF07, 0x0222),
    // Protocole « MC » du logiciel M HUB : [55][AA 01 00 01 00 01 0B 00] → réponse (ou notification 22)
    // [55 AA 01 drapeaux long 00 type sous-cmd corps… XOR] : corps[0] = 0 casque éteint, corps[1] %
    // (bit 7 en charge). Vérifié sur un V9 Pro 2.
    async read(io) {
      const parse = r => {
        if (r.length < 9 || r[0] !== 0x55) return null;
        const f = r.subarray(1);
        if (f[0] !== 0xAA || f[1] !== 0x01 || f[4] !== 0x00) return null;
        if (!(f[5] === 0x01 && f[6] === 0x0B) && !(f[5] === 0x04 && f[6] === 0x22)) return null;
        const len = f[3];
        if (len < 3 || 6 + len >= f.length) return null;
        let x = 0;
        if (f[2] === 1) { x = f[2] ^ f[3] ^ f[4] ^ f[5]; for (let i = 0; i < len; i++) x ^= f[6 + i]; }
        if (f[6 + len] !== x) return null;
        if (f[7] === 0) return { asleep: true };
        const pct = f[8] & 0x7F;
        return pct <= 100 ? { level: pct, charging: !!(f[8] & 0x80) } : null;
      };
      const r = await batAsk(io, [0x55, 0xAA, 0x01, 0x00, 0x01, 0x00, 0x01, 0x0B, 0x00], r => !!parse(r), 1000);
      return r ? parse(r) : null;
    },
  },
  {
    id: 'msi', vid: 0x0DB0, kind: 'souris', pids: Object.keys(MSI_MICE).map(Number), name: pid => MSI_MICE[pid][0],
    pick: (d, pid) => batIface(d) === 1 && batOn(d, MSI_MICE[pid][1], MSI_MICE[pid][2]),
    // MSI Center : [00 0F 20] → [0F 20 … [14] % (bit 7 en charge)]. La commande « 41 80 » (pilotage
    // par le logiciel) n'est volontairement PAS envoyée. La GM41 ne se demande pas : elle envoie
    // [A0 brut 07 …] quand elle bouge, niveau approximatif (≈ 0,51 % par pas).
    async read(io, { pid }) {
      const passive = pid === 0x0D4C || pid === 0x0D4B;
      if (passive) {
        const ok = r => r.length >= 7 && r[0] === 0xA0 && r[2] === 0x07;
        const last = io.last && Date.now() - io.last.at < 120000 && ok(io.last.r) ? io.last.r : null;
        const r = last || await io.until(ok, 2000);
        return r ? { level: batClamp((r[1] * 51 + 1760 + 50) / 100), charging: false } : null;
      }
      const r = await batAsk(io, [0x00, 0x0F, 0x20], r => r.length >= 15 && r[0] === 0x0F && r[1] === 0x20, 1000);
      if (!r) return null;
      const pct = r[14] & 0x7F, chg = !!(r[14] & 0x80);
      if (pct > 100) return null;
      return pct === 0 && !chg ? { asleep: true } : { level: pct, charging: chg };
    },
  },
  {
    id: 'niceboy', vid: 0x248A, kind: 'souris', pids: [0xFA02], name: () => 'Niceboy MW400',
    pick: d => batIface(d) === 0 && batOn(d, 0x0001, 0x0000),
    // Logiciel Niceboy MW400 : [05 24 FA 48] → [05 .. FA 48 lo hi en charge] ; (lo | hi << 8) × 990 / 240 = mV,
    // converti par la table du logiciel (paliers de 10 %). Tout à 0 : souris éteinte.
    async read(io) {
      const r = await batAsk(io, [0x05, 0x24, 0xFA, 0x48], r => r.length >= 7 && r[0] === 0x05 && r[2] === 0xFA && r[3] === 0x48, 500);
      if (!r) return null;
      if (!(r[4] | r[5] | r[6])) return { asleep: true };
      const mv = (r[4] | (r[5] << 8)) * 990 / 240;
      const steps = [[4200, 100], [4100, 90], [4000, 80], [3900, 70], [3800, 60], [3700, 50], [3500, 40], [3400, 30], [3200, 20]];
      return { level: (steps.find(([v]) => mv >= v) || [0, 10])[1], charging: r[6] !== 0 };
    },
  },
  {
    id: 'nzxt-lift', vid: 0x1E71, kind: 'souris', pids: [0x2101, 0x2129], name: () => 'NZXT Lift Elite',
    pick: d => batOn(d, 0xFFCA, 0x0001),
    // NZXT CAM 4.76.5 : [00][4E 02 81 00 B0] (lecture de la télémétrie de la souris) → [4E 02 97 … [17..18] %
    // [22] bit 0 câble] ; le dongle acquitte d'abord par [4E E5]. Il ne répond plus tant que NZXT CAM est ouvert.
    // Source : HaloBattery (MIT), d'après des captures USB.
    async read(io) {
      const req = new Uint8Array(65);
      req.set([0x00, 0x4E, 0x02, 0x81, 0x00, 0xB0]);
      const r = await batAsk(io, req, r => r.length >= 27 && r[0] === 0x4E && r[1] === 0x02 && r[2] === 0x97, 1500);
      if (!r) return null;
      const level = r[17] | (r[18] << 8);
      return level <= 100 ? { level, charging: !!(r[22] & 1) } : null;
    },
  },
  {
    id: 'semico', vid: 0x1A2C, kind: 'clavier', pids: [0x8FFF, 0xA034, 0xA036],
    name: (pid, d) => ({ 0xA034: 'Attack Shark X98', 0xA036: 'AJAZZ AK820 Max Plus' }[pid]
      || (['', '2.4 Wireless Device', 'USB Gaming Keyboard'].includes(d.productName || '') ? 'Clavier sans fil' : d.productName)),
    pick: d => batIface(d) === 0 && batOn(d, 0xFF02, 0x0002),
    // Protocole AA 55 CC 33 : [00 AA 55 CC 33 0E] (état, lecture seule) → [AA 55 CC 33 0E % état] ;
    // état 0 = clavier éteint. La charge ne se déduit pas de l'état (1 aussi sur batterie, testé sur X98).
    async read(io) {
      const r = await batAsk(io, [0x00, 0xAA, 0x55, 0xCC, 0x33, 0x0E], r => r.length >= 7 && r[0] === 0xAA && r[1] === 0x55 && r[2] === 0xCC && r[3] === 0x33 && r[4] === 0x0E, 600);
      if (!r) return null;
      if (r[6] === 0) return { asleep: true };
      return r[6] <= 3 && r[5] <= 100 ? { level: r[5], charging: false } : null;
    },
  },
  {
    id: 'arctis-nova-elite', vid: 0x1038, kind: 'casque', pids: [0x2244], name: () => 'SteelSeries Arctis Nova Elite',
    pick: d => batIface(d) === 3 && d.collections?.[0]?.usagePage >= 0xFF00,
    order: d => (batOn(d, 0xFFC0) ? 0 : 1),
    // Station : [01 B0] → réponse directe [01 B0 … [6] % … [14] alimentation (01 casque éteint, 02 câble)
    // [15] 02 en charge], ou trames poussées [07 B7 % .. 02] / [07 B5 .. .. alimentation], sur l'une ou
    // l'autre des deux collections de l'interface 3. Source : HaloBattery (MIT), Linux-Arctis-Manager.
    async read(io, ctx) {
      const other = await ctx.open(d => batIface(d) === 3 && d.collections?.[0]?.usagePage >= 0xFF00);
      const ios = [io, other].filter(Boolean);
      ios.forEach(x => x.flush());
      let level = -1, power = -1, charging = false;
      const look = r => {
        if (r[0] === 0x01 && r[1] === 0xB0 && r.length > 15) { if (r[6] <= 100) level = r[6]; charging = r[15] === 0x02; power = r[14]; }
        else if (r[0] === 0x07 && r[1] === 0xB7 && r[2] <= 100) { level = r[2]; charging = r[4] === 0x02; }
        else if (r[0] === 0x07 && r[1] === 0xB5 && r.length >= 5) power = r[4];
        return (level >= 0 && power >= 0) || power === 0x01;
      };
      const req = new Uint8Array(64);
      req.set([0x01, 0xB0]);
      let sent = false;
      for (const x of ios) { try { await x.write(req); sent = true; break; } catch {} }
      if (!sent) return null;
      // Les deux collections sont écoutées ; look() note au passage chaque trame utile
      for (const end = Date.now() + 1000; Date.now() < end && !((level >= 0 && power >= 0) || power === 0x01);) {
        await Promise.race(ios.map(x => x.until(look, 60)));
      }
      if (power === 0x01) return { asleep: true };
      return level >= 0 ? { level, charging: charging || power === 0x02 } : null;
    },
  },
  {
    id: 'switch-pro', vid: 0x057E, kind: 'manette', pids: [0x2009], name: (pid, d) => d.productName || 'Manette Switch Pro',
    pick: d => batOn(d, 0x0001, 0x0005) || batOn(d, 0x0001, 0x0004),
    // Rapport complet 30 (activé par Steam ou un autre logiciel ; PeriphHub ne fait qu'écouter) :
    // [2] bits 7-5 = niveau 0 à 4, bit 4 = en charge. Source : SDL (SDL_hidapi_switch.c).
    async read(io) {
      const ok = r => r.length >= 13 && r[0] === 0x30 && ((r[2] & 0xE0) >> 5) <= 4;
      const last = io.last && Date.now() - io.last.at < 2000 && ok(io.last.r) ? io.last.r : null;
      const r = last || await io.until(ok, 350);
      if (!r) return null;
      const l = (r[2] & 0xE0) >> 5;
      return { level: 25 * l, charging: !!(r[2] & 0x10) && l < 4 };
    },
  },
  {
    id: 'atk-v75x', vid: 0x320F, kind: 'clavier', pids: [0x5055, 0x5088],
    name: (pid, d) => /^wireless gaming keyboard\s*$/i.test(d.productName || '') ? 'Wireless Gaming Keyboard' : 'ATK V75X',
    pick: (d, pid) => batOn(d, 0xFF1C, 0x0092)
      && new RegExp(pid === 0x5055 ? '^ATK V75X\\s*$' : '^(ATK V75X 2\\.4G Dongle|Wireless Gaming Keyboard)\\s*$', 'i').test(d.productName || ''),
    // Sortie 04 [04 n° lo n° hi 1A] → [04 n° lo n° hi 1A .. 00 00 .. % état (0 batterie, 1/2 en charge)].
    // Par le récepteur, au plus toutes les 10 min : chaque question réveille le clavier (rétroéclairage).
    // Sources : HaloBattery (MIT), ATK HUB 3.2.29 ; confirmé aussi sur un Feker Alice80.
    every: 600000,
    async read(io) {
      atkSeq = atkSeq % 0xFFFF + 1;
      const lo = atkSeq & 0xFF, hi = atkSeq >> 8;
      const req = new Uint8Array(32);
      req.set([0x04, lo, hi, 0x1A]);
      const r = await batAsk(io, req, r => r.length >= 10 && r[0] === 0x04 && r[1] === lo && r[2] === hi && r[3] === 0x1A && !r[5] && !r[6], 1000);
      if (!r) return null;
      return r[8] <= 100 && r[9] <= 2 ? { level: r[8], charging: r[9] === 1 || r[9] === 2 } : null;
    },
  },
  {
    id: 'astro', vid: 0x9886, kind: 'casque', pids: [0x0015, 0x0014, 0x0018, 0x001D, 0x0026, 0x0037, 0x0038, 0x0039, 0x0043, 0x0044, 0x0045],
    name: pid => pid >= 0x0037 ? 'ASTRO A20 Wireless' : 'ASTRO A50 Gen 3',
    pick: d => (batOn(d, 0xFF32, 0x0074) || batOn(d, 0xFF31, 0x0074)),
    // [02 cmd] → [02 état long données…] (état 02 = OK, 01 = erreur). 54 : [3] bit 0 sur la base, bit 1
    // relié en 2,4 GHz ; 7C : [3] % (bit 7 en charge). L'A50 Gen 4 est lu par HeadsetControl.
    // Sources : tdryer/eh-fifty, nichtlegacy/AstroBar. Astro Command Center bloque l'accès tant qu'il est ouvert.
    async read(io) {
      const ask = async cmd => {
        const r = await batAsk(io, [0x02, cmd], r => r.length >= 4 && r[0] === 0x02 && (r[1] === 0x01 || r[1] === 0x02), 800);
        return r && r[1] === 0x02 ? r[3] : null;
      };
      const st = await ask(0x54);
      if (st == null) return null;
      const docked = !!(st & 1);
      if (!docked && !(st & 2)) return { asleep: true };
      const b = await ask(0x7C);
      if (b == null || (b & 0x7F) > 100) return { asleep: true };
      const pct = b & 0x7F;
      return { level: pct, charging: !!(b & 0x80) || (docked && pct < 100) };
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
  // Type de l'appareil entier selon l'analyse (devices.rs) : la collection qui porte la batterie peut être
  // le clavier des touches macro d'une souris
  const scan = (typeof report !== 'undefined' && report?.devices || [])
    .find(r => r.vid === hex4(f.vid) && r.pid === hex4(f.pid))?.kind;
  if (['souris', 'clavier', 'casque', 'manette'].includes(scan)) return scan;
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
