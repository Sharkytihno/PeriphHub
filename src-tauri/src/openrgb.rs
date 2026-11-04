// Passerelle OpenRGB (https://openrgb.org, GPL-2.0) : si OpenRGB tourne avec son serveur SDK,
// PeriphHub pilote l'éclairage de tous les appareils qu'il connaît (plus de 1 000 modèles).
// Client du protocole réseau d'OpenRGB, version 0 (la plus simple, acceptée par tous les serveurs),
// uniquement sur 127.0.0.1. Paquet : "ORGB", index d'appareil, identifiant, taille (u32 LE), données.
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};

const PORT: u16 = 6742;
const REQUEST_CONTROLLER_COUNT: u32 = 0;
const REQUEST_CONTROLLER_DATA: u32 = 1;
const SET_CLIENT_NAME: u32 = 50;
const RESIZEZONE: u32 = 1000;
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

    /// Attend que le serveur ait quelque chose à dire. OpenRGB 1.1 a un défaut : le fil de chaque appareil
    /// se rendort sans regarder sa file (condition_variable sans prédicat, NetworkServer.cpp), et une
    /// commande arrivée à ce moment-là attend la suivante. Sans réponse après 300 ms, on lui envoie donc
    /// une demande de description qui le réveille (la réponse en trop est ignorée, comme les notifications).
    fn wait_data(&mut self, dev: u32, deadline: std::time::Instant) -> Result<(), String> {
        use std::io::ErrorKind::{TimedOut, WouldBlock};
        self.0.set_read_timeout(Some(Duration::from_millis(300))).ok();
        let mut waits = 0u32;
        let r = loop {
            match self.0.peek(&mut [0u8; 1]) {
                Ok(0) => break Err("OpenRGB a fermé la connexion".to_string()),
                Ok(_) => break Ok(()),
                Err(e) if matches!(e.kind(), TimedOut | WouldBlock) => {
                    if std::time::Instant::now() >= deadline {
                        break Err("OpenRGB ne répond pas (appareil occupé ?)".to_string());
                    }
                    // Réveil à 300 ms puis toutes les 1,2 s (un appareil lent n'est pas noyé de demandes)
                    if waits % 4 == 0 && dev != u32::MAX {
                        if let Err(e) = self.send(dev, REQUEST_CONTROLLER_DATA, &0u32.to_le_bytes()) {
                            break Err(e);
                        }
                    }
                    waits += 1;
                }
                Err(e) => break Err(e.to_string()),
            }
        };
        self.0.set_read_timeout(Some(Duration::from_secs(3))).ok();
        r
    }

    /// Réponse à `id` pour l'appareil `dev` (les notifications du serveur et les réponses en trop sont
    /// ignorées). Un appareil lent (carte mère, mémoire) peut mettre plusieurs secondes à appliquer
    /// la commande précédente : jusqu'à 10 s.
    fn recv(&mut self, dev: u32, id: u32) -> Result<Vec<u8>, String> {
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        for _ in 0..64 {
            self.wait_data(dev, deadline)?;
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
            let from = u32::from_le_bytes(head[4..8].try_into().unwrap());
            if u32::from_le_bytes(head[8..12].try_into().unwrap()) == id && (dev == u32::MAX || from == dev) {
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

/// Zone d'un appareil. Taille réglable (min ≠ max) : prise ARGB de carte mère, bandeau… OpenRGB ne peut
/// pas compter les LED d'un ventilateur branché dessus : elle vaut 0 tant qu'on ne la règle pas, et ce qui
/// y est branché reste éteint.
struct Zone {
    name: String,
    min: u32,
    max: u32,
    count: u32,
}

struct Controller {
    index: u32,
    ty: usize,
    name: String,
    active: u32,
    modes: Vec<Mode>,
    zones: Vec<Zone>,
    leds: u16,
}

fn controller(c: &mut Client, i: u32) -> Result<Controller, String> {
    c.send(i, REQUEST_CONTROLLER_DATA, &0u32.to_le_bytes())?;
    let body = c.recv(i, REQUEST_CONTROLLER_DATA)?;
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
    let nz = r.u16()?;
    let mut zones = Vec::with_capacity(nz as usize);
    for _ in 0..nz {
        let name = r.string()?;
        r.u32()?; // type
        let (min, max, count) = (r.u32()?, r.u32()?, r.u32()?);
        let m = r.u16()? as usize;
        r.take(m)?;
        zones.push(Zone { name, min, max, count });
    }
    let leds = r.u16()?;
    Ok(Controller { index: i, ty, name, active, modes, zones, leds })
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
            "zones": self.zones.iter().map(|z| json!({ "name": z.name, "min": z.min, "max": z.max, "count": z.count })).collect::<Vec<_>>(),
        })
    }
}

