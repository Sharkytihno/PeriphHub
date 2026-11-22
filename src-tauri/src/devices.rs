// Périphériques HID branchés, regroupés par modèle (VID:PID), avec un type déduit
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
    /// Nombre de conteneurs physiques distincts identifiés par Windows.
    pub units: usize,
    /// Au moins une interface sur une page HID « constructeur » (≥ 0xFF00) : c'est là que passent
    /// presque tous les protocoles de réglage. Sans elle, l'appareil est standard (Windows le gère seul).
    pub vendor_page: bool,
}

// Lu dans le gestionnaire Plug and Play (pnp.rs) : aucun appareil n'est ouvert, donc un appareil
// qui ne répond pas ne peut plus vider la liste.
pub fn list() -> Vec<Device> {
    summarize(crate::pnp::hid_interfaces())
}

fn summarize(ifaces: Vec<crate::pnp::HidIface>) -> Vec<Device> {
    // Classement par conteneur Windows, puis regroupement par modèle dans le rapport.
    type Group = (u16, u16, Option<[u8; 16]>);
    let mut map: BTreeMap<Group, (Device, u8, i32)> = BTreeMap::new();
    for d in ifaces {
        let (vid, pid) = (d.vid, d.pid);
        if vid == 0 {
            continue;
        }
        // Rang du type : plus il est précis, plus il l'emporte entre les interfaces d'un même appareil
        let (kind, rank) = match (d.usage_page, d.usage) {
            (0x0B, _) => ("casque", 4),
            (0x01, 0x02) => ("souris", 3),
            (0x01, 0x06 | 0x07) => ("clavier", 3),
            (0x01, 0x04 | 0x05 | 0x08) => ("manette", 3),
            (0x0C, _) => ("audio", 1),
            _ => ("autre", 0),
        };
        let e = map.entry((vid, pid, d.container)).or_insert_with(|| {
            (
                Device {
                    vid,
                    pid,
                    product: String::new(),
                    manufacturer: String::new(),
                    kind: "autre",
                    interfaces: 0,
                    units: usize::from(d.container.is_some()),
                    vendor_page: false,
                },
                0,
                i32::MAX,
            )
        });
        e.0.interfaces += 1;
        e.0.vendor_page |= d.usage_page >= 0xFF00;
        if e.0.product.is_empty() {
            e.0.product = d.product.trim().to_string();
        }
        // À rang égal (clavier qui expose aussi une souris pour ses macros, souris qui expose un clavier
        // pour ses boutons), l'interface au plus petit numéro l'emporte : c'est la fonction principale de
        // l'appareil (MI_00, l'interface « boot »). Avant, la première lue gagnait, et Windows ne les
        // donne pas dans l'ordre : un clavier Hall Effect sur 3151:502D passait pour une souris.
        let iface = if d.interface < 0 { i32::MAX - 1 } else { d.interface };
        if better((rank, iface), (e.1, e.2)) {
            e.0.kind = kind;
            e.1 = rank;
            e.2 = iface;
        } else if rank >= 3 && (rank, iface) == (e.1, e.2) && e.0.kind != kind {
            e.0.kind = "mixte";
        }
    }
    let mut models = BTreeMap::<_, Device>::new();
    for (mut device, _, _) in map.into_values() {
        if matches!(device.kind, "mixte" | "autre" | "audio") {
            if let Some(kind) = kind_from_name(&device.product) {
                device.kind = kind;
            }
        }
        models.entry((device.vid, device.pid))
            .and_modify(|model| {
                model.units += device.units;
                model.interfaces += device.interfaces;
                model.vendor_page |= device.vendor_page;
                if model.product.is_empty() {
                    model.product.clone_from(&device.product);
                }
                if model.kind == "autre" {
                    model.kind = device.kind;
                } else if device.kind != "autre" && model.kind != device.kind {
                    model.kind = "mixte";
                }
            })
            .or_insert(device);
    }
    models.into_values().collect()
}

fn kind_from_name(name: &str) -> Option<&'static str> {
    let n = name.to_lowercase();
    let mut kinds = n.split(|c: char| !c.is_alphanumeric()).filter_map(|word| match word {
        "keyboard" | "clavier" | "keypad" => Some("clavier"),
        "mouse" | "souris" => Some("souris"),
        "headset" | "headphone" | "headphones" | "casque" | "earbuds" => Some("casque"),
        _ => None,
    });
    let first = kinds.next()?;
    kinds.all(|kind| kind == first).then_some(first)
}

/// Le type lu sur cette interface (rang, numéro d'interface) remplace-t-il celui retenu jusqu'ici ?
fn better(new: (u8, i32), cur: (u8, i32)) -> bool {
    new.0 > cur.0 || (new.0 == cur.0 && new.0 > 0 && new.1 < cur.1)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Type retenu pour une suite d'interfaces (type, rang, numéro), lues dans cet ordre
    fn pick(ifaces: &[(&'static str, u8, i32)]) -> &'static str {
        let (mut kind, mut cur) = ("autre", (0u8, i32::MAX));
        for &(k, r, i) in ifaces {
            if better((r, i), cur) {
                (kind, cur) = (k, (r, i));
            }
        }
        kind
    }

    #[test]
    fn interface_principale_a_rang_egal() {
        // Clavier X68HE (3151:502D) : clavier sur MI_00, souris des macros sur MI_01, lus dans n'importe quel ordre
        assert_eq!(pick(&[("souris", 3, 1), ("clavier", 3, 0)]), "clavier");
        assert_eq!(pick(&[("clavier", 3, 0), ("souris", 3, 1)]), "clavier");
        // Souris qui expose un clavier pour ses boutons : souris sur MI_00
        assert_eq!(pick(&[("clavier", 3, 2), ("souris", 3, 0)]), "souris");
        // Un type plus précis l'emporte toujours, quelle que soit l'interface
        assert_eq!(pick(&[("souris", 3, 0), ("casque", 4, 3)]), "casque");
        assert_eq!(pick(&[("audio", 1, 0), ("souris", 3, 2)]), "souris");
    }

    fn collection(usage: u16, interface: i32, product: &str, unit: u8) -> crate::pnp::HidIface {
        crate::pnp::HidIface {
            path: String::new(),
            vid: 0x3554,
            pid: 0x1234,
            usage_page: 1,
            usage,
            interface,
            product: product.into(),
            container: Some([unit; 16]),
        }
    }

    #[test]
    fn nom_generique_ne_supplante_pas_la_collection_principale() {
        let result = summarize(vec![
            collection(6, 1, "Gaming Keyboard Interface", 1),
            collection(2, 0, "Gaming Keyboard Interface", 1),
        ]);
        assert_eq!((result[0].kind, result[0].units), ("souris", 1));
    }

    #[test]
    fn collections_ambigues_et_deux_appareils_de_meme_vid_pid() {
        let mouse = collection(2, 0, "Wireless Device", 1);
        let keyboard = collection(6, 0, "Wireless Device", 2);
        for devices in [vec![mouse.clone(), keyboard.clone()], vec![keyboard.clone(), mouse.clone()]] {
            let result = summarize(devices);
            assert_eq!((result[0].kind, result[0].units), ("mixte", 2));
        }
        let result = summarize(vec![mouse, collection(6, 0, "Keyboard and Mouse", 1)]);
        assert_eq!((result[0].kind, result[0].units), ("mixte", 1));
    }

}
