# Signature de l'installeur

## État actuel

- **Installeur GitHub** (`PeriphHub_x.y.z_x64-setup.exe`) : **pas encore signé** par un certificat
  de signature de code. Windows peut afficher « Windows a protégé votre ordinateur » : cliquez sur
  **Informations complémentaires**, puis **Exécuter quand même**. Sur un PC où Smart App Control est
  activé, il est bloqué (voir [SECURITE.md](SECURITE.md)).
- **Version Microsoft Store** : signée par Microsoft, une fois publiée ([MICROSOFT-STORE.md](MICROSOFT-STORE.md)).
- **Mises à jour intégrées** : chaque mise à jour est signée par le projet (clé de mise à jour de
  Tauri) et vérifiée avant installation, signature de code ou pas ([MISES-A-JOUR.md](MISES-A-JOUR.md)).

SignPath Foundation, qui signe gratuitement des logiciels libres, a refusé la demande de novembre 2026
faute de visibilité du projet (étoiles, contributeurs, articles). Une nouvelle demande sera faite
quand le projet sera plus connu. Autre piste : un certificat payant pour les logiciels libres.

## Vérifier un téléchargement

Dans PowerShell :

```powershell
Get-FileHash .\PeriphHub_1.0.0_x64-setup.exe -Algorithm SHA256   # à comparer au fichier .sha256 de la Release
Get-AuthenticodeSignature .\PeriphHub_1.0.0_x64-setup.exe | Format-List Status, SignerCertificate
```

Tant que l'installeur n'est pas signé, la seconde commande répond `NotSigned` : c'est normal.

## Le jour où un certificat est obtenu (SignPath Foundation)

Le workflow `.github/workflows/release.yml` sait déjà signer : il suffit d'ajouter deux secrets.

1. **Demande** : formulaire sur [signpath.org/apply](https://signpath.org/apply). Elle porte sur
   le dépôt public `Sharkytihno/PeriphHub`, sous licence GPL-3.0, avec une release déjà publiée.
   Le compte GitHub doit avoir la double authentification activée.
2. **Projet** : une fois la demande acceptée, créer dans SignPath :
   - un projet de slug `periphhub`, relié au dépôt GitHub (« Trusted build system » : GitHub.com) ;
   - une configuration d'artefact de slug `exe-in-zip` (GitHub livre les artefacts en .zip) :

     ```xml
     <?xml version="1.0" encoding="utf-8"?>
     <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
       <zip-file>
         <pe-file path="*.exe">
           <authenticode-sign/>
         </pe-file>
       </zip-file>
     </artifact-configuration>
     ```

   - une politique de signature de slug `release-signing`, avec le certificat de SignPath Foundation
     et approbation manuelle.
3. **Secrets du dépôt** : dans GitHub, ouvrir Settings ▸ Secrets and variables ▸ Actions, puis ajouter :
   - `SIGNPATH_ORGANIZATION_ID` : identifiant de l'organisation (page d'accueil SignPath) ;
   - `SIGNPATH_API_TOKEN` : jeton d'un utilisateur CI SignPath, avec le rôle « Submitter » sur le projet.
4. **Release** : pousser un tag `vX.Y.Z`. Le workflow envoie deux demandes de signature : le programme,
   puis l'installeur. Il faut les approuver sur SignPath. Le workflow vérifie ensuite les deux
   signatures et prépare la Release en brouillon.

Sans ces secrets, le workflow publie un installeur non signé. La compilation ne casse pas.

### Politique de signature du code (exigée par SignPath)

- *Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by
  [SignPath Foundation](https://signpath.org).*
- Seuls les fichiers compilés par `.github/workflows/release.yml` à partir d'un tag de ce dépôt sont
  signés : `periphhub.exe`, puis l'installeur `PeriphHub_<version>_x64-setup.exe` qui le contient.
- Rôles : auteur, relecteur et approbateur des signatures : [@Sharkytihno](https://github.com/Sharkytihno).
  Chaque demande de signature est approuvée à la main sur SignPath.
- Confidentialité : PeriphHub n'a ni télémétrie ni compte. Il ne transmet rien sans l'accord de
  l'utilisateur : seul le diagnostic peut être envoyé, sur clic ou après acceptation de l'envoi
  automatique (voir [DIAGNOSTICS.md](DIAGNOSTICS.md)). La version GitHub lit au lancement un fichier
  public de la dernière release (`latest.json`) pour proposer les mises à jour ; désactivable dans
  les Options (voir [MISES-A-JOUR.md](MISES-A-JOUR.md)).
