#!/usr/bin/env python3
"""Détecteurs d'OpenRGB à couper : appareils que PeriphHub pilote lui-même.

OpenRGB ouvre les interfaces HID de chaque appareil qu'il reconnaît et les garde ouvertes : un clavier
ou une souris pilotés aussi par PeriphHub (pilote intégré, HeadsetControl…) ne répondent plus à
PeriphHub, ou à moitié. OpenRGB permet de désactiver un détecteur par son nom (OpenRGB.json ▸
Detectors ▸ detectors ▸ « nom » : false) ; ce script dresse la liste des noms dont le VID:PID est
dans le catalogue de PeriphHub avec un pilote intégré.

    python scripts/build-openrgb-detectors.py <sources d'OpenRGB (même version que livrée)> <OpenRGB.json>

<OpenRGB.json> : réglages écrits par l'OpenRGB livré après un lancement (--server --config <dossier>).
Seuls les noms qu'il y garde sont retenus : un nom qu'il ne connaît pas est effacé à sa réécriture, et
PeriphHub croirait ses réglages à refaire à chaque fois.

Sources : https://gitlab.com/CalcProgrammer1/OpenRGB/-/archive/release_1.1/OpenRGB-release_1.1.tar.gz
Écrit src-tauri/src/openrgb_off.rs.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Pilotes qui ouvrent eux-mêmes l'appareil. razer-chroma passe par Razer Synapse (pas de HID) : sans
# Synapse, OpenRGB reste le seul moyen de régler l'éclairage d'un Razer, on le laisse.
NATIVE = {"openmouse", "openmouse-kb", "logitech-hidpp", "headsetcontrol", "corsair", "razer-kraken",
          "playstation", "steelseries-apex"}


def main(src: Path, known_json: Path) -> None:
    files = list((src / "Controllers").rglob("*.cpp")) + list((src / "Controllers").rglob("*.h"))
    defines = {}
    for f in files:
        for m in re.finditer(r"^\s*#define\s+(\w+)\s+(0x[0-9A-Fa-f]+|\d+)\b", f.read_text("utf-8", "replace"), re.M):
            defines.setdefault(m.group(1), int(m.group(2), 16 if m.group(2).lower().startswith("0x") else 10))

    def val(tok: str):
        tok = tok.strip()
        if re.fullmatch(r"0x[0-9A-Fa-f]+|\d+", tok):
            return int(tok, 16 if tok.lower().startswith("0x") else 10)
        return defines.get(tok)

    table = {}  # (vid, pid) -> noms
    unresolved = 0
    macro = re.compile(r"REGISTER_HID_(?:WRAPPED_)?DETECTOR(?:_[A-Z]+)?\s*\(\s*\"([^\"]+)\"\s*,([^;]*?)\)\s*;", re.S)
    for f in files:
        for m in macro.finditer(f.read_text("utf-8", "replace")):
            args = [a for a in m.group(2).split(",")]
            if len(args) < 3:
                continue
            vid, pid = val(args[1]), val(args[2])
            if vid is None or pid is None:
                unresolved += 1
                continue
            table.setdefault((vid, pid), set()).add(m.group(1))

    catalog = json.loads((ROOT / "data" / "catalog.json").read_text("utf-8"))
    native = {(int(d["vid"], 16), int(d["pid"], 16)) for d in catalog if d.get("via") in NATIVE}
    known = set(json.loads(known_json.read_text("utf-8-sig"))["Detectors"]["detectors"])
    all_off = {n for k, names in table.items() if k in native for n in names}
    off = sorted(all_off & known)
    # Lus par OpenRGB à la détection mais effacés à sa réécriture (anciennes souris Logitech sans fil,
    # LogitechControllerDetect.cpp) : écrits avant chaque lancement, jamais vérifiés
    extra = sorted(all_off - known)

    lines = [
        "// Généré par scripts/build-openrgb-detectors.py (OpenRGB 1.1 + data/catalog.json) : ne pas modifier.",
        "// Détecteurs d'OpenRGB coupés : appareils que PeriphHub pilote lui-même (voir le script).",
        "pub const OFF: &[&str] = &[",
        *[f"    {json.dumps(n, ensure_ascii=False)}," for n in off],
        "];",
        "",
        "// Lus par OpenRGB mais effacés de ses réglages quand il les réécrit : écrits avant chaque lancement.",
        "pub const OFF_UNLISTED: &[&str] = &[",
        *[f"    {json.dumps(n, ensure_ascii=False)}," for n in extra],
        "];",
        "",
    ]
    (ROOT / "src-tauri" / "src" / "openrgb_off.rs").write_text("\n".join(lines), "utf-8", newline="\n")
    print(f"{len(table)} VID:PID dans OpenRGB ({unresolved} non résolus), {len(off)} + {len(extra)} détecteurs coupés")


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