pub fn list() -> Result<Value, String> {
    let mut c = Client::connect()?;
    let n = count(&mut c)?;
    let list: Vec<Value> = (0..n).filter_map(|i| controller(&mut c, i).ok().map(|d| d.json())).collect();
    Ok(json!(list))
}

fn count(c: &mut Client) -> Result<u32, String> {
    c.send(0, REQUEST_CONTROLLER_COUNT, &[])?;
    // Traitée par le fil du client, pas par celui d'un appareil : pas de réveil à envoyer
    let n = u32::from_le_bytes(c.recv(u32::MAX, REQUEST_CONTROLLER_COUNT)?.get(..4).ok_or("réponse vide")?.try_into().unwrap());
    Ok(n.min(64))
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
    let _one = one_at_a_time();
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

/// Une commande d'éclairage à la fois : plusieurs clics rapides ne s'empilent pas en parallèle dans les
/// files d'OpenRGB (un appareil lent les appliquerait l'une après l'autre, avec des secondes de retard)
fn one_at_a_time() -> std::sync::MutexGuard<'static, ()> {
    static OPS: Mutex<()> = Mutex::new(());
    OPS.lock().unwrap_or_else(|e| e.into_inner())
}

/// Nombre de LED de la zone `zone` (prise ARGB de carte mère…), borné à ce que l'appareil accepte.
/// OpenRGB l'enregistre dans ses réglages : il reste après un redémarrage.
pub fn resize_zone(index: u32, zone: u32, size: u32) -> Result<(), String> {
    let _one = one_at_a_time();
    let mut c = Client::connect()?;
    let ctl = controller(&mut c, index)?;
    let z = ctl.zones.get(zone as usize).ok_or("zone inconnue de cet appareil")?;
    if z.min == z.max {
        return Err("la taille de cette zone est fixe".into());
    }
    let size = size.clamp(z.min, z.max);
    let mut p = Vec::with_capacity(8);
    p.extend_from_slice(&(zone as i32).to_le_bytes());
    p.extend_from_slice(&(size as i32).to_le_bytes());
    c.send(index, RESIZEZONE, &p)?;
    // Relecture : la nouvelle taille est prise en compte au retour
    let after = controller(&mut c, index)?;
    match after.zones.get(zone as usize) {
        Some(z) if z.count == size => Ok(()),
        _ => Err("OpenRGB n'a pas changé la taille de la zone".into()),
    }
}

/// Une couleur unie sur toutes les LED de l'appareil `index` (mode « personnalisé » d'OpenRGB)
pub fn set_color(index: u32, rgb: [u8; 3]) -> Result<(), String> {
    let _one = one_at_a_time();
    let mut c = Client::connect()?;
    color_on(&mut c, index, rgb)
}

fn color_on(c: &mut Client, index: u32, rgb: [u8; 3]) -> Result<(), String> {
    let leds = controller(c, index)?.leds as usize;
    c.send(index, SETCUSTOMMODE, &[])?;
    let mut p = Vec::with_capacity(6 + 4 * leds);
    p.extend_from_slice(&((6 + 4 * leds) as u32).to_le_bytes());
    p.extend_from_slice(&(leds as u16).to_le_bytes());
    for _ in 0..leds {
        p.extend_from_slice(&[rgb[0], rgb[1], rgb[2], 0]);
    }
    c.send(index, UPDATELEDS, &p)?;
    // Relecture : la couleur est appliquée au retour (et le fil de l'appareil est réveillé s'il dormait :
    // sinon la couleur attendait le clic suivant)
    controller(c, index).map(|_| ())
}

/// La même couleur sur tous les appareils, sur une seule connexion ; un appareil en erreur n'arrête pas
/// les autres. Renvoie les erreurs par appareil.
pub fn set_color_all(rgb: [u8; 3]) -> Result<Value, String> {
    let _one = one_at_a_time();
    let mut c = Client::connect()?;
    let n = count(&mut c)?;
    let mut errors = Vec::new();
    for i in 0..n {
        if let Err(e) = color_on(&mut c, i, rgb) {
            errors.push(json!({ "index": i, "error": e }));
            // Connexion peut-être désynchronisée après un délai dépassé : on repart d'une neuve
            c = Client::connect()?;
        }
    }
    Ok(json!({ "count": n, "errors": errors }))
}

