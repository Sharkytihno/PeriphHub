// PeriphHub — ventilateurs, sous les capteurs de la page Températures : automatique (carte mère, carte
// graphique, profil ASUS), vitesse fixe ou courbe selon une température.
// Le service des capteurs (sensors/PeriphHubSensors.cs) applique et revérifie tout : bornes, minimum des
// ventilateurs du processeur et des pompes, 100 % quand le processeur ou la carte graphique chauffe trop.
// Il garde les réglages et démarre avec Windows tant qu'un ventilateur est réglé à la main : la courbe
// tient même PeriphHub fermé.
//
// #fanCtl n'est reconstruit que si les réglages changent (sinon les valeurs sont mises à jour sur place) :
// un point de courbe en cours de déplacement ou un curseur pris au clavier ne sont pas perdus à chaque relevé.
// Version perso (perso/fans.js, sa propre commande des ventilateurs) : cette partie reste vide.

let fcSig = '';            // signature de la dernière construction
let fcDragging = false;    // point de courbe tenu à la souris
const fcDraft = new Map(); // courbes en cours de modification (id → { t, p })

const FC_PRESETS = [
  { name: 'Silencieux', pts: [[40, 25], [60, 40], [75, 70], [85, 100]] },
  { name: 'Équilibré', pts: [[35, 30], [55, 50], [70, 75], [80, 100]] },
  { name: 'Performance', pts: [[30, 45], [50, 65], [65, 90], [75, 100]] },
];
const FC_MODES = [{ v: 'auto', label: 'Automatique' }, { v: 'fixed', label: 'Vitesse fixe' }, { v: 'curve', label: 'Courbe' }];
const FC_ASUS = [{ v: 2, label: 'Silencieux' }, { v: 0, label: 'Équilibré' }, { v: 1, label: 'Turbo' }];

// La version perso pilote elle-même les ventilateurs de son PC
const fcPerso = () => typeof renderFans === 'function';
// Section affichée (les vitesses des cartes de capteurs y sont alors en double)
const fcShown = hw => !fcPerso() && !!sensLast?.fan && (hw.k === 'AsusAtk' || hw.s.some(s => s.k === 'Control' && s.ctl));
// Ventilateur du processeur ou pompe : jamais sous le minimum du service (même règle que Fans.Critical)
const fcCritical = o => /cpu|pump|aio|opt/i.test(o.raw || '') || /cpu|pump|aio|opt/i.test(o.ctl?.n || '');

// Composant en deux mots (« Sondes de la carte mère » → « Carte mère »)
const fcKind = hw => /^Gpu/.test(hw.k) ? 'Carte graphique' : ['SuperIO', 'Motherboard', 'EmbeddedController'].includes(hw.k) ? 'Carte mère' : SENS_KIND[hw.k] || hw.k;

// Sorties pilotables d'après le relevé
function fcOutputs(v) {
  const out = [];
  for (const hw of v?.hw || []) {
    if (hw.k === 'AsusAtk') continue;
    for (const s of hw.s) {
      if (s.k !== 'Control' || !s.ctl || !s.id) continue;
      const fan = hw.s.find(x => x.k === 'Fan' && x.i === s.i);
      out.push({ id: s.id, hw, ctl: s, fan, raw: fan?.n || s.n, name: fan ? sensName(fan) : sensName(s),
        role: /^Gpu/.test(hw.k) ? 'Carte graphique · ' + hw.n : fcKind(hw), gpu: /^Gpu/.test(hw.k) });
    }
  }
  const ah = (v?.hw || []).find(x => x.k === 'AsusAtk');
  for (const f of v?.fan?.asus?.fans || [])
    out.push({ id: f.id, asus: true, raw: f.id === 'asus/cpu' ? 'cpu' : '', name: f.n, role: 'Portable ASUS',
      fan: ah?.s.find(x => x.id === f.id), def: f.def, gpu: f.id === 'asus/gpu' });
  return out;
}

// Sondes proposées pour une courbe : processeur, cartes graphiques, sondes de la carte mère
function fcSources(v) {
  const list = [];
  for (const hw of v?.hw || []) {
    if (hw.k === 'AsusAtk' || hw.k === 'Storage' || sensIgpu(hw)) continue;
    const main = sensMain(hw);
    for (const s of hw.s.filter(sensTempOk)) {
      if (!s.id || (hw.k === 'Cpu' && s !== main && !/Max|Average/i.test(s.n))) continue;
      const kind = fcKind(hw), name = sensName(s);
      list.push({ id: s.id, hw, s, main: s === main, label: name === kind ? kind : `${kind} · ${name}` });
    }
  }
  return list;
}

