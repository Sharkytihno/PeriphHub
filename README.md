<p align="center">
  <img src="assets/logo.svg" width="96" height="96" alt="Logo PeriphHub">
</p>
<h1 align="center">PeriphHub</h1>
<p align="center"><strong>Un seul logiciel léger pour tous vos périphériques.</strong></p>
<p align="center">
  <a href="https://github.com/Sharkytihno/PeriphHub/releases"><img alt="Dernière version" src="https://img.shields.io/github/v/release/Sharkytihno/PeriphHub?include_prereleases&color=6d5ef4"></a>
  <a href="LICENSE"><img alt="Licence GPL-3.0" src="https://img.shields.io/badge/licence-GPL--3.0-22c8ee"></a>
  <img alt="Windows 10 et 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-5b7bff">
  <a href="https://github.com/Sharkytihno/PeriphHub/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Sharkytihno/PeriphHub/actions/workflows/ci.yml/badge.svg"></a>
</p>

<p align="center">
  <img src="docs/screenshots/accueil-sombre.png" width="49%" alt="Accueil, thème sombre">
  <img src="docs/screenshots/accueil-clair.png" width="49%" alt="Accueil, thème clair">
</p>

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

<p align="center"><img src="docs/screenshots/allegement-sombre.png" width="80%" alt="Allègement guidé"></p>

## Pris en charge

