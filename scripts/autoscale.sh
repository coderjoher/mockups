#!/usr/bin/env bash
# SC-4: scale capture and render workers by queue length (run from cron or a loop next to docker compose).
# Needs an admin session token in ADMIN_TOKEN and the API at API_URL.
set -euo pipefail
api="${API_URL:-http://localhost:4000}"
advice="$(curl -fsS -H "Authorization: Bearer ${ADMIN_TOKEN:?set ADMIN_TOKEN}" "$api/admin/metrics/queues")"
capture="$(echo "$advice" | python3 -c 'import json,sys; print(json.load(sys.stdin)["capture"]["desired"])')"
render="$(echo "$advice" | python3 -c 'import json,sys; print(json.load(sys.stdin)["render"]["desired"])')"
echo "scaling capture-worker=$capture render-worker=$render"
docker compose up -d --no-recreate --scale capture-worker="$capture" --scale render-worker="$render" capture-worker render-worker
