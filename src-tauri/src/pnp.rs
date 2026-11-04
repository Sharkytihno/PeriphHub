// Liste des interfaces HID lue dans le gestionnaire Plug and Play de Windows (CfgMgr), SANS jamais
// ouvrir ni interroger un appareil.
//
// hidapi, lui, ouvre chaque interface pour lire ses noms et ses usages : il suffit d'un seul appareil
// dont le pilote ne répond plus (dongle sans fil, manette virtuelle, appareil Bluetooth endormi, pilote
// constructeur figé…) pour que toute la liste reste bloquée, et PeriphHub n'affichait alors plus rien.
// Ici tout vient de ce que Windows a déjà enregistré au branchement :
//   identifiants matériels  HID\VID_3554&PID_F5F7&REV_0216&MI_01&Col02 ; HID_DEVICE_UP:FF03_U:0000
//   nom du produit          BusReportedDeviceDesc du nœud USB parent (chaîne iProduct de l'appareil)
use windows_sys::core::GUID;
use windows_sys::Win32::Devices::DeviceAndDriverInstallation::{
    CM_Get_DevNode_PropertyW, CM_Get_Device_Interface_ListW, CM_Get_Device_Interface_List_SizeW,
    CM_Get_Device_Interface_PropertyW, CM_Get_Parent, CM_Locate_DevNodeW, CM_GET_DEVICE_INTERFACE_LIST_PRESENT,
    CM_LOCATE_DEVNODE_NORMAL, CONFIGRET, CR_BUFFER_SMALL, CR_SUCCESS,
};
use windows_sys::Win32::Devices::HumanInterfaceDevice::GUID_DEVINTERFACE_HID;
use windows_sys::Win32::Devices::Properties::{
    DEVPKEY_Device_BusReportedDeviceDesc, DEVPKEY_Device_FriendlyName, DEVPKEY_Device_HardwareIds,
    DEVPKEY_Device_InstanceId, DEVPROPTYPE,
};
use windows_sys::Win32::Foundation::DEVPROPKEY;

