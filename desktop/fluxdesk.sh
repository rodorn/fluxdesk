#!/bin/sh
# Okno panelu. Usługa startuje sama, ale gdyby stała, podnosimy ją i czekamy,
# aż odpowie, żeby okno nie otworzyło się na pustej stronie.
systemctl --user start fluxdesk 2>/dev/null
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -sf -o /dev/null http://localhost:4317/ && break
  sleep 1
done
exec ${BROWSER:-/opt/google/chrome/chrome} --app=http://localhost:4317 \
  --class=fluxdesk --user-data-dir="$HOME/.config/chrome-fluxdesk" \
  --no-first-run --no-default-browser-check
