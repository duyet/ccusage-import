/**
 * Date and datetime parsing/formatting utilities.
 *
 * Handles conversion of ISO 8601 dates and datetimes to ClickHouse-compatible
 * `YYYY-MM-DD` and `YYYY-MM-DD HH:MM:SS` string formats using UTC.
 */

use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};

/// Parse a date string and return it formatted as `YYYY-MM-DD`.
///
/// Handles ISO 8601 dates (`2025-01-05`), ISO datetimes
/// (`2025-01-05T10:00:00.000Z`), and human-readable dates
/// (`Mar 21, 2026` — parsed as UTC).
///
/// Throws (returns Err) on invalid input — mirrors the TS `parseDate`.
pub fn parse_date(date_str: &str) -> anyhow::Result<String> {
    // ISO: starts with YYYY-MM-DD
    if date_str.len() >= 10
        && date_str[..4].parse::<u16>().is_ok()
        && date_str.as_bytes()[4] == b'-'
        && date_str.as_bytes()[7] == b'-'
    {
        // Try full RFC 3339 first (handles 2025-01-05T10:00:00.000Z)
        if let Ok(dt) = DateTime::parse_from_rfc3339(date_str) {
            return Ok(dt.date_naive().format("%Y-%m-%d").to_string());
        }
        // Fall back to date-only
        let nd = NaiveDate::parse_from_str(date_str, "%Y-%m-%d")?;
        return Ok(nd.format("%Y-%m-%d").to_string());
    }

    // Non-ISO (e.g. "Mar 21, 2026") — parse as a naive date, treat as UTC.
    let nd = NaiveDate::parse_from_str(date_str, "%b %d, %Y")?;
    Ok(nd.format("%Y-%m-%d").to_string())
}

/// Current UTC time formatted as `YYYY-MM-DD HH:MM:SS` (ClickHouse DateTime string).
pub fn ch_now() -> String {
    Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// Format a UTC datetime as `YYYY-MM-DD HH:MM:SS`.
pub fn ch_datetime(dt: DateTime<Utc>) -> String {
    dt.format("%Y-%m-%d %H:%M:%S").to_string()
}

/// Parse a datetime string, returning ClickHouse-compatible `YYYY-MM-DD HH:MM:SS`.
///
/// Handles ISO 8601 with timezone (e.g. `2025-01-05T10:00:00.000Z`),
/// stripping the timezone to produce a naive UTC string.
/// Returns `None` for null/empty/invalid input.
///
/// This mirrors the TS `parseDateTime` + `chDateTime` combination:
/// the input is parsed as an absolute instant, converted to UTC, and
/// formatted without timezone info.
pub fn parse_date_time(date_time_str: &str) -> Option<String> {
    if date_time_str.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(date_time_str) {
        let utc = dt.with_timezone(&Utc);
        return Some(utc.format("%Y-%m-%d %H:%M:%S").to_string());
    }
    None
}

/// Parse a Unix timestamp (seconds) into a ClickHouse datetime string.
pub fn from_unix_seconds(seconds: i64) -> String {
    match DateTime::<Utc>::from_timestamp(seconds, 0) {
        Some(dt) => ch_datetime(dt),
        None => ch_now(),
    }
}

/// Format a UTC datetime as ISO date `YYYY-MM-DD` (for date extraction from timestamps).
pub fn date_from_unix_seconds(seconds: i64) -> String {
    match DateTime::<Utc>::from_timestamp(seconds, 0) {
        Some(dt) => dt.date_naive().format("%Y-%m-%d").to_string(),
        None => Utc::now().date_naive().format("%Y-%m-%d").to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_iso_date() {
        assert_eq!(parse_date("2025-01-05").unwrap(), "2025-01-05");
    }

    #[test]
    fn parses_iso_datetime() {
        assert_eq!(parse_date("2025-01-05T10:00:00.000Z").unwrap(), "2025-01-05");
    }

    #[test]
    fn parses_human_readable_date_as_utc() {
        assert_eq!(parse_date("Mar 21, 2026").unwrap(), "2026-03-21");
    }

    #[test]
    fn throws_on_invalid() {
        assert!(parse_date("not-a-date").is_err());
    }

    #[test]
    fn parse_date_time_null_empty() {
        assert_eq!(parse_date_time(""), None);
        assert_eq!(parse_date_time("nonsense"), None);
    }

    #[test]
    fn parse_date_time_valid() {
        let result = parse_date_time("2025-01-05T10:00:00.000Z");
        assert!(result.is_some());
        assert_eq!(result.unwrap(), "2025-01-05 10:00:00");
    }

    #[test]
    fn from_unix_seconds_format() {
        // 1780505000 = 2026-06-03 16:43:20 UTC (matches hermes test expectation)
        assert_eq!(from_unix_seconds(1780505000), "2026-06-03 16:43:20");
        assert_eq!(date_from_unix_seconds(1780505000), "2026-06-03");
    }

    #[test]
    fn from_unix_seconds_invalid_returns_now() {
        let result = from_unix_seconds(-999999999999999);
        assert!(!result.is_empty());
    }
}
