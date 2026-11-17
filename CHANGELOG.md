# Nouveautés de PeriphHub

Chaque section `## x.y.z` sert aussi de notes à la Release GitHub de cette version
(`.github/workflows/release.yml`).

## 2.0.0

*In English: battery levels on the taskbar. Next to the clock, “🖱 93 %  🎧 30 %” for every wireless
device PeriphHub knows: red at 15% or less, a bolt while charging, dimmed while asleep. Click opens
PeriphHub, right-click refreshes or hides it. Vertical taskbar, or by choice: one tray icon per
device with the level drawn in it. Options: show or hide each device, background plate for
transparent taskbars. Every battery is now read each minute, window open or not, and right after a
device is plugged in or the PC wakes up; a device that sleeps or leaves keeps its last level, dimmed,
for 30 minutes. Battery level (read-only) for many new devices: JBL Quantum, Jabra (Link 380/390),
ROG Pelta, Razer BlackShark V3 / V3 X / V2 Pro 2023 and Barracuda X, Arctis Nova Pro (225D), Logitech
G435 (0ADF), Fractal Scape, MOONDROP GM01 Pro, Rapoo VT, ASUS ROG mice and keyboards, MCHOSE, Sprime,
RK MG6 Pro, Redragon (Areson), HECATE, SONiX 2.4 GHz keyboards, Steam and Flydigi controllers.
Xbox controllers to the percent (Windows.Gaming.Input), AirPods / Beats (each bud and the case, from
their Bluetooth broadcast), Galaxy Buds, a phone linked with Phone Link, standard HID battery for any
brand, HeadsetControl 4.3.0. Technique and protocols adapted from WirelessBattery (GPL-3.0).*

- **Batteries dans la barre des tâches** : à côté de l'horloge, « 🖱 93 %  🎧 30 % » pour chaque
  appareil sans fil connu de PeriphHub. Rouge à 15 % ou moins, éclair bleu en charge, grisé en
  veille ; suit le thème clair ou sombre de la barre et la mise à l'échelle de l'écran. Clic :
  ouvrir PeriphHub ; clic droit : actualiser les batteries ou ne plus afficher. Infobulle avec le
  nom de chaque appareil.
- **Icônes de notification** à la place (barre des tâches verticale, ou au choix) : une par appareil,
  avec le niveau dessiné dedans et une jauge.
- Réglages (Options) : barre des tâches, icônes ou rien ; appareils affichés un par un ; fond
  derrière le texte pour les barres rendues transparentes (Windhawk, TranslucentTB…).
- **Batteries relues chaque minute**, fenêtre ouverte ou non, et aussitôt après un branchement ou la
  sortie de veille de l'ordinateur. La souris Scyrox principale n'était lue qu'à la connexion.
- **Appareil en veille ou parti** (éteint, hors de portée du récepteur) : sa dernière valeur reste
  affichée, grisée, pendant 30 minutes, même après un redémarrage de PeriphHub ; pas d'alerte de
  batterie faible sur une valeur ancienne. Un appareil vu à la fois en Bluetooth et par le pilote de
  sa marque n'apparaît qu'une fois.
- **Batterie de nouveaux appareils** (lecture seule : rien n'est réglé sur l'appareil) : casques JBL
  Quantum 520 / 650 / 850 / 950 (et X), Jabra derrière un dongle Link 380 / 390, ROG Pelta, Razer
  BlackShark V3 / V3 Pro / V3 X / V2 Pro (2023) et Barracuda X (2022), SteelSeries Arctis Nova Pro
  Wireless (dongle 225D), Logitech G435 (dongle 0ADF), Fractal Scape, MOONDROP GM01 Pro ; souris Rapoo
  VT (VT0 à VT9, VT1 Pro Max, VT3 Pro), ASUS ROG (Chakram, Gladius, Keris, Harpe, Pugio, Spatha, Strix),
  MCHOSE (L7, M7, A7, K7, G3 V2), Sprime PM1, RK MG6 Pro, Redragon M913 / M915 (récepteurs Areson),
  HECATE ; claviers ROG (Azoth, Falchion, Strix Scope) et SONiX en 2,4 GHz (AJAZZ AK820 MAX, AK980 V2,
  AULA F108 Pro) ; manettes Steam et Flydigi Vader 5 Pro. Pas encore confirmés sur le matériel.
- **Manettes Xbox au pour cent près** (Windows.Gaming.Input) au lieu des quatre paliers de XInput,
  avec le nom donné par Windows ; aussi les manettes GameSir en mode Xbox.
- **AirPods et Beats** : batterie de chaque écouteur et du boîtier, lue dans le message Bluetooth
  qu'ils diffusent pour l'iPhone (Windows ne la lit pas). Rien ne leur est envoyé.