// ---------- OpenRGB livré avec PeriphHub ----------
// La version portable officielle d'OpenRGB (scripts/fetch-openrgb.ps1) est installée avec PeriphHub,
// dans resources/openrgb : rien à télécharger ni à installer pour l'utilisateur. PeriphHub la lance
// sans fenêtre (serveur SDK seul, réglages dans %LOCALAPPDATA%\PeriphHub\OpenRGB) et elle s'arrête
// avec lui : elle est rattachée à un « job » Windows fermé à la fin de PeriphHub, même en cas de
// plantage (aucun fichier verrouillé pour la mise à jour suivante).
//
// Sécurité : rien n'est lancé si un seul fichier diffère de la version publiée (empreintes ci-dessous).

// OpenRGB 1.1 (à changer avec scripts/fetch-openrgb.ps1)
pub(crate) const FILES: &[(&str, &str)] = &[
    ("dxcompiler.dll", "6ec587d1952778a41a5a90647b39d0c86958e7dabf87fa1cf2b14408bfe1e8de"),
    ("dxil.dll", "a0cfaf3e930894e9b5d48efcacaed6ace5c645bad3c4e99b4a23c9831a078120"),
    ("hidapi-hotplug.dll", "263a662b014a7082871bb3e46f4d3c4790d7ed253768dcd585264fd598892dfb"),
    ("imageformats/qgif.dll", "9cb2a7645576e72db54f957e9431b6145daf55bb83f4879cc01f864d4af96621"),
    ("imageformats/qico.dll", "41038802daf3a01d4701f88e2c7730c41a9e7e63fa8c985e2ef4a9a9370b2d6e"),
    ("imageformats/qjpeg.dll", "c6d100f40b051a1750cda26c46b66694b8854eae01de45a0d4510b779b5ea88d"),
    ("LedsValve.bin", "1c1809281ae6f3e3c5b362f1536c0e6706013e6e33bfba66cad74636e61436d6"),
    ("libusb-1.0.dll", "a8c91f0ff68fb7802a9f4416728f0eeb4d99af4ceaa4ef7dfe9374e76e375018"),
    ("LpcIO.bin", "b3896a1cab0d808fca31fe2ebcae045d59dac690da87b17c858bb8da357eb45e"),
    ("OpenRGB.exe", "e26ae71162795a8abcfb90c05c1572a00ba06ca63b886aca57392a0138963b1e"),
    ("PawnIOLib.dll", "c6e7c2f54643ef9cb51b9a3ec7b0efc9e204803c206f33014e39f281546ea9b4"),
    ("platforms/qwindows.dll", "d858a41e1617052f113442ea755696bc6dbe8030e64266e3ff3dc27fddea6bef"),
    ("Qt6Core.dll", "8632f4a9f57355680f1b0de5013eb4657b1038b0cedc7c0534db827f73162014"),
    ("Qt6Core5Compat.dll", "0d949a077144cfe2fecd4a030a3a6fbf0d651501e1b39bbdaaa11f56c74c25a2"),
    ("Qt6Gui.dll", "1c6ab7a785ade7a8964f67cce21e6099b1209301498726019189ea0023e6f24c"),
    ("Qt6OpenGL.dll", "bfb1be764c0e9d75682319b14d8ba0493d89a52d1680e1cc914525ea1ad944fb"),
    ("Qt6Widgets.dll", "baf97dfdb7fe72a14e1675f37b21cc8634c7ec26cc9082f4883aa7492292a1db"),
    ("SmbusI801.bin", "a0f7d066e7efda28c0e754c1f52dbd8dc280d388ba8575b514a80cb67490530c"),
    ("SmbusIntelSkylakeIMC.bin", "2e2d6c1e541fdfe598aa8df4d334e11c491c8a84f23e8256dd18119dd420dbd2"),
    ("SmbusNCT6793.bin", "db068c6a87c0066ebfb7f691d88422fee8af350898e7a7f0db100fd6632bab17"),
    ("SmbusPIIX4.bin", "91f9b4b1c39e3d399ce48477a89d8f6bd3e58a2241064a4daec3a1513dff56e5"),
    ("styles/qmodernwindowsstyle.dll", "518118bbe1eba484b431a5eff1a212a1ffe8b92305db18a3476a6a6217a78c9f"),
];

