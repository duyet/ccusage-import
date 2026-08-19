import {
  isOwnerAccount,
  listApiKeys,
  mintApiKey,
  requireApiKey,
  requireSession,
  revokeApiKey,
  sha256Hex16,
  type Env,
} from "./auth";
import { dashboardHtml } from "./dashboard";
import { analyticsWindow, loadPoints, summarizePoints } from "./analytics";
import {
  chNow,
  collectPings,
  fanoutWrite,
  ingestStatusCode,
  parseEventRow,
  pingOk,
  VERSION,
  type EventRow,
  type SinkAck,
} from "./sinks";

export type { Env };

type LastIngest = {
  at: string;
  accepted: number;
  sinks: SinkAck[];
};

let lastIngest: LastIngest | null = null;

const CORS_ALLOW_HEADERS = "Authorization, Content-Type, X-Summa-Token";
const CORS_ALLOW_METHODS = "GET, POST, DELETE, OPTIONS";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);
    const publicPath = url.pathname === "/" || url.pathname === "/health" || url.pathname === "/ping";
    if (request.method === "OPTIONS") {
      return cors(origin, publicPath, new Response(null, { status: 204 }));
    }
    try {
      const res = await route(request, env, url);
      return cors(origin, publicPath, res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return cors(origin, publicPath, json({ error: msg }, 500));
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const { pathname } = url;
  const method = request.method;

  if (method === "GET" && pathname === "/") {
    return new Response(
      dashboardHtml({
        publishableKey: env.CLERK_PUBLISHABLE_KEY?.trim() ?? "",
        version: VERSION,
      }),
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
  if (method === "GET" && pathname === "/health") {
    return json({ ok: true, service: "summa", version: VERSION });
  }
  if (method === "GET" && pathname === "/ping") {
    const samples = await collectPings(env);
    return json({ ok: pingOk(samples), samples });
  }
  if (method === "GET" && pathname === "/status") {
    return status(request, env);
  }
  if (method === "POST" && pathname === "/v1/ingest") {
    return ingest(request, env);
  }
  if (method === "GET" && pathname === "/v1/analytics") {
    return analytics(request, env, url, false);
  }
  if (method === "GET" && pathname === "/v1/analytics/summary") {
    return analytics(request, env, url, true);
  }
  if (method === "POST" && pathname === "/v1/keys") {
    return createKey(request, env);
  }
  if (method === "GET" && pathname === "/v1/keys") {
    return listKeys(request, env);
  }
  const del = /^\/v1\/keys\/([^/]+)$/.exec(pathname);
  if (method === "DELETE" && del) {
    return deleteKey(request, env, decodeURIComponent(del[1]));
  }
  return json({ error: "not found" }, 404);
}

async function status(request: Request, env: Env): Promise<Response> {
  const auth = await requireApiKey(request, env);
  if (auth instanceof Response) return auth;
  const samples = await collectPings(env);
  return json({
    ok: pingOk(samples) || (lastIngest?.sinks.some((s) => !s.error) ?? false),
    account_id: auth.account_id,
    api_key_id: auth.api_key_id,
    last_ingest_at: lastIngest?.at ?? null,
    last_accepted: lastIngest?.accepted ?? 0,
    ping: samples,
    sinks: lastIngest?.sinks ?? [],
  });
}

async function ingest(request: Request, env: Env): Promise<Response> {
  const auth = await requireApiKey(request, env);
  if (auth instanceof Response) return auth;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const rawEvents =
    body && typeof body === "object" && "events" in body && Array.isArray((body as { events: unknown }).events)
      ? (body as { events: unknown[] }).events
      : null;
  if (!rawEvents) return json({ error: "events array required" }, 400);
  const parsed: EventRow[] = [];
  for (const item of rawEvents) {
    const row = parseEventRow(item);
    if (row) parsed.push(row);
  }
  const events = await prepareEvents(parsed, auth.account_id, auth.api_key_id);
  const sinks = await fanoutWrite(env, events);
  const code = ingestStatusCode(sinks);
  lastIngest = { at: new Date().toISOString(), accepted: events.length, sinks };
  return json({ accepted: events.length, sinks }, code);
}

async function analytics(request: Request, env: Env, url: URL, summary: boolean): Promise<Response> {
  const auth = await requireApiKey(request, env);
  if (auth instanceof Response) return auth;
  const group = url.searchParams.get("group") === "model" ? "model" : "source";
  const daysRaw = url.searchParams.get("days");
  let days: number | null = null;
  if (daysRaw) {
    const n = Number(daysRaw);
    if (!Number.isFinite(n) || n < 1) return json({ error: "invalid days" }, 400);
    days = Math.trunc(n);
  }
  let window: { since: string; until: string };
  try {
    window = analyticsWindow(
      url.searchParams.get("since"),
      url.searchParams.get("until"),
      summary ? (days ?? 7) : days,
    );
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
  const includeLegacy = await isOwnerAccount(env, auth.account_id);
  try {
    const points = await loadPoints(env, auth.account_id, includeLegacy, group, window.since, window.until);
    if (summary) return json(summarizePoints(window.since, window.until, points));
    return json({
      since: window.since,
      until: window.until,
      group,
      points,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
}

async function createKey(request: Request, env: Env): Promise<Response> {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;
  let name = "default";
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && "name" in body && typeof (body as { name: unknown }).name === "string") {
      name = (body as { name: string }).name;
    }
  } catch {
    // empty body is fine
  }
  const created = await mintApiKey(env, auth.account_id, name);
  return json({ id: created.id, token: created.token, prefix: created.prefix });
}

async function listKeys(request: Request, env: Env): Promise<Response> {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;
  const keys = await listApiKeys(env, auth.account_id);
  return json({ account_id: auth.account_id, keys });
}

async function deleteKey(request: Request, env: Env, keyId: string): Promise<Response> {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;
  const ok = await revokeApiKey(env, auth.account_id, keyId);
  if (!ok) return json({ error: "not found" }, 404);
  return json({ ok: true, id: keyId, revoked: true });
}

async function prepareEvents(events: EventRow[], accountId: string, apiKeyId: string): Promise<EventRow[]> {
  const now = chNow();
  const out: EventRow[] = [];
  for (const e of events) {
    const row: EventRow = { ...e, account_id: accountId, api_key_id: apiKeyId };
    if (!row.dedup_key) {
      row.dedup_key = await sha256Hex16(
        `${row.account_id}|${row.source}|${row.machine_name}|${row.record_type}|${row.date}|${row.model_name}|${row.record_key}`,
      );
    }
    if (!row.created_at) row.created_at = now;
    if (!row.updated_at) row.updated_at = now;
    out.push(row);
  }
  return out;
}

function corsAllowOrigin(origin: string | null): string | null {
  if (!origin) return "*";
  const o = origin.trim();
  if (o === "https://burn.duyet.net" || o === "https://summa.duyet.net") return o;
  if (o === "http://localhost" || o.startsWith("http://localhost:") || o.startsWith("http://localhost/")) return o;
  if (o === "http://127.0.0.1" || o.startsWith("http://127.0.0.1:") || o.startsWith("http://127.0.0.1/")) return o;
  return null;
}

function cors(origin: string | null, publicPath: boolean, res: Response): Response {
  const allow = corsAllowOrigin(origin) ?? (publicPath ? "*" : null);
  if (!allow) return res;
  const headers = new Headers(res.headers);
  headers.set("access-control-allow-origin", allow);
  headers.set("access-control-allow-headers", CORS_ALLOW_HEADERS);
  headers.set("access-control-allow-methods", CORS_ALLOW_METHODS);
  headers.set("vary", "Origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
