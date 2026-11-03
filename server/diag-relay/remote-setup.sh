#!/usr/bin/env bash
# Partie VPS de install.sh : démarre le relais avec pm2 et l'expose via Caddy
# (https://sharkywedding.fr/periphhub/…). Sûr à relancer : rien n'est ajouté deux fois,
# et le Caddyfile est restauré si la nouvelle version n'est pas valide.
set -euo pipefail
cd ~/periphhub-relay
PORT=3011
C=/etc/caddy/Caddyfile

major=$(node -v | sed 's/^v\([0-9]*\).*/\1/')
[ "$major" -ge 18 ] || { echo "Node $major : il faut Node 18 ou plus."; exit 1; }

# Jeton enregistré : vérifié auprès de GitHub (sans l'afficher)
T=$(sed -n 's/^GITHUB_TOKEN=//p' .env 2>/dev/null | tr -d '\r\n ')
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $T" https://api.github.com/repos/Sharkytihno/periphhub-diagnostics)
unset T
if [ "$code" != 200 ]; then
  echo "Le jeton enregistré sur le VPS est refusé par GitHub (code $code)."
  echo "Sur GitHub, copiez le bon jeton (icône « copier »), puis relancez install.sh."
  exit 1
fi
echo "Jeton GitHub valide"

if pm2 describe periphhub-relay >/dev/null 2>&1; then
  pm2 restart periphhub-relay --update-env >/dev/null
else
  if ss -ltn | grep -q ":$PORT "; then echo "Port $PORT déjà pris par autre chose : arrêt."; exit 1; fi
  pm2 start relay.mjs --name periphhub-relay >/dev/null
fi
pm2 save >/dev/null
for i in 1 2 3 4 5 6 7 8 9 10; do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null || { echo "Le relais ne répond pas :"; pm2 logs periphhub-relay --lines 20 --nostream; exit 1; }
echo "Relais lancé (pm2 : periphhub-relay, port $PORT)"


# Bloc Caddy à part (handle) : passe avant les autres « handle » du site, qui renverraient sa page 404
OLD="reverse_proxy /periphhub/* 127.0.0.1:$PORT"
MARK="# periphhub-relay"
if sudo grep -qF "$MARK" "$C"; then
  echo "Caddy déjà configuré"
else
  sudo cp "$C" "$C.bak-periphhub"
  # Ancienne version de ce script : ligne seule, retirée
  sudo grep -vF "$OLD" "$C.bak-periphhub" | sudo awk -v port="$PORT" -v mark="$MARK" '
    { print }
    !done && /^[[:space:]]*(https?:\/\/)?(www\.)?sharkywedding\.fr([ ,:]|\{)/ && /\{[[:space:]]*$/ {
      print "\thandle /periphhub/* { " mark
      print "\t\treverse_proxy 127.0.0.1:" port
      print "\t}"
      done = 1
    }
  ' | sudo tee "$C" >/dev/null
  if ! sudo grep -qF "$MARK" "$C"; then
    sudo cp "$C.bak-periphhub" "$C"
    echo "Bloc sharkywedding.fr introuvable dans $C : rien modifié."
    exit 1
  fi
  if sudo caddy validate --config "$C" --adapter caddyfile >/dev/null 2>&1; then
    sudo systemctl reload caddy
    echo "Caddy rechargé (sauvegarde : $C.bak-periphhub)"
  else
    sudo cp "$C.bak-periphhub" "$C"
    echo "Caddyfile invalide après ajout : restauré, rien n'a changé."
    exit 1
  fi
fi

for i in 1 2 3 4 5; do curl -fsS https://sharkywedding.fr/periphhub/health >/dev/null 2>&1 && break; sleep 1; done
if curl -fsS https://sharkywedding.fr/periphhub/health >/dev/null 2>&1; then
  echo "OK : https://sharkywedding.fr/periphhub/health répond"
else
  echo "Le relais tourne mais https://sharkywedding.fr/periphhub/health ne répond pas."
  echo "Structure du bloc sharkywedding.fr (jetons masqués), à envoyer à Claude :"
  sudo awk '/^[[:space:]]*(https?:\/\/)?(www\.)?sharkywedding\.fr([ ,:]|\{)/ { on = 1 } on { print } on && /^\}/ { exit }' "$C" \
    | grep -nE '\{|\}|handle|route|rewrite|try_files|redir|file_server|root|reverse_proxy|error' \
    | sed -E 's/[A-Za-z0-9_-]{16,}/***/g' | head -60
  exit 1
fi
