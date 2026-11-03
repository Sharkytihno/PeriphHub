# Signature de l'installeur

PeriphHub est signé gratuitement par [SignPath Foundation](https://signpath.org), qui fournit des
certificats de signature de code aux logiciels libres. La clé privée reste chez SignPath (module
matériel) : personne, pas même les mainteneurs, ne peut signer un fichier qui ne sort pas de la
compilation publique de GitHub Actions.

## Politique de signature du code

- *Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by
  [SignPath Foundation](https://signpath.org).*
- Seuls les fichiers compilés par `.github/workflows/release.yml` à partir d'un tag de ce dépôt sont
  signés : `periphhub.exe`, puis l'installeur `PeriphHub_<version>_x64-setup.exe` qui le contient.
- Rôles : auteur, relecteur et approbateur des signatures : [@Sharkytihno](https://github.com/Sharkytihno).
  Chaque demande de signature est approuvée à la main sur SignPath.
- Confidentialité : PeriphHub n'a ni télémétrie ni compte. Il ne transmet rien sans l'accord de
  l'utilisateur : seul le diagnostic d'un appareil qui ne se connecte pas peut être envoyé, sur clic ou
  après acceptation de l'envoi automatique (voir [DIAGNOSTICS.md](DIAGNOSTICS.md)).
  La version GitHub lit au lancement un fichier public de la dernière release (`latest.json`) pour
  proposer les mises à jour ; désactivable dans les Options (voir [MISES-A-JOUR.md](MISES-A-JOUR.md)).

## Mise en place (une seule fois, par le propriétaire du dépôt)

1. **Demande** : formulaire sur [signpath.org/apply](https://signpath.org/apply). La demande porte sur
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

Sans ces secrets, le workflow publie un installeur non signé, comme avant. La compilation ne casse pas.

## Vérifier un téléchargement

Dans PowerShell :

```powershell
Get-AuthenticodeSignature .\PeriphHub_0.9.1_x64-setup.exe | Format-List Status, SignerCertificate
Get-FileHash .\PeriphHub_0.9.1_x64-setup.exe -Algorithm SHA256   # à comparer au fichier .sha256 de la Release
```
