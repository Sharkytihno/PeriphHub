# Politique de confidentialité — PeriphHub

*Dernière mise à jour : 2 novembre 2026*

PeriphHub est un logiciel libre (GPL-3.0) qui fonctionne entièrement sur votre ordinateur.

## Ce que PeriphHub ne fait pas

- Aucune donnée n'est envoyée sur Internet : pas de télémétrie, pas de statistiques d'usage,
  pas de rapport de plantage automatique, pas de publicité, pas de compte.
- Aucune donnée personnelle (nom, adresse e-mail, localisation, contacts, fichiers…) n'est
  collectée, stockée ni partagée avec qui que ce soit.

## Ce que PeriphHub lit, uniquement sur votre ordinateur

Pour fonctionner, l'application lit localement :

- la liste des périphériques USB/HID branchés (fabricant, modèle, numéro de série fourni par
  l'appareil) et leurs réglages (DPI, éclairage, batterie…) ;
- la liste des programmes en cours d'exécution et des lancements automatiques de Windows
  (services, tâches planifiées, programmes au démarrage), pour la fonction « Allègement » ;
- si OpenRGB est lancé sur votre ordinateur, la liste de ses appareils (connexion locale
  127.0.0.1 uniquement).

Ces informations restent sur votre ordinateur et ne sont jamais transmises.

## Ce que PeriphHub enregistre, uniquement sur votre ordinateur

- vos réglages et l'état d'origine de vos périphériques (stockage local de l'application), pour
  pouvoir les réappliquer ou les annuler ;
- le journal de l'Allègement (`%LOCALAPPDATA%\PeriphHub\allegement.json`), pour pouvoir annuler
  chaque modification.

Désinstaller PeriphHub supprime ces données.

## Contact

Questions ou signalements : <https://github.com/Sharkytihno/PeriphHub/issues>

---

# Privacy policy — PeriphHub (English)

PeriphHub is free software (GPL-3.0) that runs entirely on your computer. It sends **no data
over the Internet**: no telemetry, no analytics, no automatic crash reports, no ads, no account.
It collects, stores or shares **no personal data**.

To work, it reads locally the connected USB/HID devices and their settings, the running programs
and Windows autostart entries (for the "Slim down" feature), and, if OpenRGB is running, its
device list over a local 127.0.0.1 connection. It stores locally your device settings, their
original values and the Slim down log (`%LOCALAPPDATA%\PeriphHub\allegement.json`) so every
change can be undone. Nothing leaves your computer. Uninstalling PeriphHub removes this data.

Contact: <https://github.com/Sharkytihno/PeriphHub/issues>
