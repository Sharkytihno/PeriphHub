# Identité visuelle « Orbit »

Un moyeu (PeriphHub) et trois périphériques en orbite : le logiciel qui relie tout, sans se mettre au milieu.

## Logo

`assets/logo.svg` (source des icônes : `npx tauri icon assets/logo.svg -o src-tauri/icons`).
Tuile arrondie au dégradé signature, moyeu et satellites blancs, orbite à 55 % d'opacité.
Taille minimale : 16 px. Ne pas déformer, ne pas recolorer la tuile hors du dégradé.
Logotype : « Periph » en couleur du texte, « Hub » au dégradé, Segoe UI Variable Display gras.

## Couleurs

| Rôle | Sombre | Clair |
|---|---|---|
| Dégradé signature | `#8b5cff → #5b7bff → #22c8ee` | `#7a4dff → #4f6bff → #10b4dc` |
| Iris (accent) | `#7c6cff` | `#5b4bf0` |
| Cyan | `#22c8ee` | `#0aa5cc` |
| Mémoire consommée | `#ff9a5c` | `#e8702a` |
| Gain, connecté | `#3ddc97` | `#12925c` |
| Fond / cartes | `#0c0e14` / `#131620` | `#f5f6fb` / `#ffffff` |

Règles : le dégradé est réservé à ce qui compte (logo, bouton principal, sélection, PeriphHub dans les
barres). L'ambre ne sert qu'à la mémoire des logiciels constructeurs, le vert qu'au gain et aux
appareils connectés.

## Mouvement

Courbe `cubic-bezier(.2, .8, .2, 1)`. Entrée de page 260 ms, cartes en cascade (50 ms d'écart) à
l'ouverture d'une page seulement, compteur de mémoire 700 ms, orbite du logo qui tourne pendant une
analyse. Tout est coupé si Windows demande moins d'animations.
