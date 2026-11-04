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
const UPDATEMODE: u32 = 1101;
const SAVEMODE: u32 = 1102;

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

/// Effet matériel d'un appareil (« mode » d'OpenRGB : Fixe, Respiration, Vague…)
#[derive(Clone)]
struct Mode {
    name: String,
    value: u32,
    flags: u32,
    speed_min: u32,
    speed_max: u32,
    colors_min: u32,
    colors_max: u32,
    speed: u32,
    direction: u32,
    color_mode: u32,
    colors: Vec<[u8; 3]>,
}

// Options des effets (RGBController.h)
const HAS_SPEED: u32 = 1 << 0;
const HAS_DIRECTION: u32 = 0b1110; // gauche-droite, haut-bas, horizontal-vertical
const MANUAL_SAVE: u32 = 1 << 8;
/// Couleurs propres à l'effet (et non LED par LED)
const COLORS_MODE_SPECIFIC: u32 = 2;

struct Controller {
    index: u32,
    ty: usize,
    name: String,
    active: u32,
    modes: Vec<Mode>,
    leds: u16,
}

fn controller(c: &mut Client, i: u32) -> Result<Controller, String> {
    c.send(i, REQUEST_CONTROLLER_DATA, &0u32.to_le_bytes())?;
    let body = c.recv(REQUEST_CONTROLLER_DATA)?;
    let mut r = Reader(&body, 4); // taille totale
    let ty = r.u32()? as usize;
    let name = r.string()?;
    for _ in 0..4 {
        r.string()?; // description, version, numéro de série, emplacement
    }
    let count = r.u16()?;
    let active = r.u32()?;
    let mut modes = Vec::with_capacity(count as usize);
    for _ in 0..count {
        let name = r.string()?;
        let v: Vec<u32> = (0..9).map(|_| r.u32()).collect::<Result<_, _>>()?;
        let n = r.u16()? as usize;
        let colors = (0..n).map(|_| r.take(4).map(|b| [b[0], b[1], b[2]])).collect::<Result<_, _>>()?;
        modes.push(Mode {
            name,
            value: v[0],
            flags: v[1],
            speed_min: v[2],
            speed_max: v[3],
            colors_min: v[4],
            colors_max: v[5],
            speed: v[6],
            direction: v[7],
            color_mode: v[8],
            colors,
        });
    }
    let zones = r.u16()?;
    for _ in 0..zones {
        r.string()?;
        r.take(4 * 4)?; // type, LED min, max, nombre
        let m = r.u16()? as usize;
        r.take(m)?;
    }
    let leds = r.u16()?;
    Ok(Controller { index: i, ty, name, active, modes, leds })
}

fn hex(c: &[u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2])
}

impl Controller {
    fn json(&self) -> Value {
        let modes: Vec<Value> = self
            .modes
            .iter()
            .map(|m| {
                json!({
                    "name": m.name,
                    "speed": (m.flags & HAS_SPEED != 0).then(|| json!({ "min": m.speed_min, "max": m.speed_max, "value": m.speed })),
                    "directions": m.flags & HAS_DIRECTION,
                    "direction": m.direction,
                    "colors": (m.color_mode == COLORS_MODE_SPECIFIC && m.colors_max > 0).then(|| json!({
                        "min": m.colors_min, "max": m.colors_max,
                        "value": m.colors.iter().map(hex).collect::<Vec<_>>(),
                    })),
                    "perLed": m.color_mode == 1,
                    "save": m.flags & MANUAL_SAVE != 0,
                })
            })
            .collect();
        json!({
            "index": self.index, "name": self.name, "kind": TYPES.get(self.ty).copied().unwrap_or("autre"),
            "leds": self.leds, "active": self.active, "modes": modes,
        })
    }
}

pub fn list() -> Result<Value, String> {
    let mut c = Client::connect()?;
    c.send(0, REQUEST_CONTROLLER_COUNT, &[])?;
    let n = u32::from_le_bytes(c.recv(REQUEST_CONTROLLER_COUNT)?.get(..4).ok_or("réponse vide")?.try_into().unwrap());
    let list: Vec<Value> = (0..n.min(64)).filter_map(|i| controller(&mut c, i).ok().map(|d| d.json())).collect();
    Ok(json!(list))
}

