"""Construit ui/js/drivers/rongyuan-models.js : les claviers de la plateforme Rongyuan (puces RY5088,
YC3121, PAN1086… sous les VID 0x3151, 0x39AB, 0x38A9…), d'après le pilote web officiel qmk.top/v4.

Usage : python scripts/build-rongyuan.py <dossier>
  <dossier>/index.js            = https://qmk.top/v4/js/index.<empreinte>.js (bundle principal)
  <dossier>/chunks/<id>.js      = les morceaux chargés à la demande (index des modèles 294b8f87,
                                  classe commune d3637439, une classe par modèle)

Seuls des faits sont repris (identifiants, bornes, dispositions des touches), aucun code. Un modèle
n'est retenu que si sa classe hérite de la classe commune sans en changer le protocole (sinon la
partie concernée est désactivée : éclairage, réglages magnétiques).
"""
import json, os, re, sys

sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1]
CH = os.path.join(SRC, 'chunks')
BASE = 'd3637439'          # classe commune (protocole complet)
MAG_OVERRIDE = 'edcf5b4e'  # classe intermédiaire qui réécrit les réglages magnétiques
MATRIX = re.compile(r'^default[A-Za-z]*matrix$', re.I)
PROTO_LIGHT = {'setLightSetting', 'getLightSetting', 'applyPresetOrCustomRgb'}
PROTO_MAG = {'setMultiMagnetismInfo', 'getMultiMagnetismInfo', 'setMagnetismInfoSimple', '_getMulitMagnetismCMD',
             '_sendMagnetismInfoSimpleCMD', 'get磁轴行程步进倍数', 'getLegacy磁轴行程步进倍数', 'getFeatureList', 'getPrecisionEnum'}
PROTO_OTHER = {'setReportRate', 'getReportRate', 'commonMsg', 'sendMsg', 'getUSBVersion', 'FEA_CMD_SET_REPORT',
               'FEA_CMD_GET_REPORT', 'FEA_CMD_SET_LEDPARAM', 'FEA_CMD_GET_LEDPARAM', 'MAXSPEED', 'LightList'}
# Constantes d'éclairage qu'un modèle peut redéfinir sans changer le protocole
LIGHT_CONSTS = {'NORMAL', 'DAZZLE', 'COMMONCOLOR'}


def read(p):
    return open(p, encoding='utf-8').read()


def block(s, i, open_c='{', close_c='}'):
    """Texte équilibré qui commence à s[i] (== open_c), chaînes comprises."""
    d = 0; k = i; q = None
    while True:
        c = s[k]
        if q:
            if c == '\\':
                k += 2; continue
            if c == q:
                q = None
        elif c in '"\'`':
            q = c
        elif c == open_c:
            d += 1
        elif c == close_c:
            d -= 1
            if d == 0:
                return s[i:k + 1]
        k += 1


def members(body):
    """Membres de premier niveau d'un corps de classe."""
    d = 0; q = None; out = []; i = 0; start = True
    while i < len(body):
        c = body[i]
        if q:
            if c == '\\':
                i += 2; continue
            if c == q:
                q = None
        elif c in '"\'`':
            q = c
        elif c in '{([':
            d += 1
        elif c in '})]':
            d -= 1
        elif d == 0 and c == ';':
            start = True; i += 1; continue
        if d == 0 and start and c not in ' ;':
            m = re.match(r'(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z0-9_$一-鿿]+)\s*(=|\()', body[i:])
            if m:
                out.append((m.group(1), i))
            start = False
        i += 1
    return out


