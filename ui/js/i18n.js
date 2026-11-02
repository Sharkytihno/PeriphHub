// PeriphHub — langue de l'interface (français ou anglais).
// Chargé sans « defer » dans <head>, juste après i18n/en.js : l'interface est écrite en français et,
// en anglais, chaque texte affiché (nœuds texte, title, placeholder, aria-label) est traduit au vol
// avant d'être peint, d'après les tables de i18n/en.js. Aucun texte n'est à modifier dans le code.

const LANGS = { fr: 'Français', en: 'English' };

function langChoice() {
  try { const l = localStorage.getItem('lang'); if (LANGS[l]) return l; } catch {}
  return /^fr\b/i.test(navigator.language || '') ? 'fr' : 'en';
}

const LANG = langChoice();
const LOCALE = LANG === 'en' ? 'en-GB' : 'fr-FR';
document.documentElement.lang = LANG;

// Changement de langue : rechargement complet (les appareils se reconnectent tout seuls)
function setLang(l) {
  try { localStorage.setItem('lang', l); } catch {}
  location.reload();
}

const I18N = (() => {
  if (LANG !== 'en' || typeof I18N_EN === 'undefined') return null;
  const norm = s => s.replace(/'/g, '’');
  const dict = new Map(Object.entries(I18N_EN).map(([k, v]) => [norm(k), v]));
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // gabarits : les plus précis (le plus de texte fixe) d'abord
  const tpls = Object.entries(I18N_EN_T).map(([fr, en]) => {
    const fixed = norm(fr).split('{}');
    return {
      re: new RegExp('^' + fixed.map(esc).join('(.+?)') + '$', 's'),
      en: en.split('{}'),
      weight: fixed.join('').length,
      // « {} : {} », « {} ({}) » : seulement si une partie variable est traduite
      generic: !/[A-Za-zÀ-ÿ]/.test(fixed.join('')),
    };
  }).sort((a, b) => b.weight - a.weight);
  // phrases longues reconnues aussi à l'intérieur d'un texte plus grand (messages assemblés)
  const long = [...dict.keys()].filter(k => k.length >= 12).sort((a, b) => b.length - a.length);
  const longRe = long.length ? new RegExp(long.map(esc).join('|'), 'g') : null;
  return { norm, dict, tpls, longRe };
})();

function trCore(s, depth) {
  const { dict, tpls, longRe } = I18N;
  const hit = dict.get(s);
  if (hit != null) return hit;
  if (depth > 3) return null;
  for (const [re, fn] of I18N_EN_RE) if (re.test(s)) return s.replace(re, fn);
  const fill = generic => {
    for (const tp of tpls) {
      if (tp.generic !== generic) continue;
      const m = tp.re.exec(s);
      if (!m) continue;
      let any = false;
      const parts = m.slice(1).map(p => { const t = trText(p, depth + 1); if (t !== p) any = true; return t; });
      if (generic && !any) continue;
      return tp.en.reduce((out, piece, i) => out + piece + (i < parts.length ? parts[i] : ''), '');
    }
    return null;
  };
  const out = fill(false);
  if (out != null) return out;
  if (s.includes(' · ')) {
    const segs = s.split(' · '), segOut = segs.map(p => trText(p, depth + 1));
    if (segOut.some((p, i) => p !== segs[i])) return segOut.join(' · ');
  }
  if (longRe) {
    longRe.lastIndex = 0;
    if (longRe.test(s)) return s.replace(longRe, k => dict.get(k));
  }
  return fill(true);
}

// Traduit un texte affiché (espaces autour conservés) ; le renvoie tel quel s'il est inconnu
function trText(text, depth = 0) {
  if (!I18N || !text) return text;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  if (!m[2] || !/[A-Za-zÀ-ÿ]/.test(m[2])) return text;
  const out = trCore(I18N.norm(m[2]), depth);
  return out == null ? text : m[1] + out + m[3];
}

// Pour le code qui a besoin d'un texte traduit hors du DOM (presse-papiers, etc.)
const tx = s => trText(s);

if (I18N) {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'KBD']);
  const ATTRS = ['title', 'placeholder', 'aria-label'];
  const done = new WeakMap(); // nœud → dernier texte posé (évite de retraduire sa propre traduction)
  const skip = el => !el || SKIP.has(el.nodeName) || el.closest?.('[data-noi18n],[contenteditable]');

  const textNode = n => {
    if (done.get(n) === n.data || skip(n.parentElement)) return;
    const out = trText(n.data);
    if (out !== n.data) n.data = out;
    done.set(n, n.data);
  };
  const attrs = el => {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v) { const out = trText(v); if (out !== v) el.setAttribute(a, out); }
    }
  };
  const walk = root => {
    if (root.nodeType === 3) return textNode(root);
    if (root.nodeType !== 1 || skip(root)) return;
    attrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeType === 3 ? textNode(n) : attrs(n);
  };

  new MutationObserver(list => {
    for (const r of list) {
      if (r.type === 'childList') r.addedNodes.forEach(walk);
      else if (r.type === 'characterData') textNode(r.target);
      else if (r.target.nodeType === 1) { const v = r.target.getAttribute(r.attributeName); if (v) { const out = trText(v); if (out !== v) r.target.setAttribute(r.attributeName, out); } }
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  if (document.body) walk(document.body);
}
