// Batterie des Samsung Galaxy Buds (Buds, Buds+, Live, Pro, Buds2, Buds2 Pro, FE, Buds3…).
//
// Windows n'affiche pas leur batterie. Les écouteurs acceptent une connexion RFCOMM sur le service
// SPP de Samsung et envoient d'eux-mêmes, dès l'ouverture, une trame d'état avec les niveaux gauche,
// droite et boîtier. PeriphHub n'envoie rien : il ouvre, lit, referme.
//   Buds2 et suivants : service {2e73a4ad-332d-41fc-90e2-16bef06523f2}
//   Buds+, Live, Pro :  SPP standard {00001101-0000-1000-8000-00805f9b34fb}
//   premiers Buds :     {00001102-0000-1000-8000-00805f9b34fd}, ancien format de trame
// Trame (Buds+ et suivants) : FD [taille lo][taille hi | drapeaux] [id] [données…] [crc lo][crc hi] DD
// Trame (premiers Buds)     : FE [type] [taille] [id] [données…] [crc lo][crc hi] EE
//   taille = id + données + crc (10 bits bas) ; bit 0x2000 = fragment ; CRC-16/XMODEM sur id + données
//   0x60 STATUS_UPDATED : [1] gauche %, [2] droite %, [6] boîtier % ; 0x61 EXTENDED : [2], [3], [7]
// Seuls les appareils connectés dont le nom contient « Buds » sont essayés. Si l'application Galaxy
// Buds tient déjà la liaison, la connexion échoue simplement.
// Méthode reprise de WirelessBattery (GPL-3.0, src/drivers/galaxy_buds.cpp), d'après GalaxyBudsClient.
use std::time::{Duration, Instant};
use windows_sys::core::GUID;
use windows_sys::Win32::Devices::Bluetooth::{AF_BTH, BTHPROTO_RFCOMM, SOCKADDR_BTH};
use windows_sys::Win32::Networking::WinSock::{
    closesocket, connect, ioctlsocket, recv, select, socket, WSAGetLastError, WSAStartup, FD_SET, FIONBIO, INVALID_SOCKET,
    SOCKADDR, SOCKET, SOCK_STREAM, TIMEVAL, WSADATA, WSAEWOULDBLOCK,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Status {
    /// Pourcentages, -1 si inconnus ou partie non connectée
    pub left: i32,
    pub right: i32,
    pub case: i32,
}

fn crc16(b: &[u8]) -> u16 {
    let mut crc = 0u16;
    for &x in b {
        crc ^= (x as u16) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 { (crc << 1) ^ 0x1021 } else { crc << 1 };
        }
    }
    crc
}

fn level(v: u8) -> i32 {
    if (1..=100).contains(&v) { v as i32 } else { -1 }
}

/// Dernière trame d'état valide d'un flux reçu
pub fn find_status(data: &[u8], legacy: bool) -> Option<Status> {
    let (som, eom) = if legacy { (0xFE, 0xEE) } else { (0xFD, 0xDD) };
    let mut found = None;
    let mut i = 0;
    while i + 6 <= data.len() {
        if data[i] != som {
            i += 1;
            continue;
        }
        let len = if legacy {
            data[i + 2] as usize
        } else {
            let header = data[i + 1] as usize | (data[i + 2] as usize) << 8;
            if header & 0x2000 != 0 {
                i += 1;
                continue;
            }
            header & 0x3FF
        };
        if len < 3 || i + 3 + len >= data.len() || data[i + 3 + len] != eom {
            i += 1;
            continue;
        }
        let body = &data[i + 3..i + 3 + len];
        if crc16(&body[..len - 2]) != u16::from_le_bytes([body[len - 2], body[len - 1]]) {
            i += 1;
            continue;
        }
        let (id, p) = (body[0], &body[1..len - 2]);
        let s = match id {
            0x61 if p.len() >= 4 => Some(Status { left: level(p[2]), right: level(p[3]), case: if !legacy && p.len() >= 8 { level(p[7]) } else { -1 } }),
            0x60 if p.len() >= 3 => Some(Status { left: level(p[1]), right: level(p[2]), case: if !legacy && p.len() >= 7 { level(p[6]) } else { -1 } }),
            _ => None,
        };
        if s.is_some() {
            found = s;
            i += 4 + len;
        } else {
            i += 1;
        }
    }
    found
}

const SPP_NEW: GUID = GUID::from_u128(0x2e73a4ad_332d_41fc_90e2_16bef06523f2);
const SPP_STANDARD: GUID = GUID::from_u128(0x00001101_0000_1000_8000_00805f9b34fb);
const SPP_LEGACY: GUID = GUID::from_u128(0x00001102_0000_1000_8000_00805f9b34fd);

fn wait(s: SOCKET, write: bool, ms: u64) -> bool {
    let mut set = FD_SET { fd_count: 1, fd_array: [0; 64] };
    set.fd_array[0] = s;
    let mut err = FD_SET { fd_count: 1, fd_array: [0; 64] };
    err.fd_array[0] = s;
    let tv = TIMEVAL { tv_sec: (ms / 1000) as i32, tv_usec: ((ms % 1000) * 1000) as i32 };
    let (r, w) = if write { (std::ptr::null_mut(), &mut set as *mut FD_SET) } else { (&mut set as *mut FD_SET, std::ptr::null_mut()) };
    let n = unsafe { select(0, r, w, &mut err, &tv) };
    n > 0 && set.fd_count > 0 && err.fd_count == 0
}

