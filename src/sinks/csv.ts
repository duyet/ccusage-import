/**
 * Pure CSV row formatting for the DuckDB COPY FROM path. Kept DB-free so it can
 * be unit-tested without a database.
 */

/** Format a single value for CSV: null/undefined→empty, non-finite→'0', Date→
 * `YYYY-MM-DD HH:MM:SS`, otherwise stringify and quote if it contains a comma,
 * quote, or newline. */
export function toCsvValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && !Number.isFinite(v)) return '0';
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Format one CSV line for the given column order. */
export function toCsvLine(columns: string[], row: Record<string, unknown>): string {
  return columns.map(col => toCsvValue(row[col])).join(',');
}
