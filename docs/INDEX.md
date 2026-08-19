# Docs Index

- `docs/install.md` — machine install, config, auto cron, telemetry hub.
- `docs/telemetry.md` — hosted hub at summa.duyet.net (ingest / ping / analytics for burn.duyet.net). Worker: `apps/api/README.md`.
- `.env.example` — CLI + API Worker credentials (copy to `.env`).
- `deploy/k8s/summa-sidecar.yaml` — Hermes sidecar + sidebar + hourly import CronJob.
- `deploy/k8s/hermes-values-summa.yaml` — `extraContainers` overlay for the duyet/hermes-agent Helm chart.
- `docs/knowledge/core-memory.md` — durable maintenance notes for automation runs.
- `docs/knowledge/antigravity.md` — integration details, architecture, and running guide for Antigravity source.
- `docs/knowledge/cursor.md` — Cursor account-wide usage source (dashboard/Admin APIs, surface labels).
- `docs/schema.sql` — single-table ClickHouse schema.
- `docs/migrate_add_source.sql` — migration adding `source`.
- `docs/queries.sql` — common query snippets.
