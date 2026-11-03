// Passerelle OpenRGB (https://openrgb.org, GPL-2.0) : si OpenRGB tourne avec son serveur SDK,
// PeriphHub pilote l'éclairage de tous les appareils qu'il connaît (plus de 1 000 modèles).
// Client du protocole réseau d'OpenRGB, version 0 (la plus simple, acceptée par tous les serveurs),
// uniquement sur 127.0.0.1. Paquet : "ORGB", index d'appareil, identifiant, taille (u32 LE), données.
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

const PORT: u16 = 6742;
const REQUEST_CONTROLLER_COUNT: u32 = 0;
const REQUEST_CONTROLLER_DATA: u32 = 1;
const SET_CLIENT_NAME: u32 = 50;
const UPDATELEDS: u32 = 1050;
const SETCUSTOMMODE: u32 = 1100;

struct Client(TcpStream);

impl Client {
    fn connect() -> Result<Client, String> {
        let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
        let s = TcpStream::connect_timeout(&addr, Duration::from_millis(400)).map_err(|_| "OpenRGB n'est pas lancé (serveur SDK)".to_string())?;
        s.set_read_timeout(Some(Duration::from_secs(3))).ok();
        s.set_write_timeout(Some(Duration::from_secs(3))).ok();
        let mut c = Client(s);
        c.send(0, SET_CLIENT_NAME, b"PeriphHub\0")?;
        Ok(c)
    }

    fn send(&mut self, dev: u32, id: u32, data: &[u8]) -> Result<(), String> {
        let mut p = Vec::with_capacity(16 + data.len());
        p.extend_from_slice(b"ORGB");
        for v in [dev, id, data.len() as u32] {
            p.extend_from_slice(&v.to_le_bytes());
        }
        p.extend_from_slice(data);
        self.0.write_all(&p).map_err(|e| e.to_string())
    }

    /// Réponse à `id` (les notifications du serveur sont ignorées)
    fn recv(&mut self, id: u32) -> Result<Vec<u8>, String> {
        for _ in 0..16 {
            let mut head = [0u8; 16];
            self.0.read_exact(&mut head).map_err(|e| e.to_string())?;
            if &head[..4] != b"ORGB" {
                return Err("réponse OpenRGB invalide".into());
            }
            let size = u32::from_le_bytes(head[12..16].try_into().unwrap()) as usize;
            if size > 16 << 20 {
                return Err("réponse OpenRGB trop grande".into());
            }
            let mut body = vec![0u8; size];
            self.0.read_exact(&mut body).map_err(|e| e.to_string())?;
            if u32::from_le_bytes(head[8..12].try_into().unwrap()) == id {
                return Ok(body);
            }
        }
        Err("pas de réponse d'OpenRGB".into())
    }
}

/// Lecture d'une description d'appareil (protocole 0)
struct Reader<'a>(&'a [u8], usize);

impl Reader<'_> {
    fn take(&mut self, n: usize) -> Result<&[u8], String> {
        let s = self.0.get(self.1..self.1 + n).ok_or("description OpenRGB tronquée")?;
        self.1 += n;
        Ok(s)
    }
    fn u16(&mut self) -> Result<u16, String> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn string(&mut self) -> Result<String, String> {
        let n = self.u16()? as usize;
        Ok(String::from_utf8_lossy(self.take(n)?).trim_end_matches('\0').to_string())
    }
}

const TYPES: [&str; 19] = [
    "carte mère", "mémoire", "carte graphique", "refroidissement", "bandeau LED", "clavier", "souris",
    "tapis", "casque", "support de casque", "manette", "lumière", "enceinte", "virtuel", "stockage",
    "boîtier", "micro", "accessoire", "pavé",
];

fn controller(c: &mut Client, i: u32) -> Result<Value, String> {
    c.send(i, REQUEST_CONTROLLER_DATA, &0u32.to_le_bytes())?;
    let body = c.recv(REQUEST_CONTROLLER_DATA)?;
    let mut r = Reader(&body, 4); // taille totale
    let ty = r.u32()? as usize;
    let name = r.string()?;
    for _ in 0..4 {
        r.string()?; // description, version, numéro de série, emplacement
    }
    let modes = r.u16()?;
    r.u32()?; // mode actif
    for _ in 0..modes {
        r.string()?;
        r.take(4 * 9)?; // valeur, options, vitesses, couleurs min/max, vitesse, direction, mode couleur
        let n = r.u16()? as usize;
        r.take(4 * n)?;
    }
    let zones = r.u16()?;
    for _ in 0..zones {
        r.string()?;
        r.take(4 * 4)?; // type, LED min, max, nombre
        let m = r.u16()? as usize;
        r.take(m)?;
    }
    let leds = r.u16()?;
    Ok(json!({ "index": i, "name": name, "kind": TYPES.get(ty).copied().unwrap_or("autre"), "leds": leds }))
}

