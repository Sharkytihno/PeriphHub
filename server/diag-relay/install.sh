#!/usr/bin/env bash
# Installe (ou met à jour) le relais des diagnostics sur le VPS, depuis le PC (Git Bash).
# Usage : bash server/diag-relay/install.sh
# Demande seulement : le jeton GitHub (si absent ou si on veut le changer) et le mot de passe sudo du VPS.
set -euo pipefail
KEY="${KEY:-$HOME/.ssh/trading-bot}"
HOST="${HOST:-sharky@46.224.185.112}"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "== Copie du relais sur le VPS"
ssh -i "$KEY" "$HOST" 'mkdir -p ~/periphhub-relay && chmod 700 ~/periphhub-relay'
scp -q -i "$KEY" "$DIR/relay.mjs" "$DIR/remote-setup.sh" "$HOST":~/periphhub-relay/

if ssh -i "$KEY" "$HOST" 'test -s ~/periphhub-relay/.env' && [ "${NEW_TOKEN:-}" != 1 ]; then
  echo "== Jeton déjà en place (NEW_TOKEN=1 pour le changer)"
else
  read -rsp "Collez le jeton GitHub (il reste invisible), puis Entrée : " T; echo
  [ -n "$T" ] || { echo "Jeton vide : arrêt."; exit 1; }
  printf 'GITHUB_TOKEN=%s\n' "$T" | ssh -i "$KEY" "$HOST" 'umask 077 && cat > ~/periphhub-relay/.env'
  unset T
fi

echo "== Lancement sur le VPS (le mot de passe sudo sera demandé pour Caddy)"
ssh -t -i "$KEY" "$HOST" 'bash ~/periphhub-relay/remote-setup.sh'
