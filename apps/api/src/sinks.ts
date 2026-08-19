import type { Env } from "./auth";

export const VERSION = "0.1.0";

export type EventRow = {
  date: string;
  record_type: string;
  record_key: string;
  source: string;
  machine_name: string;
  account_id: string;
  api_key_id: string;
  model_name: string;
  session_id: string;
  project_path: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  cost: number;
  dedup_key: string;
  import_id: string;
  block_id: string;
  start_time: string | null;
  end_time: string | null;
  actual_end_time: string | null;
  is_active: number;
  is_gap: number;
  entries: number;
  burn_rate: number;
  projection: number;
  usage_limit_reset_time: string | null;
  created_at: string;
  updated_at: string;
};

export type SinkAck = {
  name: string;
  rows: number;
  duration_ms: number;
  error?: string;
};

export type PingSample = {
  name: string;
  ok: boolean;
  latency_ms: number;
  error?: string;
};

const INSERT_COLUMNS = [
  "date",
  "record_type",
  "record_key",
  "source",
  "machine_name",
  "account_id",
  "api_key_id",
  "model_name",
  "session_id",
  "project_path",
  "input_tokens",
  "output_tokens",
  "cache_creation_tokens",
  "cache_read_tokens",
  "reasoning_tokens",
  "total_tokens",
  "cost",
  "dedup_key",
  "import_id",
  "block_id",
  "start_time",
  "end_time",
  "actual_end_time",
  "is_active",
  "is_gap",
  "entries",
  "burn_rate",
  "projection",
  "usage_limit_reset_time",
  "created_at",
  "updated_at",
] as const;

let chColumnsReady = false;
let mdColumnsReady = false;
let mdBodyShape: "sql" | "query" | "sql_query" | "raw" | null = null;

export function clickhouseConfigured(env: Env): boolean {
  return Boolean(env.CH_HOST?.trim());
}

export function motherduckConfigured(env: Env): boolean {
  return Boolean(env.MOTHERDUCK_TOKEN?.trim());
}

export function chNow(): string {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export function parseEventRow(value: unknown): EventRow | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  return {
    date: asString(o.date),
    record_type: asString(o.record_type),
    record_key: asString(o.record_key),
    source: asString(o.source),
    machine_name: asString(o.machine_name),
    account_id: asString(o.account_id),
    api_key_id: asString(o.api_key_id),
    model_name: asString(o.model_name),
    session_id: asString(o.session_id),
    project_path: asString(o.project_path),
    input_tokens: asUInt(o.input_tokens),
    output_tokens: asUInt(o.output_tokens),
    cache_creation_tokens: asUInt(o.cache_creation_tokens),
    cache_read_tokens: asUInt(o.cache_read_tokens),
    reasoning_tokens: asUInt(o.reasoning_tokens),
    total_tokens: asUInt(o.total_tokens),
    cost: asFloat(o.cost),
    dedup_key: asString(o.dedup_key),
    import_id: asString(o.import_id),
    block_id: asString(o.block_id),
    start_time: asOptString(o.start_time),
    end_time: asOptString(o.end_time),
    actual_end_time: asOptString(o.actual_end_time),
    is_active: asUInt(o.is_active) ? 1 : 0,
    is_gap: asUInt(o.is_gap) ? 1 : 0,
    entries: asUInt(o.entries),
    burn_rate: asFloat(o.burn_rate),
    projection: asFloat(o.projection),
    usage_limit_reset_time: asOptString(o.usage_limit_reset_time),
    created_at: asString(o.created_at),
    updated_at: asString(o.updated_at),
  };
}

export function ingestStatusCode(sinks: SinkAck[]): number {
  if (sinks.length === 0) return 503;
  return sinks.some((s) => !s.error) ? 200 : 502;
}

export async function fanoutWrite(env: Env, rows: EventRow[]): Promise<SinkAck[]> {
  const jobs: Promise<SinkAck>[] = [];
  if (clickhouseConfigured(env)) jobs.push(writeClickHouse(env, rows));
  if (motherduckConfigured(env)) jobs.push(writeMotherDuck(env, rows));
  return Promise.all(jobs);
}

