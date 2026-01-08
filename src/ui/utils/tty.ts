/**
 * TTY detection utilities
 * Determines if the output stream is a terminal (for cron compatibility)
 */

import { isatty } from 'node:tty';

/**
 * Check if stdout is a TTY (terminal)
 */
export function isStdoutTTY(): boolean {
  return isatty(1);
}

/**
 * Check if stderr is a TTY (terminal)
 */
export function isStderrTTY(): boolean {
  return isatty(2);
}

/**
 * Check if both stdout and stderr are TTYs
 * This determines if we should show interactive UI
 */
export function hasTTY(): boolean {
  return isStdoutTTY() && isStderrTTY();
}

/**
 * Check if we're running in a non-interactive environment
 * (cron, CI/CD, piped output, etc.)
 */
export function isNonInteractive(): boolean {
  return !hasTTY();
}

/**
 * Force non-interactive mode by setting environment variable
 */
export function setNonInteractive(): void {
  process.env.CI = 'true';
}