- **Samsung Galaxy Buds** (Buds à Buds3) : écouteurs gauche, droit et boîtier, lus dans la trame
  d'état qu'ils envoient à l'ouverture de leur liaison, au plus toutes les 2 minutes.
- **Téléphone relié par Phone Link** (Lien avec Windows) : sa batterie, telle qu'affichée dans le menu
  Démarrer, sans accès au téléphone.
- **Batterie HID standard, toutes marques** : un appareil qu'aucun pilote PeriphHub ne prend mais
  qui déclare un niveau de batterie normalisé apparaît avec lui (tablettes à stylet exclues).
- Module casques : **HeadsetControl 4.3.0** (HyperX Cloud Alpha 2 Wireless et Cloud Alpha S, Sony
  PULSE 3D, Razer BlackShark V2 Pro PlayStation, Logitech G PRO X 3 LIGHTSPEED, MCHOSE V9 Pro,
  fifine HT6, Sennheiser GSP370 ; Arctis 7 corrigé sous Windows). Signature du mainteneur vérifiée.
- Technique et protocoles repris du projet libre WirelessBattery (krisgfx9, GPL-3.0), réécrits pour
  PeriphHub.

## 1.9.0

*In English: VGN mice on VGN's own USB ID (0x391D): Dragonfly 3 Master and MasterGT, Dragonfly Y2 V2
MasterGT, Dragonfly F2 MasterGT, Turbo and Turbo+, Dragonfly F1 V2 SE+, Dragonfly 3 MINI SE+, wired
and with their receiver. Same CompX protocol as the models already supported, read from VGN's web
configurator; not yet tested on hardware (“Experimental” until confirmed).*

- **Souris VGN** sur l'identifiant USB propre à VGN (0x391D) : Dragonfly 3 Master et MasterGT,
  Dragonfly Y2 V2 MasterGT, Dragonfly F2 MasterGT, Turbo et Turbo+, Dragonfly F1 V2 SE+, Dragonfly 3
  MINI SE+, en filaire et avec leur récepteur. Le logiciel web de VGN les règle avec le même
  protocole CompX que les souris déjà prises en charge (Scyrox, Attack Shark V8) ; la disposition
  des paliers DPI est lue dans la souris, jamais supposée. Pas encore essayé sur le vrai matériel :
  « Expérimental » jusqu'à la première confirmation (« Tester cet appareil » suffit).

## 1.8.0

*In English: “Test this device”. One button on each device page changes every supported setting,
reads it back from the device, then puts the current value back, and shows what works. Failures
offer to send the diagnostics; with confirmations on, results reach the developer directly.*

- **Tester cet appareil** : un bouton sur la page de chaque appareil change un à un les réglages
  reconnus (DPI, fréquence, distance de levée, interrupteurs, éclairage…), vérifie que l'appareil a
  bien pris la nouvelle valeur, puis remet la valeur actuelle. Le résultat s'affiche réglage par
  réglage ; en cas d'échec, PeriphHub propose d'envoyer le diagnostic. Plus besoin de demander
  « change le DPI, ça marche ? » : avec les confirmations activées, le résultat arrive tout seul.
- Ne touche jamais aux boutons, macros, profils ni au firmware, ni aux réglages touche par touche
  des claviers magnétiques ; l'état d'origine est gardé avant le test, comme pour un réglage à la main.

## 1.7.0

*In English: opt-in confirmations. When a setting works (or fails) on a device, PeriphHub can tell
the developer — asked once, off until you say yes, Options ▸ Confirmations. Models confirmed by users
show a “Confirmed” badge instead of “Experimental”. Only the model, driver and setting names are sent.*

- **Confirmations** : quand un réglage vient de marcher sur un appareil, PeriphHub demande une fois
  s'il peut prévenir le développeur. Si vous acceptez, le modèle passe d'« Expérimental » à
  « Confirmé » pour tout le monde, sans aller-retour avec les testeurs. Seuls partent le modèle
  (identifiant USB et nom), le pilote et le nom des réglages essayés, avec leur résultat : ni valeur
  choisie, ni numéro de série, ni information personnelle. Modifiable dans **Options ▸
  Confirmations** ; politique de confidentialité mise à jour.
- Pastille **« Confirmé »** sur les modèles déjà confirmés par des utilisateurs.

## 1.6.0

*In English: manual diagnostics now include a read-only probe of the faulty device (CompX mice:
their whole settings memory; any device: its vendor feature reports), so a single diagnostic is
enough to add or fix its support. Never on automatic sends.*

- **Diagnostic plus complet, pour corriger du premier coup** : quand un appareil n'a pas de pilote
  ou que son pilote échoue, « Envoyer le diagnostic » (et « Copier le diagnostic ») ajoute une
  lecture de l'appareil, **sans rien y écrire** :
  - souris CompX (Scyrox, Lamzu, Pulsar, Attack Shark…) : toute leur mémoire de réglages, comme la
    lit le logiciel du fabricant ;
  - tout appareil à interface constructeur : ses rapports « fonction ».
  Cela peut prendre quelques secondes. Jamais lors d'un envoi automatique, et le texte reste
  visible avant l'envoi (« Voir exactement ce qui sera envoyé »). Politique de confidentialité
  mise à jour en conséquence.

