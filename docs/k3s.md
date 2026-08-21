# k3s / Hermes

The telemetry **API** is not in the cluster. It is the Cloudflare Worker at https://summa.duyet.net (`apps/api`).

On k3s you only run **import clients** that read local Hermes/agent data and POST to the hub.

## Apply

Homelab k3s (`kubectl --context homelab`) runs the import **sidecar** on `deploy/hermes-hermes-agent` in namespace `hermes-agent`.

```bash
# fill Secret (never apply empty tokens from git)
kubectl --context homelab -n hermes-agent create secret generic summa-import \
  --from-literal=SUMMA_TELEMETRY_ENDPOINT=https://summa.duyet.net \
  --from-literal=SUMMA_TELEMETRY_TOKEN=summa_… \
  --from-literal=CH_USER=duyet \
  --from-literal=CH_PASSWORD=… \
  --from-literal=CH_DATABASE=duyet_analytics \
  --from-literal=CH_HOST=clickhouse.clickhouse.svc.cluster.local \
  --from-literal=CH_PORT=8123 \
  --from-literal=DUCKDB_PATH=/tmp/summa.duckdb \
  --dry-run=client -o yaml | kubectl --context homelab apply -f -

helm --kube-context homelab upgrade hermes duyet/hermes-agent -n hermes-agent \
  --reuse-values -f deploy/k8s/hermes-values-summa.yaml
```

Sidecar loop: `summa import --days-back=7` every 6h. It writes in-cluster ClickHouse and POSTs `/v1/ingest`. The hub double-writes MotherDuck; the sidecar does not load the MotherDuck extension.

Dashboard sidebar: iframe `https://summa.duyet.net`. Do not iframe `http://127.0.0.1:8787`.

## Secret keys (`summa-import` in `hermes-agent`)

| Key | Purpose |
|-----|---------|
| `SUMMA_TELEMETRY_ENDPOINT` | `https://summa.duyet.net` |
| `SUMMA_TELEMETRY_TOKEN` | `summa_…` API key from the hub |
| `DUCKDB_PATH` | sidecar local DuckDB (`/tmp/summa.duckdb`) |
| `CH_*` | in-cluster ClickHouse (`clickhouse.clickhouse.svc`) |

Install binary via CI artifact (`summa update` / `install.sh`), never `cargo build --release` on the node.
