/**
 * Single source of truth for the ccusage_events table schema.
 *
 * Both sinks (ClickHouse, DuckDB) derive their DDL from EVENTS_COLUMNS so the
 * column set, order, types, and defaults can never drift apart.
 *
 * ClickHouse quirk (preserved): CH v26's CREATE TABLE parser rejects two
 * consecutive Nullable(Float64) columns, so `projection` and
 * `usage_limit_reset_time` are deferred out of the base CREATE and added via
 * ALTER. `reasoning_tokens` is in the base CREATE but also carries a defensive
 * idempotent ALTER (historic tables predate that column).
 */

export interface ColumnSpec {
  name: string;
  /** ClickHouse type + default, e.g. "UInt64 DEFAULT 0". */
  ch: string;
  /** DuckDB type + default, e.g. "BIGINT DEFAULT 0". */
  duck: string;
  /** Omit from the ClickHouse base CREATE (added via ALTER instead). */
  chDeferred?: boolean;
  /** Emit `ALTER ... ADD COLUMN ... AFTER <chAlterAfter>` for ClickHouse. */
  chAlterAfter?: string;
}

export const EVENTS_COLUMNS: ColumnSpec[] = [
  { name: 'date', ch: 'Date', duck: 'DATE NOT NULL' },
  { name: 'record_type', ch: 'String', duck: 'VARCHAR NOT NULL' },
  { name: 'record_key', ch: 'String', duck: 'VARCHAR NOT NULL' },
  { name: 'source', ch: "String DEFAULT 'ccusage'", duck: "VARCHAR NOT NULL DEFAULT 'ccusage'" },
  { name: 'machine_name', ch: 'String', duck: 'VARCHAR NOT NULL' },
  { name: 'model_name', ch: "String DEFAULT ''", duck: "VARCHAR DEFAULT ''" },
  { name: 'session_id', ch: "String DEFAULT ''", duck: "VARCHAR DEFAULT ''" },
  { name: 'project_path', ch: "String DEFAULT ''", duck: "VARCHAR DEFAULT ''" },
  { name: 'input_tokens', ch: 'UInt64 DEFAULT 0', duck: 'BIGINT DEFAULT 0' },
  { name: 'output_tokens', ch: 'UInt64 DEFAULT 0', duck: 'BIGINT DEFAULT 0' },
  { name: 'cache_creation_tokens', ch: 'UInt64 DEFAULT 0', duck: 'BIGINT DEFAULT 0' },
  { name: 'cache_read_tokens', ch: 'UInt64 DEFAULT 0', duck: 'BIGINT DEFAULT 0' },
  { name: 'reasoning_tokens', ch: 'UInt64 DEFAULT 0', duck: 'BIGINT DEFAULT 0', chAlterAfter: 'cache_read_tokens' },
  { name: 'total_tokens', ch: 'UInt64 DEFAULT 0', duck: 'BIGINT DEFAULT 0' },
  { name: 'cost', ch: 'Float64 DEFAULT 0', duck: 'DOUBLE DEFAULT 0' },
  { name: 'dedup_key', ch: "String DEFAULT ''", duck: "VARCHAR DEFAULT ''" },
  { name: 'import_id', ch: "String DEFAULT ''", duck: "VARCHAR DEFAULT ''" },
  { name: 'block_id', ch: "String DEFAULT ''", duck: "VARCHAR DEFAULT ''" },
  { name: 'start_time', ch: 'Nullable(DateTime)', duck: 'TIMESTAMP' },
  { name: 'end_time', ch: 'Nullable(DateTime)', duck: 'TIMESTAMP' },
  { name: 'actual_end_time', ch: 'Nullable(DateTime)', duck: 'TIMESTAMP' },
  { name: 'is_active', ch: 'UInt8 DEFAULT 0', duck: 'SMALLINT DEFAULT 0' },
  { name: 'is_gap', ch: 'UInt8 DEFAULT 0', duck: 'SMALLINT DEFAULT 0' },
  { name: 'entries', ch: 'UInt32 DEFAULT 0', duck: 'INTEGER DEFAULT 0' },
  { name: 'burn_rate', ch: 'Nullable(Float64)', duck: 'DOUBLE DEFAULT 0' },
  { name: 'projection', ch: 'Nullable(Float64)', duck: 'DOUBLE DEFAULT 0', chDeferred: true, chAlterAfter: 'burn_rate' },
  { name: 'usage_limit_reset_time', ch: 'Nullable(DateTime)', duck: 'TIMESTAMP', chDeferred: true, chAlterAfter: 'projection' },
  { name: 'created_at', ch: 'DateTime DEFAULT now()', duck: 'TIMESTAMP DEFAULT current_timestamp' },
  { name: 'updated_at', ch: 'DateTime DEFAULT now()', duck: 'TIMESTAMP DEFAULT current_timestamp' },
];

const CH_ENGINE_SUFFIX =
  'ENGINE = ReplacingMergeTree(updated_at) PARTITION BY toYYYYMM(date) ORDER BY (source, machine_name, record_type, date, model_name, record_key)';

/** ClickHouse base CREATE (deferred columns excluded). */
export function clickHouseCreateSql(): string {
  const cols = EVENTS_COLUMNS.filter(c => !c.chDeferred)
    .map(c => `${c.name} ${c.ch}`)
    .join(', ');
  return `CREATE TABLE IF NOT EXISTS ccusage_events (${cols}) ${CH_ENGINE_SUFFIX}`;
}

/** ClickHouse ALTER ADD COLUMN statements (idempotent; wrap each in try/catch). */
export function clickHouseAlterStatements(): string[] {
  return EVENTS_COLUMNS.filter(c => c.chAlterAfter).map(
    c => `ALTER TABLE ccusage_events ADD COLUMN ${c.name} ${c.ch} AFTER ${c.chAlterAfter}`
  );
}

/** DuckDB CREATE (all columns). */
export function duckDbCreateSql(): string {
  const cols = EVENTS_COLUMNS.map(c => `  ${c.name} ${c.duck}`).join(',\n');
  return `CREATE TABLE IF NOT EXISTS ccusage_events (\n${cols}\n)`;
}