## 1.5.3

*In English: Attack Shark V8 mice (and other mice sold with the same CompX 8K dongle as the Scyrox
V8S) no longer fail with "corrupt DPI stage": PeriphHub now finds where the mouse keeps its DPI
presets.*

- **Souris Attack Shark V8** (dongle 8K 3554:F517, le même que la Scyrox V8S) : la page de la souris
  échouait avec « corrupt DPI stage ». Ce dongle sert à plusieurs marques et la V8 ne range pas ses
  paliers DPI au même endroit que la Scyrox : PeriphHub vérifie maintenant les deux emplacements et
  garde celui dont la somme de contrôle est bonne. Sur une souris autre que Scyrox, les réglages
  propres à la Scyrox (mode 20K, hauteurs de décollage du capteur 3955, angle) sont masqués et le DPI
  est plafonné à 26 000.

## 1.5.2

*In English: new driver for Rongyuan-based keyboards (Attack Shark X68HE and about 960 other models,
most Hall Effect keyboards sold with the qmk.top web driver): polling rate up to 8 kHz, lighting
effects, actuation point and Rapid Trigger.*

- **Claviers Rongyuan** (Attack Shark X68HE, et environ 960 autres modèles de Cherry, Womier, Ajazz,
  Aula, Madlions… : la plupart des claviers magnétiques vendus avec le logiciel web qmk.top) : nouveau
  pilote, d’après le protocole de ce logiciel officiel.
  - Fréquence d’interrogation jusqu’à 8 kHz (selon le modèle et son firmware, mêmes règles que le
    logiciel du fabricant).
  - Éclairage : effets du clavier, luminosité, vitesse, sens, couleur ou arc-en-ciel.
  - Claviers magnétiques : point de déclenchement et Rapid Trigger (sensibilités à l’appui et au
    relâchement), sur toutes les touches à la fois.
  - Les réglages sont enregistrés par le clavier lui-même. Un modèle absent de la liste est reconnu,
    mais rien n’y est écrit.
  - Les trames envoyées ont été comparées octet par octet à celles du logiciel officiel. Ce pilote
    n’a pas encore été confirmé sur un vrai clavier : merci d’envoyer un diagnostic si quelque chose
    ne va pas.

## 1.5.1

*In English: Hall Effect keyboards no longer show up as mice (and no longer receive mouse commands),
the Windows permission buttons no longer promise a prompt when Windows shows none, sensors and
OpenRGB services update reliably, and the home page offers motherboard lighting when it needs it.*

- **Clavier pris pour une souris** (clavier à effet Hall X68HE et autres claviers Akko, MonsGeek… sur
  l’identifiant 0x3151) : le type d’un appareil vient maintenant de son interface principale, et les
  protocoles de souris d’OpenMouse ne sont plus jamais essayés sur un clavier de ce fabricant (ils lui
  envoyaient des réglages de DPI et de fréquence).
- **Autorisation Windows** : quand Windows ne montre pas de fenêtre (contrôle de compte réglé sur
  « Ne jamais m’avertir », coupé, ou PeriphHub lancé en administrateur), les boutons ne parlent plus
  de fenêtre à valider. Sinon, la fenêtre s’ouvre devant PeriphHub au lieu de clignoter dans la barre
  des tâches. Le diagnostic indique le réglage.
- **Mise à jour des services** (capteurs, OpenRGB) : la copie attend que l’ancienne version libère ses
  fichiers, au lieu d’échouer et de garder l’ancien module (sondes et ventilateurs de la carte mère
  absents).
- **Éclairage de la carte mère** (ASRock, ASUS, MSI…) : l’accueil propose de l’activer quand rien
  d’autre ne le pilote ; il passe ensuite dans l’onglet Éclairage avec les ventilateurs et bandeaux
  branchés dessus.
- Souris sur un identifiant USB partagé (Attack Shark sur le dongle 3554:F517) : si OpenMouse lit des
  données incohérentes, la page CompX de PeriphHub prend le relais.

## 1.5.0

*In English: control your fans from the Temperatures page (automatic, fixed speed or a curve you
drag with the mouse) on desktop motherboards, graphics cards and ASUS laptops, with a 100 % safety
when things get too hot; and a one-click “Send PC diagnostics” button on the home page.*

- **Ventilateurs** (page Températures) : pour chaque ventilateur, **Automatique** (courbe de la carte
  mère ou de la carte graphique), **Vitesse fixe** ou **Courbe** selon la température de votre choix
  (processeur, carte graphique, sondes de la carte mère). La courbe se modifie en glissant ses points à
  la souris ou avec les flèches du clavier ; préréglages Silencieux, Équilibré, Performance.
