// Batterie HID standard, toutes marques : appareils qui déclarent un champ de batterie normalisé
// (Generic Device Controls « Battery Strength » 06:20, Battery System « Absolute State Of Charge »
// 85:65) dans un rapport feature ou d'entrée. Sert aux appareils qu'aucun pilote PeriphHub ne prend.
//
// Lecture seule : l'interface est ouverte sans droit de lecture ni d'écriture (accès 0, suffisant pour
// lire un rapport feature ou d'entrée à la demande), rien n'est jamais écrit. Exclus : tablettes et
// écrans à stylet (page 0D : chez XP-Pen, une lecture a déjà inversé l'axe vertical), onduleurs et
// alimentations (pages 84 / 85), et les appareils déjà pris par un pilote PeriphHub.
// Chaque interface est lue avec un délai : un pilote figé ne bloque pas le reste.
// Méthode reprise de WirelessBattery (GPL-3.0, src/drivers/generic.cpp).
use std::collections::HashSet;
use std::time::Duration;
use windows_sys::Win32::Devices::HumanInterfaceDevice::{
    HidD_FreePreparsedData, HidD_GetFeature, HidD_GetInputReport, HidD_GetPreparsedData, HidP_Feature, HidP_GetCaps,
    HidP_GetUsageValue, HidP_GetValueCaps, HidP_Input, HIDP_CAPS, HIDP_STATUS_SUCCESS, HIDP_VALUE_CAPS,
};
use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::{CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING};

pub struct Found {
    pub vid: u16,
    pub pid: u16,
    pub name: String,
    pub level: u8,
    pub usage_page: u16,
    pub usage: u16,
}

fn is_battery(page: u16, usage: u16) -> bool {
    (page == 0x06 && usage == 0x20) || (page == 0x85 && usage == 0x65)
}

/// Valeur lue → pourcentage, selon l'étendue déclarée
pub fn to_percent(val: u32, min: i32, max: i32, apple: bool) -> Option<u8> {
    // Apple (Magic Mouse / Trackpad / Keyboard) donne un pourcentage tout en déclarant 0-255
    if apple && val <= 100 {
        return Some(val as u8);
    }
    if max > min {
        let p = (val as i64 - min as i64) * 100 / (max as i64 - min as i64);
        return Some(p.clamp(0, 100) as u8);
    }
    (val <= 100).then_some(val as u8)
}

fn read(path: &str, apple: bool) -> Option<u8> {
    let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
    let h = unsafe { CreateFileW(wide.as_ptr(), 0, FILE_SHARE_READ | FILE_SHARE_WRITE, std::ptr::null(), OPEN_EXISTING, 0, std::ptr::null_mut()) };
    if h == INVALID_HANDLE_VALUE {
        return None;
    }
    let mut pp = 0isize;
    let mut out = None;
    if unsafe { HidD_GetPreparsedData(h, &mut pp) } {
        let mut caps = HIDP_CAPS::default();
        if unsafe { HidP_GetCaps(pp, &mut caps) } == HIDP_STATUS_SUCCESS {
            'types: for (ty, n, len) in [
                (HidP_Feature, caps.NumberFeatureValueCaps, caps.FeatureReportByteLength),
                (HidP_Input, caps.NumberInputValueCaps, caps.InputReportByteLength),
            ] {
                if n == 0 || len == 0 {
                    continue;
                }
                let mut count = n;
                let mut vc = vec![HIDP_VALUE_CAPS::default(); n as usize];
                if unsafe { HidP_GetValueCaps(ty, vc.as_mut_ptr(), &mut count, pp) } != HIDP_STATUS_SUCCESS {
                    continue;
                }
                for v in &vc[..count as usize] {
                    let u = unsafe { if v.IsRange { v.Anonymous.Range.UsageMin } else { v.Anonymous.NotRange.Usage } };
                    if !is_battery(v.UsagePage, u) {
                        continue;
                    }
                    let mut buf = vec![0u8; len as usize];
                    buf[0] = v.ReportID;
                    let got = unsafe {
                        if ty == HidP_Feature { HidD_GetFeature(h, buf.as_mut_ptr().cast(), len as u32) } else { HidD_GetInputReport(h, buf.as_mut_ptr().cast(), len as u32) }
                    };
                    if !got {
                        continue;
                    }
                    let mut val = 0u32;
                    if unsafe { HidP_GetUsageValue(ty, v.UsagePage, v.LinkCollection, u, &mut val, pp, buf.as_ptr(), len as u32) } != HIDP_STATUS_SUCCESS {
                        continue;
                    }
                    out = to_percent(val, v.LogicalMin, v.LogicalMax, apple);
                    if out.is_some() {
                        break 'types;
                    }
                }
            }
        }
        unsafe { HidD_FreePreparsedData(pp) };
    }
    unsafe { CloseHandle(h) };
    out
}

/// `skip` : « vid:pid » (hexadécimal minuscule sur 4 chiffres) des appareils déjà pris par un pilote
pub fn batteries(skip: &[String]) -> Vec<Found> {
    let skip: HashSet<&str> = skip.iter().map(|s| s.as_str()).collect();
    let all = crate::pnp::hid_interfaces();
    let tablets: HashSet<(u16, u16)> = all.iter().filter(|i| i.usage_page == 0x0D).map(|i| (i.vid, i.pid)).collect();
    let mut out: Vec<Found> = Vec::new();
    for i in all {
        let id = format!("{:04x}:{:04x}", i.vid, i.pid);
        if skip.contains(id.as_str()) || tablets.contains(&(i.vid, i.pid)) || i.usage_page == 0x84 || i.usage_page == 0x85 {
            continue;
        }
        if out.iter().any(|f| f.vid == i.vid && f.pid == i.pid) {
            continue;
        }
        let (path, apple) = (i.path.clone(), i.vid == 0x05AC);
        let Some(Some(level)) = crate::watchdog::timed(Duration::from_millis(1500), move || read(&path, apple)) else { continue };
        out.push(Found { vid: i.vid, pid: i.pid, name: i.product.clone(), level, usage_page: i.usage_page, usage: i.usage });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore]
    fn liste_reelle() {
        let all = crate::pnp::hid_interfaces();
        let opened = all.iter().filter(|i| {
            let w: Vec<u16> = i.path.encode_utf16().chain(Some(0)).collect();
            let h = unsafe { CreateFileW(w.as_ptr(), 0, FILE_SHARE_READ | FILE_SHARE_WRITE, std::ptr::null(), OPEN_EXISTING, 0, std::ptr::null_mut()) };
            let ok = h != INVALID_HANDLE_VALUE;
            if ok { unsafe { CloseHandle(h) }; }
            ok
        }).count();
        let t = std::time::Instant::now();
        let found = batteries(&[]);
        eprintln!("interfaces {} ouvertes {} batteries {} en {:?}", all.len(), opened, found.len(), t.elapsed());
        for f in found { eprintln!("  {:04x}:{:04x} {} {} %", f.vid, f.pid, f.name, f.level); }
    }

    #[test]
    fn pourcentage() {
        assert_eq!(to_percent(128, 0, 255, false), Some(50));
        assert_eq!(to_percent(80, 0, 255, true), Some(80)); // Apple : déjà en %
        assert_eq!(to_percent(3, 0, 4, false), Some(75));
        assert_eq!(to_percent(70, 0, 0, false), Some(70));
        assert_eq!(to_percent(300, 0, 0, false), None);
        assert_eq!(to_percent(10, 20, 120, false), Some(0));
    }
}
