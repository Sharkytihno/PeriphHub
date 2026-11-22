"""Copie les protocoles d'OpenMouse (AGPL-3.0-or-later) dans ui/vendor :
@openmouse/protocol -> ui/vendor/openmouse, @openmouse/keyboard-protocol -> ui/vendor/openmouse-kb.

Usage (depuis la racine du dépôt) :
    npm pack @openmouse/protocol@<version>      # télécharge l'archive, sans rien exécuter
    tar xzf openmouse-protocol-<version>.tgz    # -> package/
    python scripts/vendor-openmouse.py package   (idem pour @openmouse/keyboard-protocol)

Le paquet est publié pour un bundler : ses imports « @openmouse/protocol/xxx » sont réécrits
en chemins relatifs (la page de PeriphHub charge des modules ES natifs, sans import map
puisque la CSP interdit les scripts en ligne). Les fichiers .map et .d.ts ne sont pas copiés.
Le code n'est pas modifié autrement.

Les adaptations CompX et VGN du projet sont réappliquées après l'import.
"""
import json
import os
import posixpath
import re
import shutil
import subprocess
import sys

src = os.path.abspath(sys.argv[1])
repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pkg = json.load(open(os.path.join(src, "package.json"), encoding="utf-8"))
name = pkg["name"]
dst = os.path.join(repo, "ui", "vendor", {"@openmouse/protocol": "openmouse", "@openmouse/keyboard-protocol": "openmouse-kb"}[name])
patch = os.path.join(repo, "scripts", "patches", f"openmouse-{pkg['version']}.patch")
patched = name == "@openmouse/protocol" and os.path.isfile(patch)
if sys.argv[2:]:
    raise SystemExit("Option inconnue.")

exports = {}
for key, val in pkg["exports"].items():
    target = val["import"] if isinstance(val, dict) else val
    exports[name + key[1:]] = target[2:]  # "./dist/x.js" -> "dist/x.js"

IMPORT = re.compile(r'((?:from|import)\s*\(?\s*")(' + re.escape(name) + r'(?:/[^"]*)?)(")')

if os.path.isdir(dst):
    shutil.rmtree(dst)
count = 0
for dirpath, _, files in os.walk(os.path.join(src, "dist")):
    for f in files:
        if not f.endswith(".js"):
            continue
        rel = os.path.relpath(os.path.join(dirpath, f), src).replace(os.sep, "/")  # dist/...
        text = open(os.path.join(dirpath, f), encoding="utf-8").read()

        def fix(m):
            target = exports.get(m.group(2))
            if not target:
                raise SystemExit(f"import inconnu dans {rel} : {m.group(2)}")
            r = posixpath.relpath(target, posixpath.dirname(rel))
            return m.group(1) + (r if r.startswith(".") else "./" + r) + m.group(3)

        text = IMPORT.sub(fix, text)
        text = re.sub(r"^//# sourceMappingURL=.*$", "", text, flags=re.M)
        out = os.path.join(dst, rel[len("dist/"):])
        os.makedirs(os.path.dirname(out), exist_ok=True)
        open(out, "w", encoding="utf-8", newline="\n").write(text)
        count += 1

if patched:
    subprocess.run(["git", "apply", patch], cwd=repo, check=True)

shutil.copy(os.path.join(src, "LICENSE"), os.path.join(dst, "LICENSE"))
open(os.path.join(dst, "VERSION"), "w", encoding="utf-8", newline="\n").write(
    f"{name} {pkg['version']}\n"
    + ("Adaptations CompX et VGN : scripts/patches/openmouse-" + pkg["version"] + ".patch.\n" if patched else "")
    + "https://github.com/OpenMouse-Project\n"
    "Licence : AGPL-3.0-or-later (voir LICENSE). Importé par scripts/vendor-openmouse.py.\n")
print(f"{count} fichiers copiés dans {dst} ({pkg['version']})")