| Famille | Comment | Réglages | Statut |
|---|---|---|---|
| **Toutes les souris et tous les claviers** | Réglages de Windows, réunis sur une page | Vitesse du pointeur, accélération, molette, double-clic, boutons inversés, répétition des touches | 🧪 |
| **Appareils Bluetooth** (casques, souris, claviers, manettes) | Batterie affichée par Windows | Niveau de batterie, alerte de batterie faible | 🧪 |
| Souris CompX (Scyrox, VXE, ATK, MCHOSE…) | Protocole observé | DPI, fréquence jusqu'à 8 kHz, boutons, macros, veille | ✅ Scyrox V6 · 🧪 autres |
| Claviers VIA / Vial (Keychron, Akko, NuPhy, REKT…) | Protocole VIA | Éclairage enregistré dans le clavier ; REKT : touches, rapid trigger, macros | ✅ REKT · 🧪 autres |
| Claviers SteelSeries Apex 3 / 3 TKL, Turtle Beach Vulcan II TKL Pro | Pilotes intégrés | Éclairage (Apex 3 : couleurs par zone, effets animés) | 🧪 |
| Logitech (HID++ 2.0) | D'après Solaar / libratbag | DPI, fréquence, SmartShift, molette, batterie | 🧪 |
| Souris de ~50 marques : Pulsar, Lamzu, WLMouse, Endgame Gear, Finalmouse, ATK, VXE, MCHOSE, G-Wolves, VAXEE, Ninjutso, Glorious, HyperX, Corsair, SteelSeries, ASUS… | Bibliothèque [OpenMouse](https://github.com/OpenMouse-Project/mouse-protocol) (AGPL-3.0) | DPI, fréquence, LOD, Motion Sync, correction d'angle, lissage, anti-rebond, veille, batterie | 🧪 |
| Claviers à effet Hall Wooting (ARM), SteelSeries Apex Pro et Keychron HE ; claviers Razer et Logitech en secours | Bibliothèque OpenMouse (`@openmouse/keyboard-protocol`) | Point d'activation, rapid trigger, fréquence, luminosité (réglages globaux) | 🧪 |
| Razer souris et claviers | D'après OpenRazer | DPI, fréquence, éclairage, batterie | 🧪 |
| Casques Razer Kraken filaires (7.1, V2, Tournament Edition, Ultimate, Kitty V2, Classic) | D'après OpenRazer | Éclairage (fixe, respiration, cycle, éteint) | 🧪 |
| Casques Razer BlackShark V2 HyperSpeed | Protocole observé | Égaliseur, retour micro, veille, THX | ✅ |
| Casque HyperX Cloud Alpha Wireless | Pilote intégré | Batterie, retour micro, extinction auto, annonces vocales | 🧪 |
| Casques SteelSeries, Corsair, HyperX, Logitech, Audeze, Sony… | [HeadsetControl](https://github.com/Sapd/HeadsetControl) | Batterie, retour micro, égaliseur, extinction auto… | 🧪 |
| RGB carte mère GIGABYTE | Protocole RGB Fusion 2 | Effets, couleurs | ✅ |
| Tout ce que gère OpenRGB (1 000+ appareils) | Serveur SDK d'OpenRGB | Couleur unie, effets de l'appareil (vitesse, sens, couleurs), enregistrement dans l'appareil | 🧪 |

Les autres appareils branchés sont tout de même **nommés** grâce à une base de plus de 1 800 modèles
(`data/catalog.json`, tirée d'OpenRGB, OpenRazer, libratbag, Solaar, rivalcfg, HeadsetControl et
OpenMouse) : PeriphHub dit honnêtement s'il sait les régler, seulement piloter leur éclairage via
OpenRGB, ou s'ils ont encore besoin de leur logiciel d'origine.

✅ testé sur l'appareil · 🧪 expérimental : écrit à partir de projets libres, à confirmer. Un modèle
fonctionne (ou pas) ? Ouvrez un [ticket « Retour sur un appareil »](https://github.com/Sharkytihno/PeriphHub/issues/new?template=retour-appareil.yml) avec le rapport de la page Allègement.

## État du projet

| Version | Contenu | État |
|---|---|---|
| 0.1 | Analyseur (lecture seule : ne modifie rien) | ✅ |
| 0.2 | Nouvelle interface, premiers appareils réglables : souris Scyrox, clavier REKT (VIA, effet Hall), casque Razer BlackShark V2 HyperSpeed (+ THX), RGB GIGABYTE | ✅ |
| 0.3 | Allègement guidé et réversible (interrupteurs officiels de Windows, services en manuel, tâches), journal d'annulation, ouverture à la demande, gain mesuré | ✅ |
| 0.4 | Pilotes génériques **expérimentaux** : Logitech HID++ 2.0 (DPI, fréquence, molette SmartShift / haute résolution, batterie) et Razer (DPI, fréquence, éclairage, batterie). Page de réglages construite automatiquement, réglages d'origine gardés | ✅ |
| 0.5 | Casques SteelSeries Arctis, Corsair Void / Virtuoso, HyperX Cloud, Logitech G / Astro, Audeze, Sony INZONE… via [HeadsetControl](https://github.com/Sapd/HeadsetControl) : batterie, retour micro, égaliseur, extinction auto, éclairage (**expérimental**) | ✅ |
| 0.6 | Claviers QMK **VIA / Vial** de toutes marques (Keychron, Akko, Epomaker, NuPhy…) : éclairage enregistré dans le clavier ; souris à puce **CompX** (VXE, ATK, MCHOSE…) sur la page souris (**expérimental**) | ✅ |
| 0.7 | Passerelle **OpenRGB** : si OpenRGB tourne (serveur SDK), couleur unie sur tous ses appareils ou appareil par appareil | ✅ |
| 0.8 | Identité visuelle « Orbit » : logo, dégradé iris → cyan, thèmes clair et sombre accordés, animations ; README illustré | ✅ |
| 0.9 | Interface en **anglais** (choix de la langue dans Options, anglais par défaut hors Windows en français) ; signature de l'installeur prête (SignPath Foundation) | ✅ |
| 0.10 | Souris de ~50 marques via **OpenMouse** ; base de 1 400+ appareils nommés avec leur niveau de prise en charge | ✅ |
| 0.11 | Claviers **Wooting** et **SteelSeries Apex Pro** (point d'activation, rapid trigger) via OpenMouse ; 108 casques reconnus (HeadsetControl) | ✅ |
| 0.12 | Éclairage des casques **Razer Kraken** filaires (OpenRazer) ; durcissements de sécurité (outils Windows appelés par chemin absolu, DLL THX verrouillée pendant sa vérification, clés FIDO jamais accessibles) ; paquet Microsoft Store (MSIX) | ✅ |
| 0.13 | **Plus jamais de blocage** : un périphérique USB qui ne répond pas à Windows ne fige plus l'appli ni l'analyse (délais partout, message clair) ; souris **SteelSeries Rival 3** corrigée (bonne interface USB) ; éclairage des claviers **SteelSeries Apex 3 / 3 TKL** ; claviers magnétiques **Keychron HE** (169 modèles) ; bouton **Signaler** qui ouvre un ticket GitHub prérempli avec le diagnostic | ✅ |
| 0.14 | **Mises à jour intégrées** : PeriphHub propose les nouvelles versions et s'installe en un clic (signées, vérifiées, désactivables) | ✅ |
| 0.15 | Bouton **Signaler un problème** sur l'accueil (diagnostic de tout le PC, y compris le module casques) ; l'accueil indique quand les appareils détectés sont listés plus bas | ✅ |
| 0.16 | DPI des souris **Logitech récentes** (commande 0x2202 : PRO X **Superlight 2** et suivantes), d'après Solaar | ✅ |
| 0.17 | Liste des périphériques lue dans le **Plug and Play** de Windows (plus jamais vide à cause d'un appareil muet) ; son, webcams et manettes réglables avec les réglages de Windows | ✅ |
| 0.18 | Mise à jour intégrée qui s'installe du premier coup | ✅ |
| 0.19 | Souris Logitech derrière un récepteur, onglets Son filtrés, rapport plus complet | ✅ |
| 0.20 | **Diagnostic sans compte GitHub** : envoi en un clic, ou automatique avec votre accord ; un appareil HID figé ne bloque plus les autres | ✅ |
| 0.21 – 0.22 | SteelSeries Apex 3 (couleurs par zone, effets) ; Turtle Beach Vulcan II TKL Pro et HyperX Cloud Alpha Wireless ; bouton « Lancer OpenRGB » | ✅ |
| **1.0** | **Fermer les logiciels constructeurs** : réglages Windows de toutes les souris et de tous les claviers, batteries Bluetooth et alerte de batterie faible, effets OpenRGB ; PeriphHub en arrière-plan (près de l'horloge, démarrage avec Windows) ; plus aucun blocage ; aucun programme en ligne de commande lancé en arrière-plan (antivirus) ; diagnostics complets du premier coup | ✅ |

Détail de chaque version : [CHANGELOG.md](CHANGELOG.md). Suite : [feuille de route](docs/ROADMAP.md).

## Installer

Téléchargez `PeriphHub_x.y.z_x64-setup.exe` dans les
[Releases](https://github.com/Sharkytihno/PeriphHub/releases). L'installation se fait pour votre
compte seul et ne demande pas de droits administrateur. Windows 10 (version 2004 ou plus récente)
et Windows 11.

**Mises à jour** : une fois installé, PeriphHub propose lui-même les nouvelles versions (bandeau
« Mettre à jour » sur l'accueil, installation en un clic, réglages conservés). Il vérifie sur GitHub
au lancement puis toutes les 6 heures ; chaque mise à jour est signée et vérifiée avant installation.
Désactivable dans **Options ▸ Mises à jour**. La version du Microsoft Store est mise à jour par le Store.

**Arrière-plan** : fenêtre fermée, PeriphHub peut rester près de l'horloge, démarrer avec Windows et
renvoyer vos réglages aux appareils qui les oublient (casque rallumé, sortie de veille). Désactivé par
défaut : **Options ▸ Arrière-plan**.

L'interface est en français ou en anglais (*English available*) : choix dans **Options ▸ Langue**.

> **L'installeur n'est pas encore signé.** Windows peut afficher « Windows a protégé votre
> ordinateur » : cliquez sur **Informations complémentaires** puis **Exécuter quand même**. Si le
> Contrôle intelligent des applications (Smart App Control) est activé, Windows 11 le bloque.
> Signature et vérification d'un téléchargement : [docs/SIGNATURE.md](docs/SIGNATURE.md).

**Antivirus** : PeriphHub ne lance aucun programme en ligne de commande en arrière-plan, n'a ni hook
clavier ni pilote noyau, et n'est ni compressé ni obscurci. Ce qu'il fait, ce qu'il s'interdit et que
faire en cas de faux positif : [docs/SECURITE.md](docs/SECURITE.md).

## Votre appareil ou votre logiciel n'est pas reconnu ?

C'est normal au début, et c'est comme ça que la liste grandit :

1. Dans PeriphHub, cliquez sur **Envoyer le diagnostic** (accueil) ou **Signaler** (sur l'appareil) :
   il part sans compte GitHub, et vous lisez avant l'envoi exactement ce qu'il contient
   ([docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md)).
2. Ou bien **Copier le diagnostic**, puis ouvrir un
   [ticket « Appareil ou logiciel non reconnu »](https://github.com/Sharkytihno/PeriphHub/issues/new/choose)
   et le coller.

Les données sont dans de simples fichiers JSON :
[`data/vendors.json`](data/vendors.json) (logiciels constructeurs),
[`data/devices.json`](data/devices.json) (appareils pris en charge),
[`data/usb-vendors.json`](data/usb-vendors.json) (fabricants USB). Voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Ce que PeriphHub ne fera jamais

- **Flasher un firmware.** Les mises à jour passent par les outils officiels des fabricants.
- **Toucher aux anti-triche** (Vanguard, FACEIT, EasyAntiCheat…) ni à la sécurité de Windows, ni installer de pilote noyau.
- **Espionner** : aucun hook clavier ou souris global, aucune injection dans d'autres programmes, aucune télémétrie.
- **Envoyer des données** sans action explicite de votre part (la vérification des mises à jour ne
  fait que lire un fichier public sur GitHub, et se désactive dans les Options). Le diagnostic d'un
  appareil qui ne se connecte pas ne part que sur clic, ou si vous avez accepté l'envoi automatique
  (voir [docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md)).

## Compiler

Prérequis : [Rust](https://rustup.rs), Node.js 20+, Visual Studio Build Tools (C++), WebView2 (déjà présent sur Windows 10/11).

```bash
npm install
powershell -File scripts/fetch-headsetcontrol.ps1   # module casques, empreinte vérifiée
npm run dev        # lancement en développement
npm test           # pilotes contre des appareils simulés, relais des diagnostics
npm run build      # installeur dans src-tauri/target/release/bundle/nsis/
```

Analyse en ligne de commande, sans fenêtre :

```bash
src-tauri/target/release/periphhub.exe --scan
```

## Licence

[GPL-3.0-or-later](LICENSE). PeriphHub s'appuie sur le travail de la communauté
(OpenRGB, OpenRazer, Solaar, libratbag, HeadsetControl, OpenMouse…) — détail dans [THIRD_PARTY.md](THIRD_PARTY.md) — et en restera un logiciel libre.

Les noms et marques cités appartiennent à leurs propriétaires. PeriphHub n'est affilié à aucun fabricant.
