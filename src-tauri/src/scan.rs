// L'analyse : croise les processus, ce qui démarre avec Windows et les périphériques branchés
// avec la base de données des logiciels constructeurs. Lecture seule.
use crate::{devices, procs, startup, vendors};
use serde_json::{json, Value};
use std::collections::HashMap;

// Moteurs web lancés par un logiciel constructeur pour afficher son interface :
// leur mémoire est comptée au logiciel qui les a lancés.
const HELPERS: &[&str] = &[
    "msedgewebview2.exe",
    "cefsharp.browsersubprocess.exe",
    "qtwebengineprocess.exe",
    "crashpad_handler.exe",
];

/// Logiciel constructeur auquel appartient chaque processus (None : aucun, ou PeriphHub lui-même).
/// Les moteurs web (WebView2, CEF…) sont rattachés au logiciel qui les a lancés.
pub fn attribute(list: &[procs::Proc], vendors: &[vendors::Vendor]) -> Vec<Option<usize>> {
    let me = procs::current_pid();
    let by_pid: HashMap<u32, usize> = list.iter().enumerate().map(|(i, p)| (p.pid, i)).collect();
    let direct: Vec<Option<usize>> = list
        .iter()
        .map(|p| {
            if vendors::protected(&p.name) {
                return None;
            }
            vendors
                .iter()
                .position(|v| v.matches_process(&p.name, p.path.as_deref()))
        })
        .collect();
    let owner = |i: usize| -> Option<usize> {
        if direct[i].is_some() {
            return direct[i];
        }
        if !HELPERS
            .iter()
            .any(|h| h.eq_ignore_ascii_case(&list[i].name))
        {
            return None;
        }
        // remonte les parents (8 niveaux max : Windows réutilise les PID)
        let mut cur = list[i].parent;
        for _ in 0..8 {
            let &j = by_pid.get(&cur)?;
            if direct[j].is_some() {
                return direct[j];
            }
            cur = list[j].parent;
        }
        None
    };
    (0..list.len())
        .map(|i| {
            if list[i].pid == me || owner_is_self(list, &by_pid, i, me) {
                None
            } else {
                owner(i)
            }
        })
        .collect()
}

