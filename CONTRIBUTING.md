# Contribuer à PeriphHub

Merci ! Les contributions les plus utiles au départ ne demandent **pas** de savoir coder.

## 1. Signaler un logiciel constructeur

Ajoutez une entrée dans [`data/vendors.json`](data/vendors.json) :

```json
{
  "id": "marque-logiciel",
  "name": "Nom affiché",
  "brand": "Marque",
  "processes": ["Exe exact.exe"],
  "paths": ["\\dossier-propre-au-logiciel\\"],
  "services": ["Nom du service Windows"],
  "usb_vids": ["1234"],
  "keeps": "Ce qui reste enregistré dans l'appareil quand le logiciel est fermé.",
  "loses": "Ce qui ne marche plus quand le logiciel est fermé.",
  "verified": false
}
```

- `processes` : noms d'exe **exacts** (Gestionnaire des tâches → Détails). Évitez les noms génériques
  (`Service.exe`, `CAM.exe`…) qui reconnaîtraient d'autres programmes.
- `paths` : un morceau du chemin d'installation propre au logiciel, entouré de `\\`.
- `keeps` / `loses` : c'est l'information la plus précieuse pour les utilisateurs. Testez-la :
  réglez l'appareil, fermez complètement le logiciel, redémarrez, et notez ce qui a survécu.
- `verified: true` seulement si vous avez vérifié l'entrée sur une vraie installation.

## 2. Signaler un appareil

Ouvrez un ticket avec le rapport de PeriphHub (bouton **Copier le rapport**) et, si possible :
- le modèle exact ;
- les réglages proposés par le logiciel du fabricant ;
- si le fabricant propose un « pilote web » (page qui règle l'appareil depuis Chrome) : c'est
  souvent le moyen le plus rapide d'ajouter un appareil.

## 3. Écrire un plugin d'appareil

Voir [docs/PLUGINS.md](docs/PLUGINS.md). Règles non négociables :

- **Lire et sauvegarder l'état de l'appareil avant toute écriture.** L'utilisateur doit pouvoir revenir à son état d'origine.
- **Aucune commande de firmware ou de bootloader.**
- Protocole issu d'un autre projet (OpenRazer, Solaar, OpenRGB…) : citez la source et respectez sa licence.

## Code

- Rust (backend Tauri) : `cargo fmt` et `cargo clippy` sans avertissement.
- Interface : JavaScript sans framework ni bundler ; jamais de `innerHTML` avec des données venant de l'analyse.
- Textes de l'interface en français pour l'instant (traduction anglaise prévue).
