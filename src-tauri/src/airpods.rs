// Batterie des AirPods et des Beats connectés au PC.
//
// Windows ne lit pas leur batterie (elle passe par des commandes propres à Apple). Les écouteurs
// l'annoncent pourtant en clair plusieurs fois par seconde, en Bluetooth basse consommation, dans le
// message « proximity pairing » dont l'iPhone se sert pour sa fenêtre de batterie : données
// constructeur de la société 0x004C (Apple), type 07 :
//   [0] 07  [1] longueur  [2] préfixe  [3..4] modèle (= PID Bluetooth, ex. 0x2014 AirPods Pro 2)
//   [5] bit 5 : c'est l'écouteur gauche qui émet
//   [6] quartet bas = écouteur qui émet, haut = l'autre (0-10 = ×10 %, 15 = inconnu)
//   [7] quartet haut : bit 0 émetteur en charge, bit 1 l'autre, bit 2 boîtier ; quartet bas : boîtier
// Les AirPods des voisins émettent le même message (adresses aléatoires) : on ne garde que ceux dont
// le modèle est celui des écouteurs connectés, et le signal le plus fort parmi les messages récents.
// Lecture seule : PeriphHub écoute, il n'envoie rien. Méthode reprise de WirelessBattery (GPL-3.0,
// src/drivers/airpods.cpp), d'après OpenPods, AirPodsDesktop et librepods.
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use windows::Devices::Bluetooth::Advertisement::{
    BluetoothLEAdvertisementReceivedEventArgs, BluetoothLEAdvertisementWatcher, BluetoothLEAdvertisementWatcherStatus,
    BluetoothLEScanningMode,
};
use windows::Foundation::TypedEventHandler;
use windows::Storage::Streams::DataReader;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Advert {
    pub model: u16,
    /// Pourcentages, -1 si inconnus
    pub left: i32,
    pub right: i32,
    pub case: i32,
    pub left_chg: bool,
    pub right_chg: bool,
    pub case_chg: bool,
}

fn level(n: u8) -> i32 {
    if n <= 10 { n as i32 * 10 } else { -1 }
}

pub fn parse(d: &[u8]) -> Option<Advert> {
    if d.len() < 9 || d[0] != 0x07 || d[1] < 0x09 {
        return None;
    }
    let left_tx = d[5] & 0x20 != 0;
    let (cur, other, chg) = (d[6] & 0x0F, d[6] >> 4, d[7] >> 4);
    let a = Advert {
        model: u16::from_le_bytes([d[3], d[4]]),
        left: level(if left_tx { cur } else { other }),
        right: level(if left_tx { other } else { cur }),
        case: level(d[7] & 0x0F),
        left_chg: chg & if left_tx { 1 } else { 2 } != 0,
        right_chg: chg & if left_tx { 2 } else { 1 } != 0,
        case_chg: chg & 4 != 0,
    };
    (a.left >= 0 || a.right >= 0).then_some(a)
}

struct Seen {
    adv: Advert,
    rssi: i16,
    at: Instant,
}

fn seen() -> &'static Mutex<HashMap<u64, Seen>> {
    static S: OnceLock<Mutex<HashMap<u64, Seen>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

fn on_received(args: &BluetoothLEAdvertisementReceivedEventArgs) -> windows::core::Result<()> {
    let list = args.Advertisement()?.GetManufacturerDataByCompanyId(0x004C)?;
    for md in list {
        let buf = md.Data()?;
        let n = buf.Length()? as usize;
        if !(9..=64).contains(&n) {
            continue;
        }
        let mut b = vec![0u8; n];
        DataReader::FromBuffer(&buf)?.ReadBytes(&mut b)?;
        if let Some(adv) = parse(&b) {
            let (addr, rssi, at) = (args.BluetoothAddress()?, args.RawSignalStrengthInDBm()?, Instant::now());
            let mut m = seen().lock().unwrap_or_else(|e| e.into_inner());
            m.insert(addr, Seen { adv, rssi, at });
            // Les adresses changent régulièrement : on oublie les anciennes
            m.retain(|_, s| at.duration_since(s.at) < Duration::from_secs(600));
        }
    }
    Ok(())
}

