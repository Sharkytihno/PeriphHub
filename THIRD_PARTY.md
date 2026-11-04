# Composants tiers

| Composant | Version | Licence | Usage dans PeriphHub | Sources |
|---|---|---|---|---|
| [HeadsetControl](https://github.com/Sapd/HeadsetControl) | 4.2.0 | GPL-3.0 | Livré tel quel (`resources/headsetcontrol.exe`) : casques SteelSeries, Corsair, HyperX, Logitech, Audeze, Sony, Roccat… | [headsetcontrol-4.2.0.tar.gz](https://github.com/Sapd/HeadsetControl/releases/tag/4.2.0) |
| [OpenRGB](https://openrgb.org) | 1.1 | GPL-2.0 | Livré tel quel (`resources/openrgb/`, version portable officielle pour Windows 64 bits), lancé sans fenêtre comme serveur SDK : éclairage des cartes mères, ventilateurs, mémoire, cartes graphiques… | [release_1.1](https://codeberg.org/OpenRGB/OpenRGB/releases/tag/release_1.1) |
| [PawnIO](https://pawnio.eu) | 2.2.0 | GPL-2.0 | Installeur officiel signé livré tel quel (`resources/PawnIO_setup.exe`), lancé sans fenêtre seulement quand l'utilisateur active l'éclairage de la mémoire (une validation Windows) : pilote qui donne à OpenRGB l'accès au bus SMBus (barrettes de mémoire, puces de la carte mère) | [PawnIO](https://github.com/namazso/PawnIO) |
| [OpenMouse protocol](https://github.com/OpenMouse-Project/mouse-protocol) (`@openmouse/protocol`) | 0.49.0 | AGPL-3.0-or-later | Copié tel quel dans `ui/vendor/openmouse/` (seuls les chemins d'import sont réécrits, par `scripts/vendor-openmouse.py`) : réglages des souris de ~50 marques (Pulsar, Lamzu, WLMouse, Endgame Gear, Finalmouse, ATK, VXE, MCHOSE, G-Wolves, VAXEE…). Les fonctions de mise à jour du firmware ne sont jamais appelées. | [npm](https://www.npmjs.com/package/@openmouse/protocol) |
| [OpenMouse keyboard protocol](https://github.com/OpenMouse-Project) (`@openmouse/keyboard-protocol`) | 1.6.1 | AGPL-3.0-or-later | Copié tel quel dans `ui/vendor/openmouse-kb/` (chemins d'import réécrits) : point d'activation et rapid trigger des claviers Wooting et SteelSeries Apex Pro, fréquence et luminosité Razer / Logitech. | [npm](https://www.npmjs.com/package/@openmouse/keyboard-protocol) |

Exécutable officiel non modifié, téléchargé par `scripts/fetch-headsetcontrol.ps1` et vérifié par
empreinte SHA-256 (`81acae4c…ff0fa5`), à la compilation comme à chaque lancement.

OpenRGB : archive officielle non modifiée, téléchargée par `scripts/fetch-openrgb.ps1` et vérifiée par
empreinte SHA-256 (`63291726…8a172a`) à la compilation ; chacun de ses fichiers est revérifié avant
chaque lancement (`src-tauri/src/openrgb.rs`). C'est un programme séparé, qui communique avec
PeriphHub par son protocole réseau local (127.0.0.1) ; ses sources sont celles de la version indiquée.
Quand l'éclairage de la mémoire est activé, cette copie est installée dans `%ProgramFiles%\PeriphHub-OpenRGB`
et lancée comme service Windows (`PeriphHubOpenRGB`, `src-tauri/src/openrgb_service.rs`), revérifiée
fichier par fichier à son arrivée. PawnIO : installeur vérifié par empreinte SHA-256 (`1f519a22…ba3032`)
avant d'être lancé.

## Protocoles réimplémentés (aucun code copié)

| Projet | Licence | Ce qui en vient |
|---|---|---|
| [Solaar](https://github.com/pwr-Solaar/Solaar), [libratbag](https://github.com/libratbag/libratbag) | GPL-2.0 / MIT | Description du protocole Logitech HID++ 2.0 (`ui/js/drivers/logitech.js`) |
| [VIA](https://github.com/the-via/app), [QMK](https://github.com/qmk/qmk_firmware) | GPL-3.0 / GPL-2.0 | Protocole VIA (`ui/js/drivers/via.js`) |
| [OpenRGB](https://gitlab.com/CalcProgrammer1/OpenRGB) | GPL-2.0 | Protocole réseau du serveur SDK (`src-tauri/src/openrgb.rs`), éclairage du Turtle Beach Vulcan II TKL Pro (`ui/js/drivers/turtle-vulcan.js`) |
| [HeadsetControl](https://github.com/Sapd/HeadsetControl) | GPL-3.0 | Protocole du HyperX Cloud Alpha Wireless (`ui/js/drivers/headsets-native.js`) |
| [OpenRazer](https://github.com/openrazer/openrazer) | GPL-2.0 | Format des commandes Razer (`ui/js/drivers/razer-chroma.js`) et de l'éclairage des Kraken (`ui/js/drivers/razer-kraken.js`) |

L'AGPL-3.0 est compatible avec la GPL-3.0 de PeriphHub (article 13 des deux licences) : l'ensemble
distribué reste libre, et le code source complet est publié dans ce dépôt.

## Base d'appareils (`data/catalog.json`)

Générée par `scripts/build-catalog.py`, qui lit seulement les listes d'identifiants USB (VID:PID)
et les noms de modèles de ces projets ; aucun code n'en est repris :
[OpenRGB](https://gitlab.com/CalcProgrammer1/OpenRGB) (GPL-2.0),
[OpenRazer](https://github.com/openrazer/openrazer) (GPL-2.0),
[libratbag](https://github.com/libratbag/libratbag) (MIT),
[Solaar](https://github.com/pwr-Solaar/Solaar) (GPL-2.0),
[rivalcfg](https://github.com/flozz/rivalcfg) (WTFPL),
[HeadsetControl](https://github.com/Sapd/HeadsetControl) (GPL-3.0),
[OpenMouse](https://github.com/OpenMouse-Project/openmouse) (AGPL-3.0).
Les noms de fabricants complètent [usb.ids](http://www.linux-usb.org/usb-ids.html).
