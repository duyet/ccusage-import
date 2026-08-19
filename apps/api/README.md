# summa telemetry hub (Cloudflare Worker)

Hosted hub at [https://summa.duyet.net](https://summa.duyet.net). Clients POST events with an API key. The worker stamps `account_id` + `api_key_id`, then double-writes ClickHouse and MotherDuck. [burn.duyet.net](https://burn.duyet.net) and MCP read `/v1/analytics`.

The first (owner) tenant also sees legacy rows with empty `account_id`.

## Setup

```bash
bun install
bun run --filter @summa/api migrate:remote
# or: cd apps/api && bunx wrangler d1 migrations apply summa-telemetry --remote
```

Set secrets (never commit values):

```bash
bunx wrangler secret put CH_HOST
bunx wrangler secret put CH_PORT
bunx wrangler secret put CH_USER
bunx wrangler secret put CH_PASSWORD
bunx wrangler secret put CH_DATABASE
bunx wrangler secret put CH_PROTOCOL
bunx wrangler secret put MOTHERDUCK_TOKEN
bunx wrangler secret put MOTHERDUCK_DATABASE   # ccusage
bunx wrangler secret put CLERK_SECRET_KEY
bunx wrangler secret put BOOTSTRAP_TOKEN
```

Optional: `MOTHERDUCK_SQL_URL` (default `https://api.motherduck.com/v1/query`).

Put the Clerk publishable key in `wrangler.jsonc` `vars.CLERK_PUBLISHABLE_KEY` (or `wrangler.toml` vars). Deploy:

```bash
bun run deploy:api
# or: cd apps/api && bunx wrangler deploy
```

Custom domain route is `summa.duyet.net`.

## Auth

- Ingest / analytics / status: `Authorization: Bearer summa_…` or `X-Summa-Token`. SHA-256 hex lookup in D1 `api_keys` (`revoked_at IS NULL`).
- Key admin (`POST/GET/DELETE /v1/keys`): Clerk session JWT, or bootstrap token (`BOOTSTRAP_TOKEN`, timing-safe compare).
- Keys are `summa_` + 32 bytes hex. Hash stored; plaintext returned once.

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | no | Dashboard: Clerk or bootstrap form |
| GET | `/health` | no | `{ok, service, version}` |
| GET | `/ping` | no | `SELECT 1` ClickHouse + MotherDuck |
| GET | `/status` | API key | Account id + sink ping + last ingest (isolate memory) |
| POST | `/v1/ingest` | API key | `{events: EventRow[]}` fan-out |
| GET | `/v1/analytics` | API key | Daily points (`since`, `until`, `group=source\|model`, `days`) |
| GET | `/v1/analytics/summary` | API key | Totals + `cost_per_day` + `by_source` |
| POST | `/v1/keys` | Clerk / bootstrap | `{name}` → `{id, token, prefix}` |
| GET | `/v1/keys` | Clerk / bootstrap | List (no hashes) |
| DELETE | `/v1/keys/:id` | Clerk / bootstrap | Revoke |

Ingest is **200** if at least one sink succeeded, **502** if every configured sink failed, **503** if none configured.

## CLI

```toml
# ~/.config/summa/config.toml
[telemetry]
endpoint = "https://summa.duyet.net"
```

```toml
# ~/.config/summa/credentials.toml
telemetry_token = "summa_..."
```

```bash
curl -s https://summa.duyet.net/health
curl -s https://summa.duyet.net/ping
curl -s -H "Authorization: Bearer $TOKEN" https://summa.duyet.net/status
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://summa.duyet.net/v1/analytics/summary?days=7"
curl -s -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"events":[]}' \
  https://summa.duyet.net/v1/ingest
```
