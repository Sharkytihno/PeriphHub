// Notifications de Windows (centre de notifications) : batterie faible d'un appareil, comme le font
// les logiciels constructeurs. API WinRT standard, aucun processus lancé.
//
// Windows n'affiche la notification d'une application de bureau que si elle a un identifiant
// d'application (AppUserModelID) connu :
// - installeur : l'installeur de Tauri le pose sur le raccourci du menu Démarrer (= identifiant du
//   bundle, tauri.conf.json) ;
// - Microsoft Store : identité du paquet.
// Exécutable lancé sans installation : Windows ignore la notification, sans erreur visible.

use windows::core::HSTRING;
use windows::Data::Xml::Dom::XmlDocument;
use windows::UI::Notifications::{NotificationSetting, ToastNotification, ToastNotificationManager, ToastNotifier};

const AUMID: &str = "io.github.sharkytihno.periphhub";

fn esc(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn xml(title: &str, body: &str) -> String {
    format!(
        "<toast><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual></toast>",
        esc(title),
        esc(body)
    )
}

fn notifier() -> windows::core::Result<ToastNotifier> {
    if crate::update::from_store() {
        ToastNotificationManager::CreateToastNotifier()
    } else {
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(AUMID))
    }
}

pub fn show(title: &str, body: &str) -> Result<(), String> {
    let doc = XmlDocument::new().map_err(|e| e.to_string())?;
    doc.LoadXml(&HSTRING::from(xml(title, body))).map_err(|e| e.to_string())?;
    let toast = ToastNotification::CreateToastNotification(&doc).map_err(|e| e.to_string())?;
    notifier().and_then(|n| n.Show(&toast)).map_err(|e| e.to_string())
}

/// Les notifications de PeriphHub peuvent-elles s'afficher ? (Windows les ignore sans erreur sinon)
/// « on », « off-app » (coupées pour PeriphHub), « off-user » (coupées pour tout Windows),
/// « off-policy » (stratégie de l'entreprise), « off » (autre raison), « unknown » (sans installation)
pub fn state() -> &'static str {
    match notifier().and_then(|n| n.Setting()) {
        Ok(NotificationSetting::Enabled) => "on",
        Ok(NotificationSetting::DisabledForApplication) => "off-app",
        Ok(NotificationSetting::DisabledForUser) => "off-user",
        Ok(NotificationSetting::DisabledByGroupPolicy) => "off-policy",
        Ok(_) => "off",
        Err(_) => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn texte_echappe() {
        let x = xml("Batterie <faible>", "Souris \"A&B\"\n: 12 %");
        assert!(x.contains("Batterie &lt;faible&gt;"));
        assert!(x.contains("Souris &quot;A&amp;B&quot;: 12 %"));
        assert!(!x.contains('\n'));
    }

    // Vraie notification (PeriphHub installé) : cargo test toast -- --ignored
    #[test]
    #[ignore]
    fn notification_reelle() {
        show("PeriphHub", "Essai : voici à quoi ressemble l’alerte de batterie faible").unwrap();
        let st = state();
        println!("notifications : {st}");
        if st != "on" {
            return; // coupées dans Windows : rien n'arrive dans le centre de notifications
        }
        // Arrivée dans le centre de notifications (sinon : identifiant inconnu de Windows). L'historique
        // n'est lisible que sous le même identifiant que l'application.
        let id: Vec<u16> = AUMID.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe { windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(id.as_ptr()) };
        std::thread::sleep(std::time::Duration::from_secs(1));
        let n = ToastNotificationManager::History()
            .and_then(|h| h.GetHistoryWithId(&HSTRING::from(AUMID)))
            .and_then(|l| l.Size())
            .unwrap();
        assert!(n > 0, "notification absente du centre de notifications");
    }

    #[test]
    fn identifiant_du_bundle() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"], AUMID);
    }
}