pub fn list() -> Result<Value, String> {
    let mut c = Client::connect()?;
    c.send(0, REQUEST_CONTROLLER_COUNT, &[])?;
    let n = u32::from_le_bytes(c.recv(REQUEST_CONTROLLER_COUNT)?.get(..4).ok_or("réponse vide")?.try_into().unwrap());
    let list: Vec<Value> = (0..n.min(64)).filter_map(|i| controller(&mut c, i).ok()).collect();
    Ok(json!(list))
}

/// Une couleur unie sur toutes les LED de l'appareil `index` (mode « personnalisé » d'OpenRGB)
pub fn set_color(index: u32, rgb: [u8; 3]) -> Result<(), String> {
    let mut c = Client::connect()?;
    let leds = controller(&mut c, index)?["leds"].as_u64().unwrap_or(0) as usize;
    c.send(index, SETCUSTOMMODE, &[])?;
    let mut p = Vec::with_capacity(6 + 4 * leds);
    p.extend_from_slice(&((6 + 4 * leds) as u32).to_le_bytes());
    p.extend_from_slice(&(leds as u16).to_le_bytes());
    for _ in 0..leds {
        p.extend_from_slice(&[rgb[0], rgb[1], rgb[2], 0]);
    }
    c.send(index, UPDATELEDS, &p)
}

// ---------- Installation et lancement ----------
// OpenRGB n'a pas d'installateur unique : on le cherche aux emplacements habituels (installateur
// officiel, winget, dossier dézippé dans Téléchargements/Bureau) et dans les processus lancés.

const NO_WINDOW: u32 = 0x0800_0000;

fn candidates() -> Vec<std::path::PathBuf> {
    use std::path::PathBuf;
    let mut out = Vec::new();
    for var in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
        if let Ok(b) = std::env::var(var) {
            out.push(PathBuf::from(&b).join("OpenRGB").join("OpenRGB.exe"));
        }
    }
    if let Ok(b) = std::env::var("LOCALAPPDATA") {
        out.push(PathBuf::from(&b).join("Programs").join("OpenRGB").join("OpenRGB.exe"));
        // winget (paquet portable) : %LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenRGB*\**\OpenRGB.exe
        let pk = PathBuf::from(&b).join("Microsoft").join("WinGet").join("Packages");
        if let Ok(rd) = std::fs::read_dir(&pk) {
            for e in rd.flatten() {
                if e.file_name().to_string_lossy().to_lowercase().contains("openrgb") {
                    out.extend(find_exe(&e.path(), 3));
                }
            }
        }
    }
    if let Ok(b) = std::env::var("USERPROFILE") {
        for sub in ["Downloads", "Desktop", "Documents"] {
            if let Ok(rd) = std::fs::read_dir(PathBuf::from(&b).join(sub)) {
                for e in rd.flatten() {
                    if e.path().is_dir() && e.file_name().to_string_lossy().to_lowercase().contains("openrgb") {
                        out.extend(find_exe(&e.path(), 2));
                    }
                }
            }
        }
    }
    out
}

fn find_exe(dir: &std::path::Path, depth: u32) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    let exe = dir.join("OpenRGB.exe");
    if exe.is_file() {
        out.push(exe);
    } else if depth > 0 {
        if let Ok(rd) = std::fs::read_dir(dir) {
            for e in rd.flatten() {
                if e.path().is_dir() {
                    out.extend(find_exe(&e.path(), depth - 1));
                }
            }
        }
    }
    out
}

fn running() -> Option<crate::procs::Proc> {
    crate::procs::list().into_iter().find(|p| p.name.eq_ignore_ascii_case("OpenRGB.exe"))
}

fn server_up() -> bool {
    TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], PORT)), Duration::from_millis(300)).is_ok()
}

/// État d'OpenRGB, sans aucun chemin (le diagnostic est envoyé tel quel)
pub fn info() -> Result<Value, String> {
    let proc_ = running();
    let installed = proc_.is_some() || candidates().iter().any(|p| p.is_file());
    Ok(json!({ "installed": installed, "running": proc_.is_some(), "server": server_up() }))
}

/// Lance OpenRGB avec son serveur SDK, réduit. Refuse s'il tourne déjà sans serveur (il faudrait le
/// fermer : on ne tue pas un logiciel de l'utilisateur).
pub fn launch() -> Result<Value, String> {
    use std::os::windows::process::CommandExt;
    if server_up() {
        return info();
    }
    if running().is_some() {
        return Err("OpenRGB est déjà ouvert sans son serveur : fermez-le (icône près de l’horloge), puis relancez-le depuis PeriphHub".into());
    }
    let exe = candidates().into_iter().find(|p| p.is_file()).ok_or("OpenRGB n’est pas installé")?;
    let dir = exe.parent().map(|d| d.to_path_buf());
    let mut cmd = std::process::Command::new(&exe);
    cmd.args(["--server", "--startminimized"]).creation_flags(NO_WINDOW);
    if let Some(d) = dir {
        cmd.current_dir(d);
    }
    cmd.spawn().map_err(|e| format!("lancement impossible : {e}"))?;
    // Le serveur répond après la détection des appareils (quelques secondes)
    for _ in 0..40 {
        if server_up() {
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    info()
}
