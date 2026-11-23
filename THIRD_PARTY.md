# Composants tiers

| Composant | Version | Licence | Usage dans PeriphHub | Sources |
|---|---|---|---|---|
| [HeadsetControl](https://github.com/Sapd/HeadsetControl) | 4.3.0 | GPL-3.0 | Livré tel quel (`resources/headsetcontrol.exe`) : casques SteelSeries, Corsair, HyperX, Logitech, Audeze, Sony, Roccat… | [headsetcontrol-4.3.0.tar.gz](https://github.com/Sapd/HeadsetControl/releases/tag/4.3.0) |
| [OpenRGB](https://openrgb.org) | 1.1 | GPL-2.0 | Livré tel quel (`resources/openrgb/`, version portable officielle pour Windows 64 bits), lancé sans fenêtre comme serveur SDK : éclairage des cartes mères, ventilateurs, mémoire, cartes graphiques… | [release_1.1](https://codeberg.org/OpenRGB/OpenRGB/releases/tag/release_1.1) |
| [PawnIO](https://pawnio.eu) | 2.2.0 | GPL-2.0 | Installeur officiel signé livré tel quel (`resources/PawnIO_setup.exe`), lancé sans fenêtre seulement quand l'utilisateur active l'éclairage de la mémoire (une validation Windows) : pilote qui donne à OpenRGB l'accès au bus SMBus (barrettes de mémoire, puces de la carte mère) | [PawnIO](https://github.com/namazso/PawnIO) |
| [G-Helper](https://github.com/seerge/g-helper) | — | GPL-3.0 | Référence seulement (aucun code copié) : identifiants de l'interface ATK de l'ACPI des portables ASUS (vitesse des ventilateurs, profils, courbes de 8 points), réécrits dans `sensors/PeriphHubSensors.cs` | [app/AsusACPI.cs](https://github.com/seerge/g-helper/blob/main/app/AsusACPI.cs) |
| [OpenMouse protocol](https://github.com/OpenMouse-Project/mouse-protocol) (`@openmouse/protocol`) | 0.60.0 | AGPL-3.0-or-later | Importé dans `ui/vendor/openmouse/` par `scripts/vendor-openmouse.py` : réglages des souris de ~50 marques (Pulsar, Lamzu, WLMouse, Endgame Gear, Finalmouse, ATK, VXE, MCHOSE, G-Wolves, VAXEE, AJAZZ AJ200 AI, Redgear X13 Pro…). Les fonctions de mise à jour du firmware ne sont jamais appelées. | [npm](https://www.npmjs.com/package/@openmouse/protocol) |
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

PeriphHub ouvre uniquement la collection de configuration des souris ROCCAT Kone Pro Air et AULA
SC380 Pro. La passerelle Windows filtre leurs commandes autorisées à la lecture. Lors de l'import,
le [correctif CompX et VGN](scripts/patches/openmouse-0.60.0.patch) est appliqué à
[OpenMouse 0.60.0](https://github.com/OpenMouse-Project/mouse-protocol/releases/tag/v0.60.0).

## Code adapté

| Projet | Licence | Ce qui en vient |
|---|---|---|
| [WirelessBattery](https://github.com/krisgfx9/Wireless-Device-Battery-Monitor) (krisgfx9) | GPL-3.0 | Widget des batteries dans la barre des tâches : technique et dessin de `src/widget.cpp` (fenêtre transparente enfant de la barre, placement contre la zone de notification, bouton Widgets de Windows 11 cherché dans un fil séparé, icônes de notification avec le niveau) traduits en Rust dans `src-tauri/src/taskbar.rs` ; protocoles de lecture de batterie de `src/drivers/*.cpp` (JBL, Jabra, ROG, casques Razer, Arctis Nova Pro 225D et Nova Elite, G435 0ADF, Fractal, MOONDROP, Rapoo, MCHOSE, Sprime, RK, Areson, SONiX, Kysona, Alienware, Arbiter, BEITONG, CHERRY, Darmoshark, 8BitDo, Machenike, MAONO, MSI, Niceboy, NZXT, Semico, ATK, ASTRO, manettes Steam, Flydigi et Switch Pro — ces protocoles citent eux-mêmes HaloBattery (MIT), BatteryWatch (MIT), SDL (zlib), OpenRazer (GPL-2.0), eh-fifty, AstroBar et d'autres projets, voir les commentaires de chaque famille) réécrits en JavaScript dans `ui/js/drivers/batteries.js` ; lecture de batterie par Windows.Gaming.Input (`src/drivers/xinput.cpp` → `src-tauri/src/pads.rs`), AirPods (`airpods.cpp` → `airpods.rs`), Galaxy Buds (`galaxy_buds*.{cpp,h}` → `galaxybuds.rs`), Phone Link (`phonelink.cpp` → `phonelink.rs`), batterie HID standard (`generic.cpp` → `generic_hid.rs`) |

## Protocoles réimplémentés (aucun code copié)

| Projet | Licence | Ce qui en vient |
|---|---|---|
| [Solaar](https://github.com/pwr-Solaar/Solaar), [libratbag](https://github.com/libratbag/libratbag) | GPL-2.0 / MIT | Description du protocole Logitech HID++ 2.0 (`ui/js/drivers/logitech.js`) |
| [VIA](https://github.com/the-via/app), [QMK](https://github.com/qmk/qmk_firmware) | GPL-3.0 / GPL-2.0 | Protocole VIA (`ui/js/drivers/via.js`) |
| [OpenRGB](https://gitlab.com/CalcProgrammer1/OpenRGB) | GPL-2.0 | Protocole réseau du serveur SDK (`src-tauri/src/openrgb.rs`), éclairage du Turtle Beach Vulcan II TKL Pro (`ui/js/drivers/turtle-vulcan.js`) |
| [HeadsetControl](https://github.com/Sapd/HeadsetControl) | GPL-3.0 | Protocole du HyperX Cloud Alpha Wireless (`ui/js/drivers/headsets-native.js`) |
| [OpenRazer](https://github.com/openrazer/openrazer) | GPL-2.0 | Format des commandes Razer (`ui/js/drivers/razer-chroma.js`) et de l'éclairage des Kraken (`ui/js/drivers/razer-kraken.js`) |
| [liquidctl](https://github.com/liquidctl/liquidctl) | GPL-3.0 | Protocole des watercoolings NZXT Kraken Z, 2023 et 2024 (`ui/js/drivers/nzxt-kraken.js`) |

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
[OpenMouse](https://github.com/OpenMouse-Project/openmouse) (AGPL-3.0),
[liquidctl](https://github.com/liquidctl/liquidctl) (GPL-3.0).
Les noms de fabricants complètent [usb.ids](http://www.linux-usb.org/usb-ids.html).

Les identifiants de plusieurs souris Pulsar et du clavier Wraith W60 proviennent du
[catalogue de PeriHub](https://github.com/hex-dump/perihub/blob/main/docs/devices.md).