function fcDefaultSrc(v, o) {
  const src = fcSources(v);
  return (o.gpu && src.find(x => x.hw === o.hw && x.main)) || src.find(x => x.hw.k === 'Cpu' && x.main) || src[0] || null;
}

// Température qui pilote la courbe (ASUS : celle que le firmware regarde)
function fcTemp(v, o, cfg) {
  if (o.asus) {
    const hw = (v.hw || []).find(x => (o.gpu ? /^Gpu/.test(x.k) && !sensIgpu(x) : x.k === 'Cpu'));
    return hw ? sensMain(hw)?.v ?? null : null;
  }
  const id = cfg.src || fcDefaultSrc(v, o)?.id;
  for (const hw of v.hw || []) for (const s of hw.s) if (s.id === id) return sensTempOk(s) ? s.v : null;
  return null;
}

const fcCfg = (v, id) => (v.fan?.cfg || []).find(c => c.id === id) || { id, mode: 'auto' };
const fcMin = (v, o) => fcCritical(o) ? v.fan?.minCpu ?? 20 : 0;
// Vitesse demandée en ce moment (%) : consigne du service, sinon ce que la puce annonce
const fcDuty = (v, o) => v.fan?.out?.[o.id] ?? (o.ctl?.v != null ? o.ctl.v : null);
const fcUsed = (v, o) => o.asus || (o.fan?.v ?? 0) > 0 || fcCfg(v, o.id).mode !== 'auto';

// Points d'un préréglage pour cette sortie : 8 points pour ASUS (températures de sa courbe d'origine)
function fcPoints(o, pts) {
  if (!o.asus) return { t: pts.map(p => p[0]), p: pts.map(p => p[1]) };
  const t = o.def?.t?.length === 8 ? o.def.t.slice() : [30, 40, 50, 60, 70, 80, 90, 100];
  return { t, p: t.map(x => Math.round(fcAt(pts.map(p => p[0]), pts.map(p => p[1]), x))) };
}
function fcAt(t, p, x) {
  if (x <= t[0]) return p[0];
  for (let i = 1; i < t.length; i++) if (x <= t[i]) return p[i - 1] + (p[i] - p[i - 1]) * (x - t[i - 1]) / (t[i] - t[i - 1]);
  return p[p.length - 1];
}

async function fcSend(cmd, quiet = false) {
  try {
    const r = await nativeInvoke('sensors_fan', { cmd });
    if (sensLast && r?.fan) sensLast.fan = r.fan;
    if (!quiet) toast(cmd.cmd === 'reset' ? 'Tous les ventilateurs sont repassés en automatique' : 'Réglage appliqué', 'ok');
    return true;
  } catch (e) {
    toast('Ventilateurs : ' + (e?.message || e), 'err');
    return false;
  } finally {
    fcSig = '';
    fcRender(sensLast);
  }
}

function fcSet(v, o, patch) {
  const cfg = fcCfg(v, o.id);
  const src = cfg.src || (o.asus ? null : fcDefaultSrc(v, o)?.id || null);
  const cmd = { cmd: 'fan', id: o.id, mode: cfg.mode, pct: cfg.pct ?? 50, src, t: cfg.t || [], p: cfg.p || [], ...patch };
  // Portable ASUS : mêmes garde-fous que le service (Fans.AsusCurve), pour voir la courbe vraiment appliquée
  if (o.asus && cmd.mode === 'curve') cmd.p = cmd.p.map((p, i) => Math.max(p, cmd.t[i] >= 80 ? 50 : 0, i === cmd.p.length - 1 ? 80 : 0));
  return fcSend(cmd);
}

function fcPickMode(v, o, mode) {
  if (mode === 'auto') return fcSet(v, o, { mode });
  if (mode === 'fixed') return fcSet(v, o, { mode, pct: Math.max(fcMin(v, o), Math.round(fcDuty(v, o) ?? 50)) });
  const c = o.asus && o.def?.t?.length === 8 ? o.def : fcPoints(o, FC_PRESETS[1].pts);
  return fcSet(v, o, { mode, t: c.t, p: c.p.map(p => Math.max(fcMin(v, o), p)) });
}

// ---------- Éditeur de courbe (souris : glisser les points ; clavier : flèches) ----------

