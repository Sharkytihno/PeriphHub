# Nouveautés de PeriphHub

Chaque section `## x.y.z` sert aussi de notes à la Release GitHub de cette version
(`.github/workflows/release.yml`).

## À venir

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
