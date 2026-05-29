/**
 * Promise timeout helper shared across fetchers.
 */

/** Race a promise against a timeout, invoking onTimeout (e.g. proc.kill) before rejecting. */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  onTimeout: () => void
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          onTimeout();
          reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