const FC_T0 = 20, FC_T1 = 110, FC_W = 340, FC_H = 170, FC_L = 34, FC_B = 22;
const fcX = t => FC_L + (t - FC_T0) / (FC_T1 - FC_T0) * (FC_W - FC_L - 10);
const fcY = p => FC_H - FC_B - p / 100 * (FC_H - FC_B - 10);
const svgEl = (tag, a = {}) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in a) e.setAttribute(k, a[k]); return e; };

function fcCurve(v, o, cfg) {
  const c = fcDraft.get(o.id) || { t: cfg.t.slice(), p: cfg.p.slice() };
  const svg = svgEl('svg', { viewBox: `0 0 ${FC_W} ${FC_H}`, class: 'fccurve', 'data-fc': 'svg:' + o.id, role: 'group',
    'aria-label': 'Courbe : température → vitesse. Flèches gauche et droite : température du point ; haut et bas : vitesse.' });
  for (const t of [20, 40, 60, 80, 100]) {
    svg.append(svgEl('line', { x1: fcX(t), x2: fcX(t), y1: 10, y2: FC_H - FC_B, class: 'grid' }));
    const lbl = svgEl('text', { x: fcX(t), y: FC_H - 6, class: 'ax', 'text-anchor': 'middle' });
    lbl.textContent = t + '°';
    svg.append(lbl);
  }
  for (const p of [0, 50, 100]) {
    svg.append(svgEl('line', { x1: FC_L, x2: FC_W - 10, y1: fcY(p), y2: fcY(p), class: 'grid' }));
    const lbl = svgEl('text', { x: FC_L - 6, y: fcY(p) + 4, class: 'ax', 'text-anchor': 'end' });
    lbl.textContent = p + '%';
    svg.append(lbl);
  }
  const now = svgEl('line', { y1: 10, y2: FC_H - FC_B, class: 'now', 'data-fc': 'now:' + o.id });
  svg.append(now);
  const line = svgEl('polyline', { class: 'line' });
  svg.append(line);
  const tip = h('div', { class: 'muted small fctip', 'aria-live': 'polite' }, '');
  const dots = c.t.map((_, i) => {
    const d = svgEl('circle', { r: 6, class: 'pt', tabindex: 0, role: 'slider', 'aria-label': `Point ${i + 1}` });
    svg.append(d);
    return d;
  });
  const draw = () => {
    line.setAttribute('points', [[FC_T0, c.p[0]], ...c.t.map((t, i) => [t, c.p[i]]), [FC_T1, c.p[c.p.length - 1]]].map(([t, p]) => `${fcX(t)},${fcY(p)}`).join(' '));
    dots.forEach((d, i) => {
      d.setAttribute('cx', fcX(c.t[i]));
      d.setAttribute('cy', fcY(c.p[i]));
      d.setAttribute('aria-valuetext', `${c.t[i]} °C, ${c.p[i]} %`);
    });
    fcNow(v, o, cfg, now);
  };
  const min = fcMin(v, o);
  const move = (i, t, p) => {
    const lo = i ? c.t[i - 1] + 1 : 0, hi = i < c.t.length - 1 ? c.t[i + 1] - 1 : FC_T1;
    c.t[i] = Math.max(lo, Math.min(hi, Math.round(t)));
    c.p[i] = Math.max(min, Math.min(100, Math.round(p)));
    // Toujours croissante : les voisins suivent le point déplacé
    for (let j = i + 1; j < c.p.length; j++) c.p[j] = Math.max(c.p[j], c.p[i]);
    for (let j = i - 1; j >= 0; j--) c.p[j] = Math.min(c.p[j], c.p[i]);
    fcDraft.set(o.id, c);
    tip.textContent = `Point ${i + 1} : ${c.t[i]} °C → ${c.p[i]} %`;
    draw();
  };
  let timer = 0;
  const commit = () => { clearTimeout(timer); fcDraft.delete(o.id); return fcSet(v, o, { mode: 'curve', t: c.t, p: c.p }); };
  dots.forEach((d, i) => {
    d.addEventListener('pointerdown', e => {
      e.preventDefault();
      d.setPointerCapture(e.pointerId);
      fcDragging = true;
      d.focus();
    });
    d.addEventListener('pointermove', e => {
      if (!d.hasPointerCapture(e.pointerId)) return;
      const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
      move(i, FC_T0 + (pt.x - FC_L) / (FC_W - FC_L - 10) * (FC_T1 - FC_T0), (FC_H - FC_B - pt.y) / (FC_H - FC_B - 10) * 100);
    });
    const end = e => {
      if (!d.hasPointerCapture(e.pointerId)) return;
      d.releasePointerCapture(e.pointerId);
      fcDragging = false;
      if (fcDraft.has(o.id)) commit();
    };
    d.addEventListener('pointerup', end);
    d.addEventListener('pointercancel', end);
    d.addEventListener('keydown', e => {
      const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] }[e.key];
      if (!k) return;
      e.preventDefault();
      move(i, c.t[i] + k[0], c.p[i] + k[1]);
      clearTimeout(timer);
      timer = setTimeout(commit, 800);
    });
  });
  draw();
  const edit = o.asus ? null : h('div', { class: 'row-inline' },
    h('button', { class: 'ghost', disabled: c.t.length >= 8, title: 'Ajoute un point au milieu du plus grand écart', onclick: () => {
      let k = 1;
      for (let i = 1; i < c.t.length; i++) if (c.t[i] - c.t[i - 1] > c.t[k] - c.t[k - 1]) k = i;
      if (c.t[k] - c.t[k - 1] < 2) return;
      const t = Math.round((c.t[k] + c.t[k - 1]) / 2);
      c.t.splice(k, 0, t);
      c.p.splice(k, 0, Math.round(fcAt(cfg.t, cfg.p, t)));
      return commit();
    } }, '+ point'),
    h('button', { class: 'ghost', disabled: c.t.length <= 2, onclick: () => { c.t.splice(-2, 1); c.p.splice(-2, 1); return commit(); } }, '− point'));
  return h('div', { class: 'fcedit' }, svg, tip, edit);
}