export async function collectPings(env: Env): Promise<PingSample[]> {
  const jobs: Promise<PingSample>[] = [];
  if (clickhouseConfigured(env)) jobs.push(timedPing("clickhouse", () => pingClickHouse(env)));
  if (motherduckConfigured(env)) jobs.push(timedPing("motherduck", () => pingMotherDuck(env)));
  return Promise.all(jobs);
}

export function pingOk(samples: PingSample[]): boolean {
  return samples.length > 0 && samples.every((s) => s.ok);
}

export async function clickhouseQuery(env: Env, sql: string): Promise<string> {
  const res = await clickhouseFetch(env, sql);
  const text = await res.text();
  if (!res.ok) throw new Error(`clickhouse ${res.status}: ${text.slice(0, 400)}`);
  return text;
}

export async function motherduckQuery(env: Env, sql: string): Promise<string> {
  const res = await motherduckFetch(env, sql);
  const text = await res.text();
  if (!res.ok) throw new Error(`motherduck ${res.status}: ${text.slice(0, 400)}`);
  return text;
}

export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function writeClickHouse(env: Env, rows: EventRow[]): Promise<SinkAck> {
  const start = Date.now();
  try {
    await ensureClickHouseColumns(env);
    if (rows.length === 0) {
      return { name: "clickhouse", rows: 0, duration_ms: Date.now() - start };
    }
    const keys = [...new Set(rows.map((r) => r.dedup_key).filter(Boolean))];
    const KEY_BATCH = 200;
    for (let i = 0; i < keys.length; i += KEY_BATCH) {
      const list = keys.slice(i, i + KEY_BATCH).map(sqlLiteral).join(",");
      await clickhouseCommand(
        env,
        `ALTER TABLE ccusage_events DELETE WHERE dedup_key IN (${list})`,
        true,
      );
    }
    const INSERT_CHUNK = 500;
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await clickhouseInsert(env, rows.slice(i, i + INSERT_CHUNK));
    }
    return { name: "clickhouse", rows: rows.length, duration_ms: Date.now() - start };
  } catch (e) {
    return {
      name: "clickhouse",
      rows: 0,
      duration_ms: Date.now() - start,
      error: errMessage(e),
    };
  }
}

async function writeMotherDuck(env: Env, rows: EventRow[]): Promise<SinkAck> {
  const start = Date.now();
  try {
    await ensureMotherDuckColumns(env);
    if (rows.length === 0) {
      return { name: "motherduck", rows: 0, duration_ms: Date.now() - start };
    }
    const keys = [...new Set(rows.map((r) => r.dedup_key).filter(Boolean))];
    const KEY_BATCH = 200;
    for (let i = 0; i < keys.length; i += KEY_BATCH) {
      const list = keys.slice(i, i + KEY_BATCH).map(sqlLiteral).join(",");
      await motherduckQuery(env, `DELETE FROM ccusage_events WHERE dedup_key IN (${list})`);
    }
    const INSERT_CHUNK = 100;
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK);
      const values = chunk.map(rowToSqlValues).join(",\n");
      await motherduckQuery(
        env,
        `INSERT INTO ccusage_events (${INSERT_COLUMNS.join(", ")}) VALUES ${values}`,
      );
    }
    return { name: "motherduck", rows: rows.length, duration_ms: Date.now() - start };
  } catch (e) {
    return {
      name: "motherduck",
      rows: 0,
      duration_ms: Date.now() - start,
      error: errMessage(e),
    };
  }
}

async function ensureClickHouseColumns(env: Env): Promise<void> {
  if (chColumnsReady) return;
  await clickhouseCommand(
    env,
    "ALTER TABLE ccusage_events ADD COLUMN IF NOT EXISTS account_id String DEFAULT ''",
    false,
  );
  await clickhouseCommand(
    env,
    "ALTER TABLE ccusage_events ADD COLUMN IF NOT EXISTS api_key_id String DEFAULT ''",
    false,
  );
  chColumnsReady = true;
}

