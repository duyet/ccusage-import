/**
 * Schema generators must reproduce the original hand-written DDL byte-for-byte,
 * and the column set must stay 1:1 with the builder's row shape.
 */

import { describe, it, expect } from 'bun:test';
import {
  EVENTS_COLUMNS,
  clickHouseCreateSql,
  clickHouseAlterStatements,
  duckDbCreateSql,
} from '../../src/sinks/schema';
import { makeEventRow } from '../../src/parsers/parsers';

// Captured verbatim from clickhouse.ts (pre-refactor baseline).
const CH_CREATE =
  "CREATE TABLE IF NOT EXISTS ccusage_events (date Date, record_type String, record_key String, source String DEFAULT 'ccusage', machine_name String, model_name String DEFAULT '', session_id String DEFAULT '', project_path String DEFAULT '', input_tokens UInt64 DEFAULT 0, output_tokens UInt64 DEFAULT 0, cache_creation_tokens UInt64 DEFAULT 0, cache_read_tokens UInt64 DEFAULT 0, reasoning_tokens UInt64 DEFAULT 0, total_tokens UInt64 DEFAULT 0, cost Float64 DEFAULT 0, dedup_key String DEFAULT '', import_id String DEFAULT '', block_id String DEFAULT '', start_time Nullable(DateTime), end_time Nullable(DateTime), actual_end_time Nullable(DateTime), is_active UInt8 DEFAULT 0, is_gap UInt8 DEFAULT 0, entries UInt32 DEFAULT 0, burn_rate Nullable(Float64), created_at DateTime DEFAULT now(), updated_at DateTime DEFAULT now()) ENGINE = ReplacingMergeTree(updated_at) PARTITION BY toYYYYMM(date) ORDER BY (source, machine_name, record_type, date, model_name, record_key)";

const CH_ALTERS = [
  'ALTER TABLE ccusage_events ADD COLUMN reasoning_tokens UInt64 DEFAULT 0 AFTER cache_read_tokens',
  'ALTER TABLE ccusage_events ADD COLUMN projection Nullable(Float64) AFTER burn_rate',
  'ALTER TABLE ccusage_events ADD COLUMN usage_limit_reset_time Nullable(DateTime) AFTER projection',
];

// Captured verbatim from duckdb.ts EVENTS_DDL (pre-refactor baseline).
const DUCK_CREATE = `CREATE TABLE IF NOT EXISTS ccusage_events (
  date DATE NOT NULL,
  record_type VARCHAR NOT NULL,
  record_key VARCHAR NOT NULL,
  source VARCHAR NOT NULL DEFAULT 'ccusage',
  machine_name VARCHAR NOT NULL,
  model_name VARCHAR DEFAULT '',
  session_id VARCHAR DEFAULT '',
  project_path VARCHAR DEFAULT '',
  input_tokens BIGINT DEFAULT 0,
  output_tokens BIGINT DEFAULT 0,
  cache_creation_tokens BIGINT DEFAULT 0,
  cache_read_tokens BIGINT DEFAULT 0,
  reasoning_tokens BIGINT DEFAULT 0,
  total_tokens BIGINT DEFAULT 0,
  cost DOUBLE DEFAULT 0,
  dedup_key VARCHAR DEFAULT '',
  import_id VARCHAR DEFAULT '',
  block_id VARCHAR DEFAULT '',
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  actual_end_time TIMESTAMP,
  is_active SMALLINT DEFAULT 0,
  is_gap SMALLINT DEFAULT 0,
  entries INTEGER DEFAULT 0,
  burn_rate DOUBLE DEFAULT 0,
  projection DOUBLE DEFAULT 0,
  usage_limit_reset_time TIMESTAMP,
  created_at TIMESTAMP DEFAULT current_timestamp,
  updated_at TIMESTAMP DEFAULT current_timestamp
)`;

describe('schema generators', () => {
  it('clickHouseCreateSql matches the original base CREATE', () => {
    expect(clickHouseCreateSql()).toBe(CH_CREATE);
  });

  it('clickHouseAlterStatements match the original ALTERs in order', () => {
    expect(clickHouseAlterStatements()).toEqual(CH_ALTERS);
  });

  it('duckDbCreateSql matches the original EVENTS_DDL', () => {
    expect(duckDbCreateSql()).toBe(DUCK_CREATE);
  });

  it('column names are 1:1 with the builder row shape', () => {
    const builderKeys = Object.keys(makeEventRow('2025-01-01 00:00:00', {}));
    expect(EVENTS_COLUMNS.map(c => c.name)).toEqual(builderKeys);
    expect(EVENTS_COLUMNS).toHaveLength(29);
  });
});