function fcNow(v, o, cfg, line) {
  const t = fcTemp(v, o, cfg);
  line.style.display = t == null ? 'none' : '';
  if (t != null) { line.setAttribute('x1', fcX(Math.max(FC_T0, Math.min(FC_T1, t)))); line.setAttribute('x2', fcX(Math.max(FC_T0, Math.min(FC_T1, t)))); }
}

// ---------- Cartes ----------

function fcCard(v, o) {
  const cfg = fcCfg(v, o.id);
  const duty = fcDuty(v, o);
  const min = fcMin(v, o);
  const t = fcTemp(v, o, cfg);
  const preset = cfg.mode === 'curve' ? FC_PRESETS.find(pr => { const q = fcPoints(o, pr.pts); return JSON.stringify(q.t) === JSON.stringify(cfg.t) && JSON.stringify(q.p) === JSON.stringify(cfg.p); }) : null;
  const srcs = o.asus ? [] : fcSources(v);
  const src = cfg.src || fcDefaultSrc(v, o)?.id;
  return h('div', { class: 'card scard fccard' + (fcUsed(v, o) ? '' : ' idle') },
    h('div', { class: 'shead' },
      h('div', {}, h('div', { class: 'muted small' }, o.role), h('strong', { title: o.raw }, o.name)),
      h('div', { class: 'sside' },
        h('div', { class: 'sbig' }, h('span', { 'data-fc': 'rpm:' + o.id }, o.fan?.v != null ? Math.round(o.fan.v).toLocaleString(LOCALE) : '—'), h('small', { class: 'unit' }, ' tr/min')),
        h('div', { class: 'spow', 'data-fc': 'duty:' + o.id }, duty != null ? Math.round(duty) + ' %' : ''))),
    duty != null ? h('div', { class: 'pwbar', title: 'Vitesse demandée' }, h('i', { 'data-fc': 'bar:' + o.id, style: `width:${Math.max(2, duty)}%` })) : null,
    segmented(FC_MODES, cfg.mode, m => fcPickMode(v, o, m)),
    cfg.mode === 'auto' ? h('div', { class: 'muted small' }, o.asus ? 'Suit le profil ASUS choisi plus haut.'
      : o.gpu ? 'Suit la courbe de la carte graphique.' : 'Suit la courbe de la carte mère (réglée dans le BIOS).') : null,
    cfg.mode === 'fixed' ? h('div', { class: 'lvl' }, h('span', { class: 'muted' }, 'Vitesse'),
      slider(min, 100, 5, Math.max(min, cfg.pct ?? 50), ' %', p => fcSet(v, o, { mode: 'fixed', pct: p }))) : null,
    cfg.mode === 'curve' ? h('div', { class: 'curvebox' },
      h('div', { class: 'seg fanpre', role: 'group' }, FC_PRESETS.map(pr => h('button', { class: preset === pr ? 'on' : '', 'aria-pressed': String(preset === pr),
        onclick: () => { const q = fcPoints(o, pr.pts); return fcSet(v, o, { mode: 'curve', t: q.t, p: q.p }); } }, pr.name)),
        o.asus && o.def?.t?.length === 8 ? h('button', { onclick: () => fcSet(v, o, { mode: 'curve', t: o.def.t, p: o.def.p.map(p => Math.max(min, p)) }) }, 'D’origine') : null),
      o.asus ? h('div', { class: 'muted small' }, (o.gpu ? 'Selon la température de la carte graphique' : 'Selon la température du processeur')
        + (t != null ? ` (${fmtT(t)} en ce moment)` : '') + ', lue par le portable lui-même.')
        : h('label', { class: 'row-inline small' }, h('span', { class: 'muted' }, 'Selon'),
          h('select', { onchange: e => fcSet(v, o, { mode: 'curve', src: e.target.value }) },
            srcs.map(x => h('option', { value: x.id, selected: x.id === src }, x.label))),
          h('span', { class: 'muted', 'data-fc': 'temp:' + o.id }, t != null ? fmtT(t) : '')),
      fcCurve(v, o, cfg)) : null,
    cfg.mode !== 'auto' && min ? h('div', { class: 'muted small' }, `Jamais sous ${min} % (sécurité du processeur).`) : null,
    o.asus && cfg.mode !== 'auto' ? h('div', { class: 'muted small' }, 'Garde-fous du portable : au moins 50 % dès 80 °C, et 80 % au dernier point.') : null);
}

