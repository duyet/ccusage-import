# Retry Utility

Exponential backoff retry utility for async operations with configurable jitter and error filtering.

## Features

- **Exponential backoff**: Delay increases exponentially with each retry (baseDelay * 2^(attempt-1))
- **Jitter**: Random variation (up to 25%) to prevent thundering herd problem
- **Type-safe**: Fully typed with TypeScript generics
- **Configurable**: Customize max attempts, delays, and retryable error types
- **Error filtering**: Optionally retry only specific error types

## Installation

The utility is included in the ccusage-import project. Import from `@/utils/retry`:

```typescript
import { retryWithOptions, retry } from '@/utils/retry';
```

## Basic Usage

### Simple Retry

```typescript
import { retry } from '@/utils/retry';

const fetchData = async () => {
  const response = await fetch('https://api.example.com/data');
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
};

const data = await retry(fetchData);
// Retries up to 3 times with default configuration
```

### Custom Configuration

```typescript
import { retryWithOptions } from '@/utils/retry';

const data = await retryWithOptions(fetchData, {
  maxAttempts: 5,        // Maximum number of attempts
  baseDelay: 2000,       // Start with 2 second delay
  maxDelay: 30000,       // Cap at 30 seconds
});
```

### Error Filtering

```typescript
class NetworkError extends Error {}
class TimeoutError extends Error {}
class ValidationError extends Error {}

const data = await retryWithOptions(fetchData, {
  maxAttempts: 3,
  retryableErrors: [NetworkError, TimeoutError],
  // ValidationError will NOT be retried
});
```

## API Reference

### `retryWithOptions<T>(fn, options?)`

Retries an async function with exponential backoff and jitter.

**Parameters:**

- `fn: () => Promise<T>` - Async function to retry
- `options?: RetryOptions` - Optional configuration

**Returns:** `Promise<T>` - Result of successful function execution

**Throws:** Last error if all attempts fail

### `RetryOptions`

Configuration options for retry behavior.

```typescript
interface RetryOptions {
  maxAttempts?: number;     // Default: 3
  baseDelay?: number;       // Default: 1000 (1 second)
  maxDelay?: number;        // Default: 30000 (30 seconds)
  retryableErrors?: Array<new (...args: any[]) => Error>;
}
```

**Options:**

- `maxAttempts`: Maximum number of attempts (including initial attempt)
- `baseDelay`: Base delay in milliseconds for exponential backoff
- `maxDelay`: Maximum delay cap in milliseconds
- `retryableErrors`: Array of error constructors that should trigger retry. If undefined, all errors are retried.

### `retry<T>(fn)`

Convenience function that uses default retry options.

**Parameters:**

- `fn: () => Promise<T>` - Async function to retry

**Returns:** `Promise<T>` - Result of successful function execution

## How It Works

### Exponential Backoff Formula

```
delay = min(baseDelay * 2^(attempt-1) + jitter, maxDelay)
```

### Example Delay Sequence

With `baseDelay: 1000`:

- Attempt 1: No delay (first attempt)
- Attempt 2: ~1000ms + jitter (1000-1250ms)
- Attempt 3: ~2000ms + jitter (2000-2500ms)
- Attempt 4: ~4000ms + jitter (4000-5000ms)
- Attempt 5: ~8000ms + jitter (8000-10000ms)

### Jitter

Jitter adds random variation (up to 25%) to prevent the thundering herd problem when multiple processes retry simultaneously. This is especially important in distributed systems.

## Use Cases

### Network Requests

```typescript
const fetchWithRetry = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
};

const data = await retryWithOptions(fetchWithRetry, {
  maxAttempts: 3,
  baseDelay: 1000,
});
```

### Database Operations

```typescript
const queryWithRetry = async (sql: string) => {
  const result = await db.query(sql);
  return result;
};

const results = await retryWithOptions(
  () => queryWithRetry('SELECT * FROM users'),
  {
    maxAttempts: 5,
    baseDelay: 500,
    retryableErrors: [ConnectionError, TimeoutError],
  }
);
```

### File Operations

```typescript
import { readFile } from 'fs/promises';

const readConfig = async () => {
  const content = await readFile('/tmp/config.json', 'utf-8');
  return JSON.parse(content);
};

const config = await retryWithOptions(readConfig, {
  maxAttempts: 3,
  baseDelay: 100,
});
```

### Rate Limiting

When encountering rate limits (HTTP 429), exponential backoff is ideal:

```typescript
const fetchApi = async () => {
  const response = await fetch('https://api.example.com/data');
  if (response.status === 429) {
    throw new Error('Rate limited');
  }
  return response.json();
};

const data = await retryWithOptions(fetchApi, {
  maxAttempts: 5,
  baseDelay: 1000, // 1s, 2s, 4s, 8s delays
});
```

## Type Safety

The utility is fully type-safe with TypeScript generics:

```typescript
interface User {
  id: number;
  name: string;
}

const fetchUser = async (id: number): Promise<User> => {
  const response = await fetch(`/api/users/${id}`);
  return response.json();
};

// TypeScript knows `user` is of type `User`
const user: User = await retryWithOptions(() => fetchUser(123));
```

## Best Practices

1. **Set appropriate max attempts**: Balance between resilience and responsiveness
   - Network requests: 3-5 attempts
   - Database operations: 2-3 attempts
   - File operations: 2-3 attempts

2. **Choose base delay wisely**:
   - Fast operations: 100-500ms
   - Network requests: 1000-2000ms
   - Database operations: 500-1000ms

3. **Use error filtering**: Only retry transient errors
   - Retry: Network errors, timeouts, rate limits
   - Don't retry: Validation errors, authentication failures

4. **Consider max delay**: Prevent excessive wait times
   - User-facing operations: 5-10 seconds
   - Background jobs: 30-60 seconds
   - Critical operations: 2-5 minutes

## Testing

The utility includes comprehensive tests covering:

- Basic functionality
- Exponential backoff calculations
- Jitter randomness
- Error filtering
- Configuration options
- Edge cases
- Real-world scenarios

Run tests:

```bash
npm test -- tests/unit/retry.test.ts
```

## Implementation Details

- **Thread-safe**: Uses standard JavaScript Promises
- **Memory-efficient**: No leaky abstractions or closures
- **Error preservation**: Maintains original error stack trace
- **Zero dependencies**: Pure TypeScript implementation

## See Also

- [Python reference implementation](../../ccusage_importer/fetchers.py)
- [Example usage](./retry.example.ts)
- [Test suite](../../tests/unit/retry.test.ts)
