# Plugins d'appareils (conception, version 0.3)

> Ce format est un **projet** : il sera figé avec les premiers plugins de la version 0.3.

Un plugin = un dossier `plugins/<id>/` :

```
plugins/scyrox/
├── plugin.json     # identité, appareils reconnus, réglages exposés
├── protocol.js     # lecture / écriture des réglages (s'exécute dans l'interface)
└── README.md       # source du protocole, modèles testés, limites
```

## plugin.json

```json
{
  "id": "scyrox",
  "name": "Souris Scyrox",
  "license": "GPL-3.0-or-later",
  "source": "Protocole du pilote web officiel scyrox.net",
  "devices": [
    { "vid": "3554", "pid": "F5F7", "usagePage": "FF02", "name": "Scyrox V6 (dongle 8K)", "kind": "souris" }
  ],
  "settings": ["dpi", "polling", "lod", "buttons", "macros", "sleep", "battery"]
}
```

## protocol.js

Le plugin reçoit un objet `device` (envoi/réception de reports HID via la passerelle native) et
expose des fonctions asynchrones :

```js
export default {
  async read(device) { /* → état complet de l'appareil (objet JSON) */ },
  async write(device, changes) { /* applique uniquement les champs modifiés */ },
  async battery(device) { /* → { percent, charging } ou null */ },
};
```

PeriphHub :
- appelle `read()` au premier branchement et **sauvegarde l'état d'origine** avant toute écriture ;
- génère l'interface à partir de `settings` (composants communs : DPI, fréquence, égaliseur, couleur, touches…) ;
- propose « Revenir à l'état d'origine » pour chaque appareil.

## Réglages communs

| Clé | Type | Exemple |
|---|---|---|
| `dpi` | niveaux + niveau actif | `{ levels: [400, 800, 1600], active: 0 }` |
| `polling` | Hz | `1000` |
| `lod` | mm | `1` |
| `lighting` | mode, couleur, vitesse, luminosité | `{ mode: "static", color: "#ff0000", brightness: 80 }` |
| `eq` | bandes en dB | `[0, 2, 3, 0, -1, 0, 0, 1, 2, 0]` |
| `sidetone` | 0-100 | `40` |
| `actuation` | mm par touche | `{ default: 1.5, keys: { "W": 0.8 } }` |
| `buttons` / `keys` | correspondances | voir la documentation du plugin |
| `macros` | liste de séquences | `[{ name, steps: [{ key, down, delay }] }]` |
