# Composants tiers

| Composant | Version | Licence | Usage dans PeriphHub | Sources |
|---|---|---|---|---|
| [HeadsetControl](https://github.com/Sapd/HeadsetControl) | 4.2.0 | GPL-3.0 | Livré tel quel (`resources/headsetcontrol.exe`) : casques SteelSeries, Corsair, HyperX, Logitech, Audeze, Sony, Roccat… | [headsetcontrol-4.2.0.tar.gz](https://github.com/Sapd/HeadsetControl/releases/tag/4.2.0) |

Exécutable officiel non modifié, téléchargé par `scripts/fetch-headsetcontrol.ps1` et vérifié par
empreinte SHA-256 (`81acae4c…ff0fa5`), à la compilation comme à chaque lancement.

## Protocoles réimplémentés (aucun code copié)

| Projet | Licence | Ce qui en vient |
|---|---|---|
| [Solaar](https://github.com/pwr-Solaar/Solaar), [libratbag](https://github.com/libratbag/libratbag) | GPL-2.0 / MIT | Description du protocole Logitech HID++ 2.0 (`ui/js/drivers/logitech.js`) |
| [VIA](https://github.com/the-via/app), [QMK](https://github.com/qmk/qmk_firmware) | GPL-3.0 / GPL-2.0 | Protocole VIA (`ui/js/drivers/via.js`) |
| [OpenRazer](https://github.com/openrazer/openrazer) | GPL-2.0 | Format des commandes Razer (`ui/js/drivers/razer-chroma.js`) |