- **Portables ASUS** (TUF, ROG, Vivobook…) : profils Silencieux / Équilibré / Turbo comme dans Armoury
  Crate, et une courbe par ventilateur (processeur, carte graphique) tenue par le portable lui-même.
- **Sécurité** : jamais moins de 20 % pour le ventilateur du processeur ou une pompe, et 100 % sur tous
  les ventilateurs réglés ici dès que le processeur dépasse 90 °C ou la carte graphique 85 °C.
- **Réglages gardés** : ils tiennent PeriphHub fermé et après un redémarrage (le service des capteurs
  démarre alors avec Windows) ; « Tout remettre en automatique » rend la main à la carte mère.
  Le module capteurs doit être mis à jour une fois (une validation Windows, bouton sur la page).
- **Diagnostic du PC en un clic** : nouveau bloc en bas de l’accueil, « Envoyer le diagnostic du PC »
  part sans rien écrire ni choisir d’appareil (appareils, capteurs, ventilateurs, réglages de Windows).
  « Signaler un problème… » garde le message et l’appareil concerné.
- Casque piloté par HeadsetControl (Arctis Nova 5…) : plus de faux « aucun pilote ne correspond » dans le
  diagnostic.

## 1.4.0

*In English: a new version now shows up the moment PeriphHub opens (banner on every page, update
window, tray menu entry), and every button that makes you wait shows a spinner.*

- **Mises à jour visibles tout de suite** : plus besoin d’attendre plusieurs secondes sur l’accueil.
  La vérification part dès le lancement, la dernière version trouvée s’affiche immédiatement au
  démarrage suivant, et une fenêtre « Une mise à jour est disponible » s’ouvre avec les nouveautés.
- **Bandeau sur toutes les pages** tant que la mise à jour n’est pas installée, avec la progression
  du téléchargement.
- **Fenêtre fermée** : entrée « Installer PeriphHub x.y.z » dans le menu de l’icône près de l’horloge
  (elle ouvre PeriphHub et lance l’installation). Vérification toutes les heures et à chaque ouverture.
- **Chargements partout** : un bouton qui fait patienter affiche un cercle qui tourne à la place de
  son texte, un interrupteur fait tourner sa pastille, et une fine barre défile en haut de la fenêtre.
  Un second clic pendant l’action est ignoré (plus d’action lancée deux fois).

## 1.3.0

*In English: keyboard and screen-reader access (switches, dialogs, current page), better contrast,
F5 rescans instead of reloading, temperature readings stop while the window is hidden, and several
reliability and privacy fixes.*

- **Utilisable au clavier** : les interrupteurs se règlent avec Tab et Espace (ils étaient hors d’atteinte),
  les fenêtres gardent le focus, annoncent leur titre et le rendent à la fermeture, la page en cours et
  le choix en cours sont annoncés aux lecteurs d’écran.
- **Plus lisible** : texte des boutons, sous-titres du menu et pastille de l’allègement mieux contrastés ;
  une température élevée est écrite (« Chaud », « Très chaud »), plus seulement colorée ; contours visibles
  avec les thèmes de contraste de Windows.
- **Une appli, pas une page web** : F5 et Ctrl+R relancent l’analyse au lieu de recharger toute
  l’interface ; plus d’impression, de recherche ni de menu « Enregistrer sous » du navigateur. Le clic
  droit reste sur les champs de saisie et le texte sélectionné.
- **Températures** : plus aucune lecture quand la fenêtre est fermée (PeriphHub près de l’horloge) avec
  cette page restée ouverte. Le service des capteurs ne s’arrêtait alors jamais.
- **Annuler l’allègement** ne reste plus bloqué sur « remis en partie » quand le logiciel a retiré de
  lui-même un de ses lancements automatiques (désinstallation, mise à jour).
- Menu réduit aux icônes (fenêtre étroite) : chaque bouton dit son nom au survol. Notifications : un clic
  les ferme. Type d’appareil écrit en clair (« éclairage », plus « rgb »).
- Plus léger : l’état d’OpenRGB n’est plus relu à chaque affichage de l’accueil, et l’empreinte des
  services n’est recalculée que si leur fichier a changé.
- Diagnostics envoyés : un nom de session Windows en deux mots (« Jean Dupont ») est retiré en entier
  par le relais ; la limite d’envois ne peut plus être contournée avec une fausse adresse.
- Sécurité de la fabrication : actions GitHub épinglées à une empreinte, jeton de la CI en lecture seule,
  règles de contenu de l’interface resserrées.

## 1.2.1

*In English: live power draw on the Temperatures page. CPU and graphics card wattage, their total and
peak, plus an estimate of the whole PC at the wall. No new Windows prompt needed.*

