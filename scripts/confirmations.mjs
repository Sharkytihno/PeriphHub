// Modèles confirmés par des utilisateurs → ui/data/confirmed.js (pastille « Confirmé » dans l'appli).
// Lit les tickets « confirmation » du dépôt privé des diagnostics (un par modèle, un commentaire par
// envoi, écrits par server/diag-relay), et affiche aussi les échecs à corriger.
//   node scripts/confirmations.mjs          (à lancer avant chaque version)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'Sharkytihno/periphhub-diagnostics';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Réglages qui ne suffisent pas à dire « ça marche » (la connexion seule ne prouve pas l'écriture)
const WEAK = new Set(['connexion']);

// « PeriphHub 1.6.1 · openmouse · dpi ✔ · note » → { version, driver, cap, ok, note }
export function parseLine(line) {
  const m = String(line).match(/^PeriphHub (\S+) · ([\w.-]+) · ([\w.-]+) ([✔✘])(?: · (.*))?$/);
  return m ? { version: m[1], driver: m[2], cap: m[3], ok: m[4] === '✔', note: m[5] || '' } : null;
}

// tickets [{ title, comments: [{ body }] }] → { confirmed: { id: { name, caps, n } }, fails: [...] }
export function aggregate(issues) {
  const confirmed = {};
  const fails = [];
  for (const is of issues) {
    const t = is.title.match(/^Confirmations · ([0-9A-F]{4}:[0-9A-F]{4})(?: · (.*))?$/);
    if (!t) continue;
    const [, id, name = ''] = t;
    const count = new Map(); // cap → { ok, ko }
    for (const c of is.comments || []) for (const l of String(c.body).split(/\r?\n/)) {
      const p = parseLine(l.trim());
      if (!p) continue;
      const k = count.get(p.cap) || { ok: 0, ko: 0 };
      p.ok ? k.ok++ : k.ko++;
      count.set(p.cap, k);
      if (!p.ok || p.note) fails.push(`${id} ${name} · ${p.version} · ${p.driver} · ${p.cap} ${p.ok ? '✔' : '✘'}${p.note ? ' · ' + p.note : ''}`);
    }
    const caps = [...count].filter(([cap, k]) => !WEAK.has(cap) && k.ok > 0 && k.ok >= k.ko).map(([cap]) => cap).sort();
    if (caps.length) confirmed[id] = { name, caps, n: caps.reduce((n, c) => n + count.get(c).ok, 0) };
  }
  return { confirmed, fails };
}

export function render(confirmed) {
  const sorted = Object.fromEntries(Object.keys(confirmed).sort().map(k => [k, confirmed[k]]));
  return '// Généré par scripts/confirmations.mjs : modèles confirmés sur le vrai matériel par des utilisateurs\n'
    + '// (« VID:PID » → { name, caps : réglages qui ont marché, n : nombre de confirmations }). Ne pas éditer.\n'
    + 'var CONFIRMED = ' + JSON.stringify(sorted, null, 1) + ';\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const gh = (...a) => JSON.parse(execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 64 << 20 }));
  const issues = gh('issue', 'list', '--repo', REPO, '--label', 'confirmation', '--state', 'all', '--limit', '1000', '--json', 'number,title')
    .map(i => ({ ...i, comments: gh('issue', 'view', String(i.number), '--repo', REPO, '--json', 'comments').comments }));
  const { confirmed, fails } = aggregate(issues);
  fs.writeFileSync(path.join(ROOT, 'ui', 'data', 'confirmed.js'), render(confirmed));
  console.log(`${issues.length} modèles signalés, ${Object.keys(confirmed).length} confirmés → ui/data/confirmed.js`);
  if (fails.length) console.log('\nÉchecs et remarques à regarder :\n' + [...new Set(fails)].join('\n'));
}
