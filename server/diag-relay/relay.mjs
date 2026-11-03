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
}, 600_000).unref();

// Dernière barrière avant GitHub : retire ce qui ressemblerait à une donnée personnelle
export function scrub(text) {
  return text
    .replace(/\\\\\?\\[^\s'"`]+/gi, '<chemin>')
    .replace(/[A-Z]:\\Users\\[^\\\s'"`]+/gi, 'C:\\Users\\<utilisateur>')
    .replace(/[\w.+-]{1,64}@[\w-]{1,63}\.[\w.-]{1,190}/g, '<adresse>')
    .replace(/@(\w)/g, '@\u200b$1'); // pas de mention GitHub involontaire
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
  if (req.method !== 'POST' || !/\/diag\/?$/.test(req.url.split('?')[0])) return send(res, 404, { error: 'introuvable' });
  let size = 0;
  const chunks = [];
  req.on('data', c => {
    size += c.length;
    if (size > MAX_BYTES * 2) { send(res, 413, { error: 'trop gros' }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', async () => {
    if (res.writableEnded) return;
    const d = parse(Buffer.concat(chunks).toString('utf8'));
    if (!d) return send(res, 400, { error: 'diagnostic invalide' });
    const h = sha(d.text);
    if (seen.has(h)) return send(res, 200, { ok: true, duplicate: true });
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (limited(ip)) return send(res, 429, { error: 'trop d’envois, réessayez plus tard' });
    try {
      const n = await createIssue(d);
      seen.set(h, Date.now());
      console.log(new Date().toISOString(), 'ticket', n, d.version, d.auto ? 'auto' : 'manuel');
      send(res, 200, { ok: true, id: n });
    } catch (e) {
      console.error(new Date().toISOString(), 'échec GitHub', e.message);
      send(res, 502, { error: 'envoi impossible pour le moment' });
    }
  });
});

// Lancé directement (node relay.mjs) : démarre le serveur ; importé (tests) : ne fait rien
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!TOKEN) {
    console.error('GITHUB_TOKEN manquant');
    process.exit(1);
  }
  server.listen(PORT, '127.0.0.1', () => console.log(`relais diagnostics PeriphHub sur 127.0.0.1:${PORT} → ${REPO}`));
}
