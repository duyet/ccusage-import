# Telemetry API (`summa serve`)

HTTP hub for ingest, live sink ping, and analytics. Machines POST events; this process fills `dedup_key`, then writes **both** MotherDuck/DuckDB and ClickHouse. [burn.duyet.net](https://burn.duyet.net) pulls `/v1/analytics`.

Default bind: `127.0.0.1:8787`.

## Config

```toml
[telemetry]
bind = "0.0.0.0:8787"
# token is better in credentials.toml
```

```toml
# credentials.toml
telemetry_token = "…"
```

Env: `SUMMA_TELEMETRY_BIND`, `SUMMA_TELEMETRY_TOKEN`.

Auth: `Authorization: Bearer <token>` or `X-Summa-Token`. `/health` and `/ping` are public. Empty token disables auth (local only).

CORS: `https://burn.duyet.net` and `http://localhost` / `http://127.0.0.1` (any port).

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | no | Tiny HTML sidebar (iframe) |
| GET | `/health` | no | `{ok, service, version}` |
| GET | `/ping` | no | Live `SELECT 1` latency to DuckDB/MotherDuck and ClickHouse |
| GET | `/status` | yes | Last ingest, last sink acks, last ping samples |
| POST | `/v1/ingest` | yes | `{events: EventRow[]}` fan-out write |
| GET | `/v1/analytics` | yes | Daily points for burn.duyet.net |
| GET | `/v1/analytics/summary` | yes | Totals + cost-per-day + per-source |

### Ingest

Missing `dedup_key` / timestamps are filled. Writes replace **by `dedup_key` only** (a partial POST does not wipe the rest of that day). Fan-out is parallel to both sinks when configured — not first-match `[sinks].routes`.

HTTP status: **200** if at least one sink succeeded, **502** if every configured sink failed, **503** if none configured, **401** if auth failed.

### Analytics

```
GET /v1/analytics?since=2026-08-01&until=2026-08-20&group=source
GET /v1/analytics?group=model&days=30
GET /v1/analytics/summary?days=7
```

`group=source` (default) or `model`. Window is inclusive `YYYY-MM-DD`. Default last 30 days (summary default 7). Prefer DuckDB/MotherDuck; fall back to ClickHouse `FINAL`.

`cost_per_day` is total cost divided by the **calendar** window, not the count of days that have rows.

Response points: `{date, source, model_name, cost, total_tokens, entries}`.

## curl

```bash
curl -s http://127.0.0.1:8787/health
curl -s http://127.0.0.1:8787/ping
curl -s -H "Authorization: Bearer $SUMMA_TELEMETRY_TOKEN" http://127.0.0.1:8787/status
curl -s -H "Authorization: Bearer $SUMMA_TELEMETRY_TOKEN" \
  "http://127.0.0.1:8787/v1/analytics?days=7&group=source"
curl -s -H "Authorization: Bearer $SUMMA_TELEMETRY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"events":[]}' \
  http://127.0.0.1:8787/v1/ingest
```

## Run

```bash
summa serve
summa serve --bind 0.0.0.0:8787
```
