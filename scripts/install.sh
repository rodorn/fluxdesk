#!/usr/bin/env bash
# Instalacja Fluxdesk na czystej maszynie. Panel zakłada trzy rzeczy:
# działający Claude Code, Node 20 lub nowszy oraz systemd użytkownika.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-4317}"

echo "Fluxdesk, instalacja w $DIR"

command -v node >/dev/null || { echo "Brak Node.js"; exit 1; }
command -v claude >/dev/null || echo "Uwaga: nie znaleziono 'claude' w PATH"

echo "1/4 zależności"
npm install --silent

echo "2/4 moduł pty"
npm rebuild node-pty --silent 2>/dev/null || (cd node_modules/node-pty && npx node-gyp rebuild >/dev/null)

echo "3/4 budowanie"
npm run build >/dev/null

echo "4/4 usługa systemd"
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/fluxdesk.service" <<UNIT
[Unit]
Description=Fluxdesk, pulpit sterowania sesjami Claude Code
After=network.target

[Service]
Type=simple
WorkingDirectory=$DIR
ExecStart=$(command -v npm) start
Restart=on-failure
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin
UNIT

systemctl --user daemon-reload
systemctl --user enable --now fluxdesk.service

ln -sf "$DIR/bin/fluxdesk.mjs" "$HOME/.local/bin/fluxdesk" 2>/dev/null || true

echo
echo "Gotowe. Panel: http://localhost:$PORT"
echo "Klient terminalowy: fluxdesk"
echo "Sterowanie usługą: systemctl --user status fluxdesk"