function fcSection(v) {
  const f = v.fan;
  const head = note => h('div', { class: 'bhead fchead' }, h('h3', {}, 'Ventilateurs'), note ? h('span', { class: 'muted small' }, note) : null);
  if (!f) return [head(''), h('div', { class: 'card warn' }, 'Pour régler les ventilateurs, le module capteurs doit être mis à jour. ',
    h('button', { disabled: sensBusy, onclick: () => sensAdmin('install') }, 'Mettre à jour (une validation Windows)'))];
  const outs = fcOutputs(v);
  if (!outs.length) return [head(''), h('div', { class: 'card scard' },
    h('strong', {}, 'PeriphHub ne peut pas encore régler les ventilateurs de ce PC'),
    h('p', { class: 'muted' }, 'Sur ce PC, aucune sortie de ventilateur n’est accessible : beaucoup de portables les confient à une puce du constructeur, '
      + 'et certaines cartes mères ne publient pas leurs commandes. Envoyez le diagnostic : il dit au développeur quelles puces ont été trouvées pour ajouter ce PC.'),
    h('div', {}, h('button', { disabled: diagBusy, onclick: sendPcDiag }, 'Envoyer le diagnostic du PC')))];
  const used = outs.filter(o => fcUsed(v, o)), idle = outs.filter(o => !fcUsed(v, o));
  const manual = (f.cfg || []).length > 0 || (f.asus && f.asus.mode >= 0);
  const parts = [head(`100 % automatiquement au-delà de ${f.hot?.cpu ?? 90} °C (processeur) ou ${f.hot?.gpu ?? 85} °C (carte graphique)`)];
  if (f.panic) parts.push(h('div', { class: 'card err' }, 'Sécurité : le processeur ou la carte graphique est trop chaud, les ventilateurs réglés ici tournent à 100 %.'));
  if (f.error) parts.push(h('div', { class: 'card err' }, 'Commande refusée par la puce : ' + f.error));
  if (f.asus) parts.push(h('div', { class: 'card scard' },
    h('div', { class: 'shead' }, h('div', {}, h('div', { class: 'muted small' }, 'Portable ASUS'), h('strong', {}, 'Profil'))),
    segmented(FC_ASUS, f.asus.mode, m => fcSend({ cmd: 'asus_mode', v: m })),
    h('div', { class: 'muted small' }, 'Comme dans Armoury Crate : le profil règle aussi la puissance du processeur et de la carte graphique. '
      + (f.asus.curves ? 'Chaque ventilateur peut ensuite suivre sa propre courbe.' : 'Ce modèle n’accepte pas de courbes personnalisées : seuls les profils.'))));
  const cards = (f.asus && !f.asus.curves ? [] : used).map(o => fcCard(v, o));
  if (cards.length) parts.push(h('div', { class: 'sgrid' }, cards));
  if (idle.length) parts.push(h('details', { class: 'fanidle' },
    h('summary', { class: 'muted small' }, `${idle.length} sortie${idle.length > 1 ? 's' : ''} sans ventilateur détecté`),
    h('div', { class: 'sgrid' }, idle.map(o => fcCard(v, o)))));
  parts.push(h('div', { class: 'muted small sfoot' },
    manual ? 'Réglages gardés par le service des capteurs : ils tiennent PeriphHub fermé et après un redémarrage. ' : 'La carte mère garde la main tant que vous ne changez rien. ',
    manual ? h('button', { class: 'ghost', onclick: () => fcSend({ cmd: 'reset' }) }, 'Tout remettre en automatique') : null));
  return parts;
}

