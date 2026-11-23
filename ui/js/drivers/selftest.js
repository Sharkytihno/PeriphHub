// Auto-test guidé (« Tester cet appareil ») : pour chaque réglage reconnu, PeriphHub écrit une autre
// valeur, la relit, puis remet celle d'origine et vérifie qu'elle est bien revenue. Le résultat
// remplace l'aller-retour avec le testeur (« change le DPI, ça marche ? ») : il s'affiche, part en
// confirmations si l'utilisateur l'a accepté (js/drivers/confirm.js), et un échec propose le diagnostic.
// Ne touche qu'aux réglages simples (nombres, listes, interrupteurs, luminosité) : jamais aux boutons,
// macros, profils ni au firmware.

const ST_SKIP = new Set(['battery', 'profile', 'buttons', 'macros', 'keys', 'keymap']);
const ST_NAME = { dpi: 'DPI', rate: 'Fréquence', lod: 'Distance de levée', sleep: 'Mise en veille', debounce: 'Anti-rebond',
  motionSync: 'Motion Sync', angleSnapping: 'Correction d’angle', ripple: 'Anti-ondulation', performance: 'Mode performance',
  smartshift: 'Molette crantée', hires: 'Défilement haute résolution', invert: 'Défilement inversé', light: 'Éclairage',
  actuation: 'Course d’activation', travel: 'Course d’activation', rt: 'Rapid Trigger', rtSens: 'Sensibilité du Rapid Trigger', brightness: 'Luminosité',
  systemMode: 'Mode du clavier', backlight: 'Rétroéclairage' };

const stEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stOther = (list, cur) => {
  const i = list.findIndex(v => stEq(v, cur));
  if (list.length < 2) return undefined;
  return i < 0 ? list[0] : list[i + 1 < list.length ? i + 1 : i - 1];
};
const stStep = (cur, min, max, step) => {
  const s = step > 0 ? step : 1;
  const r = x => Math.round(x * 1000) / 1000;
  if (cur + s <= max) return r(cur + s);
  if (cur - s >= min) return r(cur - s);
};

// Valeur d'essai pour un réglage, ou undefined s'il n'est pas testable sans risque
function selfTestValue(cap, c, cur) {
  if (cur == null || c == null || c === false || ST_SKIP.has(cap)) return;
  if (cap === 'dpi' && typeof cur === 'number') {
    if (c.discrete) return stOther(c.options, cur);
    const opts = (c.options || []).filter(v => v >= c.min && v <= c.max);
    if (opts.length > 1 && opts.length < 200) return stOther(opts, cur);
    return stStep(cur, c.min, c.max, Math.max(c.step || 50, 50));
  }
  if (cap === 'light') {
    if (typeof cur !== 'object') return;
    if (c.brightness && typeof cur.brightness === 'number') return { ...cur, brightness: cur.brightness >= 50 ? cur.brightness - 20 : cur.brightness + 20 };
    const fx = (c.effects || []).filter(e => e !== 'off');
    const e = stOther(fx, cur.effect);
    return e === undefined ? undefined : { ...cur, effect: e };
  }
  if (cap === 'smartshift' && typeof cur === 'object') return { ...cur, mode: cur.mode === 2 ? 1 : 2 };
  if (Array.isArray(c)) return stOther(c, cur);
  if (c === true && typeof cur === 'boolean') return !cur;
  if (typeof cur === 'number' && typeof c === 'object') {
    if (Array.isArray(c.options) && c.options.length > 1) return stOther(c.options, cur);
    const min = c.min ?? 0, max = c.max;
    if (Number.isFinite(max)) return stStep(cur, min, max, c.step ?? 1);
  }
}

// Réglages testés, dans l'ordre de la page
function selfTestPlan(inst) {
  const caps = inst.caps || {}, s = inst.state || {};
  const order = ['dpi', 'rate', 'lod', 'debounce', 'sleep', 'motionSync', 'angleSnapping', 'ripple', 'performance', 'smartshift', 'hires', 'invert', 'light'];
  const keys = [...order.filter(k => k in caps), ...Object.keys(caps).filter(k => !order.includes(k))];
  const plan = [];
  for (const cap of keys) {
    const test = selfTestValue(cap, caps[cap], s[cap]);
    if (test !== undefined && !stEq(test, s[cap])) plan.push({ cap, name: ST_NAME[cap] || cap, from: structuredClone(s[cap]), test });
  }
  return plan;
}

function selfTestable(inst) { return !!inst?.dev && !inst.system && !inst.noOrigin && !inst.noSelfTest && inst.kind !== 'webcam' && selfTestPlan(inst).length > 0; }

// Relu « comme demandé » : égalité, ou nombre arrondi au palier près par l'appareil
function stRead(got, want, from, c) {
  if (stEq(got, want)) return true;
  if (typeof got === 'number' && typeof want === 'number') {
    const tol = Math.max((c && c.step) || 0, 1);
    return got !== from && Math.abs(got - want) <= tol;
  }
  if (got && want && typeof got === 'object' && typeof want === 'object') // relu avec des champs en plus ou en moins
    return Object.keys(want).every(k => !(k in got) || stEq(got[k], want[k]));
  return false;
}

