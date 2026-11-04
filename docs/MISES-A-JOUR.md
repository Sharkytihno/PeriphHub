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

## PeriphHub en arrière-plan (depuis la 1.0)

- Fenêtre cachée (zone de notification, démarrage avec Windows), PeriphHub vérifie aussi les mises à
  jour. S'il en trouve une, une notification Windows l'annonce, une seule fois par version
  (« Ouvrez PeriphHub pour l'installer en un clic »). Rien ne s'installe sans clic.
- Une mise à jour conserve les réglages, le journal de l'Allègement et « Démarrer avec Windows » :
  en mode mise à jour, l'installeur ne retire ni la clé Run ni les données (`src-tauri/windows/hooks.nsh`).

## Pourquoi ça marche du premier coup (depuis la 0.18)

PeriphHub lance l'installeur (`/P /UPDATE /R`) puis se ferme aussitôt. L'installeur de Tauri demande
alors au Restart Manager de Windows de fermer tout processus qui utilise `periphhub.exe`. Si
l'ancien PeriphHub était encore **en train de se fermer** (WebView2, appareil USB qui ne rend pas la
main…), Windows refusait de le terminer et l'installeur s'arrêtait sur « La fermeture de PeriphHub a
échoué. Veuillez fermer l'application et réessayer. »

`src-tauri/windows/hooks.nsh` (`NSIS_HOOK_PREINSTALL`, exécuté avant cette vérification, en mise à
jour seulement) : attend jusqu'à 15 s que `periphhub.exe` soit libéré, puis, s'il est encore
verrouillé, le **renomme** en `periphhub.exe.old` (Windows l'autorise pour un programme en cours ;
le Restart Manager ne voit alors plus rien sur ce chemin). Le nouvel exe s'installe, PeriphHub est
relancé et supprime les `.old` à son démarrage (`update::cleanup_old`). Le hook fait partie de
l'installeur de la **nouvelle** version : il protège aussi les mises à jour lancées depuis une
ancienne version. Testé avec la vraie macro `CheckIfAppIsRunning` de Tauri (processus qui se ferme
en 3 s, et processus qui ne se ferme jamais).
Le code : `src-tauri/src/update.rs`, `ui/js/shell.js` (section « Mises à jour »).

## Publier une mise à jour

1. Écrire la section `## X.Y.Z` de `CHANGELOG.md` : elle devient les notes de la Release
   (`scripts/release-notes.ps1`, appelé par la CI).
2. Changer la version (`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`), commit, tag `vX.Y.Z`, push.
3. La CI (`.github/workflows/release.yml`) compile, signe l'installeur avec le secret
   `TAURI_SIGNING_PRIVATE_KEY` et ajoute `latest.json` au brouillon de release
   (`scripts/updater-manifest.js`).
4. Analyser l'installeur du brouillon avec Microsoft Defender, avant de publier :
   ```powershell
   gh release download vX.Y.Z --repo Sharkytihno/PeriphHub --pattern '*-setup.exe' --dir $env:TEMP\ph
   & "$env:ProgramFiles\Windows Defender\MpCmdRun.exe" -Scan -ScanType 3 -File "$env:TEMP\ph" -DisableRemediation
   ```
   Résultat attendu : « found no threats ». Sinon, ne pas publier : voir [SECURITE.md](SECURITE.md).
5. Publier le brouillon : `gh release edit vX.Y.Z --repo Sharkytihno/PeriphHub --draft=false --latest`.
   Dès cet instant, toutes les installations la proposent.

## La clé de signature

- Créée une fois avec `npx tauri signer generate -p "" -w ~/.tauri/periphhub-updater.key`.
- Clé privée : `~/.tauri/periphhub-updater.key` sur le PC du mainteneur **et** secret GitHub
  `TAURI_SIGNING_PRIVATE_KEY` (`gh secret set TAURI_SIGNING_PRIVATE_KEY --repo Sharkytihno/PeriphHub < ~/.tauri/periphhub-updater.key`).
- **À sauvegarder hors du PC** : si elle est perdue, les versions déjà installées ne peuvent plus
  recevoir de mise à jour (il faudrait réinstaller à la main une version portant une nouvelle clé).
- Si elle fuit : générer une nouvelle paire, publier une version avec la nouvelle clé publique, et
  prévenir les utilisateurs de réinstaller à la main.
