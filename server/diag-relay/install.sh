#!/usr/bin/env bash
# Installe (ou met à jour) le relais des diagnostics sur le VPS, depuis le PC (Git Bash).
# Usage : copier le jeton GitHub (bouton « copier » de GitHub), puis
#         bash server/diag-relay/install.sh
# Le jeton est lu dans le presse-papiers de Windows (rien à coller), vérifié auprès de GitHub,
# puis envoyé au VPS ; il n'est jamais affiché. Seul le mot de passe sudo du VPS est demandé.
set -euo pipefail
KEY="${KEY:-$HOME/.ssh/trading-bot}"
HOST="${HOST:-sharky@46.224.185.112}"
REPO="${REPO:-Sharkytihno/periphhub-diagnostics}"
DIR="$(cd "$(dirname "$0")" && pwd)"

token_ok() { # 0 si le jeton peut lire le dépôt des diagnostics
  [ "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $1" "https://api.github.com/repos/$REPO")" = 200 ]
}

echo "== Jeton GitHub"
T="$(powershell.exe -NoProfile -Command 'Get-Clipboard' 2>/dev/null | tr -d '\r\n\t ' || true)"
if [ -n "$T" ] && token_ok "$T"; then
  echo "Jeton trouvé dans le presse-papiers et accepté par GitHub."
  printf 'GITHUB_TOKEN=%s\n' "$T" | ssh -i "$KEY" "$HOST" 'mkdir -p ~/periphhub-relay && chmod 700 ~/periphhub-relay && umask 077 && cat > ~/periphhub-relay/.env'
  unset T
  # On vide le presse-papiers : le jeton n'a plus rien à y faire
  powershell.exe -NoProfile -Command 'Set-Clipboard -Value " "' >/dev/null 2>&1 || true
elif ssh -i "$KEY" "$HOST" 'test -s ~/periphhub-relay/.env'; then
  unset T
  echo "Pas de jeton valide dans le presse-papiers : on garde celui déjà installé sur le VPS."
else
  unset T
  echo "Aucun jeton valide : sur GitHub, cliquez l'icône « copier » à côté du jeton (commence par github_pat_), puis relancez ce script."
  exit 1
fi

echo "== Copie du relais sur le VPS"
scp -q -i "$KEY" "$DIR/relay.mjs" "$DIR/remote-setup.sh" "$HOST":~/periphhub-relay/

echo "== Lancement sur le VPS (mot de passe sudo demandé pour Caddy)"
ssh -t -i "$KEY" "$HOST" 'bash ~/periphhub-relay/remote-setup.sh'