// Déroule le test. onStep(résultats) à chaque étape (affichage) ; retourne les résultats :
// { cap, name, ok (écrit et relu), back (valeur d'origine revenue), note }
async function selfTestRun(inst, { onStep = () => {}, pause = 400 } = {}) {
  const plan = selfTestPlan(inst);
  const out = plan.map(p => ({ cap: p.cap, name: p.name, ok: null, back: null, note: '', err: '' }));
  // Filet de sécurité : l'état d'origine est gardé comme pour un réglage fait à la main
  if (typeof drvOrigin === 'function' && !drvOrigin(inst)) lsSet(origKey(inst), { date: Date.now(), state: structuredClone(inst.state) });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i], r = out[i], c = inst.caps[p.cap];
    r.ok = 'run'; onStep(out);
    try {
      await inst.set(p.cap, structuredClone(p.test));
      await wait(pause);
      await inst.refresh();
      r.ok = stRead(inst.state[p.cap], p.test, p.from, c);
      if (!r.ok) r.note = 'relu ' + JSON.stringify(inst.state[p.cap]).slice(0, 40) + ' au lieu de ' + JSON.stringify(p.test).slice(0, 40);
    } catch (e) {
      r.ok = false;
      r.note = r.err = String(e?.message || e).slice(0, 100);
    }
    // Retour à la valeur d'origine, deux essais (une souris sans fil peut s'être endormie)
    for (let k = 0; k < 2 && r.back !== true; k++) {
      try {
        if (!stEq(inst.state[p.cap], p.from)) await inst.set(p.cap, structuredClone(p.from));
        await wait(pause);
        await inst.refresh();
        r.back = stRead(inst.state[p.cap], p.from, p.test, c);
      } catch (e) {
        r.back = false;
        if (!r.note) r.note = 'retour : ' + String(e?.message || e).slice(0, 80);
      }
    }
    // Confirmation : jamais de valeur (politique de confidentialité), seulement l'erreur de l'appareil
    if (typeof drvConfirm === 'function') drvConfirm(inst, p.cap, r.ok === true, 'auto-test' + (r.ok === true ? '' : ' : ' + (r.err || 'relu différent')));
    if (r.ok !== true && typeof drvFail === 'function') drvFail(inst, p.cap, r.note || 'relu différent', 'auto-test');
    onStep(out);
  }
  return out;
}

// Fenêtre de l'auto-test
function selfTestDialog(inst) {
  const plan = selfTestPlan(inst);
  if (!plan.length) return;
  const list = h('ul', { class: 'stlist' });
  const mark = r => r.ok === 'run' ? '…' : r.ok === null ? '·' : r.ok && r.back ? '✔' : '✘';
  const draw = out => list.replaceChildren(...out.map(r => h('li', { class: r.ok === 'run' ? 'run' : r.ok === null ? '' : r.ok && r.back ? 'ok' : 'err' },
    h('span', { class: 'stmark' }, mark(r)), ' ', r.name,
    r.ok !== null && r.ok !== 'run' && r.back === false ? h('strong', {}, ' · valeur d’origine pas revenue') : null,
    r.note ? h('span', { class: 'muted small' }, ' · ' + r.note) : null)));
  draw(plan.map(p => ({ name: p.name, ok: null })));
  const foot = h('div', { class: 'row-inline' });
  const go = h('button', { onclick: run }, 'Lancer le test');
  foot.append(go);
  const info = h('p', { class: 'muted small' }, 'PeriphHub va changer chacun de ces réglages, vérifier que l’appareil a bien pris la nouvelle valeur, '
    + 'puis remettre la valeur actuelle. Environ ' + Math.max(5, Math.round(plan.length * 2)) + ' secondes. Pour une souris sans fil, bougez-la pendant le test pour qu’elle ne se mette pas en veille.');
  const m = modal(
    h('header', { class: 'dhead' }, h('h3', {}, 'Tester ' + inst.name),
      h('button', { class: 'x', title: 'Fermer', 'aria-label': 'Fermer', onclick: () => m.close() }, '×')),
    info, list, h('footer', { class: 'dfoot' }, foot));
  async function run() {
    go.disabled = true;
    go.textContent = 'Test en cours…';
    let out;
    out = await selfTestRun(inst, { onStep: draw });
    drvRender(inst);
    refreshHome();
    const bad = out.filter(r => !(r.ok && r.back));
    const lost = out.filter(r => r.back === false);
    info.textContent = !bad.length ? `Tout marche : ${out.length} réglage${out.length > 1 ? 's' : ''} sur ${out.length}.`
      : `${out.length - bad.length} réglage${out.length - bad.length > 1 ? 's' : ''} sur ${out.length} marche${out.length - bad.length > 1 ? 'nt' : ''}.`
        + (lost.length ? ' Certaines valeurs d’origine ne sont pas revenues : « Remettre les réglages » sur la page de l’appareil.' : ' Envoyer le diagnostic aide à corriger le reste.');
    info.classList.remove('muted');
    foot.replaceChildren(...[ // replaceChildren écrirait « null » en texte
      bad.length && NATIVE ? h('button', { onclick: () => { m.close(); diagDialog(drvDiagId(inst) || ''); } }, 'Envoyer le diagnostic') : null,
      h('button', { class: bad.length ? 'ghost' : '', onclick: () => m.close() }, 'Fermer')].filter(Boolean));
    if (typeof confirmAskOnPage === 'function') confirmAskOnPage(inst);
  }
}
