import type { Env } from "./auth";
import { clickhouseConfigured, clickhouseQuery, motherduckConfigured, motherduckQuery, sqlLiteral } from "./sinks";

export type AnalyticsPoint = {
  date: string;
  source: string;
  model_name: string;
  cost: number;
  total_tokens: number;
  entries: number;
};

export type AnalyticsBody = {
  since: string;
  until: string;
  group: string;
  points: AnalyticsPoint[];
};

export type SourceTotal = {
  source: string;
  cost: number;
  total_tokens: number;
  entries: number;
};

export type AnalyticsSummary = {
  since: string;
  until: string;
  days: number;
  cost: number;
  total_tokens: number;
  entries: number;
  cost_per_day: number;
  by_source: SourceTotal[];
};

const DEFAULT_DAYS = 30;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function analyticsWindow(
  since: string | null,
  until: string | null,
  days: number | null,
): { since: string; until: string } {
  const today = utcYmd(new Date());
  const untilD = until && until.trim() ? until.trim() : today;
  if (!validIsoDate(untilD)) throw new Error(`invalid date \`${untilD}\` (want YYYY-MM-DD)`);
  let sinceD: string;
  if (since && since.trim()) {
    sinceD = since.trim();
    if (!validIsoDate(sinceD)) throw new Error(`invalid date \`${sinceD}\` (want YYYY-MM-DD)`);
  } else {
    const n = Math.max(days ?? DEFAULT_DAYS, 1);
    sinceD = addDays(untilD, -(n - 1));
  }
  if (sinceD > untilD) throw new Error(`since (${sinceD}) is after until (${untilD})`);
  return { since: sinceD, until: untilD };
}

