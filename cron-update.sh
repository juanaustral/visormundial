#!/usr/bin/env bash
# Visor — generate data.json and push to GitHub
set -e
cd /root/visor-dual
/usr/bin/node generate-data.js
git add data.json
if git diff --cached --quiet; then
  echo "[visor-cron] Sin cambios en data.json"
  exit 0
fi
git commit -m "visor-data: $(date '+%d/%m %H:%M')"
git push origin main
echo "[visor-cron] data.json actualizado y pusheado"