fn bundled_dir(app: &AppHandle) -> Option<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(r) = app.path().resource_dir() {
        dirs.push(r.join("resources"));
        dirs.push(r);
    }
    if let Some(d) = std::env::current_exe().ok().and_then(|p| p.parent().map(PathBuf::from)) {
        dirs.push(d.join("resources"));
        // compilation de développement : src-tauri/target/release → src-tauri/resources
        dirs.push(d.join("..").join("..").join("resources"));
    }
    dirs.into_iter().map(|d| d.join("openrgb")).find(|d| d.join("OpenRGB.exe").is_file())
}

/// Dossier de la copie livrée, vérifiée fichier par fichier (une fois par lancement de PeriphHub)
fn bundled(app: &AppHandle) -> Result<PathBuf, String> {
    static CHECKED: OnceLock<Result<PathBuf, String>> = OnceLock::new();
    CHECKED
        .get_or_init(|| {
            let dir = bundled_dir(app).ok_or("OpenRGB livré avec PeriphHub absent")?;
            verify_dir(&dir)?;
            Ok(dir)
        })
        .clone()
}

pub(crate) fn sha256_file(p: &std::path::Path) -> Option<String> {
    let bytes = std::fs::read(p).ok()?;
    Some(Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect())
}

/// Chaque fichier de `dir` est celui de la version publiée (table FILES)
pub(crate) fn verify_dir(dir: &std::path::Path) -> Result<(), String> {
    for (name, want) in FILES {
        match sha256_file(&dir.join(name)) {
            None => return Err(format!("OpenRGB incomplet ({name} manquant)")),
            Some(h) if h != *want => return Err(format!("OpenRGB modifié ({name}) : empreinte inattendue, il ne sera pas lancé")),
            _ => {}
        }
    }
    Ok(())
}

/// Réglages d'OpenRGB (OpenRGB.json dans `dir`) : détecteurs des appareils que PeriphHub pilote lui-même
/// coupés (openrgb_off.rs). Sans ça, OpenRGB garde leurs interfaces HID ouvertes et PeriphHub, ou
/// HeadsetControl, ne peut plus leur parler (clavier qui apparaît puis disparaît, casque muet…).
/// Les autres réglages du fichier sont gardés.
pub(crate) fn write_config(dir: &std::path::Path) -> Result<(), String> {
    let f = dir.join("OpenRGB.json");
    let mut v: Value = std::fs::read(&f).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(json!({}));
    if !v.is_object() {
        v = json!({});
    }
    if !v["Detectors"].is_object() {
        v["Detectors"] = json!({});
    }
    if !v["Detectors"]["detectors"].is_object() {
        v["Detectors"]["detectors"] = json!({});
    }
    for n in crate::openrgb_off::OFF.iter().chain(crate::openrgb_off::OFF_UNLISTED) {
        v["Detectors"]["detectors"][*n] = json!(false);
    }
    std::fs::write(&f, serde_json::to_vec_pretty(&v).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// Tous les détecteurs de openrgb_off.rs sont coupés dans ces réglages (sauf OFF_UNLISTED, qu'OpenRGB efface)
pub(crate) fn config_ok(v: &Value) -> bool {
    crate::openrgb_off::OFF.iter().all(|n| v["Detectors"]["detectors"][*n] == json!(false))
}

// OpenRGB lancé par PeriphHub, et le job qui l'arrête avec lui
static CHILD: Mutex<Option<Child>> = Mutex::new(None);
static JOB: OnceLock<usize> = OnceLock::new();

fn kill_with_us(child: &Child) {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::JobObjects::*;
    let job = *JOB.get_or_init(|| unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return 0;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        // Jamais fermé : Windows le ferme à la fin de PeriphHub, ce qui arrête OpenRGB
        job as usize
    });
    if job != 0 {
        unsafe { AssignProcessToJobObject(job as _, child.as_raw_handle() as _) };
    }
}

/// OpenRGB lancé par PeriphHub encore en marche ?
fn ours_alive() -> bool {
    let mut g = CHILD.lock().unwrap_or_else(|e| e.into_inner());
    match g.as_mut().map(|c| c.try_wait()) {
        Some(Ok(None)) => true,
        Some(_) => {
            *g = None;
            false
        }
        None => false,
    }
}

/// Arrête l'OpenRGB lancé par PeriphHub (fermeture, mise à jour). Celui de l'utilisateur n'est jamais touché.
pub fn stop() {
    if let Some(mut c) = CHILD.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = c.kill();
        let _ = c.wait();
    }
}