// Appelé à chaque relevé (renderSensors, js/sensors.js)
function fcRender(v) {
  const box = $('fanCtl');
  if (!box) return;
  if (fcPerso() || !NATIVE || !v?.installed || !v.ready) { if (box.firstChild) box.replaceChildren(); fcSig = ''; return; }
  const outs = fcOutputs(v);
  const sig = JSON.stringify([!!v.fan, outs.map(o => [o.id, fcUsed(v, o)]), v.fan?.cfg, v.fan?.asus?.mode, v.fan?.asus?.curves,
    v.fan?.panic, v.fan?.error, diagBusy, sensBusy, fcSources(v).map(s => s.id)]);
  if (sig !== fcSig && !fcDragging) {
    // Saisie en cours dans la section (point pris au clavier, liste ouverte) : elle reste, on attend
    const focus = box.contains(document.activeElement) && document.activeElement !== document.body;
    if (!focus || !fcSig) {
      fcSig = sig;
      box.replaceChildren(...fcSection(v));
      return;
    }
  }
  // Mise à jour sur place
  const set = (k, txt) => { const e = box.querySelector(`[data-fc="${CSS.escape(k)}"]`); if (e && e.textContent !== txt) e.textContent = txt; };
  for (const o of outs) {
    const cfg = fcCfg(v, o.id);
    const duty = fcDuty(v, o);
    set('rpm:' + o.id, o.fan?.v != null ? Math.round(o.fan.v).toLocaleString(LOCALE) : '—');
    set('duty:' + o.id, duty != null ? Math.round(duty) + ' %' : '');
    const bar = box.querySelector(`[data-fc="${CSS.escape('bar:' + o.id)}"]`);
    if (bar && duty != null) bar.style.width = Math.max(2, duty) + '%';
    const t = fcTemp(v, o, cfg);
    set('temp:' + o.id, t != null ? fmtT(t) : '');
    const now = box.querySelector(`[data-fc="${CSS.escape('now:' + o.id)}"]`);
    if (now) fcNow(v, o, cfg, now);
  }
}

// Diagnostic : ce qui est pilotable et ce que l'utilisateur a choisi
function fcDiag(v) {
  if (!v?.fan) return v?.ready ? ['  Ventilateurs : service sans commande (ancienne version)'] : [];
  const f = v.fan;
  const outs = fcOutputs(v);
  const lines = [`  Ventilateurs pilotables : ${outs.length}${outs.length ? ' · ' + outs.map(o => `${o.asus ? o.id : o.raw || o.name}${o.fan?.v != null ? ' ' + Math.round(o.fan.v) + ' tr/min' : ''}`).join(', ') : ''}`
    + (f.asus ? ` · ASUS ATK (profil ${f.asus.mode}, courbes ${f.asus.curves ? 'oui' : 'non'})` : '')
    + ` · sécurité ${f.panic ? 'ACTIVE' : 'au repos'} · démarrage avec Windows ${f.boot ? 'oui' : 'non'}${fcPerso() ? ' · version perso (pilotage perso)' : ''}`];
  for (const c of f.cfg || []) lines.push(`    ${c.id} : ${c.mode}${c.mode === 'fixed' ? ' ' + c.pct + ' %' : ''}${c.mode === 'curve' ? ' ' + c.t.map((t, i) => t + '→' + c.p[i]).join(' ') + (c.src ? ' selon ' + c.src : '') : ''}${f.out?.[c.id] != null ? ' · envoyé ' + Math.round(f.out[c.id]) + ' %' : ''}`);
  if (f.error) lines.push('    erreur : ' + f.error);
  return lines;
}
