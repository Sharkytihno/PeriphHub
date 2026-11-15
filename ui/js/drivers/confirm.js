// Confirmations : « ce réglage a marché (ou échoué) sur ce modèle », envoyées au développeur
// seulement avec l'accord de l'utilisateur (question posée une fois, Options ▸ Diagnostics).
// C'est ce qui fait passer un appareil d'« expérimental » à « confirmé » sans aller-retour avec
// les testeurs. Contenu : identifiant USB du modèle (VID:PID), nom du modèle, pilote, réglage,
// réussite ou erreur. Ni valeur choisie, ni numéro de série, ni chemin, ni nom d'utilisateur.
// Côté serveur : server/diag-relay (POST /periphhub/confirm) → un ticket par modèle dans le
// dépôt privé des diagnostics ; scripts/confirmations.mjs en tire ui/data/confirmed.js.
var CONFIRM_URL = 'https://sharkywedding.fr/periphhub/confirm';
const confirmQueue = new Map(); // clé → { id, name, driver, cap, ok, note }
let confirmTimer = 0;

function confirmAuto() { try { return localStorage.getItem('confirmAuto'); } catch { return null; } }
function confirmSetAuto(v) {
  try { localStorage.setItem('confirmAuto', v); } catch {}
  document.querySelectorAll('.confirmask').forEach(n => n.remove());
  if (v === 'on') confirmFlush(); else confirmQueue.clear();
  if (typeof refreshHome === 'function') refreshHome();
}

// Une fois par version de PeriphHub, modèle, pilote, réglage et résultat
function confirmSent() { try { return JSON.parse(localStorage.getItem('confirmSent')) || {}; } catch { return {}; } }

function drvConfirmSend(inst, cap, ok, note = '') {
  if (!NATIVE || !inst?.dev || inst.system || confirmAuto() === 'off') return;
  const id = devId(inst.dev);
  const driver = String(inst.driver?.id || '?');
  const version = (typeof report !== 'undefined' && report?.version) || '';
  const key = [version, id, driver, cap, ok ? 1 : 0].join('|');
  if (confirmSent()[key] || confirmQueue.has(key)) return;
  confirmQueue.set(key, { id, name: String(inst.name || '').slice(0, 60), driver, cap: String(cap).slice(0, 30), ok: !!ok,
    note: String(note || '').replace(/\s+/g, ' ').slice(0, 120) });
  if (confirmAuto() === 'on') {
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(confirmFlush, 60e3); // regroupe les réglages faits à la suite
  } else if (ok && cap !== 'connexion') confirmAskOnPage(inst);
}

async function confirmFlush() {
  if (confirmAuto() !== 'on' || !confirmQueue.size) return;
  const batch = [...confirmQueue].slice(0, 20);
  try {
    const r = await fetch(CONFIRM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' }, // requête « simple » : pas de vérification CORS préalable
      body: JSON.stringify({ version: report?.version || '', items: batch.map(([, v]) => v) }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const sent = confirmSent();
    for (const [k] of batch) { sent[k] = 1; confirmQueue.delete(k); }
    const keys = Object.keys(sent);
    try { localStorage.setItem('confirmSent', JSON.stringify(Object.fromEntries(keys.slice(-500).map(k => [k, 1])))); } catch {}
    if (confirmQueue.size) confirmTimer = setTimeout(confirmFlush, 5e3);
  } catch (e) {
    console.warn('[PeriphHub] confirmations', e.message || e);
    confirmTimer = setTimeout(confirmFlush, 600e3);
  }
}

// La question, posée au moment où un réglage vient de marcher (page de l'appareil) et sur l'accueil
function confirmAsk() {
  if (!NATIVE || confirmAuto() || ![...confirmQueue.values()].some(v => v.ok && v.cap !== 'connexion')) return null;
  const names = [...new Set([...confirmQueue.values()].filter(v => v.ok).map(v => v.name))].slice(0, 3).join(', ');
  return h('div', { class: 'notice confirmask' },
    h('p', {}, h('strong', {}, `Ça marche sur ${names} : prévenir le développeur ?`)),
    h('p', { class: 'muted small' }, 'Le modèle sera marqué « confirmé » pour tout le monde. Seuls partent : le modèle (identifiant USB et nom), '
      + 'le pilote et les réglages qui ont marché ou échoué. Ni valeur choisie, ni numéro de série, ni information personnelle. Modifiable dans les Options.'),
    h('div', { class: 'row-inline' },
      h('button', { onclick: () => confirmSetAuto('on') }, 'Oui, à chaque fois'),
      h('button', { class: 'ghost', onclick: () => confirmSetAuto('off') }, 'Non merci')));
}
function confirmAskOnPage(inst) {
  const page = typeof $ === 'function' ? $(inst.key) : null;
  if (!page || page.querySelector('.confirmask')) return;
  const n = confirmAsk();
  if (n) page.querySelector('.phead')?.after(n);
}

// Pastille « Confirmé » des modèles confirmés par des utilisateurs (ui/data/confirmed.js, régénéré à
// chaque version), pour les pilotes qui n'ont pas déjà la leur
function confirmChip(inst) {
  if (inst.chip) return inst.chip;
  const c = inst.dev && typeof CONFIRMED !== 'undefined' ? CONFIRMED[devId(inst.dev)] : null;
  if (!c || !c.caps?.length) return null;
  return { text: 'Confirmé', title: `Confirmé sur le vrai matériel par des utilisateurs de PeriphHub (${c.caps.join(', ')})` };
}
