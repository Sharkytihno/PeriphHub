// PeriphHub — relais des diagnostics (un seul fichier, aucune dépendance, Node 18+).
//
// L'appli envoie, seulement quand l'utilisateur l'a accepté, le texte de « Copier le diagnostic »
// (appareils USB, essais des pilotes ; ni numéro de série, ni chemin, ni nom d'utilisateur).
// Le relais en fait un ticket dans un dépôt GitHub PRIVÉ : personne n'a besoin d'un compte,
// et le jeton GitHub reste sur le serveur.
//
// Variables d'environnement :
//   GITHUB_TOKEN  jeton « fine-grained » limité au dépôt cible, droit Issues : lecture et écriture
//   GITHUB_REPO   dépôt cible (défaut : Sharkytihno/periphhub-diagnostics)
//   PORT          port local (défaut : 3011), derrière Caddy
//
// Aucune adresse IP n'est enregistrée : elles ne servent qu'à limiter le débit, en mémoire, hachées.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// .env à côté du fichier (GITHUB_TOKEN=…, PORT=…) : lu sans dépendance, l'environnement reste prioritaire
try {
  const env = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '.env'), 'utf8');
  for (const m of env.matchAll(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/gm)) process.env[m[1]] ??= m[2];
} catch {}
const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPO || 'Sharkytihno/periphhub-diagnostics';
const PORT = Number(process.env.PORT || 3011);
const MAX_BYTES = 40_000;          // un diagnostic fait quelques Ko
const PER_IP_HOUR = 6;             // envois par adresse et par heure
const GLOBAL_DAY = 200;            // garde-fou global par jour
const DEDUP_MS = 24 * 3600_000;    // même texte renvoyé dans les 24 h : ignoré

const ipHits = new Map();   // hash d'adresse → [horodatages]
const seen = new Map();     // hash du texte → horodatage
let day = { start: Date.now(), n: 0 };

const sha = s => crypto.createHash('sha256').update(s).digest('hex');

function limited(ip) {
  const now = Date.now();
  if (now - day.start > 24 * 3600_000) day = { start: now, n: 0 };
  if (day.n >= GLOBAL_DAY) return true;
  const k = sha('periphhub' + ip).slice(0, 16);
  const hits = (ipHits.get(k) || []).filter(t => now - t < 3600_000);
  if (hits.length >= PER_IP_HOUR) { ipHits.set(k, hits); return true; }
  hits.push(now);
  ipHits.set(k, hits);
  day.n++;
  return false;
}

// Nettoyage périodique des tables en mémoire
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of ipHits) if (!v.some(t => now - t < 3600_000)) ipHits.delete(k);
  for (const [k, t] of seen) if (now - t > DEDUP_MS) seen.delete(k);
  for (const [k, v] of confirmHits) if (!v.some(t => now - t < 3600_000)) confirmHits.delete(k);
  for (const [k, t] of confirmSeen) if (now - t > CONFIRM_DEDUP_MS) confirmSeen.delete(k);
}, 600_000).unref();

