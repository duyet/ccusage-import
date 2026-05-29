/**
 * Minimal leveled logger. info/warn go to stderr (so stdout stays clean for
 * piped JSON/data); error always goes to stderr. info/warn are gated by verbose.
 */

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export function createLogger(verbose: boolean): Logger {
  return {
    info(message: string): void {
      if (verbose) console.error(message);
    },
    warn(message: string): void {
      if (verbose) console.warn(message);
    },
    error(message: string): void {
      console.error(message);
    },
  };
}
