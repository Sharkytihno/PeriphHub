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

À retirer si une version de hidapi corrige le problème.