- **Consommation en direct** sur la page Températures : watts du processeur et de la carte graphique,
  leur total, le pic depuis l’ouverture de l’appli, et une estimation du PC entier à la prise (carte mère,
  mémoire, disques et ventilateurs n’ont pas de capteur de consommation). Chaque composant affiche aussi
  ses watts sous sa température, et le total apparaît dans le menu à gauche.
- Rien à réinstaller : le service des capteurs mesurait déjà ces valeurs.
- Diagnostic : capteurs de consommation trouvés et celui retenu pour chaque composant.

## 1.2.0

*In English: a new Temperatures page. CPU, motherboard sensors and fans, graphics cards and drives, live.
Windows only lets administrators read these sensors, so PeriphHub installs, after one Windows prompt, a
small read-only service (LibreHardwareMonitor and the signed PawnIO driver). It only runs while the page
is open and stops on its own afterwards. The diagnostic now also names the motherboard, CPU, graphics cards
and the sensor chips that were found.*

- **Nouvelle page Températures** : processeur, sondes et ventilateurs de la carte mère, carte graphique
  (puce, point chaud, mémoire, ventilateur, consommation), partie graphique du processeur et disques,
  relus toutes les 2 secondes, en couleur selon le niveau.
- **Une seule validation Windows**, une fois pour toutes : Windows réserve ces capteurs aux
  administrateurs. PeriphHub installe un petit service en lecture seule (LibreHardwareMonitor, des
  centaines de cartes mères reconnues, et le pilote signé PawnIO, déjà utilisé pour l’éclairage). Il ne
  démarre que quand la page est ouverte et s’arrête tout seul 3 minutes après : aucune mémoire prise le
  reste du temps. Il ne touche à aucun réglage. « Retirer l’accès aux capteurs » le supprime.
- **Diagnostic** : modèle de carte mère, BIOS, processeur, cartes graphiques et puces de capteurs trouvées.
- Casque piloté par HeadsetControl (Arctis Nova 5…) : plus de faux « aucun pilote ne correspond » dans
  le diagnostic.

## 1.1.0

*In English: a simpler, cleaner look. Plain colours instead of gradients, no more greeting on the home
page, a one-line summary of your PC with a single “Slim down my PC” button, slimming explained in three
steps, a progress bar while it works and an animated check mark when it is done.*

- **Nouveau look**, plus simple et plus net : couleurs unies (plus de dégradés violet-bleu ni de halos),
  cartes plus grandes et arrondies, boutons plus lisibles, en clair comme en sombre.
- **Accueil** : plus de « Bonjour / Bonsoir ». L’état du PC tient en une phrase, avec un seul bouton
  « Alléger mon PC ». Les appareils pas encore réglables sont regroupés dans une liste repliable, et
  « Signaler un problème » est rangé en bas.
- **Allègement expliqué en trois cases** : le problème, ce que fait PeriphHub, et pourquoi c’est sans risque.
- **Fenêtre d’allègement simplifiée** : une phrase pour dire ce qui va se passer, le détail des
  changements replié, une barre de progression par étapes pendant l’opération, puis une coche animée et
  la mémoire libérée qui défile.
- Barre de chargement en haut de la fenêtre pendant chaque analyse.

## 1.0.10

*In English: Ranked keyboards (Nova 60 %, including the Supernova, Master 65 %, Guardian 65 %) are now
recognised and their lighting can be set from PeriphHub (effect, brightness, speed, color), without
Ranked Utility. Experimental: the protocol was read from the official software and only lighting is written.*

- **Claviers Ranked** (Nova 60 %, dont le Supernova, toutes dispositions ; Master 65 % ; Guardian 65 %) :
  reconnus et réglables sans Ranked Utility. Effet d’éclairage (19 sur Nova et Master), luminosité,
  vitesse et couleur (8 couleurs ou multicolore, selon l’effet). Le clavier garde le réglage en mémoire.
- Protocole relevé dans le logiciel d’origine : seul l’éclairage est écrit, jamais le firmware, les
  touches ni les macros. Expérimental tant qu’il n’a pas été confirmé sur chaque modèle.
- Sur le Guardian, seuls « Éteint » et « Fixe » ont un nom : les autres effets sont numérotés.

## 1.0.9

*In English: headsets, microphones and speakers plugged into a motherboard audio jack now get their own
page as soon as they are in use (volume, mic level, balance, default device, quality, which jack is in
use), and every microphone gains mic monitoring (“Listen to this device”) and, when the sound card has
one, microphone boost.*

- **Casques en prise jack** : un casque, un micro ou des enceintes branchés en jack sur la carte mère
  (Realtek…) ont maintenant leur onglet dès qu'ils servent (sortie ou micro par défaut, micro branché).
  Jusqu'ici, ce son était masqué avec les puces intégrées. La page indique sur quelle prise l'appareil
  est branché (avant / arrière, couleur). Un casque en jack n'envoie rien au PC : seuls les réglages de
  la prise sont possibles (volume, micro, balance, sortie par défaut, qualité), pas ceux propres au
  casque (égaliseur, son spatial), qui restent dans le logiciel de sa marque.
