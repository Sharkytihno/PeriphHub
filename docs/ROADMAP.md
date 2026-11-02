# Feuille de route

## La promesse

Réduire d'au moins **la moitié** la mémoire occupée en permanence par les logiciels de
périphériques, sans perdre les réglages utiles. Le gain est **mesuré** sur la machine de chaque
utilisateur (avant / après), jamais estimé.

## 0.1 — Analyseur ✅

- Processus des logiciels constructeurs et leur mémoire (y compris les services système et les
  moteurs web qu'ils lancent : WebView2, CEF, Qt WebEngine).
- Ce qui démarre avec Windows : clés Run, dossiers Démarrage, services, tâches planifiées.
- Périphériques HID branchés, type deviné, fabricant, statut de prise en charge.
- Rapport anonymisé à copier pour les tickets.

## 0.2 — Nouvelle interface et premiers appareils ✅

- Souris Scyrox (puce CompX) : DPI, fréquence, LOD, boutons, macros.
- Claviers VIA / Vial, dont les claviers à effet Hall (course, rapid trigger par touche, éclairage, macros).
- Casques Razer sans fil (égaliseur matériel, retour micro, veille) + effets THX si présents.
- RGB des cartes mères GIGABYTE (ITE Fusion 2).

## 0.3 — Allègement guidé ✅

Pour chaque logiciel constructeur, un parcours en étapes :

1. Ce que vous gardez / perdez (données de `vendors.json`).
2. Vos appareils de cette marque sont-ils pris en charge par PeriphHub ?
3. Désactivation **réversible** : lancement automatique retiré, services en « manuel », tâches
   désactivées. Chaque modification est enregistrée pour pouvoir l'annuler en un clic.
4. **Lancement à la demande** : « Ouvrir Synapse pour ce réglage », puis fermeture complète.
5. Mesure de la mémoire gagnée.

Jamais de désinstallation automatique.

## 0.4 — Pilotes génériques ✅

`ui/js/drivers/` : un pilote décrit les capacités de l'appareil (DPI, fréquence, molette, éclairage,
batterie) et PeriphHub construit la page tout seul. Avant la première modification, les réglages
d'origine sont gardés (« Remettre les réglages du … »). Les réglages choisis sont réappliqués au
branchement pour les appareils qui les oublient à l'extinction.

- `logitech.js` — HID++ 2.0 (d'après Solaar / libratbag) : direct (index 0xFF) ou derrière un récepteur
  Unifying / Bolt / Lightspeed (index 1 à 6, réveil détecté). Fonctionnalités 0x0005, 0x0003, 0x1000,
  0x1004, 0x2201, 0x8060, 0x8061, 0x2110, 0x2111, 0x2121.
- `razer-chroma.js` — protocole OpenRazer (feature report de 90 octets, CRC XOR), id de transaction
  0x1F / 0x3F / 0xFF essayés tour à tour. DPI, fréquence 125 / 500 / 1000 Hz, luminosité, effets
  fixe / respiration / cycle / éteint, batterie.

Statut « expérimental » tant qu'un modèle n'a pas été confirmé par un utilisateur.

## 0.5 — Casques via HeadsetControl ✅

Plutôt que de réécrire des dizaines de protocoles de casques, PeriphHub livre
[HeadsetControl](https://github.com/Sapd/HeadsetControl) 4.2.0 (GPL-3.0, maintenu par sa communauté).
`src-tauri/src/headset.rs` ne le lance que si son empreinte SHA-256 est la bonne, et ne lui passe que
des options en liste blanche, bornes vérifiées. `ui/js/drivers/headsets.js` construit la page :
batterie, retour micro, volume et filtre du micro, réduction de bruit, préréglages d'égaliseur,
éclairage, annonces vocales, extinction automatique, ChatMix. Ces casques ne relisent pas leurs
réglages : PeriphHub retient les choix et les renvoie quand le casque se rallume.

## 0.6 — Claviers VIA / Vial, souris CompX ✅

- `ui/js/drivers/via.js` : tout clavier QMK qui expose la collection VIA (page 0xFF60, usage 0x61),
  quel que soit le fabricant (la passerelle HID l'autorise en plus de data/devices.json). Éclairage
  RGB Matrix / RGBLight / rétroéclairage : luminosité, fixe / éteint / effet en cours, couleur,
  enregistré dans le clavier (0x09). La disposition des touches reste du ressort de VIA / Vial.
- Souris CompX (VID 0x3554 : VXE, ATK, MCHOSE, Scyrox…) : la page souris accepte toute la famille,
  marquée « Expérimental » hors des modèles confirmés.
- Sinowealth (VID 0x258A) : reconnue, « Bientôt » (configuration par blocs entiers, à faire avec
  un appareil sous la main pour ne rien dérégler).

## Plus loin — en portant les protocoles libres existants

| Famille | Source | Couverture attendue |
|---|---|---|
| Logitech (HID++ 2.0) | Solaar, libratbag | La quasi-totalité des souris et claviers Logitech récents |
| Razer | OpenRazer | Des centaines de souris, claviers, casques |
| SteelSeries, ROCCAT, Glorious… | libratbag | Souris |
| Casques Logitech, SteelSeries, Corsair, HyperX | HeadsetControl | Retour micro, batterie, égaliseur selon les modèles |
| RGB toutes marques | OpenRGB (serveur SDK) | Plus de 1 000 appareils |
| Capteurs, ventilateurs | LibreHardwareMonitor + PawnIO | Cartes mères courantes |

## Plus tard

- Outil de capture intégré pour aider la communauté à décoder de nouveaux appareils.
- Traduction anglaise.
- Signature du code (SignPath Foundation pour les projets libres).
- Modules optionnels (« + Ajouter un module ») : ventilateurs, Raspberry Pi / NAS…
