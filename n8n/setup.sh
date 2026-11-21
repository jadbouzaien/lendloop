#!/usr/bin/env bash
# Starts n8n, creates the Discord credential from n8n/.env and imports the
# LendLoop workflows. Safe to re-run (imports overwrite by id).
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "n8n/.env not found. Run: cp n8n/.env.example n8n/.env and fill it in." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source ./.env
set +a

for var in N8N_ENCRYPTION_KEY N8N_WEBHOOK_SECRET CONVEX_HTTP_SECRET; do
  val="${!var:-}"
  if [[ ${#val} -lt 32 ]]; then
    echo "$var in n8n/.env must be at least 32 characters (openssl rand -hex 32)." >&2
    exit 1
  fi
done

if [[ "${ALLOW_ANY_DISCORD_URL:-}" != "1" && ! "${DISCORD_WEBHOOK_URL:-}" =~ ^https://(discord|discordapp)\.com/api/webhooks/[0-9]+/[A-Za-z0-9_-]+$ ]]; then
  echo "DISCORD_WEBHOOK_URL in n8n/.env does not look like a Discord webhook URL." >&2
  exit 1
fi

# Waits up to ~2 minutes for n8n to answer /healthz; on failure shows the logs
# instead of looping forever (e.g. a crash loop on a bad config).
wait_for_n8n() {
  for _ in $(seq 1 60); do
    docker compose exec -T n8n wget -qO- http://localhost:5678/healthz >/dev/null 2>&1 && return 0
    sleep 2
  done
  echo "n8n did not become healthy. Last logs:" >&2
  docker compose logs --tail 30 n8n >&2
  exit 1
}

echo "→ Starting n8n…"
docker compose up -d n8n
wait_for_n8n

echo "→ Importing credentials (encrypted at rest by n8n)…"
# Built in memory and piped via stdin: secrets never touch the repo or the
# container environment. Workflows reference these credentials by id only.
json_escape() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"; }
cat <<JSON |
[
  {"id":"lendloopDiscord1","name":"LendLoop Discord webhook","type":"discordWebhookApi",
   "data":{"webhookUri":$(json_escape "$DISCORD_WEBHOOK_URL")}},
  {"id":"lendloopHmacIn01","name":"LendLoop HMAC – Convex → n8n","type":"crypto",
   "data":{"hmacSecret":$(json_escape "$N8N_WEBHOOK_SECRET")}},
  {"id":"lendloopHmacOut1","name":"LendLoop HMAC – n8n → Convex","type":"crypto",
   "data":{"hmacSecret":$(json_escape "$CONVEX_HTTP_SECRET")}}
]
JSON
  docker compose exec -T n8n sh -c '
    umask 077
    f=$(mktemp)
    cat > "$f"
    n8n import:credentials --input="$f"; rc=$?
    rm -f "$f"
    exit $rc'

echo "→ Importing workflows…"
docker compose exec -T n8n n8n import:workflow --separate --input=/workflows

echo "→ Activating workflows…"
for id in lendloopErrors01 lendloopNotify01 lendloopRemind01; do
  docker compose exec -T n8n n8n publish:workflow --id="$id" >/dev/null 2>&1 ||
    docker compose exec -T n8n n8n update:workflow --id="$id" --active=true >/dev/null 2>&1 ||
    echo "  ! Could not activate $id from the CLI; toggle it on in the editor."
done
docker compose restart n8n >/dev/null
wait_for_n8n

# /healthz answers before webhooks are registered: wait until an unsigned
# request is rejected with 401 (registered) rather than 404 (not yet).
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' \
    http://localhost:5678/webhook/lendloop-loan-events || true)
  [[ "$code" == "401" ]] && break
  sleep 2
done
[[ "$code" == "401" ]] || echo "  ! Webhook not registered yet (HTTP $code). Check the workflow is published in the editor."

cat <<MSG

✓ n8n is running at http://localhost:5678 (create the owner account on first visit).

Next, point Convex at the webhook:
  npx convex env set N8N_WEBHOOK_URL   <public-url>/webhook/lendloop-loan-events
  npx convex env set N8N_WEBHOOK_SECRET <same value as n8n/.env>
  npx convex env set CONVEX_HTTP_SECRET <same value as n8n/.env>

For a cloud Convex deployment, get a public URL with:
  docker compose --profile tunnel up -d && docker compose logs tunnel | grep trycloudflare
MSG
