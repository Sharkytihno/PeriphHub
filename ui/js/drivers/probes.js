// Sondes du diagnostic : lectures SANS AUCUNE ÉCRITURE sur un appareil sans pilote ou dont le pilote
// échoue, pour qu'un seul diagnostic suffise à écrire ou corriger son pilote (plus d'allers-retours
// « renvoie un diagnostic »). Chaque sonde :
//   { id, label, match(group) → bool, run(group) → lignes }   group = interfaces HID de l'appareil
// Règle absolue : une sonde ne fait que des lectures connues de la famille (lecture de mémoire CompX,
// GET_FEATURE…), jamais une commande d'écriture, de mode, de remise à zéro ni de firmware.
// Les sondes de familles gérées par OpenMouse (module ES chargé plus tôt) s'ajoutent à
// globalThis.DIAG_PROBES avant ce fichier.
var DIAG_PROBES = globalThis.DIAG_PROBES || [];
globalThis.DIAG_PROBES = DIAG_PROBES;

const PROBE_TTL = 10 * 60e3;     // une sonde par appareil toutes les 10 min (l'aperçu du diagnostic se recalcule souvent)
const PROBE_BUDGET = 12e3;       // toutes sondes confondues, pour un appareil
const probeCache = new Map();    // « VID:PID » → { at, lines }

// Vidage hexadécimal compact : 32 octets par ligne, les plages uniformes (mémoire vierge 0xFF, zéros)
// regroupées. Format relu par tests/sim/compx.mjs (flashFromDiag) :
//   ▸ 0040 0102…            (adresse hexadécimale, octets)
//   ▸ 0200-1AFF ×ff         (plage remplie d'un même octet)
function diagHexDump(bytes, base = 0, width = 32) {
  const h2 = b => b.toString(16).padStart(2, '0');
  const h4 = n => n.toString(16).toUpperCase().padStart(4, '0');
  const out = [];
  let run = null; // { from, to, byte }
  const flush = () => {
    if (!run) return;
    out.push(run.to - run.from >= width ? `▸ ${h4(run.from)}-${h4(run.to - 1)} ×${h2(run.byte)}` : `▸ ${h4(run.from)} ${h2(run.byte).repeat(run.to - run.from)}`);
    run = null;
  };
  for (let i = 0; i < bytes.length; i += width) {
    const row = Array.from(bytes.slice(i, i + width));
    const addr = base + i;
    if (row.every(b => b === row[0]) && (row[0] === 0xFF || row[0] === 0x00)) {
      if (run && run.byte === row[0] && run.to === addr) run.to = addr + row.length;
      else { flush(); run = { from: addr, to: addr + row.length, byte: row[0] }; }
      continue;
    }
    flush();
    out.push(`▸ ${h4(addr)} ${row.map(h2).join('')}`);
  }
  flush();
  return out;
}

// Rapports « fonction » (feature) déclarés par les pages constructeur : GET_FEATURE est une simple
// lecture côté hôte. Taille annoncée par le descripteur (+1 pour l'ID sous hidapi).
function probeFeatureIds(d) {
  const cols = d.parsed || d.collections || [];
  if (!cols.some(c => c.usagePage >= 0xFF00) || typeof hidAllCollections !== 'function') return [];
  const m = new Map();
  for (const c of hidAllCollections(cols)) for (const r of c.featureReports || []) {
    const bits = (r.items || []).reduce((n, it) => n + (it.reportSize || 0) * (it.reportCount || 0), 0);
    m.set(r.reportId, Math.max(m.get(r.reportId) || 0, Math.ceil(bits / 8)));
  }
  return [...m].slice(0, 8);
}

DIAG_PROBES.push({
  id: 'feature',
  label: 'rapports fonction (GET_FEATURE)',
  match: group => group.some(d => probeFeatureIds(d).length),
  async run(group) {
    const lines = [];
    for (const d of group) {
      const ids = probeFeatureIds(d);
      if (!ids.length) continue;
      const opened = !d.opened;
      try {
        if (opened) await d.open();
        for (const [id, len] of ids) {
          try {
            const v = await d.receiveFeatureReport(id, len + 1);
            const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
            lines.push(`MI ${d.info?.interface ?? '?'} fonction 0x${id.toString(16).padStart(2, '0')} (${b.length} o)`, ...diagHexDump(b, 0, 32).map(l => '  ' + l));
          } catch (e) {
            lines.push(`MI ${d.info?.interface ?? '?'} fonction 0x${id.toString(16).padStart(2, '0')} : ${String(e?.message || e).slice(0, 80)}`);
          }
        }
      } catch (e) {
        lines.push(`MI ${d.info?.interface ?? '?'} : ouverture impossible (${String(e?.message || e).slice(0, 80)})`);
      } finally {
        if (opened) await d.close().catch(() => {});
      }
    }
    return lines;
  },
});

// Lance les sondes qui reconnaissent l'appareil (les plus précises d'abord, déclarées avant).
// Jamais sur un appareil qu'un pilote tient : on ne se met pas en travers de ses échanges.
async function runProbes(id, group, { force = false } = {}) {
  const hit = probeCache.get(id);
  if (hit && !force && Date.now() - hit.at < PROBE_TTL) return hit.lines;
  const lines = [];
  const t0 = performance.now();
  for (const p of DIAG_PROBES) {
    if (performance.now() - t0 > PROBE_BUDGET) { lines.push(`Sonde ${p.id} : sautée (temps écoulé)`); continue; }
    let ok = false;
    try { ok = p.match(group); } catch {}
    if (!ok) continue;
    const t = performance.now();
    try {
      const out = await p.run(group);
      lines.push(`Sonde ${p.id} · ${p.label} · lecture seule · ${((performance.now() - t) / 1000).toFixed(1)} s`, ...out.map(l => '  ' + l));
    } catch (e) {
      lines.push(`Sonde ${p.id} : ${String(e?.message || e).slice(0, 160)}`);
    }
  }
  probeCache.set(id, { at: Date.now(), lines });
  return lines;
}