async function ensureMotherDuckColumns(env: Env): Promise<void> {
  if (mdColumnsReady) return;
  try {
    await motherduckQuery(
      env,
      "ALTER TABLE ccusage_events ADD COLUMN IF NOT EXISTS account_id VARCHAR DEFAULT ''",
    );
    await motherduckQuery(
      env,
      "ALTER TABLE ccusage_events ADD COLUMN IF NOT EXISTS api_key_id VARCHAR DEFAULT ''",
    );
  } catch {
    // Table may already have the columns; still try writes.
  }
  mdColumnsReady = true;
}

async function pingClickHouse(env: Env): Promise<void> {
  const text = await clickhouseQuery(env, "SELECT 1");
  if (!text.trim().startsWith("1")) throw new Error(`clickhouse ping: ${text.trim().slice(0, 120)}`);
}

async function pingMotherDuck(env: Env): Promise<void> {
  const text = await motherduckQuery(env, "SELECT 1");
  if (!text.includes("1")) throw new Error(`motherduck ping: ${text.trim().slice(0, 120)}`);
}

async function timedPing(name: string, fn: () => Promise<void>): Promise<PingSample> {
  const start = Date.now();
  try {
    await fn();
    return { name, ok: true, latency_ms: Date.now() - start };
  } catch (e) {
    return { name, ok: false, latency_ms: Date.now() - start, error: errMessage(e) };
  }
}

function clickhouseUrl(env: Env, extra: Record<string, string> = {}): string {
  const protocol = (env.CH_PROTOCOL?.trim() || "https").replace(/:$/, "");
  const host = env.CH_HOST?.trim() ?? "";
  const port = env.CH_PORT?.trim() || (protocol === "https" ? "8443" : "8123");
  const params = new URLSearchParams(extra);
  const database = env.CH_DATABASE?.trim() ?? "";
  if (database) params.set("database", database);
  const qs = params.toString();
  return `${protocol}://${host}:${port}/${qs ? `?${qs}` : ""}`;
}

function clickhouseAuth(env: Env): string {
  const user = env.CH_USER?.trim() || "default";
  const password = env.CH_PASSWORD ?? "";
  return `Basic ${btoa(`${user}:${password}`)}`;
}

async function clickhouseFetch(env: Env, sql: string, waitMutation = false): Promise<Response> {
  const extra: Record<string, string> = {};
  // ALTER DELETE is a mutation; wait so the following INSERT is not eaten.
  if (waitMutation) {
    extra.wait_end_of_query = "1";
    extra.mutations_sync = "1";
  }
  return fetch(clickhouseUrl(env, extra), {
    method: "POST",
    headers: {
      Authorization: clickhouseAuth(env),
      "Content-Type": "text/plain; charset=UTF-8",
    },
    body: sql,
  });
}

async function clickhouseCommand(env: Env, sql: string, waitMutation: boolean): Promise<void> {
  const res = await clickhouseFetch(env, sql, waitMutation);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`clickhouse ${res.status}: ${text.slice(0, 400)}`);
  }
}

