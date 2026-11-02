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

## 0.2 — Allègement guidé

Pour chaque logiciel constructeur, un parcours en étapes :

1. Ce que vous gardez / perdez (données de `vendors.json`).
2. Vos appareils de cette marque sont-ils pris en charge par PeriphHub ?
3. Désactivation **réversible** : lancement automatique retiré, services en « manuel », tâches
   désactivées. Chaque modification est enregistrée pour pouvoir l'annuler en un clic.
4. **Lancement à la demande** : « Ouvrir Synapse pour ce réglage », puis fermeture complète.
5. Mesure de la mémoire gagnée.

Jamais de désinstallation automatique.

## 0.3 — Premiers plugins (appareils déjà décodés dans le prototype)

- Souris Scyrox (puce CompX) : DPI, fréquence, LOD, boutons, macros.
- Claviers VIA / Vial, dont les claviers à effet Hall (course, rapid trigger par touche, éclairage, macros).
- Casques Razer sans fil (égaliseur matériel, retour micro, veille) + effets THX si présents.
- RGB des cartes mères GIGABYTE (ITE Fusion 2).

## 0.4+ — Grandes marques, en portant les protocoles libres existants

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
