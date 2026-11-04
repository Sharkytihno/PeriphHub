# Diagnostics : savoir pourquoi un appareil n'est pas pris en charge, sans compte GitHub

Quand un appareil est détecté mais ne se connecte pas, PeriphHub peut le dire au développeur de trois façons :

| Moyen | Quand | Ce qu'il faut |
|---|---|---|
| **Envoyer le diagnostic** (accueil, Options ▸ Diagnostics) ou **Signaler** (sur un appareil) | sur clic | rien : une fenêtre demande l'appareil concerné et ce qui ne marche pas (facultatif), et montre exactement le texte envoyé (« Voir exactement ce qui sera envoyé ») |
| **Envoi automatique** | si l'utilisateur l'a accepté (question posée une fois sur l'accueil, ou Options ▸ Diagnostics) | rien |
| **Copier le diagnostic** | sur clic (accueil, page d'un appareil, « Copier plutôt » dans la fenêtre d'envoi) | coller le texte dans Discord, un mail… |

L'envoi automatique part :

- une fois par problème (même version, mêmes appareils non connectés), au plus tôt 2 minutes après le
  lancement et fenêtre visible : le temps qu'une souris sans fil sorte de veille et que chaque pilote essaie ;
- une fois par erreur interne de la version (même emplacement, même message dans `erreurs.log`) : elle est
  corrigée sans attendre un signalement.

Seuls les appareils que PeriphHub devrait savoir régler déclenchent la question et l'envoi automatique :
souris, claviers, casques et manettes connus d'un catalogue, ou dotés d'une interface HID « constructeur »
(page ≥ 0xFF00, où passent presque tous les protocoles de réglage). Un appareil **standard** (inconnu et sans
page constructeur : souris de bureau, clavier de PC portable…) est géré par Windows seul : il est marqué
« Appareil standard » et reste signalable à la main.

Rien ne part sans l'accord de l'utilisateur. Le texte reste en français quelle que soit la langue de
l'interface (le développeur le lit tel quel). Le diagnostic contient :

- **le système** : versions de PeriphHub (installeur ou Microsoft Store), de Windows (nom, build,
  architecture) et de WebView2 ; état du Contrôle intelligent des applications (Smart App Control) ;
  lancement en administrateur ; avis de Windows (branchements, sortie de veille) actifs ou non ;
- **le contexte** : durée d'ouverture, lancé avec Windows ou non, fermeture vers la zone de notification,
  fenêtre visible ou cachée, langue ;
- **les réglages Windows** de la souris et du clavier (vitesse, accélération, molette, double-clic,
  répétition des touches) : souvent en cause quand « le curseur accélère » ;
- **les batteries Bluetooth** : type et niveau seulement, jamais le nom de l'appareil (il contient souvent
  celui du propriétaire) ; l'alerte de batterie faible et l'état des notifications Windows ;
- **les erreurs internes récentes** (`erreurs.log`, 20 dernières lignes) ;
- **les appareils USB et HID** (VID:PID, nom, type, statut), leurs interfaces HID et ce que chaque pilote a
  essayé (détail plus bas) ;
- **les logiciels constructeurs ouverts** ;
- le commentaire de l'utilisateur, s'il en écrit un (1 500 caractères au plus).

Il ne contient **ni numéro de série, ni chemin de périphérique, ni nom d'utilisateur, ni nom d'appareil
Bluetooth, ni fichier**. Les chemins sont retirés dans l'appli (`native-hid.js`) puis une seconde fois par
le relais (`scrub`).

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

### Ce qu'un diagnostic contient (pour corriger du premier coup)

Un appareil peut être piloté par plusieurs voies, essayées en parallèle ; le diagnostic dit où chacune a échoué :

| Voie | Pour quoi | Ligne du diagnostic |
|---|---|---|
| Pilotes intégrés (`ui/js/drivers/*.js`) | souris, claviers, casques connus, chacun ouvert seul | `connecté (pilote)` ou `échec …` |
| OpenMouse | souris à protocole reconnu par leur descripteur | `connecté (openmouse-…)` |
| HeadsetControl | casques pas encore intégrés | `Module casques : …` |
| OpenRGB (serveur SDK) | éclairage des appareils sans pilote intégré | `OpenRGB : non installé / installé, fermé / ouvert SANS serveur SDK / N appareils` |
| Windows (audio, caméras) | réglages exposés par Windows | onglets Son et Caméra |

- Par appareil : `Catalogue` (nom, statut et sources de la base), `Pilote connecté` et ses réglages, ou
  l'échec de chaque pilote avec sa durée ; `Appareil muet` quand il ne répond pas (réessayé après 1, 2, 4…
  jusqu'à 10 minutes, sans rien bloquer) ; `aucune page constructeur (standard)` quand il n'a rien à régler.
- Rapports d'entrée / sortie / feature avec **leur taille** (`0x11(283o)`), et pour un appareil sans
  pilote, le **descripteur brut** de ses interfaces constructeur (page ≥ 0xFF00) : de quoi écrire un pilote
  sans le matériel, en recoupant avec OpenRGB / HeadsetControl / libratbag.
- `Interfaces HID vues par Windows` : chaque interface et son sort (`bloquée`, `refusée`, `descripteur N octets`).
  Les interfaces **bloquées d'autres appareils** sont listées aussi, avec leur nom : c'est souvent elles qui figent
  HeadsetControl ou OpenRGB.
- `Autres appareils sans réglages (hubs, puces internes…)` : la liste complète, pour ne rien manquer.
- `Logiciels constructeurs ouverts` : un logiciel d'origine ouvert peut réimposer ses réglages ou garder l'appareil.
- `Erreurs internes récentes` : erreur de PeriphHub lui-même (date, version, fil, emplacement dans le code, message).
