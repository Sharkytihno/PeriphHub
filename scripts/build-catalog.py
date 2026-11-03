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
    # La docstring tient en général sur plusieurs lignes ("""\n    Class for the Razer X\n    """) :
    # exiger les guillemets fermants sur la même ligne ratait ~240 appareils Razer.
    for m in re.finditer(r'class (\w+)\([^)]*\):\s*"""\s*(?:Class for the )?([^\n"]+?)\s*"""(.*?)(?=\nclass |\Z)', t, re.S):
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
# Le VID est souvent hérité d'une classe de base (SteelSeriesLegacyDevice, CorsairDevice…) :
# on le prend dans le fichier s'il y est, sinon d'après la marque du nom de fichier.
hc_consts = {}
for p in glob.glob(os.path.join(SRC, "headsetcontrol/lib/**/*.*"), recursive=True):
    if p.endswith((".hpp", ".h", ".cpp")):
        t = rd(p)
        for k, v in re.findall(r"\b(VENDOR_[A-Z0-9_]+)\s*=\s*0x([0-9a-fA-F]{4})", t) + re.findall(r"#define\s+(VENDOR_[A-Z0-9_]+)\s+0x([0-9a-fA-F]{4})", t):
            hc_consts.setdefault(k, v)
HC_PREFIX = {"steelseries": "1038", "logitech": "046D", "corsair": "1B1C", "roccat": "1E7D", "audeze": "3329",
             "sony": "054C", "jabra": "0B0E", "plantronics": "047F", "lenovo": "17EF"}
for p in glob.glob(os.path.join(SRC, "headsetcontrol/lib/devices/*.hpp")):
    t = rd(p)
    name = re.search(r'getDeviceName\(\)[^{]*\{\s*return\s*"([^"]+)"', t)
    ids = re.search(r"((?:SUPPORTED_)?PRODUCT_IDS\s*\{[^;]*;|getProductIds\(\)[^}]*\})", t, re.S)
    if not (name and ids):
        continue
    vref = re.search(r"getVendorId\(\)[^{]*\{\s*return\s*([A-Za-z0-9_:]+)", t)
    vid = None
    if vref:
        v = vref.group(1).split("::")[-1]
        vid = v[2:] if v.startswith("0x") else hc_consts.get(v)
    if not vid:
        vid = HC_PREFIX.get(os.path.basename(p).split("_")[0])
    if not vid:
        print("HeadsetControl : VID introuvable pour", os.path.basename(p))
        continue
    if vid.upper() == "F00B":  # appareil de test de HeadsetControl
        continue
    body = re.sub(r"//[^\n]*", "", ids.group(1))
    for pid in re.findall(r"0x([0-9a-fA-F]{4})", body):
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


# ---- Razer Kraken filaires : éclairage par ui/js/drivers/razer-kraken.js (protocole OpenRazer) ----
for pid, name in {"0501": "Razer Kraken 7.1 Classic", "0506": "Razer Kraken 7.1 Classic", "0504": "Razer Kraken 7.1 Chroma",
                  "0510": "Razer Kraken 7.1 V2", "0520": "Razer Kraken Tournament Edition",
                  "0527": "Razer Kraken Ultimate", "0560": "Razer Kraken Kitty V2"}.items():
    add("1532", pid, name, "casque", "openrazer", "razer-kraken", "experimental")

# ---- SteelSeries Apex 3 : éclairage par ui/js/drivers/steelseries-apex.js (protocole OpenRGB) ----
add("1038", "161A", "SteelSeries Apex 3", "clavier", "openrgb", "steelseries-apex", "experimental")
add("1038", "1622", "SteelSeries Apex 3 TKL", "clavier", "openrgb", "steelseries-apex", "experimental")

