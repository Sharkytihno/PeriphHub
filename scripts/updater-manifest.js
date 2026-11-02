// Écrit latest.json à côté de l'installeur : le fichier que PeriphHub lit pour proposer une mise à
// jour (voir src-tauri/src/update.rs). La signature (installeur.sig) doit déjà exister :
//   npx tauri signer sign -p "" <installeur>   (clé dans TAURI_SIGNING_PRIVATE_KEY)
// Usage : node scripts/updater-manifest.js <installeur> <tag>
const fs = require('fs');
const path = require('path');

const [setup, tag] = process.argv.slice(2);
if (!setup || !/^v\d+\.\d+\.\d+$/.test(tag || '')) {
  console.error('usage : node scripts/updater-manifest.js <installeur> <vX.Y.Z>');
  process.exit(1);
}
const name = path.basename(setup);
const signature = fs.readFileSync(setup + '.sig', 'utf8').trim();
if (!signature) throw new Error('signature vide');

const repo = 'https://github.com/Sharkytihno/PeriphHub';
const manifest = {
  version: tag.slice(1),
  notes: `${repo}/releases/tag/${tag}`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': { signature, url: `${repo}/releases/download/${tag}/${encodeURIComponent(name)}` },
  },
};
const out = path.join(path.dirname(setup), 'latest.json');
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(`latest.json : ${manifest.version} → ${name}`);
