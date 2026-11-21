#!/usr/bin/env bash
# Re-exports the LendLoop workflows from the running n8n into n8n/workflows/
# after editing them in the UI. Credentials are referenced by id/name only;
# this script fails if anything that looks like a secret ends up in the JSON.
set -euo pipefail
cd "$(dirname "$0")"

tmp=$(docker compose exec -T n8n mktemp -d)
docker compose exec -T n8n n8n export:workflow --all --separate --pretty --output="$tmp" >/dev/null
for id in lendloopErrors01 lendloopNotify01 lendloopRemind01; do
  case $id in
    lendloopErrors01) name=00-error-handler.json ;;
    lendloopNotify01) name=01-loan-event-notification.json ;;
    lendloopRemind01) name=02-daily-overdue-reminders.json ;;
  esac
  docker compose exec -T n8n cat "$tmp/$id.json" > "workflows/$name"
done
docker compose exec -T n8n rm -rf "$tmp"

# Drop instance-specific metadata (owner project, version ids, timestamps) so the
# files are portable and diff cleanly. Workflows are imported inactive; setup.sh publishes them.
python3 - workflows/*.json <<'PY'
import json, sys
KEEP = ["id", "name", "description", "nodes", "connections", "settings", "pinData", "tags"]
for path in sys.argv[1:]:
    wf = json.load(open(path))
    clean = {k: wf[k] for k in KEEP if k in wf}
    clean["active"] = False
    with open(path, "w") as f:
        json.dump(clean, f, indent=2, ensure_ascii=False)
        f.write("\n")
PY

# Guard rails: no secrets in exported JSON.
set -a; [[ -f .env ]] && source ./.env; set +a
for value in "${N8N_WEBHOOK_SECRET:-}" "${CONVEX_HTTP_SECRET:-}" "${DISCORD_WEBHOOK_URL:-}" "${N8N_ENCRYPTION_KEY:-}"; do
  if [[ -n "$value" ]] && grep -rqF -- "$value" workflows/; then
    echo "✗ A secret from n8n/.env was found in workflows/. Aborting." >&2
    exit 1
  fi
done
if grep -rqE 'discord(app)?\.com/api/webhooks|hmacSecret|webhookUri' workflows/; then
  echo "✗ Credential material found in workflows/. Aborting." >&2
  exit 1
fi
echo "✓ Exported $(ls workflows/*.json | wc -l | tr -d ' ') workflows, no secrets found."
