/**
 * Minimal leveled logger. info/warn go to stderr (so stdout stays clean
 * for piped JSON/data); error always goes to stderr. info/warn are gated
 * by verbose.
 */

pub struct Logger {
    verbose: bool,
}

impl Logger {
    pub fn info(&self, msg: &str) {
        if self.verbose {
            eprintln!("{}", msg);
        }
    }
    pub fn warn(&self, msg: &str) {
        if self.verbose {
            eprintln!("{}", msg);
        }
    }
    pub fn error(&self, msg: &str) {
        eprintln!("{}", msg);
    }
}

pub fn create_logger(verbose: bool) -> Logger {
    Logger { verbose }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logger_creates_with_verbose_flag() {
        let log = create_logger(true);
        assert!(log.verbose);
    }

    #[test]
    fn logger_creates_without_verbose() {
        let log = create_logger(false);
        assert!(!log.verbose);
    }
}
