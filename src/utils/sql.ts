/**
 * SQL helpers shared across sinks.
 */

/** Escape a single-quoted SQL string literal by doubling embedded quotes. */
export function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}
