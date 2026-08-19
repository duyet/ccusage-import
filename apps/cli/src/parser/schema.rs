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

/// Specification for a single column in the ccusage_events table.
#[derive(Debug, Clone)]
pub struct ColumnSpec {
    pub name: &'static str,
    /// ClickHouse type + default, e.g. "UInt64 DEFAULT 0".
    pub ch: &'static str,
    /// DuckDB type + default, e.g. "BIGINT DEFAULT 0".
    pub duck: &'static str,
    /// Omit from ClickHouse base CREATE (added via ALTER instead).
    pub ch_deferred: bool,
    /// Emit ALTER ADD COLUMN after this column for ClickHouse.
    pub ch_alter_after: Option<&'static str>,
}

/// The 31-column schema for ccusage_events, in authoritative order.
pub const EVENTS_COLUMNS: &[ColumnSpec] = &[
    ColumnSpec { name: "date", ch: "Date", duck: "DATE NOT NULL", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "record_type", ch: "String", duck: "VARCHAR NOT NULL", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "record_key", ch: "String", duck: "VARCHAR NOT NULL", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "source", ch: "String DEFAULT 'ccusage'", duck: "VARCHAR NOT NULL DEFAULT 'ccusage'", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "machine_name", ch: "String", duck: "VARCHAR NOT NULL", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "account_id", ch: "String DEFAULT ''", duck: "VARCHAR DEFAULT ''", ch_deferred: false, ch_alter_after: Some("machine_name") },
    ColumnSpec { name: "api_key_id", ch: "String DEFAULT ''", duck: "VARCHAR DEFAULT ''", ch_deferred: false, ch_alter_after: Some("account_id") },
    ColumnSpec { name: "model_name", ch: "String DEFAULT ''", duck: "VARCHAR DEFAULT ''", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "session_id", ch: "String DEFAULT ''", duck: "VARCHAR DEFAULT ''", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "project_path", ch: "String DEFAULT ''", duck: "VARCHAR DEFAULT ''", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "input_tokens", ch: "UInt64 DEFAULT 0", duck: "BIGINT DEFAULT 0", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "output_tokens", ch: "UInt64 DEFAULT 0", duck: "BIGINT DEFAULT 0", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "cache_creation_tokens", ch: "UInt64 DEFAULT 0", duck: "BIGINT DEFAULT 0", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "cache_read_tokens", ch: "UInt64 DEFAULT 0", duck: "BIGINT DEFAULT 0", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "reasoning_tokens", ch: "UInt64 DEFAULT 0", duck: "BIGINT DEFAULT 0", ch_deferred: false, ch_alter_after: Some("cache_read_tokens") },
    ColumnSpec { name: "total_tokens", ch: "UInt64 DEFAULT 0", duck: "BIGINT DEFAULT 0", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "cost", ch: "Float64 DEFAULT 0", duck: "DOUBLE DEFAULT 0", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "dedup_key", ch: "String DEFAULT ''", duck: "VARCHAR DEFAULT ''", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "import_id", ch: "String DEFAULT ''", duck: "VARCHAR DEFAULT ''", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "block_id", ch: "String DEFAULT ''", duck: "VARCHAR DEFAULT ''", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "start_time", ch: "Nullable(DateTime)", duck: "TIMESTAMP", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "end_time", ch: "Nullable(DateTime)", duck: "TIMESTAMP", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "actual_end_time", ch: "Nullable(DateTime)", duck: "TIMESTAMP", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "is_active", ch: "UInt8 DEFAULT 0", duck: "SMALLINT DEFAULT 0", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "is_gap", ch: "UInt8 DEFAULT 0", duck: "SMALLINT DEFAULT 0", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "entries", ch: "UInt32 DEFAULT 0", duck: "INTEGER DEFAULT 0", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "burn_rate", ch: "Nullable(Float64)", duck: "DOUBLE DEFAULT 0", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "projection", ch: "Nullable(Float64)", duck: "DOUBLE DEFAULT 0", ch_deferred: true, ch_alter_after: Some("burn_rate") },
    ColumnSpec { name: "usage_limit_reset_time", ch: "Nullable(DateTime)", duck: "TIMESTAMP", ch_deferred: true, ch_alter_after: Some("projection") },
    ColumnSpec { name: "created_at", ch: "DateTime DEFAULT now()", duck: "TIMESTAMP DEFAULT current_timestamp", ch_deferred: false, ch_alter_after: None },
    ColumnSpec { name: "updated_at", ch: "DateTime DEFAULT now()", duck: "TIMESTAMP DEFAULT current_timestamp", ch_deferred: false, ch_alter_after: None },
];

const CH_ENGINE_SUFFIX: &str = "ENGINE = ReplacingMergeTree(updated_at) PARTITION BY toYYYYMM(date) ORDER BY (account_id, source, machine_name, record_type, date, model_name, record_key)";

/// ClickHouse base CREATE (deferred columns excluded).
pub fn click_house_create_sql() -> String {
    let cols: Vec<String> = EVENTS_COLUMNS
        .iter()
        .filter(|c| !c.ch_deferred)
        .map(|c| format!("{} {}", c.name, c.ch))
        .collect();
    format!("CREATE TABLE IF NOT EXISTS ccusage_events ({}) {}", cols.join(", "), CH_ENGINE_SUFFIX)
}

/// ClickHouse ALTER ADD COLUMN statements (idempotent; wrap each in try/catch).
pub fn click_house_alter_statements() -> Vec<String> {
    EVENTS_COLUMNS
        .iter()
        .filter(|c| c.ch_alter_after.is_some())
        .map(|c| format!("ALTER TABLE ccusage_events ADD COLUMN {} {} AFTER {}", c.name, c.ch, c.ch_alter_after.unwrap()))
        .collect()
}

