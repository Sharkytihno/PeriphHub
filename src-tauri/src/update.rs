// Mises à jour de la version téléchargée sur GitHub (l'installeur setup.exe).
//
// PeriphHub lit `latest.json` sur la dernière release publiée du dépôt. Ce fichier n'est accepté
// que s'il est signé par la clé du projet (clé publique dans tauri.conf.json, `plugins.updater`) :
// un installeur modifié ou servi par quelqu'un d'autre est refusé. Seule l'adresse IP est vue par
// GitHub, comme pour n'importe quelle page web ; rien sur l'ordinateur ni les appareils n'est envoyé.
//
// La version du Microsoft Store ne s'en sert jamais : le Store la met à jour lui-même.

use serde_json::{json, Value};
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

const TIMEOUT: Duration = Duration::from_secs(30);

/// Vrai si PeriphHub tourne comme paquet MSIX (installé depuis le Microsoft Store).
pub fn from_store() -> bool {
    use windows_sys::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;
    const APPMODEL_ERROR_NO_PACKAGE: u32 = 15700;
    let mut len = 0u32;
    let r = unsafe { GetCurrentPackageFullName(&mut len, std::ptr::null_mut()) };
    r != APPMODEL_ERROR_NO_PACKAGE
}

async fn find(app: &AppHandle) -> Result<Option<tauri_plugin_updater::Update>, String> {
    app.updater_builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Value, String> {
    if from_store() {
        return Ok(json!({ "store": true }));
    }
    Ok(match find(&app).await? {
        Some(u) => json!({ "available": true, "version": u.version, "current": u.current_version, "notes": u.body }),
        None => json!({ "available": false }),
    })
}

/// Télécharge l'installeur, vérifie sa signature puis le lance (installation sans questions) :
/// PeriphHub se ferme et l'installeur le relance une fois la mise à jour faite.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    if from_store() {
        return Err("mises à jour assurées par le Microsoft Store".into());
    }
    let u = find(&app).await?.ok_or("aucune mise à jour disponible")?;
    u.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart();
}

#[cfg(test)]
mod tests {
    #[test]
    fn hors_store() {
        // Les tests tournent hors paquet MSIX : la mise à jour intégrée doit rester active
        assert!(!super::from_store());
    }
}
