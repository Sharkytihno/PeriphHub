# Crates corrigées

## hidapi 2.6.7 (MIT, https://github.com/ruabmbua/hidapi-rs)

Copie de la version publiée sur crates.io, avec une seule modification dans `src/lib.rs`
(`HidApi::new`, commentaire « PeriphHub ») :

- `HidApi::new()` énumérait **tous** les appareils HID même après `disable_device_discovery()`
  (qui ne joue que pour libusb). Sous Windows, l'énumération ouvre chaque appareil et lit ses
  chaînes : un seul appareil figé (dongle sans fil, puce générique…) la bloque pour toujours.
- Cette énumération se faisait en gardant le verrou global `CONTEXT_STATE` : le premier appel
  bloqué bloquait aussi tous les suivants, donc **chaque** ouverture d'appareil de PeriphHub.

Constaté sur un PC où toutes les interfaces étaient « bloquées » (diagnostic 0.20.1), ainsi que
HeadsetControl, qui énumère de la même façon.

Deuxième correctif (1.0.0), dans `src/windows_native/mod.rs` et `types.rs` (commentaires
« PeriphHub ») : **aucun échange avec un appareil ne peut plus attendre indéfiniment**.

- `get_feature_report` attendait la réponse sans limite (`get_result(…, None)`) : un appareil
  qui ne répond pas figeait le fil pour toujours.
- `send_feature_report` passait par `HidD_SetFeature`, synchrone et sans délai : remplacé par
  l'IOCTL `IOCTL_HID_SET_FEATURE` en asynchrone, comme le fait le hidapi C.
- `write` abandonnait l'attente au bout d'1 s mais laissait l'écriture en cours sur un
  `OVERLAPPED` aussitôt réutilisé par l'envoi suivant.
- Nouvelle fonction `Overlapped::get_result_or_cancel` : au-delà du délai (1 s pour une écriture,
  2,5 s pour un feature report), l'opération est annulée (`CancelIoEx`) et on attend que Windows
  ait lâché le tampon avant de rendre la main avec `WaitTimedOut`.

À retirer si une version de hidapi corrige le problème.