/// DuckDB CREATE (all columns).
pub fn duck_db_create_sql() -> String {
    let cols: Vec<String> = EVENTS_COLUMNS
        .iter()
        .map(|c| format!("  {} {}", c.name, c.duck))
        .collect();
    format!("CREATE TABLE IF NOT EXISTS ccusage_events (\n{}\n)", cols.join(",\n"))
}

/// Column names in order.
pub fn column_names() -> Vec<&'static str> {
    EVENTS_COLUMNS.iter().map(|c| c.name).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Captured verbatim from clickhouse.ts (pre-refactor baseline).
    const CH_CREATE: &str = "CREATE TABLE IF NOT EXISTS ccusage_events (date Date, record_type String, record_key String, source String DEFAULT 'ccusage', machine_name String, account_id String DEFAULT '', api_key_id String DEFAULT '', model_name String DEFAULT '', session_id String DEFAULT '', project_path String DEFAULT '', input_tokens UInt64 DEFAULT 0, output_tokens UInt64 DEFAULT 0, cache_creation_tokens UInt64 DEFAULT 0, cache_read_tokens UInt64 DEFAULT 0, reasoning_tokens UInt64 DEFAULT 0, total_tokens UInt64 DEFAULT 0, cost Float64 DEFAULT 0, dedup_key String DEFAULT '', import_id String DEFAULT '', block_id String DEFAULT '', start_time Nullable(DateTime), end_time Nullable(DateTime), actual_end_time Nullable(DateTime), is_active UInt8 DEFAULT 0, is_gap UInt8 DEFAULT 0, entries UInt32 DEFAULT 0, burn_rate Nullable(Float64), created_at DateTime DEFAULT now(), updated_at DateTime DEFAULT now()) ENGINE = ReplacingMergeTree(updated_at) PARTITION BY toYYYYMM(date) ORDER BY (account_id, source, machine_name, record_type, date, model_name, record_key)";

    const CH_ALTERS: &[&str] = &[
        "ALTER TABLE ccusage_events ADD COLUMN account_id String DEFAULT '' AFTER machine_name",
        "ALTER TABLE ccusage_events ADD COLUMN api_key_id String DEFAULT '' AFTER account_id",
        "ALTER TABLE ccusage_events ADD COLUMN reasoning_tokens UInt64 DEFAULT 0 AFTER cache_read_tokens",
        "ALTER TABLE ccusage_events ADD COLUMN projection Nullable(Float64) AFTER burn_rate",
        "ALTER TABLE ccusage_events ADD COLUMN usage_limit_reset_time Nullable(DateTime) AFTER projection",
    ];

    const DUCK_CREATE: &str = "CREATE TABLE IF NOT EXISTS ccusage_events (\n  date DATE NOT NULL,\n  record_type VARCHAR NOT NULL,\n  record_key VARCHAR NOT NULL,\n  source VARCHAR NOT NULL DEFAULT 'ccusage',\n  machine_name VARCHAR NOT NULL,\n  account_id VARCHAR DEFAULT '',\n  api_key_id VARCHAR DEFAULT '',\n  model_name VARCHAR DEFAULT '',\n  session_id VARCHAR DEFAULT '',\n  project_path VARCHAR DEFAULT '',\n  input_tokens BIGINT DEFAULT 0,\n  output_tokens BIGINT DEFAULT 0,\n  cache_creation_tokens BIGINT DEFAULT 0,\n  cache_read_tokens BIGINT DEFAULT 0,\n  reasoning_tokens BIGINT DEFAULT 0,\n  total_tokens BIGINT DEFAULT 0,\n  cost DOUBLE DEFAULT 0,\n  dedup_key VARCHAR DEFAULT '',\n  import_id VARCHAR DEFAULT '',\n  block_id VARCHAR DEFAULT '',\n  start_time TIMESTAMP,\n  end_time TIMESTAMP,\n  actual_end_time TIMESTAMP,\n  is_active SMALLINT DEFAULT 0,\n  is_gap SMALLINT DEFAULT 0,\n  entries INTEGER DEFAULT 0,\n  burn_rate DOUBLE DEFAULT 0,\n  projection DOUBLE DEFAULT 0,\n  usage_limit_reset_time TIMESTAMP,\n  created_at TIMESTAMP DEFAULT current_timestamp,\n  updated_at TIMESTAMP DEFAULT current_timestamp\n)";

    #[test]
    fn clickhouse_create_sql_matches_baseline() {
        assert_eq!(click_house_create_sql(), CH_CREATE);
    }

    #[test]
    fn clickhouse_alter_statements_match_baseline() {
        assert_eq!(click_house_alter_statements(), CH_ALTERS);
    }

    #[test]
    fn duckdb_create_sql_matches_baseline() {
        assert_eq!(duck_db_create_sql(), DUCK_CREATE);
    }

    #[test]
    fn column_count_is_31() {
        assert_eq!(EVENTS_COLUMNS.len(), 31);
    }

    #[test]
    fn column_names_match_model() {
        assert_eq!(
            column_names(),
            vec![
                "date", "record_type", "record_key", "source", "machine_name",
                "account_id", "api_key_id",
                "model_name", "session_id", "project_path", "input_tokens",
                "output_tokens", "cache_creation_tokens", "cache_read_tokens",
                "reasoning_tokens", "total_tokens", "cost", "dedup_key",
                "import_id", "block_id", "start_time", "end_time",
                "actual_end_time", "is_active", "is_gap", "entries",
                "burn_rate", "projection", "usage_limit_reset_time",
                "created_at", "updated_at",
            ]
        );
    }
}