/// Ouvre le service RFCOMM et attend la trame d'état que les écouteurs envoient à la connexion
fn read_status(addr: u64, service: GUID, legacy: bool) -> Option<Status> {
    let s = unsafe { socket(AF_BTH as i32, SOCK_STREAM, BTHPROTO_RFCOMM as i32) };
    if s == INVALID_SOCKET {
        return None;
    }
    let mut nb = 1u32;
    unsafe { ioctlsocket(s, FIONBIO, &mut nb) };
    // Windows cherche le canal RFCOMM du service par SDP
    let sa = SOCKADDR_BTH { addressFamily: AF_BTH, btAddr: addr, serviceClassId: service, port: 0 };
    let mut found = None;
    let r = unsafe { connect(s, &sa as *const _ as *const SOCKADDR, std::mem::size_of::<SOCKADDR_BTH>() as i32) };
    if r == 0 || (unsafe { WSAGetLastError() } == WSAEWOULDBLOCK && wait(s, true, 4000)) {
        let mut buf = Vec::new();
        let end = Instant::now() + Duration::from_secs(3);
        while found.is_none() && buf.len() < 8192 {
            let left = end.saturating_duration_since(Instant::now()).as_millis() as u64;
            if left == 0 || !wait(s, false, left) {
                break;
            }
            let mut chunk = [0u8; 512];
            let n = unsafe { recv(s, chunk.as_mut_ptr(), chunk.len() as i32, 0) };
            if n <= 0 {
                break;
            }
            buf.extend_from_slice(&chunk[..n as usize]);
            found = find_status(&buf, legacy);
        }
    }
    unsafe { closesocket(s) };
    found
}

pub struct Buds {
    pub name: String,
    pub address: String,
    pub status: Status,
}

/// Galaxy Buds connectés et leur état. Relu au plus toutes les 2 minutes : chaque lecture ouvre une
/// liaison avec les écouteurs.
pub fn batteries() -> Vec<Buds> {
    use std::sync::Mutex;
    type Read = (Instant, Vec<(String, String, Status)>);
    static CACHE: Mutex<Option<Read>> = Mutex::new(None);
    let list = crate::pnp::connected_bt("buds");
    if list.is_empty() {
        return Vec::new();
    }
    let mut cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let stale = cache.as_ref().is_none_or(|(at, _)| at.elapsed() > Duration::from_secs(110));
    if stale {
        static WSA: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
        if !*WSA.get_or_init(|| {
            let mut d: WSADATA = unsafe { std::mem::zeroed() };
            unsafe { WSAStartup(0x0202, &mut d) == 0 }
        }) {
            return Vec::new();
        }
        let mut out = Vec::new();
        for (name, address) in &list {
            let Ok(addr) = u64::from_str_radix(address, 16) else { continue };
            let st = read_status(addr, SPP_NEW, false)
                .or_else(|| read_status(addr, SPP_STANDARD, false))
                .or_else(|| read_status(addr, SPP_LEGACY, true));
            // Liaison occupée (application Galaxy Buds ouverte) : on garde la valeur précédente
            let st = st.or_else(|| cache.as_ref().and_then(|(_, v)| v.iter().find(|x| &x.1 == address).map(|x| x.2)));
            if let Some(st) = st {
                out.push((name.clone(), address.clone(), st));
            }
        }
        *cache = Some((Instant::now(), out));
    }
    let Some((_, v)) = cache.as_ref() else { return Vec::new() };
    v.iter()
        .filter(|x| list.iter().any(|(_, a)| a == &x.1))
        .map(|(name, address, status)| Buds { name: name.clone(), address: address.clone(), status: *status })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(id: u8, payload: &[u8]) -> Vec<u8> {
        let mut body = vec![id];
        body.extend_from_slice(payload);
        let crc = crc16(&body);
        body.extend_from_slice(&crc.to_le_bytes());
        let len = body.len() as u16;
        let mut f = vec![0xFD, len as u8, (len >> 8) as u8];
        f.extend(body);
        f.push(0xDD);
        f
    }

    #[test]
    fn trame_etat() {
        // bruit, puis STATUS_UPDATED : gauche 85, droite 60, boîtier 40
        let mut data = vec![0x00, 0xFD, 0x12];
        data.extend(frame(0x60, &[0x00, 85, 60, 0, 0, 0, 40]));
        assert_eq!(find_status(&data, false), Some(Status { left: 85, right: 60, case: 40 }));
        // EXTENDED : la dernière trame gagne ; boîtier 101 (inconnu) → -1
        data.extend(frame(0x61, &[0x00, 0x00, 90, 0, 0, 0, 0, 101]));
        assert_eq!(find_status(&data, false), Some(Status { left: 90, right: -1, case: -1 }));
        // CRC faux : ignorée
        let mut bad = frame(0x60, &[0x00, 85, 60]);
        bad[5] ^= 1;
        assert_eq!(find_status(&bad, false), None);
    }
}