- **Retour micro** sur tous les micros (USB, Bluetooth, jack) : « S'entendre dans le casque », comme
  « Écouter ce périphérique » de Windows.
- **Amplification du micro** (+10, +20, +30 dB…) quand la carte son en a une, comme dans l'onglet
  Niveaux de Windows : utile pour les micros de casque en jack, souvent faibles.
- Le diagnostic liste aussi le son (sorties, micros, prises jack), pour voir pourquoi un casque n'a pas
  d'onglet.

## 1.0.8

*In English: NZXT Kraken Z, 2023 and 2024 (Elite, Plus) liquid coolers get their own page (liquid
temperature, pump and fan speeds, speed profiles, screen brightness), and coolers or LED controllers are
no longer listed as headsets or game controllers.*

- **Watercoolings NZXT Kraken Z, 2023 et 2024 (Elite, Plus)** : nouvelle page « Watercooling », avec en
  direct la température du liquide et la vitesse de la pompe et des ventilateurs, des profils
  Silencieux / Équilibré / Performance (toujours à 100 % dès 45 °C de liquide) et la luminosité de
  l'écran. Protocole du logiciel libre liquidctl, encore expérimental. L'éclairage reste dans l'onglet
  Éclairage (OpenRGB).
- **Appareils mal rangés** : les watercoolings NZXT « Kraken » apparaissaient comme des casques, et les
  contrôleurs LED et ventilateurs (NZXT, Dell, SRGBmods…) comme des manettes. Ils sont maintenant rangés
  avec l'éclairage ou le refroidissement.

## 1.0.7

*In English: choosing a lighting effect (Static, Breathing, Color Cycle…) for a device driven through
OpenRGB now really applies it; before, OpenRGB silently kept "Direct".*

- **Effets d'éclairage (OpenRGB)** : choisir « Statique », « Respiration », « Cycle de couleurs »… sur
  la carte mère ou un autre appareil passant par OpenRGB n'avait aucun effet : OpenRGB refusait l'effet
  sans le dire (PeriphHub lui parlait dans une version trop ancienne de son protocole, sans la
  luminosité) et l'appareil restait sur « Direct », malgré le message de réussite. L'effet choisi est
  maintenant appliqué, et un effet vraiment refusé affiche une erreur au lieu d'un faux succès.

## 1.0.6

*In English: fans and strips plugged into the motherboard light up (set how many LEDs each ARGB header
has), a mouse or keyboard that is detected but not connected stays in the sidebar, and a device briefly
held by another program comes back by itself.*

- **Ventilateurs et bandeaux branchés sur la carte mère** : OpenRGB ne peut pas compter les LED d'une
  prise ARGB (JRAINBOW chez MSI, D_LED/ARGB chez Gigabyte, ADD_GEN chez ASUS…) et la laissait à 0 : rien
  ne s'allumait, la carte mère semblait ne pas réagir. Onglet Éclairage ▸ la carte mère ▸ « Prise … :
  nombre de LED » (souvent 8 à 12 par ventilateur, additionnez ceux en chaîne). OpenRGB garde la taille,
  même après un redémarrage, et l'éclairage est renvoyé aussitôt sur toutes les LED.
- **Souris (ou clavier, casque) détectée mais pas connectée** : elle reste dans « Mes appareils », avec un
  point orange, au lieu de disparaître ; le clic mène à sa fiche (pourquoi, que faire, Signaler).
- **Appareil occupé un moment par un autre logiciel** (OpenRGB qui démarre ou se met à jour…) : il était
  écarté jusqu'au débranchement. Il revient maintenant tout seul dès que Windows répond à nouveau.
- Diagnostic : les zones de chaque appareil OpenRGB et leur taille.

## 1.0.5

*In English: OpenRGB no longer takes over the keyboards, mice and headsets PeriphHub drives itself
(they stopped responding or disappeared), lighting commands no longer time out or lag, "All devices"
sets every device in one go, and the "Memory and motherboard" button is shown where it is needed.*

- **Clavier, souris et casque à nouveau pilotés par PeriphHub** quand OpenRGB tourne. OpenRGB ouvrait
  aussi les appareils que PeriphHub sait régler lui-même (SteelSeries Apex 3, Rival 3, Logitech,
  Corsair…) et les gardait : le clavier apparaissait puis disparaissait, la souris refusait les réglages
  et HeadsetControl ne répondait plus. OpenRGB laisse désormais ces appareils-là à PeriphHub ; il garde
  la mémoire, la carte mère, la carte graphique, les ventilateurs et tout ce que PeriphHub ne pilote pas.
  Service « Mémoire et carte mère » déjà activé : « Mettre à jour » (une validation Windows).
