// Décodeur de descripteur de rapports HID (USB HID 1.11, § 6.2.2).
// hidapi ne donne que les octets du descripteur : on en tire les « collections » que WebHID
// présente dans Chrome (page et usage, rapports d'entrée / sortie / feature avec leur ID et
// leurs éléments, sous-collections), pour que les protocoles écrits pour WebHID s'y retrouvent.

function hidParseDescriptor(bytes) {
  const top = [];
  const stack = [];
  let g = { usagePage: 0, reportSize: 0, reportCount: 0, reportId: 0, logicalMinimum: 0, logicalMaximum: 0 };
  const gStack = [];
  let local = { usages: [], usageMinimum: null, usageMaximum: null };
  const newCollection = (usagePage, usage, type) => ({
    usagePage, usage, type, children: [], inputReports: [], outputReports: [], featureReports: [],
  });
  const fullUsage = (v, size) => size === 4 ? v >>> 0 : ((g.usagePage << 16) | v) >>> 0;
  const addItem = (kind, flags) => {
    const col = stack[stack.length - 1];
    if (!col) return;
    const list = col[kind];
    let rep = list.find(r => r.reportId === g.reportId);
    if (!rep) list.push(rep = { reportId: g.reportId, items: [] });
    rep.items.push({
      reportSize: g.reportSize, reportCount: g.reportCount, usages: local.usages.slice(),
      usageMinimum: local.usageMinimum, usageMaximum: local.usageMaximum,
      logicalMinimum: g.logicalMinimum, logicalMaximum: g.logicalMaximum,
      isConstant: !!(flags & 1), isArray: !(flags & 2), isAbsolute: !(flags & 4),
    });
  };

  for (let i = 0; i < bytes.length;) {
    const prefix = bytes[i];
    if (prefix === 0xFE) { i += 3 + (bytes[i + 1] || 0); continue; } // élément long (jamais utilisé en pratique)
    const size = [0, 1, 2, 4][prefix & 3];
    const type = (prefix >> 2) & 3, tag = prefix >> 4;
    let u = 0;
    for (let k = 0; k < size; k++) u |= (bytes[i + 1 + k] || 0) << (8 * k);
    u >>>= 0;
    const s = size === 1 ? (u << 24) >> 24 : size === 2 ? (u << 16) >> 16 : u | 0; // valeur signée
    i += 1 + size;

    if (type === 0) { // élément principal
      if (tag === 0x8) addItem('inputReports', u);
      else if (tag === 0x9) addItem('outputReports', u);
      else if (tag === 0xB) addItem('featureReports', u);
      else if (tag === 0xA) {
        const usage = local.usages.length ? local.usages[0] : local.usageMinimum != null ? local.usageMinimum : (g.usagePage << 16) >>> 0;
        const col = newCollection(usage >>> 16, usage & 0xFFFF, u);
        (stack.length ? stack[stack.length - 1].children : top).push(col);
        stack.push(col);
      } else if (tag === 0xC) stack.pop();
      local = { usages: [], usageMinimum: null, usageMaximum: null };
    } else if (type === 1) { // élément global
      if (tag === 0x0) g.usagePage = u & 0xFFFF;
      else if (tag === 0x1) g.logicalMinimum = s;
      else if (tag === 0x2) g.logicalMaximum = g.logicalMinimum < 0 ? s : u;
      else if (tag === 0x7) g.reportSize = u;
      else if (tag === 0x8) g.reportId = u;
      else if (tag === 0x9) g.reportCount = u;
      else if (tag === 0xA) gStack.push({ ...g });
      else if (tag === 0xB && gStack.length) g = gStack.pop();
    } else if (type === 2) { // élément local
      if (tag === 0x0) local.usages.push(fullUsage(u, size));
      else if (tag === 0x1) local.usageMinimum = fullUsage(u, size);
      else if (tag === 0x2) local.usageMaximum = fullUsage(u, size);
    }
  }
  return top;
}

// Toutes les collections (sous-collections comprises)
function hidAllCollections(cols) {
  const out = [];
  const walk = list => list.forEach(c => { out.push(c); walk(c.children); });
  walk(cols);
  return out;
}

// Taille en octets d'un rapport, sans l'octet d'ID (0 si le rapport n'existe pas)
function hidReportBytes(cols, kind, reportId) {
  let bits = 0;
  for (const c of hidAllCollections(cols)) {
    for (const r of c[kind]) if (r.reportId === reportId) for (const it of r.items) bits += it.reportSize * it.reportCount;
  }
  return Math.ceil(bits / 8);
}

const hidHasReportIds = cols => hidAllCollections(cols).some(c =>
  ['inputReports', 'outputReports', 'featureReports'].some(k => c[k].some(r => r.reportId !== 0)));
