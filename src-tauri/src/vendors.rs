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
    /// Versions anglaises de `keeps` et `loses` (interface en anglais)
    #[serde(default)]
    pub keeps_en: String,
    #[serde(default)]
    pub loses_en: String,
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

    /// Lancement automatique (Run, dossier Démarrage, service, tâche) appartenant à ce logiciel
    pub fn owns_entry(&self, e: &crate::startup::Entry) -> bool {
        if protected(&e.name) || protected(&e.target) {
            return false;
        }
        (e.kind == "service" && self.services.iter().any(|s| s.eq_ignore_ascii_case(&e.name)))
            || self.matches_path(&e.target)
            || (e.kind == "dossier" && e.name.to_lowercase().contains(&self.brand.to_lowercase()))
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

/// Catalogue généré par scripts/build-catalog.py à partir des projets libres (OpenRGB, OpenRazer,
/// libratbag, Solaar, rivalcfg, HeadsetControl, OpenMouse) : nomme un appareil et dit ce qu'on sait en faire.
#[derive(Deserialize)]
pub struct Known {
    pub vid: String,
    pub pid: String,
    pub name: String,
    pub kind: String,
    /// "experimental" (un pilote générique sait le régler) | "rgb" (éclairage via OpenRGB) | "known"
    pub status: String,
    #[serde(default)]
    pub via: String,
    #[serde(default)]
    pub src: Vec<String>,
}

pub fn catalog() -> Vec<Known> {
    serde_json::from_str(include_str!("../../data/catalog.json")).expect("data/catalog.json invalide")
}

/// Anti-triche et protections de Windows : PeriphHub n'y touche jamais (ni arrêt, ni désactivation
/// au démarrage), même si une entrée de la base de données les désignait par erreur (risque de
/// bannissement en jeu). Comparé au nom ET au chemin.
/// Volontairement aucune liste de noms d'antivirus : c'est la marque des logiciels malveillants qui
/// cherchent à les arrêter, et Windows protège déjà ces programmes (processus et services
/// « protégés », que même un administrateur ne peut ni arrêter ni modifier).
pub fn protected(text: &str) -> bool {
    const NEVER: &[&str] = &[
        // Anti-triche
        "vgc", "vgk", "vgtray", "vanguard", "valorant", "riotclient", "riot games", "easyanticheat",
        "start_protected_game", "battleye", "beservice", "bedaisy", "faceit", "eseaclient", "eaanticheat",
        "anticheat", "anti-cheat", "xigncode", "xhunter", "wellbia", "nprotect", "gameguard", "ace-base",
        "sguard", "mhyprot", "hoyokprotect", "punkbuster", "pnkbstr", "equ8", "randgrid", "ricochet",
        // Sécurité de Windows
        "windows defender", "securityhealth", "msmpeng", "windefend",
    ];
    let t = text.to_lowercase();
    NEVER.iter().any(|n| t.contains(n))
}

/// Processus vitaux de Windows (nom exact) : jamais attribués à un logiciel, donc jamais fermés.
pub fn system_process(name: &str) -> bool {
    const SYSTEM: &[&str] = &[
        "system", "registry", "memory compression", "secure system", "smss.exe", "csrss.exe", "wininit.exe",
        "winlogon.exe", "services.exe", "lsass.exe", "lsaiso.exe", "svchost.exe", "dwm.exe", "explorer.exe",
        "fontdrvhost.exe", "sihost.exe", "ctfmon.exe", "audiodg.exe", "conhost.exe", "runtimebroker.exe",
        "taskhostw.exe", "dllhost.exe", "spoolsv.exe", "searchindexer.exe", "wmiprvse.exe",
        "startmenuexperiencehost.exe", "shellexperiencehost.exe", "textinputhost.exe", "applicationframehost.exe",
    ];
    SYSTEM.iter().any(|s| s.eq_ignore_ascii_case(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protections_reconnues_par_nom_ou_chemin() {
        for t in [
            "vgc",
            r"C:\Program Files\Riot Vanguard\vgtray.exe",
            "EasyAntiCheat_EOS",
            r"C:\ProgramData\Microsoft\Windows Defender\Platform\4.18.25010.11-0\NisSrv.exe",
            "MsMpEng.exe",
            "SecurityHealthService",
        ] {
            assert!(protected(t), "{t}");
        }
    }

    #[test]
    fn logiciels_de_peripheriques_jamais_proteges_par_erreur() {
        // Aucun logiciel de la base ne doit tomber dans la liste (sinon il ne serait plus allégeable)
        for v in all() {
            for p in v.processes.iter().chain(&v.services) {
                assert!(!protected(p), "{} : {p}", v.id);
            }
            for p in &v.paths {
                assert!(!protected(p), "{} : {p}", v.id);
            }
        }
        for t in ["PresetManager.exe", "lghub_agent.exe", r"C:\Program Files\Corsair\Corsair iCUE5 Software\iCUE.exe"] {
            assert!(!protected(t), "{t}");
        }
        assert!(system_process("SVCHOST.EXE") && !system_process("RazerCentralService.exe"));
    }
}
