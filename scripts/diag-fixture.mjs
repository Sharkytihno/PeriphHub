// Récupère un diagnostic reçu (dépôt privé periphhub-diagnostics) dans tests/fixtures/diag-<n>.txt,
// pour rejouer l'appareil d'un testeur sans le matériel :
//   node scripts/diag-fixture.mjs 18
//   → dans un test : flashFromDiag(fs.readFileSync('tests/fixtures/diag-18.txt', 'utf8')) (tests/sim/compx.mjs)
// Le dépôt est PUBLIC et le diagnostic décrit le PC d'un testeur (matériel, message) : ces fichiers
// sont ignorés par git. Pour un test commité, ne recopier que l'extrait utile (le vidage de la sonde).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const n = Number(process.argv[2]);
if (!Number.isInteger(n) || n <= 0) { console.error('Usage : node scripts/diag-fixture.mjs <numéro du ticket>'); process.exit(1); }
const body = execFileSync('gh', ['issue', 'view', String(n), '--repo', 'Sharkytihno/periphhub-diagnostics', '--json', 'body', '-q', '.body'], { encoding: 'utf8' });
const out = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'tests', 'fixtures', `diag-${n}.txt`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, body.replace(/^[\s\S]*?```\n?/, '').replace(/\n?```[\s\S]*$/, '') + '\n');
const probes = (body.match(/Sonde \w+/g) || []);
console.log(`${out} (${body.length} caractères${probes.length ? ', sondes : ' + [...new Set(probes)].join(', ') : ', aucune sonde'})`);
