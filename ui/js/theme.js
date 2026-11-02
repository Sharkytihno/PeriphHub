// PeriphHub — thème clair / sombre. Chargé sans « defer » dans <head> : le bon thème est posé
// avant le premier affichage (pas de flash blanc ou noir). Choix retenu : system | light | dark.
const themeMedia = matchMedia('(prefers-color-scheme: light)');

function themeChoice() {
  try { return localStorage.getItem('theme') || 'system'; } catch { return 'system'; }
}

function applyTheme(choice = themeChoice()) {
  const t = choice === 'system' ? (themeMedia.matches ? 'light' : 'dark') : choice;
  document.documentElement.dataset.theme = t;
  // Barre de titre Windows assortie (fenêtre de l'appli seulement)
  window.__TAURI__?.core.invoke('ui_theme', { theme: choice === 'system' ? null : t }).catch(() => {});
}

function setTheme(choice) {
  try { localStorage.setItem('theme', choice); } catch {}
  // Pas de fondu de toutes les couleurs pendant la bascule
  document.body.classList.add('notrans');
  applyTheme(choice);
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('notrans')));
}

themeMedia.addEventListener('change', () => { if (themeChoice() === 'system') applyTheme('system'); });
applyTheme();
