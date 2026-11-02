// Vérification de signature Authenticode avant de charger un fichier d'un éditeur tiers
// (ex. la DLL THX de Razer, installée dans un dossier modifiable sans droits administrateur).
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;

const NO_WINDOW: u32 = 0x0800_0000;

/// Chemin absolu d'un outil de Windows (System32). Jamais résolu par nom : Windows chercherait
/// d'abord dans le dossier de PeriphHub, modifiable sans droits administrateur (installation par
/// utilisateur), où un faux `sc.exe` serait lancé par l'instance administrateur.
pub fn system_exe(rel: &str) -> std::path::PathBuf {
    use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;
    let mut buf = [0u16; 260];
    let n = unsafe { GetSystemDirectoryW(buf.as_mut_ptr(), buf.len() as u32) } as usize;
    let dir = if n > 0 && n < buf.len() {
        String::from_utf16_lossy(&buf[..n])
    } else {
        r"C:\Windows\System32".to_string()
    };
    std::path::Path::new(&dir).join(rel)
}

/// Signature valide ET émise pour l'éditeur attendu. Renvoie le nom de l'éditeur.
pub fn check_signature(file: &Path, expected: &str) -> Result<String, String> {
    let out = Command::new(system_exe(r"WindowsPowerShell\v1.0\powershell.exe"))
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$s = Get-AuthenticodeSignature -LiteralPath $env:PH_FILE; \
             $s.Status.ToString() + '|' + $s.SignerCertificate.GetNameInfo('SimpleName', $false)",
        ])
        .env("PH_FILE", file)
        .creation_flags(NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let (status, signer) = text.split_once('|').unwrap_or((&text, ""));
    if status != "Valid" {
        return Err(format!("signature numérique invalide ({status}) : fichier refusé"));
    }
    let norm: String = signer
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_lowercase();
    if !norm.contains(expected) {
        return Err(format!("éditeur inattendu ({signer}) : fichier refusé"));
    }
    Ok(signer.to_string())
}
