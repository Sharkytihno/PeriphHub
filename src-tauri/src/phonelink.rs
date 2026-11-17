// Batterie du téléphone relié par Microsoft Phone Link (« Lien avec Windows »), en Wi-Fi ou Bluetooth.
//
// Phone Link tient à jour la carte du téléphone affichée dans le menu Démarrer de Windows 11 :
//   %LOCALAPPDATA%\Packages\Microsoft.YourPhone_8wekyb3d8bbwe\LocalState\StartMenu\StartMenuCompanion.json
// C'est une Adaptive Card dont le champ « speak » vaut « <nom du téléphone> - Connected to your PC »
// et dont l'élément batterie porte l'infobulle « Battery <n>% remaining ». Seuls ces deux champs sont
// lus ; le reste de la carte (aperçus de notifications) est ignoré et ne quitte jamais ce module.
// Fichier interne de Phone Link, non documenté : au moindre écart, aucun téléphone n'est signalé.
// Lecture seule, sans accès au téléphone ni au réseau.
// Méthode reprise de WirelessBattery (GPL-3.0, src/drivers/phonelink.cpp).
use serde_json::Value;
use std::time::{Duration, SystemTime};

pub struct Phone {
    pub name: String,
    pub level: u8,
    /// Carte pas réécrite depuis plus de 3 heures : dernière valeur connue
    pub stale: bool,
}

/// Suffixes du champ « speak » quand le téléphone est relié (anglais, puis français par précaution)
const CONNECTED: &[&str] = &[" - Connected to your PC", " - Connecté à votre PC", " - Connecté à votre ordinateur"];

fn strings<'a>(v: &'a Value, out: &mut Vec<(&'a str, &'a str)>) {
    match v {
        Value::Object(m) => {
            for (k, x) in m {
                if let Value::String(s) = x {
                    out.push((k.as_str(), s.as_str()));
                } else {
                    strings(x, out);
                }
            }
        }
        Value::Array(a) => a.iter().for_each(|x| strings(x, out)),
        _ => {}
    }
}

/// Pourcentage dans « Battery 57% remaining » (ou « Batterie : 57 % restants »)
fn percent(s: &str) -> Option<u8> {
    let low = s.to_lowercase();
    let rest = low.strip_prefix("battery ").or_else(|| low.strip_prefix("batterie"))?;
    let rest = rest.trim_start_matches([' ', ':', '\u{a0}', '\u{202f}']);
    let n: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    let after = rest[n.len()..].trim_start_matches([' ', '\u{a0}', '\u{202f}']);
    if n.is_empty() || n.len() > 3 || !after.starts_with('%') {
        return None;
    }
    n.parse().ok().filter(|v| *v <= 100)
}

pub fn parse(json: &str) -> Option<(String, u8)> {
    let v: Value = serde_json::from_str(json).ok()?;
    let mut all = Vec::new();
    strings(&v, &mut all);
    let speak = all.iter().find(|(k, _)| *k == "speak")?.1;
    let name = CONNECTED.iter().find_map(|s| speak.strip_suffix(s))?.trim();
    let level = all.iter().find_map(|(_, s)| percent(s))?;
    (!name.is_empty()).then(|| (name.to_string(), level))
}

pub fn phone() -> Option<Phone> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    let path = std::path::Path::new(&base)
        .join(r"Packages\Microsoft.YourPhone_8wekyb3d8bbwe\LocalState\StartMenu\StartMenuCompanion.json");
    let meta = std::fs::metadata(&path).ok()?;
    if meta.len() == 0 || meta.len() > 4 * 1024 * 1024 {
        return None;
    }
    let text = std::fs::read_to_string(&path).ok()?;
    let (name, level) = parse(text.trim_start_matches('\u{feff}'))?;
    let age = meta.modified().ok().and_then(|m| SystemTime::now().duration_since(m).ok()).unwrap_or_default();
    Some(Phone { name, level, stale: age > Duration::from_secs(3 * 3600) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn carte_phone_link() {
        let card = r#"{"type":"AdaptiveCard","speak":"Pixel 9 - Connected to your PC","body":[{"type":"ColumnSet","columns":[
            {"items":[{"type":"Image","tooltip":"Battery 57% remaining"}]},{"items":[{"type":"TextBlock","text":"Battery saver"}]}]}]}"#;
        assert_eq!(parse(card), Some(("Pixel 9".into(), 57)));
        // téléphone déconnecté : rien
        assert_eq!(parse(&card.replace("Connected to your PC", "Not connected")), None);
        assert_eq!(parse("pas du json"), None);
        assert_eq!(percent("Batterie : 8 % restants"), Some(8));
        assert_eq!(percent("Battery saver"), None);
    }
}