async function clickhouseInsert(env: Env, rows: EventRow[]): Promise<void> {
  const extra: Record<string, string> = {
    query: "INSERT INTO ccusage_events FORMAT JSONEachRow",
  };
  const body = rows.map(rowToJsonEachRow).join("\n") + "\n";
  const res = await fetch(clickhouseUrl(env, extra), {
    method: "POST",
    headers: {
      Authorization: clickhouseAuth(env),
      "Content-Type": "application/x-ndjson",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`clickhouse insert ${res.status}: ${text.slice(0, 400)}`);
  }
}

function motherduckUrl(env: Env): string {
  return env.MOTHERDUCK_SQL_URL?.trim() || "https://api.motherduck.com/v1/query";
}

function motherduckDatabase(env: Env): string {
  return env.MOTHERDUCK_DATABASE?.trim() || "ccusage";
}

async function motherduckFetch(env: Env, sql: string): Promise<Response> {
  const token = env.MOTHERDUCK_TOKEN?.trim() ?? "";
  const database = motherduckDatabase(env);
  const url = motherduckUrl(env);
  const auth = { Authorization: `Bearer ${token}` };
  const qualified = safeIdent(database) ? `USE ${database};\n${sql}` : sql;

  const tryJson = async (body: unknown): Promise<Response> =>
    fetch(url, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const order: Array<"sql" | "query" | "sql_query" | "raw"> = mdBodyShape
    ? [mdBodyShape, "sql", "query", "sql_query", "raw"]
    : ["sql", "query", "sql_query", "raw"];
  const seen = new Set<string>();
  let last: Response | null = null;
  for (const shape of order) {
    if (seen.has(shape)) continue;
    seen.add(shape);
    const res =
      shape === "sql"
        ? await tryJson({ sql: qualified, database })
        : shape === "query"
          ? await tryJson({ query: qualified, database })
          : shape === "sql_query"
            ? await tryJson({ sql_query: qualified, database })
            : await fetch(url, {
                method: "POST",
                headers: {
                  ...auth,
                  "Content-Type": "text/plain; charset=UTF-8",
                  "X-MotherDuck-Database": database,
                },
                body: qualified,
              });
    if (res.ok) {
      mdBodyShape = shape;
      return res;
    }
    last = res;
    if (res.status === 401 || res.status === 403) return res;
  }
  return last ?? new Response("motherduck unreachable", { status: 502 });
}

function rowToJsonEachRow(row: EventRow): string {
  const obj: Record<string, string | number | null> = {
    date: row.date,
    record_type: row.record_type,
    record_key: row.record_key,
    source: row.source,
    machine_name: row.machine_name,
    account_id: row.account_id,
    api_key_id: row.api_key_id,
    model_name: row.model_name,
    session_id: row.session_id,
    project_path: row.project_path,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    cache_creation_tokens: row.cache_creation_tokens,
    cache_read_tokens: row.cache_read_tokens,
    reasoning_tokens: row.reasoning_tokens,
    total_tokens: row.total_tokens,
    cost: finite(row.cost),
    dedup_key: row.dedup_key,
    import_id: row.import_id,
    block_id: row.block_id,
    start_time: row.start_time,
    end_time: row.end_time,
    actual_end_time: row.actual_end_time,
    is_active: row.is_active,
    is_gap: row.is_gap,
    entries: row.entries,
    burn_rate: finite(row.burn_rate),
    projection: finite(row.projection),
    usage_limit_reset_time: row.usage_limit_reset_time,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  return JSON.stringify(obj);
}

function rowToSqlValues(row: EventRow): string {
  const vals = [
    sqlLiteral(row.date),
    sqlLiteral(row.record_type),
    sqlLiteral(row.record_key),
    sqlLiteral(row.source),
    sqlLiteral(row.machine_name),
    sqlLiteral(row.account_id),
    sqlLiteral(row.api_key_id),
    sqlLiteral(row.model_name),
    sqlLiteral(row.session_id),
    sqlLiteral(row.project_path),
    String(row.input_tokens),
    String(row.output_tokens),
    String(row.cache_creation_tokens),
    String(row.cache_read_tokens),
    String(row.reasoning_tokens),
    String(row.total_tokens),
    String(finite(row.cost)),
    sqlLiteral(row.dedup_key),
    sqlLiteral(row.import_id),
    sqlLiteral(row.block_id),
    sqlTs(row.start_time),
    sqlTs(row.end_time),
    sqlTs(row.actual_end_time),
    String(row.is_active),
    String(row.is_gap),
    String(row.entries),
    String(finite(row.burn_rate)),
    String(finite(row.projection)),
    sqlTs(row.usage_limit_reset_time),
    sqlLiteral(row.created_at),
    sqlLiteral(row.updated_at),
  ];
  return `(${vals.join(", ")})`;
}

function sqlTs(value: string | null): string {
  if (!value) return "NULL";
  return sqlLiteral(value);
}

function safeIdent(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function asOptString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v;
  return String(v);
}

function asUInt(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.trunc(v);
  if (typeof v === "string" && v !== "") {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return Math.trunc(n);
  }
  if (typeof v === "boolean") return v ? 1 : 0;
  return 0;
}

function asFloat(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
