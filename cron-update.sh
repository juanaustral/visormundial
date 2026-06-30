#!/usr/bin/env bash
# Visor — generate data.json and push to GitHub
# Runs every 30 min OR on-demand from cron scheduler
set -e
cd /root/visor-dual

# Fetch latest from repo first (in case score was manually entered elsewhere)
git pull origin main --ff-only 2>/dev/null || true

# Generate fresh data
/usr/bin/node generate-data.js

# Check if anything meaningful changed (data.json updated !== data.json content)
git add data.json
if ! git diff --cached --quiet; then
  git commit -m "visor-data: $(date '+%d/%m %H:%M')"
  git push origin main
  echo "[visor-cron] data.json actualizado y pusheado"
else
  # Even if data.json didn't change, check if index.html did
  git add -A
  if ! git diff --cached --quiet; then
    git commit -m "visor-update: $(date '+%d/%m %H:%M')"
    git push origin main
    echo "[visor-cron] cambios menores pusheados"
  else
    echo "[visor-cron] Sin cambios"
  fi
fi
