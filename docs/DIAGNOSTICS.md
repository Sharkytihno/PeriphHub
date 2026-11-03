# Diagnostics : savoir pourquoi un appareil n'est pas pris en charge, sans compte GitHub

Quand un appareil est détecté mais n'a pas de page, PeriphHub peut le dire au développeur de trois façons :

| Moyen | Quand | Ce qu'il faut |
|---|---|---|
| **Envoyer le diagnostic** (accueil) | sur clic | rien : l'appli l'envoie au relais |
| **Envoi automatique** | si l'utilisateur l'a accepté (question sur l'accueil, ou Options → Diagnostics) ; une seule fois par problème (même version, mêmes appareils), au plus tôt 2 minutes après le lancement | rien |
| **Copier le diagnostic** | sur clic | coller le texte dans Discord, un mail… |

Rien ne part sans l'accord de l'utilisateur. Le diagnostic contient :

- la liste des appareils USB et HID (VID:PID, nom, type, statut) ;
- les interfaces HID de chacun (page et usage, numéros de rapports) ;
- les échecs des pilotes et leur durée ;
- les derniers avertissements de l'appli.

Il ne contient **ni numéro de série, ni chemin de périphérique, ni nom d'utilisateur, ni fichier**. Les chemins sont retirés dans l'appli (`native-hid.js`) puis une seconde fois par le relais (`scrub`).

## Le relais (`server/diag-relay/relay.mjs`)

Un seul fichier, sans dépendance (Node 18+). Il reçoit `POST /periphhub/diag` et crée un ticket dans un **dépôt GitHub privé** (`Sharkytihno/periphhub-diagnostics`) avec les étiquettes `diagnostic` et `auto` ou `manuel`.

Ses protections :

- taille limitée à 40 Ko ;
- au plus 6 envois par heure et par adresse (adresses hachées, gardées en mémoire, jamais écrites) ;
- au plus 200 envois par jour ;
- un même texte n'est envoyé qu'une fois toutes les 24 h ;
- le jeton GitHub ne quitte jamais le serveur.

### Installation sur le VPS (une fois)

1. Créer le dépôt privé et ses étiquettes (sur le PC) :
   ```
   gh repo create Sharkytihno/periphhub-diagnostics --private
   gh label create diagnostic --repo Sharkytihno/periphhub-diagnostics
   gh label create auto --repo Sharkytihno/periphhub-diagnostics
   gh label create manuel --repo Sharkytihno/periphhub-diagnostics
   ```
2. Créer un jeton « fine-grained » sur https://github.com/settings/personal-access-tokens/new avec ces réglages :
   - dépôt : **seulement** `periphhub-diagnostics` ;
   - permission : **Issues, lecture et écriture** ;
   - expiration : 1 an.
3. Depuis le PC (Git Bash), lancer `bash server/diag-relay/install.sh`. Le script :
   - copie le relais sur le VPS ;
   - demande le jeton (saisie invisible) et l'écrit dans `~/periphhub-relay/.env` (droits 600) ;
   - le lance avec pm2 (`periphhub-relay`, port 3011) ;
   - ajoute un bloc `handle /periphhub/* { reverse_proxy 127.0.0.1:3011 }` (marqué `# periphhub-relay`) au bloc
     `sharkywedding.fr` du Caddyfile — un `reverse_proxy` seul serait court-circuité par les `handle` du site —, après une sauvegarde
     `Caddyfile.bak-periphhub`, puis recharge Caddy. Si le fichier modifié n'est pas valide, la sauvegarde est remise.
   Le script peut être relancé sans risque : c'est aussi la méthode de mise à jour. `NEW_TOKEN=1` permet de changer le jeton.
4. Vérifier : `curl -s https://sharkywedding.fr/periphhub/health` doit renvoyer `{"ok":true}`.

### Lire les diagnostics

```
gh issue list --repo Sharkytihno/periphhub-diagnostics --label diagnostic
gh issue view <numéro> --repo Sharkytihno/periphhub-diagnostics
```