- **Éclairage sans latence ni délai dépassé** : OpenRGB 1.1 laissait parfois une commande en attente
  jusqu'à la suivante (la couleur arrivait au clic d'après, ou « délai dépassé »). PeriphHub le relance
  quand il tarde, et attend qu'une couleur soit appliquée avant d'envoyer la suivante. Clics rapides :
  seule la dernière couleur part.
- **« Tous les appareils »** : une seule commande pour tous ; un appareil qui ne répond pas n'empêche plus
  les autres de changer, et l'erreur dit lequel.
- **Mémoire et carte mère** : le bouton « Activer » est en tête de l'onglet Éclairage et sur la page de la
  carte mère. Plus besoin de lancer PeriphHub en administrateur.
- Diagnostic : la liste des appareils vus par OpenRGB (nom, LED, effet), l'état du service et de PawnIO.

## 1.0.4

*In English: OpenRGB now ships with PeriphHub and starts by itself — motherboard, fan and other
lighting works with nothing to download or install. Memory (RAM) lighting takes a single Windows
permission, once.*

- **OpenRGB est livré avec PeriphHub** (version 1.1, officielle et non modifiée) : plus rien à
  télécharger ni à installer. Quand le PC a un appareil que seul OpenRGB sait piloter (carte mère,
  ventilateurs branchés dessus, carte graphique…), PeriphHub le lance tout seul, sans fenêtre ni icône,
  et l'arrête en se fermant. Un OpenRGB que vous avez installé et ouvert vous-même n'est jamais touché.
- **Mémoire (RAM) et puces protégées de la carte mère** : Windows exige les droits administrateur.
  Onglet Éclairage ou Options ▸ « Mémoire et carte mère » ▸ **Activer** : une seule validation Windows,
  une fois pour toutes. PeriphHub installe le pilote PawnIO (signé) et fait tourner OpenRGB comme
  service Windows ; ensuite, plus rien à faire, même après un redémarrage. « Retirer » l'enlève, et la
  désinstallation de PeriphHub aussi.
- Chaque fichier d'OpenRGB est vérifié avant chaque lancement : rien n'est lancé s'il a été modifié.

## 1.0.3

*In English: lighting for the SteelSeries Rival 3 mouse, and SteelSeries headsets are no longer
retried as mice every few minutes.*

- **SteelSeries Rival 3** (1re génération) : éclairage réglable dans PeriphHub (fixe, par zone — bande
  haut, milieu, bas et logo —, respiration, cycle de couleurs, éteint) avec la luminosité. Rien n'est
  enregistré dans la souris : PeriphHub renvoie l'éclairage choisi à chaque branchement. « Celui de la
  souris » puis débrancher et rebrancher la souris rend son éclairage d'origine. Fermez SteelSeries GG.
- Les casques SteelSeries (Arctis Nova…) ne sont plus pris pour des souris : ils ne sont plus marqués
  « muets » ni réessayés toutes les quelques minutes.

## 1.0.2

*In English: the version number is shown under the PeriphHub name, and switching the interface
language no longer re-runs the PC scan.*

- La version de PeriphHub s'affiche sous son nom, en haut de la barre latérale.
- Changer la langue de l'interface (Options ▸ Langue) ne relance plus l'analyse du PC : l'interface se
  recharge dans la nouvelle langue avec le résultat de l'analyse qui venait d'être faite.

## 1.0.0

*In English: settings for every mouse and keyboard (Windows settings, any brand), Bluetooth battery
levels, low-battery notifications, full OpenRGB effects, background mode next to the clock with
start with Windows, no more freezes when a device stops answering, no more PowerShell or command-line
tools run in the background (antivirus-friendly), and diagnostics complete enough to fix a problem
from a single report.*

### Pour tous les appareils, même sans pilote de la marque

- **Souris et clavier** (nouvelle page, toutes marques) : les réglages de Windows réunis au même
  endroit. Vitesse du pointeur, précision (accélération), boutons inversés, double-clic, molette
  (lignes par cran, un écran à la fois, défilement horizontal), délai et vitesse de répétition du clavier.
- **Batteries Bluetooth** : casques, souris, claviers et manettes, telles que les affiche Windows.
  Rattachées à la page de l'appareil quand elle existe, sinon sur une page à part.
- **Alerte de batterie faible** : notification de Windows à 15 %, une seule fois jusqu'à la recharge
  (Options ▸ Batterie faible). PeriphHub signale si les notifications sont coupées dans Windows.
- **OpenRGB** : les effets de chaque appareil (respiration, vague, arc-en-ciel…) avec leur vitesse,
  leur sens et leurs couleurs. « Enregistrer dans l'appareil » garde l'effet sans PeriphHub ni OpenRGB.
- **Icône près de l'horloge** : son infobulle donne la batterie de chaque appareil.
- **Son** : la sortie stéréo et le mode mains libres d'un même casque Bluetooth ne font plus qu'un appareil.

