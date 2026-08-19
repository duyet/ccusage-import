/**
 * Number and string formatting utilities for CLI display.
 *
 * Ported from `src/ui/utils/formatting.ts` (the tested variant).
 */

/// Format a large number with K/M/B suffixes.
pub fn format_number(num: f64, decimals: usize) -> String {
    if num == 0.0 {
        return "0".to_string();
    }
    let abs = num.abs();
    let sign = if num < 0.0 { "-" } else { "" };

    if abs >= 1_000_000_000.0 {
        return format!("{}{:.2$}B", sign, abs / 1_000_000_000.0, decimals);
    }
    if abs >= 1_000_000.0 {
        return format!("{}{:.2$}M", sign, abs / 1_000_000.0, decimals);
    }
    if abs >= 1_000.0 {
        return format!("{}{:.2$}K", sign, abs / 1_000.0, decimals);
    }
    format!("{}{}", sign, abs)
}

/// Format a cost value in USD.
pub fn format_cost(cost: f64, decimals: usize) -> String {
    format!("${:.1$}", cost, decimals)
}

/// Format a duration in seconds to human-readable format.
pub fn format_duration(seconds: f64) -> String {
    if seconds < 60.0 {
        return format!("{}s", seconds.round());
    }
    let hours = (seconds / 3600.0) as i64;
    let minutes = ((seconds % 3600.0) / 60.0) as i64;
    let secs = (seconds % 60.0).round() as i64;

    if hours > 0 {
        return format!("{}h {}m {}s", hours, minutes, secs);
    }
    if minutes > 0 {
        return format!("{}m {}s", minutes, secs);
    }
    format!("{}s", secs)
}

/// Format a percentage value.
pub fn format_percentage(value: f64, decimals: usize) -> String {
    format!("{:.1$}%", value, decimals)
}

/// Format a date to ISO string (YYYY-MM-DD).
pub fn format_date(date_str: &str) -> String {
    // If it's already a date string, extract YYYY-MM-DD
    date_str.split('T').next().unwrap_or(date_str).to_string()
}

/// Truncate a string to a maximum length with ellipsis.
pub fn truncate(str: &str, max_length: usize) -> String {
    if str.len() <= max_length {
        return str.to_string();
    }
    let suffix = "...";
    if max_length <= suffix.len() {
        return str[..max_length].to_string();
    }
    format!("{}{}", &str[..max_length - suffix.len()], suffix)
}

/// Pad a string to a fixed width.
pub fn pad(str: &str, width: usize, align: &str) -> String {
    if str.len() >= width {
        return str.to_string();
    }
    let padding = width - str.len();
    match align {
        "right" => format!("{}{}", " ".repeat(padding), str),
        "center" => {
            let left = padding / 2;
            let right = padding - left;
            format!("{}{}{}", " ".repeat(left), str, " ".repeat(right))
        }
        _ => format!("{}{}", str, " ".repeat(padding)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_number_zero() {
        assert_eq!(format_number(0.0, 1), "0");
    }

    #[test]
    fn format_number_small() {
        assert_eq!(format_number(123.0, 1), "123");
        assert_eq!(format_number(999.0, 1), "999");
    }

    #[test]
    fn format_number_thousands() {
        assert_eq!(format_number(1234.0, 1), "1.2K");
        assert_eq!(format_number(1000.0, 1), "1.0K");
    }

    #[test]
    fn format_number_millions() {
        assert_eq!(format_number(1234567.0, 1), "1.2M");
        assert_eq!(format_number(1000000.0, 1), "1.0M");
    }

    #[test]
    fn format_number_billions() {
        assert_eq!(format_number(1234567890.0, 1), "1.2B");
        assert_eq!(format_number(1000000000.0, 1), "1.0B");
    }

    #[test]
    fn format_number_negative() {
        assert_eq!(format_number(-1234.0, 1), "-1.2K");
        assert_eq!(format_number(-1000000.0, 1), "-1.0M");
    }

    #[test]
    fn test_format_cost() {
        assert_eq!(format_cost(12.34, 2), "$12.34");
        assert_eq!(format_cost(0.5, 2), "$0.50");
        assert_eq!(format_cost(100.0, 2), "$100.00");
    }

    #[test]
    fn format_duration_seconds() {
        assert_eq!(format_duration(45.0), "45s");
        assert_eq!(format_duration(59.0), "59s");
    }

    #[test]
    fn format_duration_minutes() {
        assert_eq!(format_duration(90.0), "1m 30s");
        assert_eq!(format_duration(120.0), "2m 0s");
    }

    #[test]
    fn format_duration_hours() {
        assert_eq!(format_duration(3661.0), "1h 1m 1s");
        assert_eq!(format_duration(7200.0), "2h 0m 0s");
    }

    #[test]
    fn test_format_percentage() {
        assert_eq!(format_percentage(95.5, 1), "95.5%");
        assert_eq!(format_percentage(100.0, 1), "100.0%");
        assert_eq!(format_percentage(0.0, 1), "0.0%");
    }

    #[test]
    fn truncate_short() {
        assert_eq!(truncate("hello", 10), "hello");
    }

    #[test]
    fn truncate_long() {
        assert_eq!(truncate("hello world", 8), "hello...");
    }

    #[test]
    fn pad_left() {
        assert_eq!(pad("test", 8, "left"), "test    ");
    }

    #[test]
    fn pad_right() {
        assert_eq!(pad("test", 8, "right"), "    test");
    }

    #[test]
    fn pad_center() {
        assert_eq!(pad("test", 8, "center"), "  test  ");
    }
}
