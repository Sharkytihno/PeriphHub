#!/usr/bin/env bash
# Partie VPS de install.sh : démarre le relais avec pm2 et l'expose via Caddy
# (https://sharkywedding.fr/periphhub/…). Sûr à relancer : rien n'est ajouté deux fois,
# et le Caddyfile est restauré si la nouvelle version n'est pas valide.
set -euo pipefail
cd ~/periphhub-relay
PORT=3011
C=/etc/caddy/Caddyfile
LINE="reverse_proxy /periphhub/* 127.0.0.1:$PORT"

major=$(node -v | sed 's/^v\([0-9]*\).*/\1/')
[ "$major" -ge 18 ] || { echo "Node $major : il faut Node 18 ou plus."; exit 1; }

if pm2 describe periphhub-relay >/dev/null 2>&1; then
  pm2 restart periphhub-relay --update-env >/dev/null
else
  if ss -ltn | grep -q ":$PORT "; then echo "Port $PORT déjà pris par autre chose : arrêt."; exit 1; fi
  pm2 start relay.mjs --name periphhub-relay >/dev/null
fi
pm2 save >/dev/null
sleep 1
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null || { echo "Le relais ne répond pas :"; pm2 logs periphhub-relay --lines 20 --nostream; exit 1; }
echo "Relais lancé (pm2 : periphhub-relay, port $PORT)"

if sudo grep -qF "$LINE" "$C"; then
  echo "Caddy déjà configuré"
else
  sudo cp "$C" "$C.bak-periphhub"
  # Ligne ajoutée juste après l'ouverture du bloc du site sharkywedding.fr (pas les sous-domaines)
  sudo awk -v line="	$LINE" '
    { print }
    !done && /^[[:space:]]*(https?:\/\/)?(www\.)?sharkywedding\.fr([ ,:]|\{)/ && /\{[[:space:]]*$/ { print line; done = 1 }
  ' "$C.bak-periphhub" | sudo tee "$C" >/dev/null
  if ! sudo grep -qF "$LINE" "$C"; then
    sudo cp "$C.bak-periphhub" "$C"
    echo "Bloc sharkywedding.fr introuvable dans $C : rien modifié. Ajoutez à la main : $LINE"
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

sleep 1
if curl -fsS https://sharkywedding.fr/periphhub/health >/dev/null; then
  echo "OK : https://sharkywedding.fr/periphhub/health répond"
else
  echo "Le relais tourne mais https://sharkywedding.fr/periphhub/health ne répond pas encore."
  exit 1
fi
