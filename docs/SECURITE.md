# Sécurité de PeriphHub

PeriphHub touche à des choses sensibles : les périphériques USB, les programmes qui démarrent
avec Windows, les services. Cette page dit ce qu'il fait, ce qu'il s'interdit, et pourquoi
un antivirus n'a aucune raison de le prendre pour un logiciel malveillant.

Pour signaler une faille : voir [SECURITY.md](../SECURITY.md).

## En bref

- Application de bureau pour **Windows 10 (version 2004 ou plus récente) et Windows 11**, installée
  pour votre compte seul, **sans droits administrateur**. Seul l'allègement des services demande
  l'accord de Windows (UAC), au moment où vous le lancez.
- **Rien d'installé en profondeur** : aucun pilote noyau, aucun service, aucune injection dans
  d'autres programmes, aucun hook clavier ou souris global.
- **Jamais de firmware** : PeriphHub n'écrit jamais le micrologiciel d'un appareil, et n'ouvre
  jamais un appareil en mode de mise à jour (chargeur de démarrage, DFU).
- **Pas de télémétrie.** Deux connexions seulement, toutes deux désactivables : la vérification
  des mises à jour (un fichier public sur GitHub), et le diagnostic, qui ne part que sur clic ou si
  vous avez accepté l'envoi automatique ([DIAGNOSTICS.md](DIAGNOSTICS.md),
  [PRIVACY.md](../PRIVACY.md)).

## Contre quoi PeriphHub se protège

| Risque | Protection |
|---|---|
| Contenu malveillant dans la fenêtre | L'interface ne charge que ses propres fichiers. Politique de sécurité du contenu stricte : `script-src 'self'`, connexions limitées à l'application et au relais des diagnostics. |
| Appareil USB défaillant ou malveillant | Délai sur chaque échange, verrou par appareil, interface écartée si Windows ne rend pas la main. Rapports bornés. Seules les interfaces des appareils pris en charge sont ouvertes. |
| Clé de sécurité (FIDO, U2F) | Jamais ouverte (page HID 0xF1D0 exclue). |
| Appareil en mode mise à jour | Jamais ouvert (chargeurs de démarrage et DFU exclus) : impossible de « briquer » un appareil. |
| Programme remplacé sur le disque | Module casques (HeadsetControl) vérifié par empreinte SHA-256 avant chaque lancement. DLL THX vérifiée par sa signature Authenticode (WinVerifyTrust), verrouillée pendant la vérification. Outils de Windows appelés par leur chemin absolu dans System32. |
| Mise à jour piégée | Chaque mise à jour est signée par le projet et vérifiée avant installation ; téléchargée depuis GitHub en HTTPS. Un fichier non signé ou modifié est refusé ([MISES-A-JOUR.md](MISES-A-JOUR.md)). |
| Élévation détournée | L'instance administrateur ne reçoit qu'une liste d'opérations d'allègement, revérifiées une à une (logiciel connu, service ou tâche de ce logiciel). Jamais de commande arbitraire. |
| Anti-triche et sécurité de Windows | Jamais arrêtés ni désactivés (Vanguard, FACEIT, EasyAntiCheat, BattlEye, Windows Defender…), même si la base de données les désignait par erreur : nom **et** chemin vérifiés. Processus vitaux de Windows jamais fermés. |

Hors de portée : un logiciel malveillant déjà présent sur le PC avec les mêmes droits que vous
peut faire tout ce que vous pouvez faire, PeriphHub ou pas.

## Antivirus : ce qui déclenche les faux positifs, et ce que fait PeriphHub

Les antivirus jugent un programme sur son comportement. Les choix ci-dessous évitent tout ce
qui ressemble à un logiciel malveillant, sans rien perdre en fonctionnalités.

