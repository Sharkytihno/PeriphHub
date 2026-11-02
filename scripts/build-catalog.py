"""Construit data/catalog.json : les périphériques connus des projets libres, par VID:PID.

Sert à nommer un appareil branché et à dire honnêtement ce que PeriphHub sait en faire
(réglable, éclairage seulement via OpenRGB, ou simplement reconnu). Les sources ne sont
que LUES comme du texte (aucun code n'est exécuté) :

    python scripts/build-catalog.py <dossier des sources>

Le dossier contient des clones (git clone --depth 1) de :
    libratbag/        github.com/libratbag/libratbag            data/devices/*.device
    openrazer/        github.com/openrazer/openrazer            daemon/openrazer_daemon/hardware/*.py
    rivalcfg/         github.com/flozz/rivalcfg                 rivalcfg/devices/*.py
    solaar/           github.com/pwr-Solaar/Solaar              lib/logitech_receiver/descriptors.py
    headsetcontrol/   github.com/Sapd/HeadsetControl (tag de la version livrée)  lib/devices/*.hpp
    openrgb/          gitlab.com/CalcProgrammer1/OpenRGB        Controllers/**
    openmouse/        github.com/OpenMouse-Project/openmouse    src/features/hardware-test/supported-devices-data.ts
"""
import glob
import json
import os
import re
import sys

SRC = sys.argv[1]
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cat = {}  # (vid, pid) -> entrée


def rd(p):
    return open(p, encoding="utf-8", errors="replace").read()


def kind_of(name, hint=""):
    # Les dossiers OpenRGB s'appellent « …Controller » : ce mot n'y désigne pas une manette
    n = (name + " " + hint.replace("Controllers", "").replace("Controller", "")).lower()
    for words, k in (
        (("mousepad", "mouse pad", "mousemat", "mouse mat", "firefly", "goliathus", "mm800", "mm1000", "qck"), "tapis"),
        (("headset", "headphone", "earbud", "arctis", "kraken", "blackshark", "barracuda", "nari", "cloud ", "virtuoso", "void", "hs80", "hs70", "astro a", "audio"), "casque"),
        (("keyboard", "keypad", "clavier", "keeb", "tkl", "huntsman", "blackwidow", "ornata", "cynosa", "apex", "alloy", "k70", "k95", "k65", "k100"), "clavier"),
        (("mouse", "souris", "mice", "deathadder", "viper", "basilisk", "naga", "mamba", "lancehead", "orochi", "rival", "sensei", "aerox", "prime", "pulsefire", "kone", "burst", "model o", "model d", "superlight", "g502", "g pro"), "souris"),
        (("controller", "gamepad", "manette", "wolverine", "raiju", "kishi"), "manette"),
        (("receiver", "dongle", "récepteur", "unifying", "lightspeed", "bolt"), "récepteur"),
    ):
        if any(w in n for w in words):
            return k
    return "rgb" if "rgb" in hint.lower() else "autre"


def add(vid, pid, name, kind, src, via="", status=None):
    vid, pid = vid.upper().zfill(4), pid.upper().zfill(4)
    e = cat.setdefault((vid, pid), {"vid": vid, "pid": pid, "name": "", "kind": "autre", "src": [], "via": "", "status": "known"})
    if name and (not e["name"] or src in ("openmouse", "openrazer", "rivalcfg", "headsetcontrol")):
        e["name"] = re.sub(r"\s+", " ", name).strip()
    if kind and kind != "autre" and (e["kind"] in ("autre", "rgb") or src in ("openrazer", "headsetcontrol")):
        e["kind"] = kind
    if src not in e["src"]:
        e["src"].append(src)
    rank = {"known": 0, "rgb": 1, "experimental": 2}
    if status and rank[status] > rank[e["status"]]:
        e["status"], e["via"] = status, via


# ---- libratbag (souris : Logitech, ASUS, SteelSeries, ROCCAT, Glorious…) ----
for p in glob.glob(os.path.join(SRC, "libratbag/data/devices/*.device")):
    t = rd(p)
    name = (re.search(r"^Name=(.*)$", t, re.M) or [None, ""])[1]
    dtype = (re.search(r"^DeviceType=(.*)$", t, re.M) or [None, ""])[1]
    driver = (re.search(r"^Driver=(.*)$", t, re.M) or [None, ""])[1]
    kind = {"mouse": "souris", "keyboard": "clavier"}.get(dtype.strip(), kind_of(name))
    for vid, pid in re.findall(r"usb:([0-9a-fA-F]{4}):([0-9a-fA-F]{4})", t):
        logi = vid.lower() == "046d" and driver.startswith("hidpp20")
        add(vid, pid, name, kind, "libratbag", "logitech-hidpp" if logi else "", "experimental" if logi else None)