#[derive(Clone, Debug, PartialEq)]
pub struct HidIface {
    pub path: String,
    pub vid: u16,
    pub pid: u16,
    pub usage_page: u16,
    pub usage: u16,
    /// Numéro d'interface USB (MI_xx), -1 si l'appareil n'en a qu'une
    pub interface: i32,
    pub product: String,
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Lit une propriété (chaîne ou liste de chaînes) : `get(type, tampon, taille)`.
fn read_strings(get: impl Fn(*mut DEVPROPTYPE, *mut u8, *mut u32) -> CONFIGRET) -> Vec<String> {
    let mut ty: DEVPROPTYPE = 0;
    let mut size = 0u32;
    let r = get(&mut ty, std::ptr::null_mut(), &mut size);
    if (r != CR_BUFFER_SMALL && r != CR_SUCCESS) || size < 2 {
        return Vec::new();
    }
    let mut buf = vec![0u16; (size as usize).div_ceil(2)];
    if get(&mut ty, buf.as_mut_ptr().cast(), &mut size) != CR_SUCCESS {
        return Vec::new();
    }
    multi_sz(&buf)
}

fn multi_sz(buf: &[u16]) -> Vec<String> {
    buf.split(|&c| c == 0)
        .take_while(|s| !s.is_empty())
        .map(String::from_utf16_lossy)
        .collect()
}

fn node_prop(node: u32, key: &DEVPROPKEY) -> Vec<String> {
    read_strings(|ty, buf, size| unsafe { CM_Get_DevNode_PropertyW(node, key, ty, buf, size, 0) })
}

fn first(v: Vec<String>) -> String {
    v.into_iter().next().unwrap_or_default().trim().to_string()
}

/// Chemins des interfaces HID présentes (\\?\HID#VID_…#{4d1e55b2-…})
fn interface_paths() -> Vec<String> {
    let guid: GUID = GUID_DEVINTERFACE_HID;
    // La liste peut grandir entre les deux appels (appareil branché à ce moment-là) : on réessaie
    for _ in 0..4 {
        let mut len = 0u32;
        let r = unsafe {
            CM_Get_Device_Interface_List_SizeW(&mut len, &guid, std::ptr::null(), CM_GET_DEVICE_INTERFACE_LIST_PRESENT)
        };
        if r != CR_SUCCESS || len == 0 {
            return Vec::new();
        }
        let mut buf = vec![0u16; len as usize];
        let r = unsafe {
            CM_Get_Device_Interface_ListW(&guid, std::ptr::null(), buf.as_mut_ptr(), len, CM_GET_DEVICE_INTERFACE_LIST_PRESENT)
        };
        if r == CR_SUCCESS {
            return multi_sz(&buf);
        }
        if r != CR_BUFFER_SMALL {
            return Vec::new();
        }
    }
    Vec::new()
}

pub fn hid_interfaces() -> Vec<HidIface> {
    interface_paths().into_iter().filter_map(|p| iface(&p)).collect()
}

fn iface(path: &str) -> Option<HidIface> {
    let wpath = wide(path);
    let instance = first(read_strings(|ty, buf, size| unsafe {
        CM_Get_Device_Interface_PropertyW(wpath.as_ptr(), &DEVPKEY_Device_InstanceId, ty, buf, size, 0)
    }));
    if instance.is_empty() {
        return None;
    }
    let mut node = 0u32;
    if unsafe { CM_Locate_DevNodeW(&mut node, wide(&instance).as_ptr(), CM_LOCATE_DEVNODE_NORMAL) } != CR_SUCCESS {
        return None;
    }
    let ids = node_prop(node, &DEVPKEY_Device_HardwareIds);
    let mut out = parse_ids(&ids)?;
    out.path = path.to_string();
    out.product = product_name(node);
    Some(out)
}

/// Nom du produit tel que l'appareil l'a annoncé au branchement, lu sur les nœuds parents
/// (USB : chaîne iProduct ; Bluetooth : nom de l'appareil appairé).
fn product_name(node: u32) -> String {
    let mut cur = node;
    for _ in 0..4 {
        let brdd = first(node_prop(cur, &DEVPKEY_Device_BusReportedDeviceDesc));
        if !brdd.is_empty() {
            return brdd;
        }
        let id = first(node_prop(cur, &DEVPKEY_Device_InstanceId)).to_ascii_uppercase();
        if id.starts_with("BTHLE\\") || id.starts_with("BTHENUM\\") {
            let name = first(node_prop(cur, &DEVPKEY_Device_FriendlyName));
            if !name.is_empty() {
                return name;
            }
        }
        let mut parent = 0u32;
        if unsafe { CM_Get_Parent(&mut parent, cur, 0) } != CR_SUCCESS {
            break;
        }
        cur = parent;
    }
    String::new()
}

/// Suite de chiffres hexadécimaux qui suit `tag` (« VID_ », « VID& », « MI_ »…) dans `s` (en majuscules)
fn hex_after<'a>(s: &'a str, tags: &[&str]) -> Option<&'a str> {
    tags.iter().find_map(|t| {
        let i = s.find(t)? + t.len();
        let run = &s[i..];
        let n = run.bytes().take_while(|b| b.is_ascii_hexdigit()).count();
        (n > 0).then(|| &run[..n])
    })
}

/// VID, PID, interface et usage depuis les identifiants matériels Windows. Formats :
///   USB          HID\VID_046D&PID_C08B&REV_0300&MI_01&Col02
///   Bluetooth    HID\{00001124-…}_VID&0002046D_PID&B023&Col01
///   Bluetooth LE HID\{00001812-…}_Dev_VID&02046D_PID&B023_REV&0007
///   usage        HID_DEVICE_UP:FF00_U:0001
pub fn parse_ids(ids: &[String]) -> Option<HidIface> {
    let up: Vec<String> = ids.iter().map(|s| s.to_ascii_uppercase()).collect();
    let main = up.iter().find(|s| s.contains("VID"))?;
    // Bluetooth : le VID est précédé de la source de l'identifiant (0002 / 02) — on garde les 4 derniers chiffres
    let v = hex_after(main, &["VID_", "VID&"])?;
    let vid = u16::from_str_radix(&v[v.len().saturating_sub(4)..], 16).ok()?;
    let p = hex_after(main, &["PID_", "PID&"])?;
    let pid = u16::from_str_radix(&p[..p.len().min(4)], 16).ok()?;
    let interface = hex_after(main, &["&MI_", "_MI_"])
        .and_then(|m| i32::from_str_radix(&m[..m.len().min(2)], 16).ok())
        // comme hidapi : un appareil USB à interface unique est l'interface 0 ; Bluetooth : -1
        .unwrap_or(if main.contains("\\VID_") { 0 } else { -1 });
    let (mut usage_page, mut usage) = (0, 0);
    if let Some(u) = up.iter().find_map(|s| s.strip_prefix("HID_DEVICE_UP:")) {
        let n = u.bytes().take_while(|b| b.is_ascii_hexdigit()).count();
        usage_page = u16::from_str_radix(&u[..n], 16).unwrap_or(0);
        usage = hex_after(u, &["_U:"]).and_then(|x| u16::from_str_radix(x, 16).ok()).unwrap_or(0);
    }
    Some(HidIface { path: String::new(), vid, pid, usage_page, usage, interface, product: String::new() })
}