pub fn run() -> Value {
    let vendors = vendors::all();
    let usb = vendors::usb();
    let support = vendors::support();
    let known = vendors::catalog();
    let list = procs::list();
    let me = procs::current_pid();
    let by_pid: HashMap<u32, usize> = list.iter().enumerate().map(|(i, p)| (p.pid, i)).collect();
    let owners = attribute(&list, &vendors);

    let mut own_bytes = 0u64;
    // vendor → nom de processus → (nombre, octets)
    let mut found: HashMap<usize, HashMap<String, (u32, u64)>> = HashMap::new();
    for (i, p) in list.iter().enumerate() {
        if p.pid == me || owner_is_self(&list, &by_pid, i, me) {
            own_bytes += p.bytes;
            continue;
        }
        if let Some(v) = owners[i] {
            let e = found
                .entry(v)
                .or_default()
                .entry(p.name.clone())
                .or_default();
            e.0 += 1;
            e.1 += p.bytes;
        }
    }

    let entries = startup::all();
    let devs = devices::list();

    let mut out_vendors = Vec::new();
    let mut total = 0u64;
    for (vi, v) in vendors.iter().enumerate() {
        let procs_found = found.remove(&vi).unwrap_or_default();
        let auto: Vec<Value> = entries
            .iter()
            .filter(|e| v.owns_entry(e))
            .map(|e| json!({ "kind": e.kind, "name": e.name, "target": anon(&e.target), "mode": e.mode }))
            .collect();
        let dev_ids: Vec<String> = devs
            .iter()
            .filter(|d| v.has_vid(d.vid))
            .map(|d| format!("{:04X}:{:04X}", d.vid, d.pid))
            .collect();
        if procs_found.is_empty() && auto.is_empty() {
            continue;
        }
        let bytes: u64 = procs_found.values().map(|x| x.1).sum();
        total += bytes;
        let mut ps: Vec<_> = procs_found.into_iter().collect();
        ps.sort_by_key(|p| std::cmp::Reverse(p.1 .1));
        out_vendors.push(json!({
            "id": v.id, "name": v.name, "brand": v.brand, "bytes": bytes,
            "processes": ps.into_iter().map(|(n, (c, b))| json!({ "name": n, "count": c, "bytes": b })).collect::<Vec<_>>(),
            "startup": auto, "devices": dev_ids.len(), "device_ids": dev_ids,
            "keeps": v.keeps, "loses": v.loses, "keeps_en": v.keeps_en, "loses_en": v.loses_en, "verified": v.verified,
        }));
    }
    out_vendors.sort_by_key(|v| std::cmp::Reverse(v["bytes"].as_u64().unwrap_or(0)));

    let out_devices: Vec<Value> = devs
        .iter()
        .map(|d| {
            // entrée exacte, sinon pilote générique de la marque (pid « * »)
            let s = support
                .iter()
                .find(|s| hex(&s.vid) == Some(d.vid) && hex(&s.pid) == Some(d.pid))
                .or_else(|| support.iter().find(|s| hex(&s.vid) == Some(d.vid) && s.pid == "*"));
            let maker = usb.get(&d.vid);
            let exact = s.filter(|s| s.pid != "*");
            // Pas d'entrée précise dans devices.json : le catalogue des projets libres prend le relais
            let k = if exact.is_none() {
                known.iter().find(|k| hex(&k.vid) == Some(d.vid) && hex(&k.pid) == Some(d.pid))
            } else {
                None
            };
            let name = if !d.product.is_empty() {
                d.product.clone()
            } else if let Some(e) = exact {
                e.name.clone()
            } else {
                k.map(|k| k.name.clone()).unwrap_or_default()
            };
            let kind = s
                .and_then(|s| s.kind.clone())
                .or_else(|| k.filter(|k| k.kind != "autre").map(|k| k.kind.clone()))
                .unwrap_or_else(|| d.kind.to_string());
            let (status, plugin) = match (exact, s, k) {
                (Some(e), _, _) => (e.status.clone(), Some(e.plugin.clone())),
                (None, _, Some(k)) if k.status != "known" => (k.status.clone(), Some(k.via.clone())),
                (None, Some(g), _) => (g.status.clone(), Some(g.plugin.clone())),
                (None, None, Some(_)) => ("known".into(), None),
                _ => ("unknown".into(), None),
            };
            json!({
                "vid": format!("{:04X}", d.vid), "pid": format!("{:04X}", d.pid),
                "product": name, "catalog_name": k.map(|k| k.name.clone()),
                "manufacturer": d.manufacturer, "interfaces": d.interfaces,
                "kind": kind,
                "brand": maker.map(|m| m.name.clone()),
                "brand_note": maker.map(|m| m.note.clone()).filter(|n| !n.is_empty()),
                "status": status,
                "plugin": plugin,
                "sources": k.map(|k| k.src.clone()).unwrap_or_default(),
                "missing": s.map(|s| s.missing.clone()).unwrap_or_default(),
            })
        })
        .collect();

    json!({
        "version": env!("CARGO_PKG_VERSION"),
        "ram_total": procs::total_ram(),
        "vendor_bytes": total,
        "periphhub_bytes": own_bytes,
        "vendors": out_vendors,
        "devices": out_devices,
    })
}

// Les WebView de PeriphHub lui-même (pour afficher honnêtement sa propre consommation)
fn owner_is_self(list: &[procs::Proc], by_pid: &HashMap<u32, usize>, i: usize, me: u32) -> bool {
    let mut cur = list[i].parent;
    for _ in 0..4 {
        if cur == me {
            return true;
        }
        let Some(&j) = by_pid.get(&cur) else {
            return false;
        };
        cur = list[j].parent;
    }
    false
}

fn hex(s: &str) -> Option<u16> {
    u16::from_str_radix(s.trim_start_matches("0x"), 16).ok()
}

// Retire le nom d'utilisateur des chemins (le rapport peut être partagé)
fn anon(s: &str) -> String {
    let Ok(home) = std::env::var("USERPROFILE") else {
        return s.to_string();
    };
    // recherche insensible à la casse sur les octets ASCII : les indices restent valides
    let (sb, hb) = (s.as_bytes(), home.as_bytes());
    if hb.is_empty() || sb.len() < hb.len() {
        return s.to_string();
    }
    match (0..=sb.len() - hb.len()).find(|&i| sb[i..i + hb.len()].eq_ignore_ascii_case(hb)) {
        Some(i) if s.is_char_boundary(i) && s.is_char_boundary(i + hb.len()) => {
            format!("{}%USERPROFILE%{}", &s[..i], &s[i + hb.len()..])
        }
        _ => s.to_string(),
    }
}
