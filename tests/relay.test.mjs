// Relais des diagnostics (server/diag-relay) : rien de personnel ne doit atteindre GitHub
import test from 'node:test';
import assert from 'node:assert/strict';
import { scrub, parse } from '../server/diag-relay/relay.mjs';

test('Relais : chemins, dossier utilisateur, adresses mail et mentions retirés', () => {
  const s = scrub(String.raw`ouvre \\?\hid#vid_046d&pid_c54d&mi_02#7&1a2b#{4d1e55b2} dans C:\Users\Jean Dupont\AppData x jean.dupont@gmail.com @Sharkytihno`);
  assert.ok(!s.includes('hid#vid_046d'), s);
  assert.ok(!s.includes('Jean'), s);
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
