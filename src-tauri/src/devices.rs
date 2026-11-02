// Périphériques HID branchés, regroupés par appareil (VID:PID), avec un type deviné
// à partir des « usages » HID (souris, clavier, casque…).
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Serialize, Clone)]
pub struct Device {
    pub vid: u16,
    pub pid: u16,
    pub product: String,
    pub manufacturer: String,
    pub kind: &'static str,
    pub interfaces: usize,
}

pub fn list() -> Vec<Device> {
    let Ok(api) = hidapi::HidApi::new() else {
        return Vec::new();
    };
    let mut map: BTreeMap<(u16, u16), (Device, u8)> = BTreeMap::new();
    for d in api.device_list() {
        let (vid, pid) = (d.vendor_id(), d.product_id());
        if vid == 0 {
            continue;
        }
        // Rang du type : plus il est précis, plus il l'emporte entre les interfaces d'un même appareil
        let (kind, rank) = match (d.usage_page(), d.usage()) {
            (0x0B, _) => ("casque", 4),
            (0x01, 0x02) => ("souris", 3),
            (0x01, 0x06) => ("clavier", 3),
            (0x01, 0x04 | 0x05) => ("manette", 3),
            (0x0C, _) => ("audio", 1),
            _ => ("autre", 0),
        };
        let e = map.entry((vid, pid)).or_insert_with(|| {
            (
                Device {
                    vid,
                    pid,
                    product: String::new(),
                    manufacturer: String::new(),
                    kind: "autre",
                    interfaces: 0,
                },
                0,
            )
        });
        e.0.interfaces += 1;
        if e.0.product.is_empty() {
            e.0.product = d.product_string().unwrap_or_default().trim().to_string();
        }
        if e.0.manufacturer.is_empty() {
            e.0.manufacturer = d
                .manufacturer_string()
                .unwrap_or_default()
                .trim()
                .to_string();
        }
        if rank > e.1 {
            e.0.kind = kind;
            e.1 = rank;
        }
    }
    map.into_values()
        .map(|(mut d, _)| {
            // Beaucoup de claviers exposent aussi une interface souris (et inversement) :
            // le nom du produit tranche quand il est explicite.
            if let Some(k) = kind_from_name(&d.product) {
                d.kind = k;
            }
            d
        })
        .collect()
}

fn kind_from_name(name: &str) -> Option<&'static str> {
    let n = name.to_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| n.contains(w));
    if has(&["keyboard", "clavier", "keypad"]) {
        Some("clavier")
    } else if has(&["mouse", "souris"]) {
        Some("souris")
    } else if has(&["headset", "headphone", "casque", "earbuds"]) {
        Some("casque")
    } else {
        None
    }
}
