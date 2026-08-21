#!/usr/bin/env bash
# Copy local summa CH/MD creds + Access service token into Worker secrets.
# Does not print secret values.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API="$ROOT/apps/api"
CONFIG="${SUMMA_CONFIG:-$HOME/.config/summa/config.toml}"
CREDS="${SUMMA_CREDENTIALS:-$HOME/.config/summa/credentials.toml}"
ACCESS_FILE="${SUMMA_ACCESS_TOKEN_FILE:-/tmp/summa-access-token.json}"
CH_PUBLIC_HOST="${SUMMA_CH_PUBLIC_HOST:-clickhouse-homelab.duyet.net}"

toml_get() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  python3 - "$file" "$key" <<'PY'
from pathlib import Path
import sys
path, key = sys.argv[1], sys.argv[2]
for line in Path(path).read_text().splitlines():
    s = line.strip()
    if not s or s.startswith("#") or s.startswith("[") or "=" not in s:
        continue
    k, v = s.split("=", 1)
    if k.strip() == key:
        print(v.strip().strip('"').strip("'"), end="")
        break
PY
}

put() {
  local name="$1" value="$2"
  if [[ -z "$value" ]]; then
    echo "skip $name (empty)"
    return 0
  fi
  printf '%s' "$value" | bunx wrangler secret put "$name" >/dev/null
  echo "put $name"
}

cd "$API"
put CH_HOST "$CH_PUBLIC_HOST"
put CH_PORT "${SUMMA_CH_PORT:-443}"
put CH_PROTOCOL "${SUMMA_CH_PROTOCOL:-https}"
put CH_USER "$(toml_get "$CONFIG" user)"
put CH_DATABASE "$(toml_get "$CONFIG" database)"
put CH_PASSWORD "$(toml_get "$CREDS" clickhouse_password)"
put MOTHERDUCK_TOKEN "$(toml_get "$CREDS" motherduck_token)"
put MOTHERDUCK_DATABASE "${SUMMA_MOTHERDUCK_DATABASE:-ccusage}"

# Clerk (login for key minting). Publishable key is also a wrangler var.
MONOREPO_ENV="${SUMMA_CLERK_ENV:-$HOME/project/monorepo/.env.production.local}"
if [[ -f "$MONOREPO_ENV" ]] || [[ -n "${CLERK_SECRET_KEY:-}" ]]; then
  clerk_get() {
    if [[ -n "${CLERK_SECRET_KEY:-}" && "$1" = "CLERK_SECRET_KEY" ]]; then
      printf '%s' "$CLERK_SECRET_KEY"
    else
      grep -E "^${1}=" "$MONOREPO_ENV" 2>/dev/null | tail -n1 | cut -d= -f2-
    fi
  }
  put CLERK_SECRET_KEY "$(clerk_get CLERK_SECRET_KEY)"
  PK="$(clerk_get NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)"
  PK="${PK:-$(clerk_get VITE_CLERK_PUBLISHABLE_KEY)}"
  if [[ -n "$PK" ]]; then
    # Publishable key is a plain wrangler var (in wrangler.jsonc), not a secret.
    PK_ESCAPED="${PK//\"/\\\"}"
    python3 - "$PK_ESCAPED" <<'PY'
import re, sys
from pathlib import Path
pk = sys.argv[1]
p = Path("wrangler.jsonc")
text = p.read_text()
new = re.sub(r'("CLERK_PUBLISHABLE_KEY"\s*:\s*)"[^"]*"', rf'\1"{pk}"', text)
if new != text:
    p.write_text(new)
    print("wrangler var CLERK_PUBLISHABLE_KEY updated")
elif f'"{pk}"' in text:
    print("wrangler var CLERK_PUBLISHABLE_KEY already set")
else:
    sys.exit("CLERK_PUBLISHABLE_KEY var not found in wrangler.jsonc")
PY
  fi
else
  echo "skip CLERK_* (no $MONOREPO_ENV)"
fi

if [[ -f "$ACCESS_FILE" ]]; then
  python3 - "$ACCESS_FILE" <<'PY'
import json, sys
from pathlib import Path
p = Path(sys.argv[1])
data = json.loads(p.read_text())
Path("/tmp/summa-access-id").write_text(data.get("client_id") or "")
Path("/tmp/summa-access-secret").write_text(data.get("client_secret") or "")
PY
  put CF_ACCESS_CLIENT_ID "$(cat /tmp/summa-access-id)"
  put CF_ACCESS_CLIENT_SECRET "$(cat /tmp/summa-access-secret)"
  rm -f /tmp/summa-access-id /tmp/summa-access-secret
else
  echo "skip CF_ACCESS_* (no $ACCESS_FILE)"
fi
