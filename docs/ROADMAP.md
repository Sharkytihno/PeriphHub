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

## 0.7 à 0.22 ✅

Détail dans le [README](../README.md) et le [CHANGELOG](../CHANGELOG.md) : passerelle OpenRGB, interface en
anglais, bibliothèque OpenMouse (souris de ~50 marques ; claviers Wooting, SteelSeries Apex Pro, Keychron HE),
casques Razer Kraken, paquet Microsoft Store, plus aucun blocage, mises à jour intégrées, diagnostics envoyés
sans compte GitHub.

## 1.0 — Fermer les logiciels constructeurs au quotidien ✅

- **Pour tous les appareils, même sans pilote de la marque** : réglages Windows de la souris et du
  clavier, batteries Bluetooth, effets OpenRGB.
- **En arrière-plan** : zone de notification, démarrage avec Windows (fenêtre cachée), réglages
  réappliqués au branchement et à la sortie de veille, alerte de batterie faible.
- **Plus aucun blocage**, que l'appareil réponde ou non.
- **Antivirus** : plus aucun programme en ligne de commande lancé en arrière-plan (API de Windows à la
  place) ; [modèle de sécurité](SECURITE.md) documenté.
- **Diagnostics complets du premier coup** : système, contexte, erreurs internes ; appareils standards
  écartés de l'envoi automatique.

## Après la 1.0

| Chantier | Pourquoi |
|---|---|
| Confirmer les pilotes expérimentaux | Grâce aux diagnostics et aux tickets « Retour sur un appareil » : 🧪 → ✅ |
| Souris Sinowealth (VID 0x258A) | Beaucoup de souris d'entrée de gamme ; configuration par blocs entiers, à faire avec un appareil sous la main |
| Pompes AIO et ventilateurs USB (d'après liquidctl) | NZXT, Corsair, Lian Li… : un logiciel constructeur de moins |
| Outil de capture intégré | Aider la communauté à décoder de nouveaux appareils |
| Installeur signé | Nouvelle demande à SignPath Foundation quand le projet sera plus connu ([SIGNATURE.md](SIGNATURE.md)) |
| Microsoft Store | Version signée par Microsoft, mise à jour par le Store ([MICROSOFT-STORE.md](MICROSOFT-STORE.md)) |
| Autres langues | Ajouter un fichier `ui/i18n/<langue>.js` sur le modèle de `en.js` |
| Capteurs de la carte mère | LibreHardwareMonitor + PawnIO demandent un pilote noyau : seulement en module optionnel (« + Ajouter un module »), jamais par défaut |
