# @summa/api — Rust Cloudflare Worker

Telemetry hub at [https://summa.duyet.net](https://summa.duyet.net). Written in Rust (`workers-rs`).

D1 holds **API keys and accounts only**. Usage rows go to ClickHouse and MotherDuck.

```bash
rustup target add wasm32-unknown-unknown
cargo check -p summa-api --target wasm32-unknown-unknown
# worker crate 0.8.x + worker-build 0.8.5 (pinned in wrangler.jsonc).
bun run deploy:api
```

`wrangler.jsonc` runs `worker-build --release` on deploy. Secrets via `bash scripts/sync-worker-secrets.sh` (CH through `clickhouse-homelab.duyet.net` + Access token; MotherDuck MCP).