### PeriphHub en arrière-plan

- Fenêtre fermée, PeriphHub peut rester près de l'horloge et **démarrer avec Windows** (option,
  désactivée par défaut). Il renvoie alors les réglages aux appareils qui les oublient : casque
  rallumé, appareil rebranché, sortie de veille. La première fermeture demande ce que vous préférez.
- Une seule instance : relancer PeriphHub ramène la fenêtre déjà ouverte.
- Windows prévient PeriphHub des branchements et des sorties de veille. Plus de relecture de la
  liste toutes les 2 secondes.
- Sortie de veille : seuls les réglages qui ont changé sont renvoyés aux appareils, pour ne pas user
  leur mémoire pour rien.
- Une nouvelle version disponible, PeriphHub fenêtre fermée : une notification, une fois par version.

### Plus aucun blocage

- Un appareil qui ne répond plus ne bloque que lui-même. Chaque échange (lecture, écriture, feature
  report) a un délai jusque dans hidapi, chaque appareil a son propre verrou, et une interface dont
  Windows ne rend jamais la main est écartée. La fermeture d'un appareil ne se fait jamais sur le
  fil de la fenêtre.
- Une erreur interne dans un fil est rattrapée et notée (`erreurs.log`) au lieu de fermer PeriphHub.
- Planificateur de tâches figé, descripteur HID exotique : délai ou mise à l'écart, jamais de gel.

### Antivirus et sécurité

- **Plus aucun programme lancé en arrière-plan pour interroger Windows.** PowerShell, `sc.exe` et
  `schtasks.exe` sont remplacés par les API de Windows : WinVerifyTrust (signatures), Gestionnaire
  de services, Planificateur de tâches. Les antivirus surveillent de près les programmes qui en
  pilotent d'autres en ligne de commande.
- Aucune liste de noms d'antivirus dans le programme. Anti-triche et protections de Windows ne sont
  jamais touchés (nom **et** chemin vérifiés), processus vitaux de Windows jamais fermés.
- La désinstallation retire « Démarrer avec Windows » et le journal des erreurs.
- Modèle de sécurité, choix faits pour éviter les faux positifs, Windows 10 et 11, Smart App
  Control : [docs/SECURITE.md](https://github.com/Sharkytihno/PeriphHub/blob/master/docs/SECURITE.md).

### Diagnostics complets du premier coup

- **Fenêtre d'envoi** : l'appareil concerné, ce qui ne marche pas, et l'aperçu exact du texte qui part.
- Le diagnostic contient le système réel (Windows 10 ou 11, build, édition), WebView2, la version
  Store ou installeur, les droits, Smart App Control, l'arrière-plan et les erreurs internes récentes.
- Pour l'appareil en cause : ses derniers échanges avec PeriphHub et le bilan des échanges de chaque
  interface. Les descripteurs bruts de ses pages constructeur sont joints aussi.
- Il donne aussi les réglages de la souris dans Windows, les batteries Bluetooth (type et niveau, jamais
  le nom) et l'état des notifications.
- Une erreur interne d'une version est envoyée une fois, si l'envoi automatique est accepté.
- L'envoi automatique ignore les appareils standards (sans protocole du fabricant), pour lesquels
  il n'y a rien à corriger. Le bouton « Signaler » reste disponible pour eux.
- Correction : le diagnostic ne plante plus avec un appareil pris en charge (Scyrox, REKT, BlackShark,
  Vulcan II TKL Pro…) ; sa ligne « Catalogue » donne le statut, le pilote et les sources.

### Interface

- Traduction anglaise complétée (textes des versions 0.17 à 0.22 et de celle-ci).

## 0.22.0

Pilotes intégrés Turtle Beach Vulcan II TKL Pro (éclairage) et HyperX Cloud Alpha Wireless (batterie,
retour micro, extinction, annonces vocales). Bouton « Lancer OpenRGB ». Diagnostic enrichi : taille
des rapports, descripteurs bruts, interfaces figées, état d'OpenRGB.

## 0.21.0

SteelSeries Apex 3 / 3 TKL : couleurs par zone, arc-en-ciel, effets animés.

## 0.20.x

Diagnostic sans compte GitHub : copie, envoi en un clic ou automatique (avec accord). Un appareil
HID figé ne bloque plus les autres (hidapi corrigé).

## 0.19.0

Souris Logitech derrière un récepteur, onglets Son filtrés, rapport plus complet.

## 0.18.0

Mise à jour intégrée qui s'installe du premier coup, sans « fermez et réessayez ».

## 0.17.0

Liste des périphériques lue dans le Plug and Play de Windows : plus jamais vide à cause d'un
appareil muet. Son, webcams et manettes réglables avec les réglages de Windows.

Versions antérieures : tableau « État du projet » du [README](README.md).
