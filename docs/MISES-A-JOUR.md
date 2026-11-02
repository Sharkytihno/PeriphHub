# Mises à jour intégrées

La version installée avec `PeriphHub_x.y.z_x64-setup.exe` se met à jour toute seule (depuis la 0.14) :

1. Au lancement puis toutes les 6 heures, PeriphHub lit
   `https://github.com/Sharkytihno/PeriphHub/releases/latest/download/latest.json`, c'est-à-dire
   le fichier de la **dernière release publiée** (un brouillon n'est proposé à personne).
2. Si la version est plus récente, l'accueil affiche « PeriphHub x.y.z est disponible » et un bouton
   **Mettre à jour** : l'installeur est téléchargé, **sa signature est vérifiée** avec la clé
   publique écrite dans `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`), puis il s'installe
   sans questions et relance PeriphHub. Un fichier non signé ou modifié est refusé.
3. **Options ▸ Mises à jour** : désactiver, ou « Vérifier maintenant ».

La version du Microsoft Store (paquet MSIX) ne fait jamais cette vérification : le Store la met à jour.
Le code : `src-tauri/src/update.rs`, `ui/js/shell.js` (section « Mises à jour »).

## Publier une mise à jour

1. Changer la version (`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`), commit, tag `vX.Y.Z`, push.
2. La CI (`.github/workflows/release.yml`) signe l'installeur avec le secret
   `TAURI_SIGNING_PRIVATE_KEY` et ajoute `latest.json` au brouillon de release
   (`scripts/updater-manifest.js`).
3. Publier le brouillon : `gh release edit vX.Y.Z --repo Sharkytihno/PeriphHub --draft=false --latest`.
   Dès cet instant, toutes les installations la proposent.

## La clé de signature

- Créée une fois avec `npx tauri signer generate -p "" -w ~/.tauri/periphhub-updater.key`.
- Clé privée : `~/.tauri/periphhub-updater.key` sur le PC du mainteneur **et** secret GitHub
  `TAURI_SIGNING_PRIVATE_KEY` (`gh secret set TAURI_SIGNING_PRIVATE_KEY --repo Sharkytihno/PeriphHub < ~/.tauri/periphhub-updater.key`).
- **À sauvegarder hors du PC** : si elle est perdue, les versions déjà installées ne peuvent plus
  recevoir de mise à jour (il faudrait réinstaller à la main une version portant une nouvelle clé).
- Si elle fuit : générer une nouvelle paire, publier une version avec la nouvelle clé publique, et
  prévenir les utilisateurs de réinstaller à la main.
