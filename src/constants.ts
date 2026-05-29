/**
 * Shared numeric constants (timeouts, batch sizes).
 */

export const TIMEOUTS = {
  /** ccusage (Claude) CLI fetch */
  ccusage: 180_000,
  /** companion agent CLI fetch */
  companion: 120_000,
  /** package-runner availability probe (`npx/bunx --version`) */
  runnerProbe: 5_000,
  /** CLI availability check (`--version` / `--help`) */
  availability: 10_000,
} as const;

/** Number of scoped DELETE predicates combined per ClickHouse ALTER ... DELETE. */
export const CH_DELETE_BATCH = 20;
