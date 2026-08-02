/**
 * SQL helpers shared across sinks.
 */

/// Escape a single-quoted SQL string literal by doubling embedded quotes.
pub fn escape_sql_literal(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn doubles_a_single_quote() {
        assert_eq!(escape_sql_literal("O'Brien"), "O''Brien");
    }

    #[test]
    fn doubles_every_quote() {
        assert_eq!(escape_sql_literal("a'b'c"), "a''b''c");
    }

    #[test]
    fn empty_string_passes_through() {
        assert_eq!(escape_sql_literal(""), "");
    }

    #[test]
    fn no_quotes_unchanged() {
        assert_eq!(escape_sql_literal("/home/user/project"), "/home/user/project");
    }
}