/// Démarre l'écoute (ou la relance si la radio a été coupée). Vrai si elle vient de démarrer.
fn ensure_watcher() -> bool {
    static W: OnceLock<Option<BluetoothLEAdvertisementWatcher>> = OnceLock::new();
    let mut fresh = false;
    let w = W.get_or_init(|| {
        let w = BluetoothLEAdvertisementWatcher::new().ok()?;
        let _ = w.SetScanningMode(BluetoothLEScanningMode::Passive);
        w.Received(&TypedEventHandler::new(|_, args: windows::core::Ref<BluetoothLEAdvertisementReceivedEventArgs>| {
            if let Some(a) = args.as_ref() {
                let _ = on_received(a);
            }
            Ok(())
        }))
        .ok()?;
        fresh = w.Start().is_ok();
        Some(w)
    });
    let Some(w) = w else { return false };
    if !fresh {
        if let Ok(st) = w.Status() {
            if st == BluetoothLEAdvertisementWatcherStatus::Stopped || st == BluetoothLEAdvertisementWatcherStatus::Aborted {
                fresh = w.Start().is_ok();
            }
        }
    }
    fresh
}

/// Meilleur message pour un modèle : le signal le plus fort de la dernière minute et demie, sinon le
/// plus récent des 5 dernières minutes
fn pick(model: u16) -> Option<Advert> {
    let m = seen().lock().unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    let fresh = |s: &Seen| now.duration_since(s.at) < Duration::from_secs(90);
    m.values()
        .filter(|s| (model == 0 || s.adv.model == model) && now.duration_since(s.at) < Duration::from_secs(300))
        .max_by(|a, b| (fresh(a), if fresh(a) { a.rssi as i64 } else { 0 }, a.at).cmp(&(fresh(b), if fresh(b) { b.rssi as i64 } else { 0 }, b.at)))
        .map(|s| s.adv)
}

pub struct Buds {
    pub name: String,
    pub address: String,
    pub adv: Advert,
}

/// Écouteurs Apple connectés (liste de pnp.rs) avec leur dernier message. N'écoute que si des
/// écouteurs Apple sont connectés.
pub fn batteries() -> Vec<Buds> {
    let devices = crate::pnp::apple_audio();
    if devices.is_empty() {
        return Vec::new();
    }
    if ensure_watcher() {
        // L'écoute vient de démarrer : les écouteurs émettent plusieurs fois par seconde
        for _ in 0..25 {
            if devices.iter().all(|d| pick(d.pid).is_some()) {
                break;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    }
    devices
        .into_iter()
        .filter_map(|d| Some(Buds { adv: pick(d.pid)?, name: if d.name.is_empty() { "AirPods".into() } else { d.name }, address: d.address }))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_airpods() {
        // gauche émet (bit 5) : gauche 80 %, droite 70 %, boîtier 50 % en charge
        let a = parse(&[0x07, 0x19, 0x01, 0x14, 0x20, 0x20, 0x78, 0x45, 0x00]).unwrap();
        assert_eq!((a.model, a.left, a.right, a.case), (0x2014, 80, 70, 50));
        assert!(!a.left_chg && !a.right_chg && a.case_chg);
        // droite émet, elle charge : niveaux inversés
        let b = parse(&[0x07, 0x19, 0x01, 0x14, 0x20, 0x00, 0x78, 0x1F, 0x00]).unwrap();
        assert_eq!((b.left, b.right, b.case), (70, 80, -1));
        assert!(b.right_chg && !b.left_chg);
        // rien de connu : ignoré
        assert!(parse(&[0x07, 0x19, 0x01, 0x14, 0x20, 0x00, 0xFF, 0x0F, 0x00]).is_none());
        assert!(parse(&[0x10, 0x05, 0x01]).is_none());
    }
}