# ---- OpenRazer (souris, claviers, casques, tapis Razer) ----
KIND_FILE = {"mouse.py": "souris", "keyboards.py": "clavier", "headsets.py": "casque", "mouse_mat.py": "tapis", "accessory.py": ""}
for p in glob.glob(os.path.join(SRC, "openrazer/daemon/openrazer_daemon/hardware/*.py")):
    t = rd(p)
    for m in re.finditer(r'class (\w+)\([^)]*\):\s*"""\s*(?:Class for the )?([^\n"]+)"""(.*?)(?=\nclass |\Z)', t, re.S):
        body = m.group(3)
        vid = re.search(r"USB_VID\s*=\s*0x([0-9a-fA-F]{4})", body)
        pid = re.search(r"USB_PID\s*=\s*0x([0-9a-fA-F]{4})", body)
        if not (vid and pid):
            continue
        name = m.group(2).strip()
        kind = KIND_FILE.get(os.path.basename(p)) or kind_of(name)
        ok = vid.group(1).lower() == "1532" and kind in ("souris", "clavier")
        add(vid.group(1), pid.group(1), name, kind, "openrazer", "razer-chroma" if ok else "", "experimental" if ok else None)

# ---- rivalcfg (souris SteelSeries) ----
for p in glob.glob(os.path.join(SRC, "rivalcfg/rivalcfg/devices/*.py")):
    t = rd(p)
    for name, vid, pid in re.findall(r'"name":\s*"([^"]+)",\s*"vendor_id":\s*0x([0-9a-fA-F]{4}),\s*"product_id":\s*0x([0-9a-fA-F]{4})', t):
        add(vid, pid, name, "souris", "rivalcfg")

# ---- Solaar (Logitech filaires) ----
t = rd(os.path.join(SRC, "solaar/lib/logitech_receiver/descriptors.py"))
for m in re.finditer(r'_D\(\s*"([^"]+)"(.*?)\)\s*\n', t, re.S):
    for usbid in re.findall(r"usbid=0x([0-9a-fA-F]{4})", m.group(2)):
        k = "clavier" if "DEVICE_KIND.keyboard" in m.group(2) else kind_of(m.group(1))
        add("046D", usbid, "Logitech " + m.group(1), k, "solaar", "logitech-hidpp", "experimental")
t = rd(os.path.join(SRC, "solaar/lib/logitech_receiver/base_usb.py"))
for kind, pid in re.findall(r"_(bolt|unifying|nano|lightspeed)\w*_receiver\(0x([0-9a-fA-F]{4})\)", t):
    add("046D", pid, f"Logitech récepteur {kind.capitalize()}", "récepteur", "solaar", "logitech-hidpp", "experimental")

# ---- HeadsetControl (casques ; version livrée avec PeriphHub) ----
hc_consts = {}
for p in glob.glob(os.path.join(SRC, "headsetcontrol/lib/**/*.hpp"), recursive=True):
    for k, v in re.findall(r"\b(VENDOR_[A-Z0-9_]+)\s*=\s*0x([0-9a-fA-F]{4})", rd(p)):
        hc_consts.setdefault(k, v)
for p in glob.glob(os.path.join(SRC, "headsetcontrol/lib/devices/*.hpp")):
    t = rd(p)
    name = re.search(r'getDeviceName\(\)[^{]*\{\s*return\s*"([^"]+)"', t)
    vref = re.search(r"getVendorId\(\)[^{]*\{\s*return\s*([A-Za-z0-9_:]+|0x[0-9a-fA-F]{4})", t)
    if not (name and vref):
        continue
    v = vref.group(1).split("::")[-1]
    local = dict(re.findall(r"\b(VENDOR_[A-Z0-9_]+)\s*=\s*0x([0-9a-fA-F]{4})", t))
    vid = v[2:] if v.startswith("0x") else local.get(v) or hc_consts.get(v)
    if not vid:
        continue
    block = re.search(r"(SUPPORTED_PRODUCT_IDS[^;]*;|getProductIds\(\)[^}]*\})", t, re.S)
    for pid in re.findall(r"0x([0-9a-fA-F]{4})", block.group(1) if block else ""):
        add(vid, pid, name.group(1), "casque", "headsetcontrol", "headsetcontrol", "experimental")