// ---------- Batterie des appareils Bluetooth ----------

pub struct BtBattery {
    pub name: String,
    /// Adresse Bluetooth (12 chiffres hexadécimaux), pour regrouper les nœuds d'un même appareil
    pub address: String,
    pub level: u8,
}

/// Instances présentes d'un énumérateur (« BTHLE », « BTHENUM »…)
fn device_ids(enumerator: &str) -> Vec<String> {
    use windows_sys::Win32::Devices::DeviceAndDriverInstallation::{
        CM_Get_Device_ID_ListW, CM_Get_Device_ID_List_SizeW, CM_GETIDLIST_FILTER_ENUMERATOR, CM_GETIDLIST_FILTER_PRESENT,
    };
    let filter = wide(enumerator);
    let flags = CM_GETIDLIST_FILTER_ENUMERATOR | CM_GETIDLIST_FILTER_PRESENT;
    // Un appareil peut arriver entre la taille et la liste : on recommence
    for _ in 0..3 {
        let mut len = 0u32;
        if unsafe { CM_Get_Device_ID_List_SizeW(&mut len, filter.as_ptr(), flags) } != CR_SUCCESS || len < 2 {
            return Vec::new();
        }
        let mut buf = vec![0u16; len as usize];
        match unsafe { CM_Get_Device_ID_ListW(filter.as_ptr(), buf.as_mut_ptr(), len, flags) } {
            CR_SUCCESS => return multi_sz(&buf),
            CR_BUFFER_SMALL => continue,
            _ => return Vec::new(),
        }
    }
    Vec::new()
}

/// Adresse Bluetooth dans un identifiant d'instance : dernière suite de 12 chiffres hexadécimaux,
/// hors fin de l'UUID de base Bluetooth (…-00805F9B34FB) que portent tous les services.
///   BTHLE\DEV_C0FBF9A1B2C3\7&…   BTHENUM\{0000111E-…-00805F9B34FB}_…\7&2C4D1D4&0&A0C9A0123456_C00000000
fn bt_address(id: &str) -> String {
    let up = id.to_ascii_uppercase();
    up.rsplit(|c: char| !c.is_ascii_hexdigit())
        .find(|run| run.len() == 12 && *run != "00805F9B34FB")
        .unwrap_or_default()
        .to_string()
}

/// Nom de l'appareil sans le nom du service Bluetooth que Windows y ajoute
fn bt_name(name: &str) -> String {
    const SERVICES: &[&str] = &[
        "hands-free ag audio", "hands-free ag", "hands-free", "mains libres ag audio", "mains libres ag", "mains libres",
        "avrcp transport", "stereo", "stéréo",
    ];
    let mut n = name.trim().to_string();
    for s in SERVICES {
        let cut = n.len().wrapping_sub(s.len());
        if n.len() > s.len() && n.is_char_boundary(cut) && n[cut..].to_lowercase() == *s {
            n.truncate(cut);
            return n.trim_end().to_string();
        }
    }
    n
}

