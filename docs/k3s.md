# k3s / Hermes

The telemetry **API** is not in the cluster. It is the Cloudflare Worker at https://summa.duyet.net (`apps/api`).

On k3s you only run **import clients** that read local Hermes/agent data and POST to the hub.

## Apply

```bash
kubectl apply -f deploy/k8s/summa-sidecar.yaml
# fill Secret: SUMMA_TELEMETRY_TOKEN (and optional MotherDuck / ClickHouse)
```

Hourly CronJob: `summa import --days-back=2`.

Hermes Helm chart overlay (import sidecar, not `summa serve`):

```bash
helm upgrade hermes duyet/hermes-agent -f deploy/k8s/hermes-values-summa.yaml
```

Dashboard sidebar: iframe `https://summa.duyet.net`. Do not iframe `http://127.0.0.1:8787`.

## Secret keys

| Key | Purpose |
|-----|---------|
| `SUMMA_TELEMETRY_ENDPOINT` | `https://summa.duyet.net` |
| `SUMMA_TELEMETRY_TOKEN` | `summa_…` API key from the hub |
| `MOTHERDUCK_TOKEN` / `DUCKDB_PATH` | optional local/cloud DuckDB |
| `CH_*` | optional if this node also writes ClickHouse |

Install binary via CI artifact (`summa update` / `install.sh`), never `cargo build --release` on the node.
