/**
 * Date and datetime parsing utilities for ccusage-import.
 *
 * Handles conversion of ISO 8601 format dates and datetimes to
 * ClickHouse-compatible string formats.
 *
 * Key features:
 * - Parses ISO 8601 date strings (YYYY-MM-DD)
 * - Parses ISO 8601 datetime strings (YYYY-MM-DDTHH:MM:SS.sssZ)
 * - Strips timezone information for ClickHouse compatibility
 * - Handles Date objects and string inputs
 * - Returns null for invalid inputs
 */

/**
 * Parse a date string or Date object to ClickHouse-compatible format.
 *
 * Handles ISO 8601 date strings (e.g., "2025-01-05") and Date objects.
 * Returns the date in YYYY-MM-DD format for ClickHouse Date columns.
 *
 * @param dateStr - Date string in ISO format, Date object, or null
 * @returns Date string in YYYY-MM-DD format, or null if parsing fails
 *
 * @example
 * ```ts
 * parseDate("2025-01-05") // "2025-01-05"
 * parseDate("2025-01-05T15:30:00.000Z") // "2025-01-05"
 * parseDate(new Date("2025-01-05")) // "2025-01-05"
 * parseDate(null) // null
 * parseDate("invalid") // null
 * ```
 */
export function parseDate(dateStr: string | Date | null): string | null {
  if (!dateStr) {
    return null;
  }

  try {
    let date: Date;

    if (typeof dateStr === "string") {
      // Handle ISO format date strings
      // Replace 'Z' suffix with empty string to avoid UTC interpretation issues
      const normalizedStr = dateStr.replace("Z", "");
      date = new Date(normalizedStr);

      // Check if date is invalid
      if (isNaN(date.getTime())) {
        return null;
      }
    } else if (dateStr instanceof Date) {
      date = dateStr;

      // Check if date is invalid
      if (isNaN(date.getTime())) {
        return null;
      }
    } else {
      return null;
    }

    // Format as YYYY-MM-DD for ClickHouse Date type
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  } catch (error) {
    console.warn(`Failed to parse date '${dateStr}':`, error);
    return null;
  }
}

/**
 * Parse a datetime string or Date object to ClickHouse-compatible format.
 *
 * Handles ISO 8601 datetime strings (e.g., "2025-01-05T15:30:00.000Z")
 * and Date objects. Strips timezone information and returns in local time
 * for ClickHouse DateTime columns.
 *
 * @param datetimeStr - Datetime string in ISO format, Date object, or null
 * @returns Datetime string in YYYY-MM-DDTHH:MM:SS format, or null if parsing fails
 *
 * @example
 * ```ts
 * parseDateTime("2025-01-05T15:30:00.000Z") // "2025-01-05T15:30:00"
 * parseDateTime(new Date("2025-01-05T15:30:00.000Z")) // "2025-01-05T15:30:00"
 * parseDateTime(null) // null
 * parseDateTime("invalid") // null
 * ```
 */
export function parseDateTime(datetimeStr: string | Date | null): string | null {
  if (!datetimeStr) {
    return null;
  }

  try {
    let date: Date;

    if (typeof datetimeStr === "string") {
      // Handle ISO format datetime strings
      // Replace 'Z' suffix to parse as local time (stripping timezone info)
      const normalizedStr = datetimeStr.replace("Z", "");
      date = new Date(normalizedStr);

      // Check if date is invalid
      if (isNaN(date.getTime())) {
        return null;
      }
    } else if (datetimeStr instanceof Date) {
      date = datetimeStr;

      // Check if date is invalid
      if (isNaN(date.getTime())) {
        return null;
      }
    } else {
      return null;
    }

    // Format as YYYY-MM-DDTHH:MM:SS for ClickHouse DateTime type
    // Note: No timezone suffix (stripped for ClickHouse compatibility)
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
  } catch (error) {
    console.warn(`Failed to parse datetime '${datetimeStr}':`, error);
    return null;
  }
}

/**
 * Type guard to check if a value is a valid date string.
 *
 * @param value - Any value to check
 * @returns True if the value is a valid date string
 */
export function isDateString(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  // Basic ISO date format check (YYYY-MM-DD)
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
  return isoDateRegex.test(value);
}

/**
 * Type guard to check if a value is a valid datetime string.
 *
 * @param value - Any value to check
 * @returns True if the value is a valid datetime string
 */
export function isDateTimeString(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  // Basic ISO datetime format check (YYYY-MM-DDTHH:MM:SS.sssZ)
  const isoDateTimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  return isoDateTimeRegex.test(value);
}
