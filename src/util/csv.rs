/**
 * CSV value/line formatting for the DuckDB COPY FROM path.
 * Pure logic — no database dependency.
 *
 * Ported from `src/sinks/csv.ts`.
 */

/// Format a single value for CSV: null/None → empty, non-finite float → '0',
/// finite numbers pass through, strings quoted if they contain `,`, `"`, or `\n`.
pub fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        let escaped: String = s.replace('"', "\"\"");
        format!("\"{}\"", escaped)
    } else {
        s.to_string()
    }
}

/// Trait for converting values to CSV cell strings.
pub trait CsvValue {
    fn to_csv_cell(&self) -> String;
}

impl CsvValue for str {
    fn to_csv_cell(&self) -> String {
        csv_escape(self)
    }
}

impl CsvValue for &str {
    fn to_csv_cell(&self) -> String {
        csv_escape(self)
    }
}

impl CsvValue for String {
    fn to_csv_cell(&self) -> String {
        csv_escape(self)
    }
}

impl CsvValue for &String {
    fn to_csv_cell(&self) -> String {
        csv_escape(self)
    }
}

impl CsvValue for Option<String> {
    fn to_csv_cell(&self) -> String {
        match self {
            None => String::new(),
            Some(s) => csv_escape(s),
        }
    }
}

impl CsvValue for u64 {
    fn to_csv_cell(&self) -> String {
        self.to_string()
    }
}

impl CsvValue for u32 {
    fn to_csv_cell(&self) -> String {
        self.to_string()
    }
}

impl CsvValue for u8 {
    fn to_csv_cell(&self) -> String {
        self.to_string()
    }
}

impl CsvValue for f64 {
    fn to_csv_cell(&self) -> String {
        if !self.is_finite() {
            "0".to_string()
        } else if self.fract() == 0.0 {
            format!("{}", *self as i64)
        } else {
            format!("{}", self)
        }
    }
}

/// Public toCsvValue for test compatibility.
pub fn to_csv_value<T: CsvValue>(v: &T) -> String {
    v.to_csv_cell()
}

/// Format one CSV line from pre-computed cell values.
pub fn to_csv_line_from_cells(cells: &[String]) -> String {
    cells.join(",")
}

/// Format one CSV line for the given column order from a map.
pub fn to_csv_line(
    columns: &[&str],
    row: &std::collections::HashMap<String, String>,
) -> String {
    let mut parts: Vec<String> = Vec::with_capacity(columns.len());
    for col in columns {
        match row.get(*col) {
            Some(v) => parts.push(csv_escape(v)),
            None => parts.push(String::new()),
        }
    }
    parts.join(",")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn null_option_empty() {
        let none: Option<String> = None;
        assert_eq!(none.to_csv_cell(), "");
        assert_eq!(to_csv_value(&none), "");
    }

    #[test]
    fn non_finite_numbers_become_zero() {
        assert_eq!(f64::NAN.to_csv_cell(), "0");
        assert_eq!(f64::INFINITY.to_csv_cell(), "0");
        assert_eq!(f64::NEG_INFINITY.to_csv_cell(), "0");
    }

    #[test]
    fn finite_numbers_pass_through() {
        assert_eq!(to_csv_value(&0u64), "0");
        assert_eq!(to_csv_value(&42.5f64), "42.5");
    }

    #[test]
    fn quotes_values_containing_comma_quote_newline() {
        assert_eq!(to_csv_value(&"a,b".to_string()), "\"a,b\"");
        assert_eq!(to_csv_value(&"a\"b".to_string()), "\"a\"\"b\"");
        assert_eq!(to_csv_value(&"a\nb".to_string()), "\"a\nb\"");
    }

    #[test]
    fn plain_strings_pass_through() {
        assert_eq!(to_csv_value(&"hello".to_string()), "hello");
    }

    #[test]
    fn csv_line_from_map() {
        let mut row = std::collections::HashMap::new();
        row.insert("a".to_string(), "1".to_string());
        row.insert("b".to_string(), "x,y".to_string());
        // c is not in the map → empty
        assert_eq!(to_csv_line(&["a", "b", "c"], &row), "1,\"x,y\",");
    }
}