# ---- Souris Corsair : DPI / fréquence par ui/js/drivers/corsair.js (protocoles ckb-next) ----
t = rd(os.path.join(REPO, "ui", "js", "drivers", "corsair.js"))
for pid, name in re.findall(r"0x([0-9A-F]{4}): \['([^']+)'", t):
    add("1B1C", pid, name, "souris", "ckb-next", "corsair", "experimental")

# ---- Manettes PlayStation : barre lumineuse, voyants, batterie par ui/js/drivers/playstation.js ----
t = rd(os.path.join(REPO, "ui", "js", "drivers", "playstation.js"))
for pid, name in re.findall(r"0x([0-9A-F]{4}): \['([^']+)'", t):
    add("054C", pid, "Sony " + name, "manette", "linux-hid-playstation", "playstation", "experimental")

# ---- OpenMouse claviers (copié dans ui/vendor/openmouse-kb) : Wooting ARM, SteelSeries Apex Pro, Keychron HE ----
kbv = os.path.join(REPO, "ui", "vendor", "openmouse-kb")
t = rd(os.path.join(kbv, "wooting", "index.js"))
for pid, name in re.findall(r"0x([0-9a-fA-F]{4}): \{ name: \"([^\"]+)\"", t[t.index("WOOTING_PRODUCTS"):t.index("WOOTING_PRODUCT_IDS")]):
    arm = "AVR" not in name and name not in ("Wooting One", "Wooting Two", "Wooting Two Lekker Edition")
    # le dernier chiffre du PID varie selon le mode manette (XInput / DInput / aucun)
    for q in [pid[:3] + d for d in "012"]:
        add("31E3", q, name, "clavier", "openmouse", "openmouse-kb" if arm else "", "experimental" if arm else None)
t = rd(os.path.join(kbv, "steelseries", "index.js"))
for pid, name in re.findall(r"\[0x([0-9a-fA-F]{4}), \{ name: \"([^\"]+)\"", t):
    add("1038", pid, "SteelSeries " + name, "clavier", "openmouse", "openmouse-kb", "experimental")
t = rd(os.path.join(kbv, "keychron", "products.js"))
for pid, name in re.findall(r"0x([0-9a-fA-F]{4}): \{ name: \"([^\"]+)\"", t):
    add("3434", pid, name, "clavier", "openmouse", "openmouse-kb", "experimental")

# HyperX Pulsefire Haste (DPI, fréquence, distance de levée) : protocole HyperX d'OpenMouse
t = rd(os.path.join(REPO, "ui", "vendor", "openmouse", "hyperx", "index.js"))
for m in re.finditer(r"0x([0-9a-fA-F]{4}), // (Pulsefire Haste[^\n(]*?)\s*\((Kingston|HP) era\)", t):
    pid, label, era = m.groups()
    add("0951" if era == "Kingston" else "03F0", pid.upper(), "HyperX " + label.replace("wired-mode alt", "filaire (variante)")
        .replace("wireless dongle", "sans fil (dongle)").replace("wired", "filaire"), "souris", "openmouse", "openmouse", "experimental")

# ---- Vérification croisée : ce que les protocoles OpenMouse embarqués acceptent réellement ----
# La liste « supported-devices-data » d'OpenMouse est en retard sur ses protocoles (DeathAdder V2,
# Basilisk V3, Rival 300, Prime… y manquent) : on interroge directement leurs isSupported().
import subprocess
import tempfile
with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tf:
    json.dump([f"{v}:{p}" for v, p in cat], tf)
probe = subprocess.run(["node", os.path.join(REPO, "scripts", "probe-openmouse.mjs"), tf.name],
                       capture_output=True, text=True, check=True)
os.unlink(tf.name)
for key, drivers in json.loads(probe.stdout).items():
    v, p = key.split(":")
    e = cat[(v, p)]
    # VIA = interface générique des claviers QMK, déjà gérée par drivers/via.js
    real = [d for d in drivers if d != "kb:VIA"]
    if real:
        add(v, p, "", "", "openmouse", "openmouse-kb" if real[0].startswith("kb:") else "openmouse", "experimental")

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
