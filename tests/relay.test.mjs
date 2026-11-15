// Relais des diagnostics (server/diag-relay) : rien de personnel ne doit atteindre GitHub
import test from 'node:test';
import assert from 'node:assert/strict';
import { scrub, parse, clientIp } from '../server/diag-relay/relay.mjs';

test('Relais : limite de débit sur l’adresse ajoutée par le proxy, pas sur celle que le client annonce', () => {
  const req = (xff, remote = '127.0.0.1') => ({ headers: xff == null ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: remote } });
  assert.equal(clientIp(req('203.0.113.7')), '203.0.113.7');
  assert.equal(clientIp(req('1.2.3.4, 203.0.113.7')), '203.0.113.7'); // « 1.2.3.4 » inventée par le client
  assert.equal(clientIp(req(null, '198.51.100.9')), '198.51.100.9');
  assert.equal(clientIp(req('', '198.51.100.9')), '198.51.100.9');
});

test('Relais : chemins, dossier utilisateur, adresses mail et mentions retirés', () => {
  const s = scrub(String.raw`ouvre \\?\hid#vid_046d&pid_c54d&mi_02#7&1a2b#{4d1e55b2} dans C:\Users\Jean Dupont\AppData x jean.dupont@gmail.com @Sharkytihno`);
  assert.ok(!s.includes('hid#vid_046d'), s);
  assert.ok(!s.includes('Jean'), s);
  assert.ok(!s.includes('Dupont'), s); // nom de session en deux mots : rien n'en reste
  assert.ok(s.includes('AppData x'), s); // la suite du chemin et du texte est gardée
  assert.ok(!s.includes('gmail'), s);
  assert.ok(!/@Sharkytihno/.test(s), s);
  assert.match(s, /<chemin>/);
  assert.match(s, /<utilisateur>/);
});

test('Relais : diagnostic validé, borné, champs nettoyés', () => {
  const d = parse(JSON.stringify({ version: '0.20.0<script>', text: 'x'.repeat(100000), summary: 'souris\nclavier', auto: true }));
  assert.equal(d.version, '0.20.0script');
  assert.equal(d.text.length, 40000);
  assert.equal(d.summary, 'souris clavier');
  assert.equal(d.auto, true);
  assert.equal(parse('{}'), null);
  assert.equal(parse('pas du json'), null);
  assert.equal(parse(JSON.stringify({ version: '1', text: '   ' })), null);
  assert.equal(parse(JSON.stringify({ version: '1', text: 'a', auto: 'oui' })).auto, false);
});

// ---------- Confirmations (POST /periphhub/confirm) ----------
import { parseConfirm, confirmLines } from '../server/diag-relay/relay.mjs';
import { parseLine, aggregate } from '../scripts/confirmations.mjs';

test('Confirmations : seuls les champs attendus passent, bornés et nettoyés', () => {
  const d = parseConfirm(JSON.stringify({ version: '1.6.1', items: [
    { id: '3554:f517', name: 'ATTACK SHARK `Mouse`\n| x', driver: 'openmouse', cap: 'dpi', ok: true, note: String.raw`C:\Users\Jean\x jean@mail.fr` },
    { id: '../etc', driver: 'x', cap: 'dpi', ok: true },
    { id: '1234:5678', driver: 'a b', cap: 'dpi', ok: true },
    ...Array(30).fill({ id: '1234:5678', driver: 'via', cap: 'rate', ok: false }),
  ] }));
  assert.equal(d.items.length, 18); // 20 lus au plus, dont 2 refusés
  assert.equal(d.items[0].id, '3554:F517');
  assert.ok(!/[`|\n]/.test(d.items[0].name), d.items[0].name);
  assert.ok(!/Jean|mail\.fr/.test(d.items[0].note), d.items[0].note);
  assert.equal(parseConfirm('{"version":"1","items":[]}'), null);
  assert.equal(parseConfirm('pas du json'), null);
});

test('Confirmations : lignes du relais relues par scripts/confirmations.mjs', () => {
  const lines = confirmLines('1.6.1', [
    { driver: 'openmouse', cap: 'dpi', ok: true, note: '' },
    { driver: 'openmouse', cap: 'rate', ok: false, note: 'Command 0x07 failed' },
    { driver: 'openmouse', cap: 'connexion', ok: true, note: '' },
  ]);
  assert.deepEqual({ ...parseLine(lines[1]) }, { version: '1.6.1', driver: 'openmouse', cap: 'rate', ok: false, note: 'Command 0x07 failed' });
  const { confirmed, fails } = aggregate([
    { title: 'Confirmations · 3554:F517 · ATTACK SHARK Mouse', comments: [{ body: lines.join('\n') }, { body: confirmLines('1.6.1', [{ driver: 'openmouse', cap: 'dpi', ok: true }]).join('\n') }] },
    { title: 'Confirmations · 1234:5678', comments: [{ body: confirmLines('1.6.1', [{ driver: 'via', cap: 'connexion', ok: true }]).join('\n') }] },
    { title: 'Diagnostic envoyé', comments: [] },
  ]);
  assert.deepEqual(confirmed, { '3554:F517': { name: 'ATTACK SHARK Mouse', caps: ['dpi'], n: 2 } }); // la connexion seule ne confirme pas
  assert.equal(fails.length, 1);
  assert.match(fails[0], /rate ✘ · Command 0x07 failed/);
});
