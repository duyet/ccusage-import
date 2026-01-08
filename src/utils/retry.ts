/**
 * Retry utility with exponential backoff and jitter
 *
 * Provides configurable retry logic for async operations with:
 * - Exponential backoff: delay = baseDelay * 2^(attempt-1)
 * - Jitter: random variation to prevent thundering herd
 * - Type-safe: returns same type as wrapped function
 * - Configurable max attempts and error filtering
 */

/**
 * Default retry configuration
 */
const DEFAULT_OPTIONS = {
  maxAttempts: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  retryableErrors: undefined, // Retry all errors by default
} as const;

/**
 * Retry configuration options
 */
export interface RetryOptions {
  /**
   * Maximum number of attempts (including initial attempt)
   * @default 3
   */
  maxAttempts?: number;

  /**
   * Base delay in milliseconds for exponential backoff
   * @default 1000
   */
  baseDelay?: number;

  /**
   * Maximum delay in milliseconds (caps exponential growth)
   * @default 30000
   */
  maxDelay?: number;

  /**
   * Array of error constructors that should trigger retry
   * If undefined, all errors are retried
   * @example [NetworkError, TimeoutError]
   */
  retryableErrors?: Array<new (...args: any[]) => Error>;
}

/**
 * Calculate delay with exponential backoff and jitter
 *
 * Formula: min(baseDelay * 2^(attempt-1) + random jitter, maxDelay)
 *
 * @param attempt - Current attempt number (1-indexed)
 * @param baseDelay - Base delay in milliseconds
 * @param maxDelay - Maximum delay cap in milliseconds
 * @returns Delay in milliseconds
 */
function calculateDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number
): number {
  // Exponential backoff: baseDelay * 2^(attempt-1)
  const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);

  // Add jitter: random variation up to 25% of exponential delay
  // This prevents thundering herd problem when multiple processes retry simultaneously
  const jitter = Math.random() * exponentialDelay * 0.25;

  // Cap at maxDelay
  return Math.min(exponentialDelay + jitter, maxDelay);
}

/**
 * Check if error is retryable based on configured error types
 *
 * @param error - Error to check
 * @param retryableErrors - Array of error constructors to match against
 * @returns True if error should trigger retry
 */
function isRetryableError(
  error: unknown,
  retryableErrors?: Array<new (...args: any[]) => Error>
): boolean {
  // If no specific error types configured, retry all errors
  if (!retryableErrors || retryableErrors.length === 0) {
    return true;
  }

  // Check if error is an instance of any retryable error type
  return retryableErrors.some((ErrorType) => {
    return error instanceof ErrorType;
  });
}

/**
 * Retry an async function with exponential backoff and jitter
 *
 * @example
 * ```typescript
 * // Basic usage
 * const result = await retryWithOptions(() => fetchData());
 *
 * // Custom configuration
 * const result = await retryWithOptions(
 *   () => fetchData(),
 *   { maxAttempts: 5, baseDelay: 2000 }
 * );
 *
 * // Retry only specific errors
 * const result = await retryWithOptions(
 *   () => fetchData(),
 *   { retryableErrors: [NetworkError, TimeoutError] }
 * );
 * ```
 *
 * @param fn - Async function to retry
 * @param options - Retry configuration options
 * @returns Result of successful function execution
 * @throws Last error if all attempts fail
 */
export async function retryWithOptions<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      // Attempt the operation
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if this is the last attempt
      if (attempt >= opts.maxAttempts) {
        break;
      }

      // Check if error is retryable
      if (!isRetryableError(error, opts.retryableErrors)) {
        // Don't retry non-retryable errors
        throw error;
      }

      // Calculate delay and wait before next attempt
      const delay = calculateDelay(attempt, opts.baseDelay, opts.maxDelay);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // All attempts failed - throw the last error
  throw lastError;
}

/**
 * Convenience function for retrying with default options
 *
 * @example
 * ```typescript
 * const result = await retry(() => fetchData());
 * ```
 *
 * @param fn - Async function to retry
 * @returns Result of successful function execution
 */
export async function retry<T>(fn: () => Promise<T>): Promise<T> {
  return retryWithOptions(fn);
}