/// Batterie des appareils Bluetooth telle que l'affiche Paramètres ▸ Bluetooth (propriété
/// {104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2 posée par la pile Bluetooth de Windows : service
/// Batterie des appareils BLE, indicateur des casques en mains libres). Lecture seule, sans jamais
/// ouvrir l'appareil.
pub fn bluetooth_batteries() -> Vec<BtBattery> {
    use windows_sys::Win32::Devices::Properties::DEVPROP_TYPE_BYTE;
    const BATTERY: DEVPROPKEY = DEVPROPKEY { fmtid: GUID::from_u128(0x104ea319_6ee2_4701_bd47_8ddbf425bbe5), pid: 2 };
    let mut out: Vec<BtBattery> = Vec::new();
    for enumerator in ["BTHLE", "BTHLEDEVICE", "BTHENUM", "BTHHFENUM"] {
        for id in device_ids(enumerator) {
            let mut node = 0u32;
            let wid = wide(&id);
            if unsafe { CM_Locate_DevNodeW(&mut node, wid.as_ptr(), CM_LOCATE_DEVNODE_NORMAL) } != CR_SUCCESS {
                continue;
            }
            let (mut ty, mut level, mut size) = (0u32, 0u8, 1u32);
            let r = unsafe { CM_Get_DevNode_PropertyW(node, &BATTERY, &mut ty, &mut level, &mut size, 0) };
            if r != CR_SUCCESS || ty != DEVPROP_TYPE_BYTE || level > 100 {
                continue;
            }
            let address = bt_address(&id);
            let name = bt_name(&first(node_prop(node, &DEVPKEY_Device_FriendlyName)));
            match out.iter_mut().find(|b| !address.is_empty() && b.address == address) {
                Some(b) if b.name.is_empty() => b.name = name,
                Some(_) => {}
                None => out.push(BtBattery { name, address, level }),
            }
        }
    }
    out.retain(|b| !b.name.is_empty());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bluetooth_adresse_et_nom() {
        assert_eq!(bt_address(r"BTHLE\DEV_C0FBF9A1B2C3\7&1A2B3C4D&0&C0FBF9A1B2C3"), "C0FBF9A1B2C3");
        assert_eq!(
            bt_address(r"BTHENUM\{0000111E-0000-1000-8000-00805F9B34FB}_VID&0002054C_PID&0D58\7&2C4D1D4&0&A0C9A0123456_C00000000"),
            "A0C9A0123456"
        );
        assert_eq!(bt_address(r"BTHENUM\{0000111E-0000-1000-8000-00805F9B34FB}_LOCALMFG&0000"), "");
        assert_eq!(bt_name("WH-1000XM4 Hands-Free AG"), "WH-1000XM4");
        assert_eq!(bt_name("MX Master 3S"), "MX Master 3S");
        // Lecture réelle : ne doit ni bloquer ni planter, avec ou sans Bluetooth
        let _ = bluetooth_batteries();
    }

    fn ids(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn usb_composite() {
        let d = parse_ids(&ids(&[
            "HID\\VID_3554&PID_F5F7&REV_0216&MI_01&Col02",
            "HID\\VID_3554&PID_F5F7&MI_01&Col02",
            "HID\\VID_3554&UP:FF03_U:0000",
            "HID_DEVICE_UP:FF03_U:0000",
            "HID_DEVICE_UPR:FF00-FFFF",
            "HID_DEVICE",
        ]))
        .unwrap();
        assert_eq!((d.vid, d.pid, d.interface, d.usage_page, d.usage), (0x3554, 0xF5F7, 1, 0xFF03, 0));
    }

    #[test]
    fn usb_simple_et_via() {
        let d = parse_ids(&ids(&["HID\\VID_373B&PID_1194&REV_0001&MI_01", "HID_DEVICE_UP:FF60_U:0061"])).unwrap();
        assert_eq!((d.vid, d.pid, d.interface, d.usage_page, d.usage), (0x373B, 0x1194, 1, 0xFF60, 0x61));
        let d = parse_ids(&ids(&["HID\\VID_048D&PID_5702&REV_0001&Col02", "HID_DEVICE_SYSTEM_MOUSE", "HID_DEVICE_UP:0001_U:0002"])).unwrap();
        assert_eq!((d.vid, d.pid, d.interface, d.usage_page, d.usage), (0x048D, 0x5702, 0, 1, 2));
    }

    #[test]
    fn bluetooth() {
        let d = parse_ids(&ids(&["HID\\{00001124-0000-1000-8000-00805f9b34fb}_VID&0002046d_PID&b023&Col01", "HID_DEVICE_UP:0001_U:0002"])).unwrap();
        assert_eq!((d.vid, d.pid, d.interface, d.usage_page, d.usage), (0x046D, 0xB023, -1, 1, 2));
        let d = parse_ids(&ids(&["HID\\{00001812-0000-1000-8000-00805f9b34fb}_Dev_VID&02054c_PID&0ce6_REV&0100&Col01"])).unwrap();
        assert_eq!((d.vid, d.pid), (0x054C, 0x0CE6));
    }

    #[test]
    fn sans_vid_ignore() {
        assert!(parse_ids(&ids(&["HID\\CONVERTEDDEVICE&Col01", "HID_DEVICE_SYSTEM_KEYBOARD"])).is_none());
    }

    #[test]
    fn liste_reelle_sans_bloquer() {
        // Sur la machine de test : ne doit jamais bloquer ni paniquer, quelle que soit la liste
        let t = std::time::Instant::now();
        let l = hid_interfaces();
        assert!(t.elapsed() < std::time::Duration::from_secs(5), "{:?}", t.elapsed());
        assert!(l.iter().all(|d| d.path.starts_with("\\\\?\\")));
    }
}
