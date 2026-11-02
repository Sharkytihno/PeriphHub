// Signalement d'un appareil : ouvre dans le navigateur le formulaire de ticket GitHub du projet,
// prérempli avec le diagnostic. Rien n'est envoyé par PeriphHub : l'utilisateur relit le ticket
// et décide lui-même de le publier.
//
// L'adresse est fixe (seuls le titre et le texte varient, encodés) : cette commande ne peut pas
// servir à ouvrir une autre page ni à lancer un programme.

const ISSUE_FORM: &str =
    "https://github.com/Sharkytihno/PeriphHub/issues/new?template=retour-appareil.yml&labels=retour%20appareil";
// Les adresses très longues sont refusées par GitHub ou les navigateurs (~8 000 caractères)
const MAX_TITLE: usize = 120;
const MAX_REPORT_ENCODED: usize = 5000;

fn clean(s: &str, max: usize, multiline: bool) -> String {
    s.chars()
        .filter(|c| !c.is_control() || (multiline && *c == '\n'))
        .take(max)
        .collect()
}

fn encode(s: &str) -> String {
    encode_max(s, usize::MAX)
}

// Encode caractère par caractère et s'arrête avant de dépasser `max` (jamais au milieu d'un caractère)
fn encode_max(s: &str, max: usize) -> String {
    let mut out = String::new();
    let mut buf = [0u8; 4];
    for c in s.chars() {
        let mut part = String::new();
        for b in c.encode_utf8(&mut buf).bytes() {
            match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => part.push(b as char),
                _ => part.push_str(&format!("%{b:02X}")),
            }
        }
        if out.len() + part.len() > max {
            break;
        }
        out.push_str(&part);
    }
    out
}

pub fn issue_url(model: &str, version: &str, report: &str) -> String {
    let model = clean(model, MAX_TITLE, false);
    format!(
        "{ISSUE_FORM}&title={}&model={}&version={}&report={}",
        encode(&format!("[Retour] {model}")),
        encode(&model),
        encode(&clean(version, 20, false)),
        encode_max(&clean(report, usize::MAX, true), MAX_REPORT_ENCODED),
    )
}

pub fn open_issue(model: &str, version: &str, report: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let url = issue_url(model, version, report);
    debug_assert!(url.starts_with("https://github.com/Sharkytihno/PeriphHub/issues/new?"));
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let (verb, file) = (wide("open"), wide(&url));
    // ShellExecute renvoie une valeur > 32 en cas de succès
    let r = unsafe {
        ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), file.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL)
    };
    if r as usize > 32 { Ok(()) } else { Err("impossible d’ouvrir le navigateur".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adresse_fixe_et_texte_encode() {
        let u = issue_url("Rival 3 & co\u{7}", "0.13.0", "ligne 1\nligne 2 \"x\" <y>");
        assert!(u.starts_with(ISSUE_FORM));
        assert!(u.contains("&model=Rival%203%20%26%20co&"));
        assert!(u.contains("ligne%201%0Aligne%202%20%22x%22%20%3Cy%3E"));
        assert!(!u.contains(' ') && !u.contains('\n'));
    }

    #[test]
    fn longueurs_bornees() {
        let u = issue_url(&"a".repeat(5000), &"9".repeat(500), &"é".repeat(10000));
        assert!(u.len() < 8000, "{}", u.len());
    }
}