# ---- OpenRGB (éclairage de plus de 1 000 appareils) ----
defines = {}
files = glob.glob(os.path.join(SRC, "openrgb/Controllers/**/*.*"), recursive=True)
for p in files:
    if p.endswith((".h", ".cpp")):
        for k, v in re.findall(r"#define\s+(\w+)\s+0x([0-9a-fA-F]{4})\b", rd(p)):
            defines.setdefault(k, v)
for p in files:
    if not p.endswith(".cpp"):
        continue
    t = rd(p)
    for name, vid, pid in re.findall(r'REGISTER_(?:HID_|WOOTING_|DYNAMIC_HID_)?DETECTOR\w*\s*\(\s*"([^"]+)"\s*,\s*(?:\w+\s*,\s*)?(\w+)\s*,\s*(\w+)', t):
        v = vid[2:] if vid.startswith("0x") else defines.get(vid)
        q = pid[2:] if pid.startswith("0x") else defines.get(pid)
        if v and q and len(v) == 4 and len(q) == 4:
            # Wooting : le dernier chiffre du PID varie selon le mode manette (XInput/DInput/aucun)
            for q in ([q[:3] + d for d in "012"] if v.upper() == "31E3" else [q]):
                add(v, q, name, kind_of(name, os.path.basename(os.path.dirname(p))), "openrgb", "openrgb", "rgb")

# ---- OpenMouse (souris de toutes marques) ----
OM_BRAND_VID = {
    "Pulsar": ["3710", "25A7", "3554"], "Endgame Gear": ["3367"], "WLMouse": ["36A7"], "Lamzu": ["373E", "37B0", "3554"],
    "ATK": ["373B", "3554"], "VXE": ["3554", "373B"], "VGN": ["3554"], "Finalmouse": ["361D"], "Keychron": ["3434", "362D"],
    "Glorious": ["093A", "258A", "22D4", "320F", "3794"], "Mchose": ["3837", "2023"], "G-Wolves": ["33E4"], "VAXEE": ["3057"],
    "Ninjutso": ["093A", "1915"], "RAWM": ["1915"], "Razer": ["1532"], "Logitech": ["046D"], "SteelSeries": ["1038"],
    "Corsair": ["1B1C"], "Asus": ["0B05"], "HyperX": ["03F0", "0951"], "Cooler Master": ["2516"], "Redragon": ["04D9", "258A"],
    "AJAZZ": ["1A2C", "A8A4", "A8A5"], "Attack Shark": ["25A7", "373E", "1D57"], "Fantech": ["3151"], "Incott": ["093A"],
    "Rapoo": ["24AE"], "Delux": ["1D57"], "Hitscan": ["3770"], "Zaunkoenig": ["0483"], "Gravastar": ["3554"], "Microsoft": ["045E"],
    "Scyrox": ["3554"], "Teevolution": ["3554"], "Dareu": ["260D"], "Motospeed": ["0BDA"], "moddoMOUSE": ["2FE3"], "Orbital": ["1915"],
}
om = rd(os.path.join(SRC, "openmouse/src/features/hardware-test/supported-devices-data.ts"))
for brand, model, status, pids in re.findall(r'brand:\s*"([^"]+)",\s*model:\s*"([^"]+)",\s*status:\s*"(\w+)"(?:,\s*pids:\s*\[([^\]]*)\])?', om):
    vids = OM_BRAND_VID.get(brand)
    if not vids or not pids:
        continue
    for pid in re.findall(r"0x([0-9a-fA-F]{4})", pids):
        # Le même PID peut exister chez plusieurs puces : on ne garde que les VID déjà vus pour ce PID,
        # sinon le premier VID de la marque (le plus courant)
        seen = [v for v in vids if (v, pid.upper().zfill(4)) in cat]
        for v in seen or vids[:1]:
            good = status in ("supported", "likely")
            add(v, pid, f"{brand} {model}", "souris", "openmouse", "openmouse" if good else "", "experimental" if good else None)

out = sorted(cat.values(), key=lambda e: (e["vid"], e["pid"]))
for e in out:
    if not e["name"]:
        e["name"] = f"Appareil {e['vid']}:{e['pid']}"
path = os.path.join(REPO, "data", "catalog.json")
with open(path, "w", encoding="utf-8", newline="\n") as f:
    f.write("[\n" + ",\n".join(json.dumps(e, ensure_ascii=False, separators=(",", ":")) for e in out) + "\n]\n")
by = {}
for e in out:
    by[e["status"]] = by.get(e["status"], 0) + 1
srcs = {}
for e in out:
    for s in e["src"]:
        srcs[s] = srcs.get(s, 0) + 1
print(len(out), "appareils", by, srcs, os.path.getsize(path) // 1024, "Ko")
