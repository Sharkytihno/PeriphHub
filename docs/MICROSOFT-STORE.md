# Publication sur le Microsoft Store

Un programme téléchargé sans signature déclenche l'écran « Windows a protégé votre ordinateur ».
Le Microsoft Store signe lui-même les paquets **MSIX** qu'on lui envoie : installé depuis le Store,
PeriphHub n'affiche aucun avertissement. L'inscription est **gratuite** pour un développeur
individuel (depuis septembre 2025).

## Une fois : créer le compte et réserver le nom

1. <https://storedeveloper.microsoft.com> → s'inscrire comme **développeur individuel** (compte
   Microsoft personnel, vérification d'identité).
2. Partner Center → **Applications et jeux** → **Nouveau produit** → **Application MSIX ou PWA** →
   réserver le nom **PeriphHub**.
3. Produit → **Gestion du produit** → **Identité du produit** : noter
   - `Package/Identity/Name` (ex. `12345Sharky.PeriphHub`)
   - `Package/Identity/Publisher` (ex. `CN=1A2B3C4D-…`)
   - `Package/Properties/PublisherDisplayName` (ex. `Sharky`)
4. GitHub → dépôt → Settings → Secrets and variables → Actions → onglet **Variables** :
   `MSIX_IDENTITY_NAME`, `MSIX_PUBLISHER`, `MSIX_PUBLISHER_NAME` avec ces trois valeurs
   (ce ne sont pas des secrets).

## À chaque version

La release GitHub (tag `v*`) contient `PeriphHub_<version>_x64.msix`, construit par
`scripts/build-msix.ps1`. Dans le Partner Center : **Soumission** → **Packages** → déposer ce
fichier, puis envoyer en certification (quelques jours la première fois).

## Points à justifier lors de la certification

Le paquet demande des capacités restreintes ; le formulaire de soumission demande pourquoi :

| Capacité | Justification à recopier |
|---|---|
| `runFullTrust` | Application de bureau (Tauri / WebView2) qui communique avec les périphériques USB (HID). |
| `allowElevation` | La fonction « Allègement », à la demande explicite de l'utilisateur, met en démarrage manuel des services de logiciels constructeurs (Razer, Logitech, Corsair…) : cela nécessite une élévation UAC. Chaque changement est réversible depuis l'application. |
| `unvirtualizedResources` | La même fonction désactive le démarrage automatique de ces logiciels (registre `Run`, dossier Démarrage) : sans cela, les écritures seraient redirigées vers une copie privée et resteraient sans effet. |

Code source complet : <https://github.com/Sharkytihno/PeriphHub> (GPL-3.0).

## Construire le paquet à la main

```powershell
npx tauri build --no-bundle
./scripts/fetch-headsetcontrol.ps1
./scripts/build-msix.ps1 -IdentityName "..." -Publisher "CN=..." -PublisherName "..."
```