// Dernière barrière avant GitHub : retire ce qui ressemblerait à une donnée personnelle
export function scrub(text) {
  return text
    .replace(/\\\\\?\\[^\s'"`]+/gi, '<chemin>')
    // Nom de session avec des espaces (« Jean Dupont ») : tout le dossier quand un « \ » le suit,
    // sinon le premier mot seulement (fin de chemin : on ne sait pas où le nom s'arrête)
    .replace(/[A-Z]:\\Users\\(?:[^\\/:*?"<>|\r\n'`]+(?=\\)|[^\\\s'"`]+)/gi, 'C:\\Users\\<utilisateur>')
    .replace(/[\w.+-]{1,64}@[\w-]{1,63}\.[\w.-]{1,190}/g, '<adresse>')
    .replace(/@(\w)/g, '@\u200b$1'); // pas de mention GitHub involontaire
}

// Adresse du client pour la limite de débit : la DERNIÈRE de X-Forwarded-For, celle qu'ajoute le proxy
// (Caddy). Les précédentes viennent du client lui-même : s'y fier laisserait contourner la limite en
// envoyant une fausse adresse à chaque requête.
export function clientIp(req) {
  const hops = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return hops.pop() || req.socket?.remoteAddress || '';
}

export function parse(body) {
  let data;
  try { data = JSON.parse(body); } catch { return null; }
  if (!data || typeof data.text !== 'string' || typeof data.version !== 'string') return null;
  const version = data.version.slice(0, 20).replace(/[^\w.-]/g, '');
  const text = scrub(data.text.slice(0, MAX_BYTES));
  const summary = typeof data.summary === 'string' ? scrub(data.summary).replace(/[\r\n]+/g, ' ').slice(0, 120) : '';
  if (!text.trim()) return null;
  return { version, text, summary, auto: data.auto === true };
}

async function createIssue({ version, text, summary, auto }) {
  const title = `Diagnostic ${auto ? 'auto' : 'envoyé'} · PeriphHub ${version || '?'}${summary ? ' · ' + summary : ''}`;
  const body = (auto ? 'Envoi automatique (accepté par l’utilisateur).\n\n' : 'Envoyé depuis l’appli (« Envoyer le diagnostic »).\n\n')
    + (text.startsWith('```') ? text : '```\n' + text + '\n```');
  const r = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'periphhub-diag-relay',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, body, labels: ['diagnostic', auto ? 'auto' : 'manuel'] }),
  });
  if (!r.ok) throw new Error(`GitHub ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).number;
}

// ---------- Confirmations (POST /periphhub/confirm) ----------
// « Ce réglage a marché (ou échoué) sur ce modèle », envoyé par l'appli avec l'accord de l'utilisateur
// (ui/js/drivers/confirm.js). Un ticket par modèle (étiquette « confirmation »), un commentaire par envoi :
// scripts/confirmations.mjs en tire la liste des modèles confirmés livrée avec l'appli.
const CONFIRM_MAX = 8_000;
const CONFIRM_PER_IP_HOUR = 20;
const CONFIRM_DEDUP_MS = 30 * 24 * 3600_000; // même confirmation, même adresse : une fois par mois
const confirmHits = new Map();   // hash d'adresse → [horodatages]
const confirmSeen = new Map();   // hash (adresse + confirmation) → horodatage
const INDEX_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'confirm-index.json');
let confirmIndex = {};           // « VID:PID » → numéro du ticket
try { confirmIndex = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch {}

export function parseConfirm(body) {
  let data;
  try { data = JSON.parse(body); } catch { return null; }
  if (!data || typeof data.version !== 'string' || !Array.isArray(data.items)) return null;
  const version = data.version.slice(0, 20).replace(/[^\w.-]/g, '');
  const items = [];
  for (const it of data.items.slice(0, 20)) {
    if (!it || typeof it !== 'object') continue;
    const id = String(it.id || '').toUpperCase();
    const driver = String(it.driver || '');
    const cap = String(it.cap || '');
    if (!/^[0-9A-F]{4}:[0-9A-F]{4}$/.test(id) || !/^[\w.-]{1,30}$/.test(driver) || !/^[\w.-]{1,30}$/.test(cap)) continue;
    items.push({
      id, driver, cap, ok: it.ok === true,
      name: scrub(String(it.name || '')).replace(/[\r\n`|]+/g, ' ').slice(0, 60),
      note: scrub(String(it.note || '')).replace(/[\r\n`|]+/g, ' ').slice(0, 120),
    });
  }
  return items.length ? { version, items } : null;
}

function confirmLimited(ipKey) {
  const now = Date.now();
  if (now - day.start > 24 * 3600_000) day = { start: now, n: 0 };
  if (day.n >= GLOBAL_DAY * 5) return true;
  const hits = (confirmHits.get(ipKey) || []).filter(t => now - t < 3600_000);
  if (hits.length >= CONFIRM_PER_IP_HOUR) { confirmHits.set(ipKey, hits); return true; }
  hits.push(now);
  confirmHits.set(ipKey, hits);
  day.n++;
  return false;
}

async function gh(method, url, body) {
  const r = await fetch(`https://api.github.com${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'periphhub-diag-relay',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`GitHub ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// Ticket du modèle : index local, sinon recherche (index perdu), sinon création
const issueFor = new Map(); // « VID:PID » → promesse du numéro (deux envois simultanés : un seul ticket)
function confirmIssue(id, name) {
  if (confirmIndex[id]) return Promise.resolve(confirmIndex[id]);
  if (!issueFor.has(id)) issueFor.set(id, (async () => {
    const found = await gh('GET', `/search/issues?q=${encodeURIComponent(`repo:${REPO} is:issue label:confirmation in:title "${id}"`)}`);
    let n = found.items?.find(i => i.title.includes(id))?.number;
    if (!n) n = (await gh('POST', `/repos/${REPO}/issues`, {
      title: `Confirmations · ${id}${name ? ' · ' + name : ''}`,
      body: `Réglages essayés sur ce modèle par des utilisateurs (envoi accepté dans l’appli, un commentaire par envoi).

Lu par \`scripts/confirmations.mjs\`.`,
      labels: ['confirmation'],
    })).number;
    confirmIndex[id] = n;
    try { fs.writeFileSync(INDEX_FILE, JSON.stringify(confirmIndex)); } catch {}
    return n;
  })().finally(() => issueFor.delete(id)));
  return issueFor.get(id);
}

// Une ligne par réglage : « PeriphHub 1.6.1 · openmouse · dpi ✔ » (lue par scripts/confirmations.mjs)
export function confirmLines(version, items) {
  return items.map(i => `PeriphHub ${version || '?'} · ${i.driver} · ${i.cap} ${i.ok ? '✔' : '✘'}${i.note ? ' · ' + i.note : ''}`);
}

async function handleConfirm(req, res, raw) {
  const d = parseConfirm(raw);
  if (!d) return send(res, 400, { error: 'confirmation invalide' });
  const ipKey = sha('periphhub' + clientIp(req)).slice(0, 16);
  const fresh = d.items.filter(i => !confirmSeen.has(sha(ipKey + JSON.stringify([d.version, i.id, i.driver, i.cap, i.ok]))));
  if (!fresh.length) return send(res, 200, { ok: true, duplicate: true });
  if (confirmLimited(ipKey)) return send(res, 429, { error: 'trop d’envois, réessayez plus tard' });
  try {
    const byDev = new Map();
    for (const i of fresh) byDev.set(i.id, [...(byDev.get(i.id) || []), i]);
    for (const [id, list] of byDev) {
      const n = await confirmIssue(id, list[0].name);
      await gh('POST', `/repos/${REPO}/issues/${n}/comments`, { body: confirmLines(d.version, list).join('\n') });
      for (const i of list) confirmSeen.set(sha(ipKey + JSON.stringify([d.version, i.id, i.driver, i.cap, i.ok])), Date.now());
    }
    console.log(new Date().toISOString(), 'confirmations', [...byDev.keys()].join(','), d.version);
    send(res, 200, { ok: true });
  } catch (e) {
    console.error(new Date().toISOString(), 'échec GitHub (confirmation)', e.message);
    send(res, 502, { error: 'envoi impossible pour le moment' });
  }
}

const send = (res, code, obj) => {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
};

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method === 'GET' && req.url.endsWith('/health')) return send(res, 200, { ok: true });
  const route = req.url.split('?')[0];
  const isConfirm = /\/confirm\/?$/.test(route);
  if (req.method !== 'POST' || !(isConfirm || /\/diag\/?$/.test(route))) return send(res, 404, { error: 'introuvable' });
  let size = 0;
  const chunks = [];
  req.on('data', c => {
    size += c.length;
    if (size > MAX_BYTES * 2) { send(res, 413, { error: 'trop gros' }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', async () => {
    if (res.writableEnded) return;
    if (isConfirm) {
      const raw = Buffer.concat(chunks).toString('utf8');
      return raw.length > CONFIRM_MAX ? send(res, 413, { error: 'trop gros' }) : handleConfirm(req, res, raw);
    }
    const d = parse(Buffer.concat(chunks).toString('utf8'));
    if (!d) return send(res, 400, { error: 'diagnostic invalide' });
    const h = sha(d.text);
    if (seen.has(h)) return send(res, 200, { ok: true, duplicate: true });
    if (limited(clientIp(req))) return send(res, 429, { error: 'trop d’envois, réessayez plus tard' });
    // Noté avant l'envoi à GitHub : deux requêtes identiques arrivées en même temps ne font qu'un ticket
    seen.set(h, Date.now());
    try {
      const n = await createIssue(d);
      console.log(new Date().toISOString(), 'ticket', n, d.version, d.auto ? 'auto' : 'manuel');
      send(res, 200, { ok: true, id: n });
    } catch (e) {
      seen.delete(h); // pas de ticket : le même diagnostic pourra être renvoyé
      console.error(new Date().toISOString(), 'échec GitHub', e.message);
      send(res, 502, { error: 'envoi impossible pour le moment' });
    }
  });
});

// Lancé directement (node relay.mjs) ou par pm2 (qui passe par son propre lanceur : argv[1]
// n'est alors pas ce fichier, mais pm_id est défini) : démarre le serveur ; importé (tests) : ne fait rien
const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct || process.env.pm_id !== undefined) {
  if (!TOKEN) {
    console.error('GITHUB_TOKEN manquant');
    process.exit(1);
  }
  server.listen(PORT, '127.0.0.1', () => console.log(`relais diagnostics PeriphHub sur 127.0.0.1:${PORT} → ${REPO}`));
}