| Ce que les antivirus surveillent | Ce que fait PeriphHub |
|---|---|
| Lancer PowerShell, `cmd`, `sc.exe`, `schtasks.exe`… en arrière-plan | Jamais (depuis la 1.0). API de Windows à la place : WinVerifyTrust pour les signatures, Gestionnaire de services, Planificateur de tâches (COM), Plug and Play (CfgMgr), Core Audio. |
| Une liste de noms d'antivirus dans le programme | Aucune liste d'antivirus : c'est la marque des logiciels malveillants qui cherchent à les arrêter. Seuls les composants de sécurité de Windows sont nommés, dans la liste de ce que PeriphHub ne touche jamais. |
| Hooks clavier ou souris globaux (enregistreurs de frappe) | Aucun. Les macros sont enregistrées dans l'appareil, pas captées par PeriphHub. |
| Lire ou écrire la mémoire d'autres programmes, y injecter du code | Jamais. La mémoire des logiciels constructeurs est lue par les compteurs publics de Windows (accès « informations limitées »). |
| Démarrage caché avec Windows | Seulement si vous l'activez (Options ▸ Arrière-plan), par la clé Run de votre compte : visible et désactivable dans le Gestionnaire des tâches. Version Store : tâche de démarrage du paquet, visible dans Paramètres ▸ Applications ▸ Démarrage. Retiré à la désinstallation. |
| Programme compressé ou obscurci (UPX…) | Non. Code source public, compilé par GitHub Actions depuis un tag de ce dépôt. |
| Télécharger puis exécuter du code | Jamais. Le module casques est fourni dans l'installeur (empreinte vérifiée). Les mises à jour passent par l'installeur signé et vérifié. |
| Exécutable sans nom ni éditeur | Métadonnées complètes : nom, description, version, éditeur, copyright. |

Programmes que PeriphHub lance, toujours à votre demande : un logiciel constructeur (« Ouvrir
Synapse pour ce réglage »), OpenRGB (« Lancer OpenRGB »), le module casques HeadsetControl, une
page web dans votre navigateur. Il ferme des programmes seulement quand vous allégez un logiciel
constructeur (ses propres programmes, jamais les autres).

## Windows 10 et Windows 11

PeriphHub fonctionne de la même façon sur Windows 10 (version 2004 ou plus récente, 22H2
conseillée) et Windows 11. Les fonctions qui dépendent de Windows :

- **WebView2** (le moteur de la fenêtre) est présent sur Windows 11 et sur Windows 10 à jour ; s'il
  manque, l'installeur le télécharge (programme officiel de Microsoft).
- **Batteries Bluetooth** : celles que Windows affiche lui-même dans Paramètres ▸ Bluetooth.
- **Notifications** (batterie faible) : notifications de Windows ; PeriphHub signale si elles sont
  coupées dans Paramètres ▸ Système ▸ Notifications.

## Smart App Control (Windows 11)

Le Contrôle intelligent des applications bloque les programmes qui ne sont pas signés par un
certificat reconnu, sans bouton « Exécuter quand même ». L'installeur de GitHub n'est pas encore
signé ([SIGNATURE.md](SIGNATURE.md)) : sur un PC où ce contrôle est **activé**, Windows refuse de le
lancer. Il bloque aussi HeadsetControl (le module casques) : le diagnostic le signale.

Solutions :

1. la version du **Microsoft Store**, signée par Microsoft, une fois publiée ([MICROSOFT-STORE.md](MICROSOFT-STORE.md)) ;
2. attendre l'installeur signé ;
3. désactiver le contrôle (Sécurité Windows ▸ Contrôle des applications et du navigateur) est
   déconseillé : selon la version de Windows, il ne peut ensuite être réactivé qu'en réinstallant Windows.

En mode « Évaluation », Windows décide seul au fil de l'usage ; rien à faire.

## En cas de faux positif

1. **Vérifiez le fichier** : comparez son empreinte au fichier `.sha256` de la Release :
   `Get-FileHash .\PeriphHub_x.y.z_x64-setup.exe -Algorithm SHA256`.
2. **Signalez-le à l'éditeur de l'antivirus**. Pour Microsoft Defender :
   <https://www.microsoft.com/wdsi/filesubmission> (choisir « Incorrectly detected as malware/malicious »).
   Les autres éditeurs ont un formulaire équivalent (« false positive »).
3. **Prévenez le projet** : ouvrez un ticket avec le nom de l'antivirus, sa version et le nom exact de
   la détection. Ne désactivez pas votre antivirus pour installer PeriphHub.

Avant publication, l'installeur de chaque version est analysé avec Microsoft Defender
([MISES-A-JOUR.md](MISES-A-JOUR.md), « Publier une mise à jour »).

## Vérifications automatiques

À chaque envoi sur GitHub (`.github/workflows/ci.yml`) : fichiers de données valides, tests des
pilotes contre des appareils simulés, Clippy sans avertissement, tests Rust (dont les garde-fous :
anti-triche et sécurité de Windows jamais touchés, aucun logiciel de périphérique protégé par erreur,
services et tâches de test seulement).