// ---------- OpenRGB installé par l'utilisateur ----------
// Utilisé seulement si la copie livrée manque (compilation de développement sans
// scripts/fetch-openrgb.ps1) : emplacements habituels (installateur officiel, winget, dossier dézippé).

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

/// État d'OpenRGB, sans aucun chemin (le diagnostic est envoyé tel quel).
/// `bundled` : copie livrée présente et intacte ; `ours` : c'est PeriphHub qui l'a lancée.
pub fn info(app: &AppHandle) -> Result<Value, String> {
    let ours = ours_alive();
    let proc_ = running();
    let bundled = bundled(app);
    let installed = bundled.is_ok() || proc_.is_some() || candidates().iter().any(|p| p.is_file());
    let mut v = json!({
        "installed": installed, "running": proc_.is_some(), "server": server_up(), "ours": ours,
        "bundled": bundled.is_ok(), "bundledError": bundled.err(),
    });
    // Service « mémoire et carte mère » (openrgb_service.rs) : service, serviceStale, pawnio
    if let (Some(o), Value::Object(svc)) = (v.as_object_mut(), crate::openrgb_service::info()) {
        o.extend(svc);
    }
    Ok(v)
}

/// Lance OpenRGB avec son serveur SDK : la copie livrée, sans fenêtre ; sinon celle de l'utilisateur,
/// réduite. Refuse si l'utilisateur a déjà ouvert le sien sans serveur (on ne tue pas son logiciel).
pub fn launch(app: &AppHandle) -> Result<Value, String> {
    use std::os::windows::process::CommandExt;
    if server_up() || ours_alive() {
        // Déjà prêt, ou lancé par PeriphHub et encore en train de détecter les appareils
        return info(app);
    }
    // Service installé (mémoire et carte mère) : c'est lui qui sert, jamais un second OpenRGB à côté
    match crate::openrgb_service::state(crate::openrgb_service::SERVICE) {
        None => {}
        Some(windows_sys::Win32::System::Services::SERVICE_RUNNING | windows_sys::Win32::System::Services::SERVICE_START_PENDING) => {
            return info(app);
        }
        Some(_) => return Err("le service OpenRGB de PeriphHub est arrêté : réactivez l’éclairage de la mémoire (onglet Éclairage)".into()),
    }
    if running().is_some() {
        return Err("OpenRGB est déjà ouvert sans son serveur : fermez-le (icône près de l’horloge), puis relancez-le depuis PeriphHub".into());
    }
    let mut cmd = match bundled(app) {
        Ok(dir) => {
            let mut cmd = Command::new(dir.join("OpenRGB.exe"));
            // Réglages et profils à part : ceux d'un OpenRGB installé par l'utilisateur ne sont pas touchés
            let conf = std::env::var("LOCALAPPDATA").map(|b| PathBuf::from(b).join("PeriphHub").join("OpenRGB"));
            cmd.args(["--server", "--noautoconnect"]);
            if let Ok(c) = conf {
                let _ = std::fs::create_dir_all(&c);
                let _ = write_config(&c);
                cmd.arg("--config").arg(c);
            }
            cmd.current_dir(dir);
            cmd
        }
        Err(e) => {
            let exe = candidates().into_iter().find(|p| p.is_file()).ok_or(e)?;
            let mut cmd = Command::new(&exe);
            cmd.args(["--server", "--startminimized"]);
            if let Some(d) = exe.parent() {
                cmd.current_dir(d);
            }
            cmd
        }
    };
    let child = cmd.creation_flags(NO_WINDOW).spawn().map_err(|e| format!("lancement impossible : {e}"))?;
    kill_with_us(&child);
    *CHILD.lock().unwrap_or_else(|e| e.into_inner()) = Some(child);
    // Le serveur répond après la détection des appareils (quelques secondes)
    for _ in 0..40 {
        if server_up() {
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    info(app)
}

#[cfg(test)]
mod tests {
    use super::*;

    // scripts/fetch-openrgb.ps1 et la table FILES doivent changer ensemble (ignoré si OpenRGB n'est pas téléchargé)
    #[test]
    fn copie_livree_conforme_a_la_table() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("openrgb");
        if !dir.join("OpenRGB.exe").is_file() {
            return;
        }
        let mut on_disk = Vec::new();
        fn walk(d: &std::path::Path, base: &std::path::Path, out: &mut Vec<String>) {
            for e in std::fs::read_dir(d).unwrap().flatten() {
                let p = e.path();
                if p.is_dir() {
                    walk(&p, base, out);
                } else if !e.file_name().to_string_lossy().starts_with('.') {
                    out.push(p.strip_prefix(base).unwrap().to_string_lossy().replace('\\', "/"));
                }
            }
        }
        walk(&dir, &dir, &mut on_disk);
        on_disk.sort_by_key(|s| s.to_lowercase());
        let mut table: Vec<String> = FILES.iter().map(|(n, _)| n.to_string()).collect();
        table.sort_by_key(|s| s.to_lowercase());
        assert_eq!(on_disk, table, "fichiers d'OpenRGB différents de la table FILES");
        for (name, want) in FILES {
            let hash: String = Sha256::digest(std::fs::read(dir.join(name)).unwrap()).iter().map(|b| format!("{b:02x}")).collect();
            assert_eq!(&hash, want, "{name}");
        }
    }

    // openrgb_off.rs vient des sources de la même version qu'OpenRGB livré : chaque nom y figure
    #[test]
    fn detecteurs_coupes_connus_d_openrgb() {
        let exe = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("openrgb").join("OpenRGB.exe");
        let Ok(bin) = std::fs::read(&exe) else { return };
        for n in crate::openrgb_off::OFF.iter().chain(crate::openrgb_off::OFF_UNLISTED) {
            assert!(bin.windows(n.len()).any(|w| w == n.as_bytes()), "détecteur inconnu d'OpenRGB : {n}");
        }
    }

    #[test]
    fn reglages_gardes_et_detecteurs_coupes() {
        let dir = std::env::temp_dir().join(format!("ph-orgb-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("OpenRGB.json"), r#"{"Server":{"port":6742},"Detectors":{"detectors":{"SteelSeries Rival 3":true,"MSI Mystic Light":true}}}"#).unwrap();
        write_config(&dir).unwrap();
        let v: Value = serde_json::from_slice(&std::fs::read(dir.join("OpenRGB.json")).unwrap()).unwrap();
        assert!(config_ok(&v));
        assert_eq!(v["Detectors"]["detectors"]["SteelSeries Rival 3"], json!(false));
        assert_eq!(v["Detectors"]["detectors"]["MSI Mystic Light"], json!(true));
        assert_eq!(v["Server"]["port"], json!(6742));
        let _ = std::fs::remove_dir_all(&dir);
    }

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

#[cfg(test)]
mod live {
    use super::*;
    // Contre un serveur OpenRGB lancé à la main : cargo test openrgb::live -- --ignored --nocapture
    #[test]
    #[ignore]
    fn couleur_partout_puis_effet_d_origine() {
        let mut c = Client::connect().unwrap();
        let n = count(&mut c).unwrap();
        let before: Vec<Controller> = (0..n).map(|i| controller(&mut c, i).unwrap()).collect();
        drop(c);
        for d in &before {
            println!("#{} {} · {} LED · effet {}", d.index, d.name, d.leds, d.modes.get(d.active as usize).map(|m| m.name.as_str()).unwrap_or("?"));
        }
        for _ in 0..3 {
            let t = std::time::Instant::now();
            let r = set_color_all([255, 0, 0]).unwrap();
            println!("tous en rouge : {:?} · {r}", t.elapsed());
        }
        // Zones à taille réglable : 12 LED puis taille d'origine
        for d in &before {
            for (zi, z) in d.zones.iter().enumerate() {
                println!("#{} zone {} : {} ({}-{})", d.index, z.name, z.count, z.min, z.max);
                if z.max > z.min {
                    let t = std::time::Instant::now();
                    resize_zone(d.index, zi as u32, 12).unwrap();
                    let mut c = Client::connect().unwrap();
                    let now = controller(&mut c, d.index).unwrap();
                    println!("  → 12 LED en {:?} : zone {} LED, appareil {} LED", t.elapsed(), now.zones[zi].count, now.leds);
                    drop(c);
                    set_color(d.index, [0, 0, 255]).unwrap();
                    resize_zone(d.index, zi as u32, z.count.max(z.min)).unwrap();
                    println!("  → remise à {}", z.count);
                }
            }
        }
        for d in &before {
            let t = std::time::Instant::now();
            let m = &d.modes[d.active as usize];
            set_mode(d.index, d.active, Some(m.speed), Some(m.direction), Some(m.colors.clone()), false).unwrap();
            println!("#{} effet d'origine remis : {:?}", d.index, t.elapsed());
        }
    }
}