def literal(js):
    """Littéral JS simple (nombres, chaînes, !0/!1, tableaux, objets) → valeur Python."""
    if re.search(r'[()=>]', re.sub(r'"(?:[^"\\]|\\.)*"', '""', js)):
        raise ValueError('pas un littéral : ' + js[:80])
    t = re.sub(r'!0\b', 'true', js)
    t = re.sub(r'!1\b', 'false', t)
    t = re.sub(r'void 0', 'null', t)
    t = re.sub(r'([{,])\s*([A-Za-z_$一-鿿][A-Za-z0-9_$一-鿿]*)\s*:', r'\1"\2":', t)
    t = re.sub(r'([{,])\s*([0-9]+)\s*:', r'\1"\2":', t)
    t = re.sub(r'(?<![0-9"])\.([0-9])', r'0.\1', t)
    t = re.sub(r'(\d)e(\d)', r'\1e\2', t)
    t = re.sub(r'(\d+(?:\.\d+)?)\*(\d+)(?:\*(\d+))?', lambda m: str(float(m.group(1)) * int(m.group(2)) * int(m.group(3) or 1)), t)
    return json.loads(t)


def int_array(js):
    return [int(x) for x in js.strip('[]').split(',') if x.strip() != '']


def class_info(src, local):
    """(classe parente : (fichier, nom exporté) ou None, membres, corps) d'une classe locale."""
    m = re.search(r'class ' + re.escape(local) + r' extends ([A-Za-z0-9_$]+)\{', src)
    if not m:
        return None
    body = block(src, m.end() - 1)[1:-1]
    imp = {}
    for a, f in re.findall(r'import\{([^}]*)\}from"\./([0-9a-f]+)\.js"', src):
        for part in a.split(','):
            x = part.strip().split(' as ')
            if len(x) == 2:
                imp[x[1]] = (f, x[0])
    parent = imp.get(m.group(1))
    if parent is None:  # classe parente dans le même fichier
        parent = ('.', m.group(1))
    return parent, members(body), body


def value_of(src, body, name, pos):
    """Valeur littérale du membre `name=` (directe, ou constante du module)."""
    rest = body[pos:]
    v = rest[len(name) + 1:].lstrip()
    if v.startswith('[') or v.startswith('{'):
        return block(v, 0, v[0], ']' if v[0] == '[' else '}')
    m = re.match(r'([A-Za-z_$][A-Za-z0-9_$]*)', v)
    if m:
        c = re.search(r'(?:const |,)' + re.escape(m.group(1)) + r'=([\[{])', src)
        if c:
            st = c.end() - 1
            return block(src, st, src[st], ']' if src[st] == '[' else '}')
    m = re.match(r'(-?[0-9.]+)', v)
    return m.group(1) if m else None


def export_local(src, export):
    m = re.search(r'export\{([^}]*)\}', src)
    for part in (m.group(1).split(',') if m else []):
        a = part.strip().split(' as ')
        if len(a) == 2 and a[1] == export:
            return a[0]
        if len(a) == 1 and a[0] == export:
            return a[0]
    return None


def resolve(file, local, depth=0):
    """Remonte la chaîne de classes jusqu'à la classe commune : membres redéfinis et matrices."""
    src = read(os.path.join(CH, file + '.js'))
    info = class_info(src, local)
    if info is None:
        return None
    parent, mem, body = info
    here = {'files': [file], 'over': set(), 'matrix': None, 'consts': {}}
    for name, pos in mem:
        if name == 'defaultMatrix':
            here['matrix'] = value_of(src, body, name, pos)
        elif MATRIX.match(name):
            pass
        elif name in LIGHT_CONSTS:
            here['consts'][name] = value_of(src, body, name, pos)
        else:
            here['over'].add(name)
    pf, pl = parent
    if pf == '.':
        pf = file
    if pf == BASE:
        here['base'] = True
        return here
    if depth > 4:
        return None
    up = resolve(pf, export_local(read(os.path.join(CH, pf + '.js')), pl) or pl, depth + 1)
    if up is None:
        return None
    up['files'] = here['files'] + up['files']
    up['over'] |= here['over']
    up['matrix'] = here['matrix'] or up['matrix']
    up['consts'] = {**up['consts'], **here['consts']}
    return up


