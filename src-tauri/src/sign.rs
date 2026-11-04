// Vérification de signature Authenticode avant de charger un fichier d'un éditeur tiers
// (ex. la DLL THX de Razer, installée dans un dossier modifiable sans droits administrateur).
// Faite par l'API de Windows (WinVerifyTrust, celle de l'Explorateur et de SmartScreen) : aucun
// PowerShell lancé en arrière-plan, ce que les antivirus surveillent de près.
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use windows_sys::Win32::Foundation::HANDLE;

/// Signature valide ET émise pour l'éditeur attendu. Renvoie le nom de l'éditeur.
pub fn check_signature(file: &Path, expected: &str) -> Result<String, String> {
    let signer = verify(file)?;
    let norm: String = signer
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_lowercase();
    if !norm.contains(expected) {
        return Err(format!("éditeur inattendu ({signer}) : fichier refusé"));
    }
    Ok(signer)
}

/// Signature intégrée au fichier : empreinte intacte, chaîne jusqu'à une autorité racine de
/// confiance. Renvoie le nom du signataire.
fn verify(file: &Path) -> Result<String, String> {
    use windows_sys::Win32::Security::WinTrust::{
        WinVerifyTrust, WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_DATA_0, WINTRUST_FILE_INFO,
        WTD_CHOICE_FILE, WTD_REVOKE_NONE, WTD_STATEACTION_CLOSE, WTD_STATEACTION_VERIFY, WTD_UI_NONE,
    };
    let wide: Vec<u16> = file.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut info = WINTRUST_FILE_INFO {
        cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
        pcwszFilePath: wide.as_ptr(),
        ..Default::default()
    };
    let mut data = WINTRUST_DATA {
        cbStruct: std::mem::size_of::<WINTRUST_DATA>() as u32,
        dwUIChoice: WTD_UI_NONE,
        fdwRevocationChecks: WTD_REVOKE_NONE,
        dwUnionChoice: WTD_CHOICE_FILE,
        Anonymous: WINTRUST_DATA_0 { pFile: &mut info },
        dwStateAction: WTD_STATEACTION_VERIFY,
        ..Default::default()
    };
    let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    let status = unsafe { WinVerifyTrust(std::ptr::null_mut(), &mut action, (&mut data as *mut WINTRUST_DATA).cast()) };
    // Le signataire se lit tant que l'état de la vérification est ouvert, puis on le referme
    let signer = if status == 0 { unsafe { signer_name(data.hWVTStateData) } } else { None };
    data.dwStateAction = WTD_STATEACTION_CLOSE;
    unsafe { WinVerifyTrust(std::ptr::null_mut(), &mut action, (&mut data as *mut WINTRUST_DATA).cast()) };
    if status != 0 {
        return Err(format!("signature numérique {} : fichier refusé", trust_error(status)));
    }
    signer.ok_or_else(|| "signataire illisible : fichier refusé".to_string())
}

/// Nom simple (« Razer USA Ltd. ») du certificat du premier signataire.
unsafe fn signer_name(state: HANDLE) -> Option<String> {
    use windows_sys::Win32::Security::Cryptography::{CertGetNameStringW, CERT_NAME_SIMPLE_DISPLAY_TYPE};
    use windows_sys::Win32::Security::WinTrust::{
        WTHelperGetProvCertFromChain, WTHelperGetProvSignerFromChain, WTHelperProvDataFromStateData,
    };
    let prov = WTHelperProvDataFromStateData(state);
    if prov.is_null() {
        return None;
    }
    let sgnr = WTHelperGetProvSignerFromChain(prov, 0, 0, 0);
    if sgnr.is_null() {
        return None;
    }
    let cert = WTHelperGetProvCertFromChain(sgnr, 0);
    if cert.is_null() || (*cert).pCert.is_null() {
        return None;
    }
    let mut buf = [0u16; 256];
    let n = CertGetNameStringW(
        (*cert).pCert,
        CERT_NAME_SIMPLE_DISPLAY_TYPE,
        0,
        std::ptr::null(),
        buf.as_mut_ptr(),
        buf.len() as u32,
    ) as usize;
    // n compte le zéro final ; 1 = nom vide
    (n > 1 && n <= buf.len()).then(|| String::from_utf16_lossy(&buf[..n - 1]))
}

fn trust_error(code: i32) -> String {
    match code as u32 {
        0x800B_0100 => "absente".into(),                                // TRUST_E_NOSIGNATURE
        0x8009_6010 => "altérée (fichier modifié après signature)".into(), // TRUST_E_BAD_DIGEST
        0x800B_0101 => "expirée".into(),                                // CERT_E_EXPIRED
        0x800B_010C => "révoquée".into(),                               // CERT_E_REVOKED
        0x800B_0109 | 0x800B_010A => "d’une autorité non reconnue".into(), // CERT_E_UNTRUSTEDROOT, CERT_E_CHAINING
        0x800B_0111 => "refusée par Windows".into(),                    // TRUST_E_EXPLICIT_DISTRUST
        c => format!("invalide (0x{c:08X})"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fichier_non_signe_refuse() {
        let p = std::env::temp_dir().join(format!("periphhub-sign-{}.dll", std::process::id()));
        std::fs::write(&p, b"MZ pas un vrai programme").unwrap();
        let r = check_signature(&p, "razer");
        let _ = std::fs::remove_file(&p);
        let e = r.unwrap_err();
        assert!(e.contains("fichier refusé"), "{e}");
    }

    #[test]
    fn signature_microsoft_reconnue() {
        // Edge (signature intégrée) est présent sur Windows 10 et 11 ; ignoré s'il manque
        let candidates = [
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        ];
        let Some(p) = candidates.iter().map(Path::new).find(|p| p.exists()) else {
            return;
        };
        assert!(check_signature(p, "microsoft").unwrap().to_lowercase().contains("microsoft"));
        // Bon fichier, mauvais éditeur : refusé
        assert!(check_signature(p, "razer").unwrap_err().contains("éditeur inattendu"));
    }
}