export function inclusiveDays(since: string, until: string): number {
  const a = Date.parse(`${since}T00:00:00Z`);
  const b = Date.parse(`${until}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 1;
  return Math.floor((b - a) / 86400000) + 1;
}

export function summarizePoints(since: string, until: string, points: AnalyticsPoint[]): AnalyticsSummary {
  const days = inclusiveDays(since, until);
  let cost = 0;
  let totalTokens = 0;
  let entries = 0;
  const by: SourceTotal[] = [];
  for (const p of points) {
    cost += p.cost;
    totalTokens += p.total_tokens;
    entries += p.entries;
    const row = by.find((s) => s.source === p.source);
    if (row) {
      row.cost += p.cost;
      row.total_tokens += p.total_tokens;
      row.entries += p.entries;
    } else {
      by.push({
        source: p.source,
        cost: p.cost,
        total_tokens: p.total_tokens,
        entries: p.entries,
      });
    }
  }
  by.sort((a, b) => b.cost - a.cost);
  return {
    since,
    until,
    days,
    cost,
    total_tokens: totalTokens,
    entries,
    cost_per_day: days > 0 ? cost / days : 0,
    by_source: by,
  };
}

export async function loadPoints(
  env: Env,
  accountId: string,
  includeLegacyEmpty: boolean,
  group: string,
  since: string,
  until: string,
): Promise<AnalyticsPoint[]> {
  if (!validIsoDate(since) || !validIsoDate(until)) {
    throw new Error("analytics dates must be YYYY-MM-DD");
  }
  const g = group === "model" ? "model" : "source";
  const errors: string[] = [];
  if (clickhouseConfigured(env)) {
    try {
      return await pointsFromClickHouse(env, accountId, includeLegacyEmpty, g, since, until);
    } catch (e) {
      errors.push(`clickhouse: ${errMessage(e)}`);
    }
  }
  if (motherduckConfigured(env)) {
    try {
      return await pointsFromMotherDuck(env, accountId, includeLegacyEmpty, g, since, until);
    } catch (e) {
      errors.push(`motherduck: ${errMessage(e)}`);
    }
  }
  if (errors.length > 0) throw new Error(errors.join("; "));
  throw new Error("no analytics sink configured");
}

function tenantClause(accountId: string, includeLegacyEmpty: boolean): string {
  if (includeLegacyEmpty) {
    return `(account_id = ${sqlLiteral(accountId)} OR account_id = '')`;
  }
  return `account_id = ${sqlLiteral(accountId)}`;
}

async function pointsFromClickHouse(
  env: Env,
  accountId: string,
  includeLegacyEmpty: boolean,
  group: string,
  since: string,
  until: string,
): Promise<AnalyticsPoint[]> {
  const extra = group === "model" ? "source, model_name" : "source, '' AS model_name";
  const groupBy = group === "model" ? "date, source, model_name" : "date, source";
  const sql = `SELECT date, ${extra}, sum(cost) AS cost, sum(total_tokens) AS total_tokens, sum(entries) AS entries \
FROM ccusage_events FINAL \
WHERE record_type = 'daily' AND date >= '${since}' AND date <= '${until}' \
AND ${tenantClause(accountId, includeLegacyEmpty)} \
GROUP BY ${groupBy} \
ORDER BY date, source${group === "model" ? ", model_name" : ""} \
FORMAT JSONEachRow`;
  const text = await clickhouseQuery(env, sql);
  return parsePoints(text);
}

async function pointsFromMotherDuck(
  env: Env,
  accountId: string,
  includeLegacyEmpty: boolean,
  group: string,
  since: string,
  until: string,
): Promise<AnalyticsPoint[]> {
  const extra = group === "model" ? "source, model_name" : "source, '' AS model_name";
  const groupBy = group === "model" ? "1, 2, 3" : "1, 2";
  const sql = `SELECT CAST(date AS VARCHAR) AS date, ${extra}, \
COALESCE(sum(cost), 0) AS cost, COALESCE(sum(total_tokens), 0) AS total_tokens, COALESCE(sum(entries), 0) AS entries \
FROM ccusage_events \
WHERE record_type = 'daily' AND date >= '${since}' AND date <= '${until}' \
AND ${tenantClause(accountId, includeLegacyEmpty)} \
GROUP BY ${groupBy} \
ORDER BY 1, 2`;
  const text = await motherduckQuery(env, sql);
  return parsePoints(text);
}

function parsePoints(text: string): AnalyticsPoint[] {
  const rows = parseQueryRows(text);
  const out: AnalyticsPoint[] = [];
  for (const row of rows) {
    const p = pointFromRow(row);
    if (p) out.push(p);
  }
  return out;
}

function parseQueryRows(text: string): Record<string, unknown>[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const fromJson = rowsFromJson(parsed);
    if (fromJson) return fromJson;
  } catch {
    // JSONEachRow: one object per line
  }
  const out: Record<string, unknown>[] = [];
  for (const line of trimmed.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const v: unknown = JSON.parse(t);
      if (v && typeof v === "object" && !Array.isArray(v)) out.push(v as Record<string, unknown>);
    } catch {
      continue;
    }
  }
  return out;
}

function rowsFromJson(parsed: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(parsed)) {
    return parsed.filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r));
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  for (const key of ["data", "rows", "result", "results"]) {
    const v = o[key];
    if (Array.isArray(v)) {
      if (v.length === 0) return [];
      if (v[0] && typeof v[0] === "object" && !Array.isArray(v[0])) {
        return v.filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r));
      }
      if (Array.isArray(v[0]) && Array.isArray(o.columns)) {
        const cols = o.columns.map((c) => {
          if (typeof c === "string") return c;
          if (c && typeof c === "object" && "name" in c && typeof (c as { name: unknown }).name === "string") {
            return (c as { name: string }).name;
          }
          return "";
        });
        return (v as unknown[][]).map((tuple) => {
          const row: Record<string, unknown> = {};
          for (let i = 0; i < cols.length; i++) row[cols[i] ?? `c${i}`] = tuple[i];
          return row;
        });
      }
    }
  }
  if ("date" in o || "cost" in o) return [o];
  return null;
}

function pointFromRow(row: Record<string, unknown>): AnalyticsPoint | null {
  const date = asDate(row.date ?? row.DATE);
  if (!date) return null;
  return {
    date,
    source: asString(row.source ?? row.SOURCE),
    model_name: asString(row.model_name ?? row.MODEL_NAME),
    cost: asFloat(row.cost ?? row.COST),
    total_tokens: asUInt(row.total_tokens ?? row.TOTAL_TOKENS),
    entries: asUInt(row.entries ?? row.ENTRIES),
  };
}

function utcYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(ymd: string, delta: number): string {
  const dt = new Date(`${ymd}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + delta);
  return utcYmd(dt);
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function asDate(v: unknown): string {
  if (typeof v === "string") {
    const s = v.trim().slice(0, 10);
    return validIsoDate(s) ? s : "";
  }
  return "";
}

function asUInt(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.trunc(v);
  if (typeof v === "string" && v !== "") {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return Math.trunc(n);
  }
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

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
