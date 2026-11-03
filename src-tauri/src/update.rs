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
use tauri::{AppHandle, Emitter};
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

/// Télécharge l'installeur (progression : événement « update-progress »), vérifie sa signature puis
/// le lance en mode passif : PeriphHub se ferme, l'installeur attend qu'il soit vraiment fermé
/// (windows/hooks.nsh), installe et relance PeriphHub. Rien à faire pour l'utilisateur.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    if from_store() {
        return Err("mises à jour assurées par le Microsoft Store".into());
    }
    let u = find(&app).await?.ok_or("aucune mise à jour disponible")?;
    let mut done = 0u64;
    let bytes = u
        .download(
            |chunk, total| {
                done += chunk as u64;
                let _ = app.emit("update-progress", json!({ "done": done, "total": total }));
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    let _ = app.emit("update-progress", json!({ "installing": true }));
    // Laisse l'interface afficher « Installation… » avant que la fenêtre ne disparaisse
    tokio_sleep(Duration::from_millis(400)).await;
    // Sous Windows, install() lance l'installeur puis termine PeriphHub (ne revient qu'en cas d'erreur)
    u.install(bytes).map_err(|e| e.to_string())?;
    app.restart();
}

async fn tokio_sleep(d: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}

/// Supprime les anciens exécutables mis de côté par l'installeur pendant une mise à jour
/// (windows/hooks.nsh : un programme encore en cours de fermeture est renommé en « .old »).
pub fn cleanup_old() {
    let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) else {
        return;
    };
    for d in [dir.clone(), dir.join("resources")] {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_lowercase();
            if name.ends_with(".exe.old") || name.ends_with(".exe.old2") {
                // encore verrouillé (ancien processus pas tout à fait fermé) : ce sera pour la prochaine fois
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn hors_store() {
        // Les tests tournent hors paquet MSIX : la mise à jour intégrée doit rester active
        assert!(!super::from_store());
    }
}
