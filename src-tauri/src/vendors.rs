// Base de données des logiciels constructeurs (data/vendors.json) et des fabricants USB
// (data/usb-vendors.json). Enrichie par la communauté : aucune donnée en dur dans le code.
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Deserialize)]
pub struct Vendor {
    pub id: String,
    pub name: String,
    pub brand: String,
    /// Noms exacts d'exécutables (insensible à la casse)
    #[serde(default)]
    pub processes: Vec<String>,
    /// Morceaux de chemin propres au logiciel, ex. "\\razer\\" (insensible à la casse)
    #[serde(default)]
    pub paths: Vec<String>,
    /// Noms de services Windows
    #[serde(default)]
    pub services: Vec<String>,
    /// Identifiants USB (VID en hexadécimal) des appareils de la marque
    #[serde(default)]
    pub usb_vids: Vec<String>,
    /// Ce qui reste enregistré dans l'appareil quand le logiciel est fermé
    #[serde(default)]
    pub keeps: String,
    /// Ce qui ne fonctionne plus quand le logiciel est fermé
    #[serde(default)]
    pub loses: String,
    /// false = entrée à confirmer sur une vraie installation
    #[serde(default)]
    pub verified: bool,
}

impl Vendor {
    pub fn matches_process(&self, name: &str, path: Option<&str>) -> bool {
        if self.processes.iter().any(|p| p.eq_ignore_ascii_case(name)) {
            return true;
        }
        path.is_some_and(|p| self.matches_path(p))
    }

    pub fn matches_path(&self, text: &str) -> bool {
        let t = text.to_lowercase();
        self.paths.iter().any(|s| t.contains(&s.to_lowercase()))
            || self.processes.iter().any(|p| {
                // nom d'exe précédé d'un séparateur : « cam.exe » ne doit pas reconnaître « webcam.exe »
                let p = p.to_lowercase();
                t == p
                    || t.starts_with(&p)
                    || ["\\", "\"", " "]
                        .iter()
                        .any(|s| t.contains(&format!("{s}{p}")))
            })
    }

    pub fn has_vid(&self, vid: u16) -> bool {
        self.usb_vids
            .iter()
            .any(|v| u16::from_str_radix(v.trim_start_matches("0x"), 16) == Ok(vid))
    }
}

pub fn all() -> Vec<Vendor> {
    serde_json::from_str(include_str!("../../data/vendors.json"))
        .expect("data/vendors.json invalide")
}

#[derive(Deserialize)]
pub struct UsbVendor {
    pub name: String,
    #[serde(default)]
    pub note: String,
}

pub fn usb() -> HashMap<u16, UsbVendor> {
    let raw: HashMap<String, UsbVendor> =
        serde_json::from_str(include_str!("../../data/usb-vendors.json"))
            .expect("data/usb-vendors.json invalide");
    raw.into_iter()
        .filter_map(|(k, v)| u16::from_str_radix(&k, 16).ok().map(|vid| (vid, v)))
        .collect()
}

#[derive(Deserialize)]
pub struct Support {
    pub vid: String,
    pub pid: String,
    pub name: String,
    /// Type affiché, prioritaire sur la détection automatique (souris, clavier, casque, rgb…)
    #[serde(default)]
    pub kind: Option<String>,
    /// "supported" | "partial" | "planned"
    pub status: String,
    #[serde(default)]
    pub plugin: String,
    #[serde(default)]
    pub missing: Vec<String>,
}

pub fn support() -> Vec<Support> {
    serde_json::from_str(include_str!("../../data/devices.json"))
        .expect("data/devices.json invalide")
}