def main():
    idx = read(os.path.join(SRC, 'index.js'))
    base = read(os.path.join(CH, BASE + '.js'))
    base_matrix = int_array(re.search(r'const P=(\[[0-9,]+\])', base).group(1))

    # Modèles : objets {id:…,vid:…,pid:…,…} du bundle principal
    models = {}
    for m in re.finditer(r'\{id:(\d+),vid:(\d+),pid:(\d+),', idx):
        o = block(idx, m.start())
        if 'type:"keyboard"' not in o:
            continue
        g = lambda k: (re.search(k + r':"((?:[^"\\]|\\.)*)"', o) or [None, None])[1]
        name = g('name')
        if not name:
            continue
        ts = re.search(r'travelSetting:\{', o)
        lay = re.search(r'lightLayout:([A-Za-z0-9_$]+)', o)
        models.setdefault(name, []).append({
            'id': int(m.group(1)), 'vid': int(m.group(2)), 'pid': int(m.group(3)),
            'n': g('displayName') or name, 'c': g('company') or '',
            'mag': 'magnetism:!0' in o,
            'layout': lay.group(1) if lay else None,
            'travel': literal(block(o, ts.end() - 1)) if ts else None,
        })

    # Classe de chaque modèle (index findRy5088Device)
    ry = read(os.path.join(CH, '294b8f87.js'))
    rows = re.findall(r'([A-Za-z0-9_]+):\(\)=>t\(\(\)=>import\("\./([0-9a-f]+)\.js"\),\[[^\]]*\],import\.meta\.url\)\.then\(_=>\(\{default:_\.([A-Za-z0-9_$]+)\}\)\)', ry)

    layouts_used, out, skipped = {}, {}, []
    for name, file, export in rows:
        if name not in models:
            continue  # classe sans fiche clavier (souris, récepteur…)
        src = read(os.path.join(CH, file + '.js'))
        r = resolve(file, export_local(src, export) or export)
        if r is None:
            skipped.append((name, 'chaîne de classes non résolue')); continue
        if r['over'] & PROTO_OTHER:
            skipped.append((name, 'protocole redéfini : ' + ', '.join(sorted(r['over'] & PROTO_OTHER)))); continue
        matrix = int_array(r['matrix']) if r['matrix'] else base_matrix
        slots = -(-len(matrix) // 4)
        keys = 0
        for i in range(slots):
            if any(matrix[i * 4:i * 4 + 4]):
                keys |= 1 << i
        no_mag = MAG_OVERRIDE in r['files'] or bool(r['over'] & PROTO_MAG)
        no_light = bool(r['over'] & PROTO_LIGHT)
        consts = {}
        bad_const = None
        for k, v in r['consts'].items():
            try:
                consts[k] = literal(v) if v and v[0] in '[{' else (float(v) if v and '.' in v else int(v))
            except (ValueError, TypeError):
                bad_const = f'{k} = {str(v)[:60]}'
        if bad_const:
            no_light = True
            skipped.append((name, 'éclairage désactivé, constante illisible : ' + bad_const))
        for mo in models[name]:
            e = {'n': mo['n'], 'c': mo['c'], 'p': mo['pid'], 'v': mo['vid'], 's': slots, 'k': format(keys, 'x')}
            if mo['mag'] and not no_mag:
                e['m'] = 1
                if mo['travel']:
                    e['t'] = {k: mo['travel'][k] for k in ('travel', 'firePress', 'fireLift') if k in mo['travel']}
            if mo['layout'] and not no_light:
                e['l'] = mo['layout']
                layouts_used[mo['layout']] = True
            if consts:
                e['x'] = consts
            out[mo['id']] = e

    # Dispositions d'éclairage : X={isRgb:…,types:[…]} dans le bundle principal
    layouts = {}
    for lay in layouts_used:
        m = re.search(r'[,;{ ]' + re.escape(lay) + r'=\{isRgb:', idx)
        if not m:
            continue
        obj = literal(block(idx, m.start() + len(lay) + 2))
        layouts[lay] = [{k: t[k] for k in ('type', 'maxValue', 'maxSpeed', 'options', 'rgb', 'dazzle') if k in t} for t in obj['types']]
    for e in out.values():
        if e.get('l') not in layouts:
            e.pop('l', None)

    # Interfaces à ouvrir (filtres WebHID du pilote officiel), claviers seulement
    filters = []
    for f in re.findall(r'\{type:"keyboard",vendorId:(\d+),productId:(\d+),usage:(\d+),usagePage:(\d+)(?:,interfaceNumber:(\d+))?(?:,reportRate:([0-9e.]+))?\}', idx):
        filters.append([int(f[0]), int(f[1]), int(f[3]), int(f[2]), int(f[4]) if f[4] else -1, int(float(f[5])) if f[5] else 0])
    # Seule l'interface fabricant (page 0xFFFF) : jamais l'interface clavier standard (page 1)
    filters = sorted({tuple(x) for x in filters if x[2] == 0xFFFF})
    # Récepteurs 2,4 GHz : ils relaient les commandes autrement (préfixe F6), pas pris en charge ici
    dq = re.search(r'[,;]DQ=(\[[^\]]*\])', idx)
    dongles = sorted({(d['vid'], d['pid']) for d in literal(dq.group(1))}) if dq else []
    filters = [f for f in filters if (f[0], f[1]) not in dongles]

    # Règle du pilote officiel (isSupportReportRate) : jamais en Bluetooth, jamais si la fréquence max
    # connue est <= 1000 ; sinon liste blanche (identifiants, marques entières) ou firmware >= 1024.
    i = idx.index('isSupportReportRate=()=>{')
    fn = idx[i:idx.index('a>=1024}', i)]
    deny = {int(x) for x in re.findall(r'id===(\d+)\)return!1', fn)}
    rate_ids = sorted({int(x) for x in re.findall(r'deviceType\.id===(\d+)', fn)} - deny)
    rate_brands = sorted(set(re.findall(r'company==="([^"]+)"(?:&&e\.deviceType\.type==="keyboard")?\|\|', fn)))
    for mid, e in out.items():
        if mid in rate_ids or e['c'] in rate_brands:
            e['r'] = 1
        if mid in deny:
            e['r'] = 0

    labels = sorted({json.dumps(o, ensure_ascii=False) for l in layouts.values() for t in l for o in (t.get("options") or [])})
    js = ('// Généré par scripts/build-rongyuan.py d\'après le pilote web qmk.top/v4 : ne pas modifier à la main.\n'
          '// id (commande 0x8F) → n nom, c marque, v/p VID/PID, s emplacements de la matrice, k touches présentes\n'
          '// (masque hexadécimal), m réglages magnétiques, t bornes de course (mm), l éclairage, x constantes, r fréquence réglable\n'
          '// quel que soit le firmware (1) ou jamais (0).\n'
          'const RY_MODELS = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n'
          'const RY_LAYOUTS = ' + json.dumps(layouts, ensure_ascii=False, separators=(',', ':')) + ';\n'
          '// [VID, PID, page d\'usage, usage, interface (-1 : toutes), fréquence max (0 : inconnue)]\n'
          'const RY_FILTERS = ' + json.dumps([list(f) for f in filters], separators=(',', ':')) + ';\n')
    dst = os.path.join(ROOT, 'ui', 'js', 'drivers', 'rongyuan-models.js')
    open(dst, 'w', encoding='utf-8', newline='\n').write(js)
    mag = sum(1 for e in out.values() if e.get('m'))
    print(f'{len(out)} claviers ({mag} magnétiques), {len(layouts)} éclairages, {len(filters)} interfaces, '
          f'{len(rate_ids)} exceptions de fréquence {rate_brands}, {len(skipped)} écartés, {len(js) // 1024} Ko')
    for s in skipped[:15]:
        print('  écarté :', *s)
    print('libellés d\'options :', labels)


main()
