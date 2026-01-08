/**
 * Retry utility tests
 */

import { describe, it, expect, mock } from 'bun:test';
import { retryWithOptions, retry } from '../../src/utils/retry';

// Custom error types for testing
class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

describe('retryWithOptions', () => {
  describe('basic functionality', () => {
    it('should succeed on first attempt', async () => {
      const fn = mock(() => Promise.resolve('success'));
      const result = await retryWithOptions(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      let attempts = 0;
      const fn = mock(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error('Temporary failure'));
        }
        return Promise.resolve('success');
      });

      const result = await retryWithOptions(fn, { maxAttempts: 5 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw after max attempts', async () => {
      const fn = mock(() => Promise.reject(new Error('Permanent failure')));

      await expect(retryWithOptions(fn, { maxAttempts: 3 })).rejects.toThrow(
        'Permanent failure'
      );
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should preserve return type', async () => {
      interface TestData {
        id: number;
        name: string;
      }

      const fn = mock(() =>
        Promise.resolve<TestData>({ id: 1, name: 'test' })
      );

      const result = await retryWithOptions(fn);

      expect(result).toEqual({ id: 1, name: 'test' });
      // Type assertion: TypeScript infers result as TestData
      const typeCheck: TestData = result;
      expect(typeCheck).toBeDefined();
    });
  });

  describe('exponential backoff', () => {
    it('should use exponential backoff delays', async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;

      // Mock setTimeout to capture delays
      global.setTimeout = mock((fn: Function, delay: number) => {
        delays.push(delay);
        return originalSetTimeout(fn, 0); // Execute immediately
      }) as any;

      let attempts = 0;
      const fn = mock(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error('fail'));
        }
        return Promise.resolve('success');
      });

      await retryWithOptions(fn, {
        maxAttempts: 5,
        baseDelay: 100,
        maxDelay: 10000,
      });

      // Should have 2 delays (after attempt 1 and 2)
      expect(delays.length).toBe(2);

      // First delay: ~100ms (baseDelay * 2^0 + jitter)
      expect(delays[0]).toBeGreaterThan(100);
      expect(delays[0]).toBeLessThan(125); // 100 + 25% jitter

      // Second delay: ~200ms (baseDelay * 2^1 + jitter)
      expect(delays[1]).toBeGreaterThan(200);
      expect(delays[1]).toBeLessThan(250); // 200 + 25% jitter

      // Restore original setTimeout
      global.setTimeout = originalSetTimeout;
    });

    it('should cap delay at maxDelay', async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;

      global.setTimeout = mock((fn: Function, delay: number) => {
        delays.push(delay);
        return originalSetTimeout(fn, 0);
      }) as any;

      let attempts = 0;
      const fn = mock(() => {
        attempts++;
        if (attempts < 5) {
          return Promise.reject(new Error('fail'));
        }
        return Promise.resolve('success');
      });

      await retryWithOptions(fn, {
        maxAttempts: 6,
        baseDelay: 1000,
        maxDelay: 2000,
      });

      // All delays should be capped at maxDelay
      for (const delay of delays) {
        expect(delay).toBeLessThanOrEqual(2000);
      }

      global.setTimeout = originalSetTimeout;
    });
  });

  describe('jitter', () => {
    it('should add random jitter to delays', async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;

      global.setTimeout = mock((fn: Function, delay: number) => {
        delays.push(delay);
        return originalSetTimeout(fn, 0);
      }) as any;

      const fn = mock(() => Promise.reject(new Error('fail')));

      try {
        await retryWithOptions(fn, {
          maxAttempts: 4,
          baseDelay: 100,
        });
      } catch {
        // Expected to fail
      }

      // Check that delays vary (jitter is working)
      const baseDelay = 100;
      const firstDelayExpected = baseDelay * Math.pow(2, 0); // 100
      const secondDelayExpected = baseDelay * Math.pow(2, 1); // 200

      // Delays should be within expected range with jitter
      expect(delays[0]).toBeGreaterThan(firstDelayExpected);
      expect(delays[0]).toBeLessThan(firstDelayExpected * 1.25);

      expect(delays[1]).toBeGreaterThan(secondDelayExpected);
      expect(delays[1]).toBeLessThan(secondDelayExpected * 1.25);

      global.setTimeout = originalSetTimeout;
    });
  });

  describe('error filtering', () => {
    it('should retry all errors when no filter specified', async () => {
      let attempts = 0;
      const fn = mock(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new NetworkError('Network error'));
        }
        return Promise.resolve('success');
      });

      const result = await retryWithOptions(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should retry only specified error types', async () => {
      let attempts = 0;
      const fn = mock(() => {
        attempts++;
        if (attempts === 1) {
          return Promise.reject(new NetworkError('Network error'));
        }
        return Promise.resolve('success');
      });

      const result = await retryWithOptions(fn, {
        maxAttempts: 5,
        retryableErrors: [NetworkError],
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should not retry non-retryable errors', async () => {
      const fn = mock(() =>
        Promise.reject(new ValidationError('Invalid data'))
      );

      await expect(
        retryWithOptions(fn, {
          maxAttempts: 5,
          retryableErrors: [NetworkError, TimeoutError],
        })
      ).rejects.toThrow('Invalid data');

      // Should fail immediately without retries
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should handle mixed error types', async () => {
      let attempts = 0;
      const fn = mock(() => {
        attempts++;
        if (attempts === 1) {
          return Promise.reject(new NetworkError('Network error'));
        } else if (attempts === 2) {
          return Promise.reject(new TimeoutError('Timeout'));
        }
        return Promise.resolve('success');
      });

      const result = await retryWithOptions(fn, {
        maxAttempts: 5,
        retryableErrors: [NetworkError, TimeoutError],
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should stop retrying on non-retryable error after retryable ones', async () => {
      let attempts = 0;
      const fn = mock(() => {
        attempts++;
        if (attempts === 1) {
          return Promise.reject(new NetworkError('Network error'));
        } else if (attempts === 2) {
          return Promise.reject(new ValidationError('Invalid data'));
        }
        return Promise.resolve('success');
      });

      await expect(
        retryWithOptions(fn, {
          maxAttempts: 5,
          retryableErrors: [NetworkError],
        })
      ).rejects.toThrow('Invalid data');

      // Should retry NetworkError but fail immediately on ValidationError
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('configuration options', () => {
    it('should use default options when not specified', async () => {
      const fn = mock(() => Promise.resolve('success'));
      const result = await retryWithOptions(fn);

      expect(result).toBe('success');
    });

    it('should respect custom maxAttempts', async () => {
      const fn = mock(() => Promise.reject(new Error('fail')));

      await expect(
        retryWithOptions(fn, { maxAttempts: 2 })
      ).rejects.toThrow();

      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should respect custom baseDelay', async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;

      global.setTimeout = mock((fn: Function, delay: number) => {
        delays.push(delay);
        return originalSetTimeout(fn, 0);
      }) as any;

      const fn = mock(() => Promise.reject(new Error('fail')));

      try {
        await retryWithOptions(fn, {
          maxAttempts: 3,
          baseDelay: 500,
        });
      } catch {
        // Expected
      }

      expect(delays[0]).toBeGreaterThan(500);
      expect(delays[0]).toBeLessThan(625); // 500 + 25% jitter

      global.setTimeout = originalSetTimeout;
    });
  });

  describe('edge cases', () => {
    it('should handle maxAttempts of 1', async () => {
      const fn = mock(() => Promise.reject(new Error('fail')));

      await expect(retryWithOptions(fn, { maxAttempts: 1 })).rejects.toThrow(
        'fail'
      );

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should handle zero baseDelay', async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;

      global.setTimeout = mock((fn: Function, delay: number) => {
        delays.push(delay);
        return originalSetTimeout(fn, 0);
      }) as any;

      const fn = mock(() => Promise.reject(new Error('fail')));

      try {
        await retryWithOptions(fn, {
          maxAttempts: 2,
          baseDelay: 0,
        });
      } catch {
        // Expected
      }

      // Should still have delay (just jitter component)
      expect(delays.length).toBe(1);

      global.setTimeout = originalSetTimeout;
    });

    it('should preserve error stack trace', async () => {
      const originalError = new Error('Original error');
      const fn = mock(() => Promise.reject(originalError));

      try {
        await retryWithOptions(fn, { maxAttempts: 2 });
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect((error as Error).message).toBe('Original error');
        expect((error as Error).stack).toContain('retry.test.ts');
      }
    });

    it('should handle synchronous errors in async function', async () => {
      const fn = mock(() => {
        throw new Error('Sync error');
      });

      await expect(retryWithOptions(fn, { maxAttempts: 2 })).rejects.toThrow(
        'Sync error'
      );
    });
  });
});

describe('retry (convenience function)', () => {
  it('should use default options', async () => {
    const fn = mock(() => Promise.resolve('success'));
    const result = await retry(fn);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry with default configuration', async () => {
    let attempts = 0;
    const fn = mock(() => {
      attempts++;
      if (attempts < 3) {
        return Promise.reject(new Error('fail'));
      }
      return Promise.resolve('success');
    });

    const result = await retry(fn);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should throw after default max attempts', async () => {
    const fn = mock(() => Promise.reject(new Error('fail')));

    await expect(retry(fn)).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(3); // Default maxAttempts
  });
});

describe('real-world scenarios', () => {
  it('should simulate network request retry', async () => {
    const mockFetch = mock((url: string) => {
      return Promise.reject(new NetworkError('Connection refused'));
    });

    try {
      await retryWithOptions(
        () => mockFetch('https://api.example.com/data'),
        {
          maxAttempts: 3,
          baseDelay: 100,
          retryableErrors: [NetworkError],
        }
      );
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(NetworkError);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    }
  });

  it('should simulate database connection retry', async () => {
    let attempts = 0;
    const mockConnect = mock((_connectionString: string) => {
      attempts++;
      if (attempts < 2) {
        return Promise.reject(new TimeoutError('Connection timeout'));
      }
      return Promise.resolve({ connected: true });
    });

    const result = await retryWithOptions(
      () => mockConnect('postgresql://localhost'),
      {
        maxAttempts: 5,
        baseDelay: 1000,
        retryableErrors: [TimeoutError],
      }
    );

    expect(result).toEqual({ connected: true });
    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  it('should simulate API rate limiting with exponential backoff', async () => {
    const delays: number[] = [];
    const originalSetTimeout = global.setTimeout;

    global.setTimeout = mock((fn: Function, delay: number) => {
      delays.push(delay);
      return originalSetTimeout(fn, 0);
    }) as any;

    let attempts = 0;
    const mockApiCall = mock(() => {
      attempts++;
      if (attempts < 4) {
        const error = new Error('Rate limit exceeded');
        (error as any).statusCode = 429;
        return Promise.reject(error);
      }
      return Promise.resolve({ data: 'success' });
    });

    const result = await retryWithOptions(() => mockApiCall(), {
      maxAttempts: 5,
      baseDelay: 1000,
    });

    expect(result).toEqual({ data: 'success' });
    expect(mockApiCall).toHaveBeenCalledTimes(4);

    // Verify exponential backoff: 1s, 2s, 4s (approximately)
    expect(delays[0]).toBeGreaterThan(1000);
    expect(delays[1]).toBeGreaterThan(2000);
    expect(delays[2]).toBeGreaterThan(4000);

    global.setTimeout = originalSetTimeout;
  });
});
