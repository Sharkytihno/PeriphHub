# PeriphHub

**Un seul logiciel léger pour tous vos périphériques.**

Razer Synapse, Logitech G HUB, Corsair iCUE, SteelSeries GG, Armoury Crate… Chaque marque installe
son logiciel, qui démarre avec Windows et occupe souvent plusieurs centaines de Mo de mémoire vive,
même quand vous ne changez aucun réglage.

PeriphHub vise à les remplacer par une seule petite application :

1. **Analyse** : quels logiciels constructeurs tournent, combien de mémoire ils occupent, ce qui
   démarre avec Windows, et quels périphériques sont branchés.
2. **Centralisation** : les réglages de vos souris, claviers et casques (DPI, éclairage, égaliseur,
   macros…) dans PeriphHub.
3. **Allègement guidé** : une fois vos appareils pris en charge, PeriphHub propose, avec votre
   accord et toujours de façon réversible, d'empêcher les logiciels constructeurs de tourner en
   permanence. Ils restent installés et s'ouvrent à la demande pour les réglages rares.

## État du projet

| Version | Contenu | État |
|---|---|---|
| 0.1 | Analyseur (lecture seule : ne modifie rien) | ✅ |
| 0.2 | Nouvelle interface, premiers appareils réglables : souris Scyrox, clavier REKT (VIA, effet Hall), casque Razer BlackShark V2 HyperSpeed (+ THX), RGB GIGABYTE | ✅ |
| 0.3 | Allègement guidé et réversible (interrupteurs officiels de Windows, services en manuel, tâches), journal d'annulation, ouverture à la demande, gain mesuré | ✅ |
| 0.4+ | Logitech (HID++), Razer (protocole OpenRazer), passerelles OpenRGB, HeadsetControl, LibreHardwareMonitor | 🗺️ |

Voir la [feuille de route](docs/ROADMAP.md).

## Installer

Téléchargez `PeriphHub_x.y.z_x64-setup.exe` dans les
[Releases](https://github.com/Sharkytihno/PeriphHub/releases). L'installation se fait pour votre
compte seul et ne demande pas de droits administrateur.

> Le programme n'est pas encore signé : Windows peut afficher « Windows a protégé votre
> ordinateur ». Cliquez sur **Informations complémentaires** puis **Exécuter quand même**.

## Votre appareil ou votre logiciel n'est pas reconnu ?

C'est normal au début, et c'est comme ça que la liste grandit :

1. Dans PeriphHub, cliquez sur **Copier le rapport** (les chemins sont anonymisés).
2. Ouvrez un [ticket « Appareil ou logiciel non reconnu »](https://github.com/Sharkytihno/PeriphHub/issues/new/choose)
   et collez le rapport.

Les données sont dans de simples fichiers JSON :
[`data/vendors.json`](data/vendors.json) (logiciels constructeurs),
[`data/devices.json`](data/devices.json) (appareils pris en charge),
[`data/usb-vendors.json`](data/usb-vendors.json) (fabricants USB). Voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Ce que PeriphHub ne fera jamais

- **Flasher un firmware.** Les mises à jour passent par les outils officiels des fabricants.
- **Toucher aux anti-triche** (Vanguard, FACEIT, EasyAntiCheat…) ni installer de pilote noyau non signé.
- **Envoyer des données** sans action explicite de votre part.

## Compiler

Prérequis : [Rust](https://rustup.rs), Node.js 20+, Visual Studio Build Tools (C++), WebView2 (déjà présent sur Windows 10/11).

```bash
npm install
npm run dev        # lancement en développement
npm run build      # installeur dans src-tauri/target/release/bundle/nsis/
```

Analyse en ligne de commande, sans fenêtre :

```bash
src-tauri/target/release/periphhub.exe --scan
```

## Licence

[GPL-3.0-or-later](LICENSE). PeriphHub s'appuie sur le travail de la communauté
(OpenRGB, OpenRazer, Solaar, libratbag, HeadsetControl…) et en restera un logiciel libre.

Les noms et marques cités appartiennent à leurs propriétaires. PeriphHub n'est affilié à aucun fabricant.
