# Politique de confidentialité — PeriphHub

*Dernière mise à jour : 4 novembre 2026 (version 1.0)*

PeriphHub est un logiciel libre (GPL-3.0) qui fonctionne sur votre ordinateur. Il n'a ni compte,
ni publicité, ni télémétrie, ni statistiques d'usage. Il ne vend et ne partage aucune donnée.

## Ce qui peut quitter votre ordinateur

Deux connexions seulement, chacune désactivable.

### 1. Vérification des mises à jour (version téléchargée sur GitHub uniquement)

La version installée avec `setup.exe` lit, au lancement puis toutes les 6 heures, un fichier public
de la dernière version publiée sur GitHub (`latest.json`). Comme pour toute page web, GitHub voit
alors l'adresse IP de l'ordinateur ; **aucune autre information** n'est envoyée. Les mises à jour
sont signées par le projet et vérifiées avant installation. Se désactive dans **Options ▸ Mises à
jour**. La version du Microsoft Store ne fait pas cette vérification : le Store s'occupe de ses mises
à jour.

### 2. Diagnostic, seulement avec votre accord

Quand un appareil ne se connecte pas, PeriphHub peut envoyer un diagnostic au développeur :

- **sur clic** (« Envoyer le diagnostic », « Signaler ») : la fenêtre d'envoi montre exactement le
  texte qui part, avant l'envoi ;
- **automatiquement**, seulement si vous l'avez accepté (question posée une fois, ou Options ▸
  Diagnostics, désactivable à tout moment) : une fois par problème, et une fois par erreur interne
  de PeriphHub.

Le diagnostic contient : les versions de Windows, de PeriphHub et de WebView2 ; la liste des
appareils USB et HID (identifiants du fabricant et du modèle, nom du modèle, type) et ce que
PeriphHub a essayé avec eux ; les réglages de souris et de clavier de Windows (vitesse,
accélération, molette) ; le type et le niveau des batteries Bluetooth ; l'état des notifications
Windows ; les dernières erreurs internes de PeriphHub ; votre commentaire, si vous en écrivez un.

Il ne contient **ni numéro de série, ni chemin de périphérique, ni nom d'utilisateur, ni nom
d'appareil Bluetooth, ni fichier**. Les chemins sont retirés dans l'application, puis une seconde
fois par le relais.

Il passe par un relais du développeur (`sharkywedding.fr`), qui le dépose dans un dépôt GitHub
**privé**, lu seulement par le développeur. Le relais n'enregistre pas votre adresse IP : il n'en
garde qu'une empreinte, en mémoire, pour limiter le nombre d'envois. Un diagnostic peut être
supprimé sur demande (ticket indiquant le jour d'envoi).

## Ce que PeriphHub lit, uniquement sur votre ordinateur

- les périphériques USB et HID branchés (fabricant, modèle, numéro de série fourni par l'appareil)
  et leurs réglages (DPI, éclairage, batterie…) ;
- les périphériques Bluetooth et le niveau de batterie que Windows affiche pour eux ;
- les réglages de souris et de clavier de Windows (page « Souris et clavier ») ;
- les sorties audio et les caméras (onglets Son et Caméra) ;
- les programmes en cours d'exécution, leur mémoire, et les lancements automatiques de Windows
  (services, tâches planifiées, programmes au démarrage), pour la fonction « Allègement » ;
- si OpenRGB est lancé sur votre ordinateur, la liste de ses appareils (connexion locale
  127.0.0.1 uniquement).

Ces informations restent sur votre ordinateur, sauf la partie décrite plus haut si vous envoyez un
diagnostic.

Les **notifications** (batterie faible, mise à jour disponible) sont affichées par Windows sur cet
ordinateur : rien n'est envoyé.

## Ce que PeriphHub enregistre, uniquement sur votre ordinateur

- vos réglages et l'état d'origine de vos périphériques (stockage local de l'application), pour
  pouvoir les réappliquer ou les annuler ;
- le journal de l'Allègement (`%LOCALAPPDATA%\PeriphHub\allegement.json`), pour pouvoir annuler
  chaque modification ;
- les 20 dernières erreurs internes (`%LOCALAPPDATA%\PeriphHub\erreurs.log`) ;
- si vous l'activez, le démarrage avec Windows (clé « Run » de votre compte).

À la désinstallation : le démarrage avec Windows et le journal des erreurs sont supprimés. Le
journal de l'Allègement est conservé, pour pouvoir annuler l'allègement après une réinstallation.
Vos réglages sont supprimés si vous cochez « Supprimer les données de l'application ».

## Contact

Questions ou signalements : <https://github.com/Sharkytihno/PeriphHub/issues>

---

# Privacy policy — PeriphHub (English)

*Last updated: November 4, 2026 (version 1.0)*

PeriphHub is free software (GPL-3.0) that runs on your computer. No account, no ads, no
telemetry, no usage statistics. It does not sell or share any data.

**What can leave your computer**: two connections only, each one can be turned off.

1. **Update check** (GitHub version only): the version installed with `setup.exe` reads a public
   file of the latest GitHub release (`latest.json`) at startup and every 6 hours. GitHub sees the
   computer's IP address, as with any web page; nothing else is sent. Updates are signed and
   verified before installing. Turn it off in **Options ▸ Updates**. The Microsoft Store version
   does not do this check.
2. **Diagnostic, only with your consent**: when a device does not connect, PeriphHub can send a
   diagnostic to the developer, on click (the send window shows the exact text first), or
   automatically if you accepted it (asked once, or Options ▸ Diagnostics; can be turned off at
   any time). It contains the Windows, PeriphHub and WebView2 versions, the USB/HID device list
   (vendor and product IDs, model name, type) and what PeriphHub tried with them, Windows mouse
   and keyboard settings, Bluetooth battery types and levels, the Windows notification state,
   recent PeriphHub internal errors and your comment if you write one. It contains **no serial
   number, device path, user name, Bluetooth device name or file**. It goes through a relay run
   by the developer (`sharkywedding.fr`) to a **private** GitHub repository read only by the
   developer. The relay does not store your IP address (it keeps a hash in memory to limit
   submissions). A diagnostic can be deleted on request (issue with the day it was sent).

**Read locally only**: connected USB/HID devices and their settings, Bluetooth devices and the
battery level Windows shows for them, Windows mouse and keyboard settings, audio outputs and
cameras, running programs, their memory and Windows autostart entries (for the "Slim down"
feature), and, if OpenRGB is running, its device list over a local 127.0.0.1 connection.
Notifications (low battery, update available) are shown by Windows on this computer.

**Stored locally only**: your device settings and their original values, the Slim down log
(`%LOCALAPPDATA%\PeriphHub\allegement.json`), the last 20 internal errors
(`%LOCALAPPDATA%\PeriphHub\erreurs.log`) and, if you turn it on, start with Windows (your
account's "Run" key). Uninstalling removes start with Windows and the error log; the Slim down log
is kept so slimming can be undone after a reinstall; your settings are removed if you tick
"Delete the application data".

Contact: <https://github.com/Sharkytihno/PeriphHub/issues>