/// Description d'un effet telle que l'attend le serveur (protocole 0) : taille totale, numéro de
/// l'effet, puis l'effet lui-même dans l'ordre de REQUEST_CONTROLLER_DATA.
fn mode_packet(idx: u32, m: &Mode) -> Vec<u8> {
    let mut p = vec![0u8; 4];
    p.extend_from_slice(&idx.to_le_bytes());
    p.extend_from_slice(&(m.name.len() as u16 + 1).to_le_bytes());
    p.extend_from_slice(m.name.as_bytes());
    p.push(0);
    for v in [m.value, m.flags, m.speed_min, m.speed_max, m.colors_min, m.colors_max, m.speed, m.direction, m.color_mode] {
        p.extend_from_slice(&v.to_le_bytes());
    }
    p.extend_from_slice(&(m.colors.len() as u16).to_le_bytes());
    for c in &m.colors {
        p.extend_from_slice(&[c[0], c[1], c[2], 0]);
    }
    let n = p.len() as u32;
    p[..4].copy_from_slice(&n.to_le_bytes());
    p
}

/// Choisit l'effet matériel `mode` de l'appareil `index`, avec sa vitesse, son sens et ses couleurs
/// (bornés à ce que l'appareil annonce) ; `save` l'enregistre dans l'appareil s'il le permet.
pub fn set_mode(
    index: u32,
    mode: u32,
    speed: Option<u32>,
    direction: Option<u32>,
    colors: Option<Vec<[u8; 3]>>,
    save: bool,
) -> Result<(), String> {
    let mut c = Client::connect()?;
    let ctl = controller(&mut c, index)?;
    let mut m = ctl.modes.get(mode as usize).cloned().ok_or("effet inconnu de cet appareil")?;
    if let Some(s) = speed.filter(|_| m.flags & HAS_SPEED != 0) {
        m.speed = s.clamp(m.speed_min.min(m.speed_max), m.speed_min.max(m.speed_max));
    }
    if let Some(d) = direction.filter(|_| m.flags & HAS_DIRECTION != 0) {
        m.direction = d.min(5);
    }
    if let Some(mut cols) = colors.filter(|_| m.color_mode == COLORS_MODE_SPECIFIC) {
        let (lo, hi) = (m.colors_min as usize, (m.colors_max as usize).max(m.colors_min as usize));
        cols.truncate(hi);
        while cols.len() < lo {
            cols.push(*cols.last().unwrap_or(&[255, 255, 255]));
        }
        m.colors = cols;
    }
    let body = mode_packet(mode, &m);
    c.send(index, UPDATEMODE, &body)?;
    if save && m.flags & MANUAL_SAVE != 0 {
        c.send(index, SAVEMODE, &body)?;
    }
    // Relecture : le serveur traite les paquets dans l'ordre, l'effet est appliqué au retour
    controller(&mut c, index).map(|_| ())
}

/// Une couleur unie sur toutes les LED de l'appareil `index` (mode « personnalisé » d'OpenRGB)
pub fn set_color(index: u32, rgb: [u8; 3]) -> Result<(), String> {
    let mut c = Client::connect()?;
    let leds = controller(&mut c, index)?.leds as usize;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn description_d_effet_relue_a_l_identique() {
        let m = Mode {
            name: "Breathing".into(),
            value: 2,
            flags: HAS_SPEED | MANUAL_SAVE,
            speed_min: 0,
            speed_max: 4,
            colors_min: 1,
            colors_max: 2,
            speed: 3,
            direction: 0,
            color_mode: COLORS_MODE_SPECIFIC,
            colors: vec![[255, 0, 16], [0, 32, 255]],
        };
        let p = mode_packet(5, &m);
        assert_eq!(u32::from_le_bytes(p[..4].try_into().unwrap()) as usize, p.len());
        let mut r = Reader(&p, 4);
        assert_eq!(r.u32().unwrap(), 5);
        assert_eq!(r.string().unwrap(), "Breathing");
        let v: Vec<u32> = (0..9).map(|_| r.u32().unwrap()).collect();
        assert_eq!(v, [2, HAS_SPEED | MANUAL_SAVE, 0, 4, 1, 2, 3, 0, COLORS_MODE_SPECIFIC]);
        assert_eq!(r.u16().unwrap(), 2);
        assert_eq!(r.take(8).unwrap(), &[255, 0, 16, 0, 0, 32, 255, 0]);
        assert_eq!(r.1, p.len());
    }
}
