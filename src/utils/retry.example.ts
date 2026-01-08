/**
 * Retry utility usage examples
 *
 * This file demonstrates common patterns for using the retry utility
 */

import { retryWithOptions, retry } from './retry';

// Example 1: Basic retry with default options
async function basicExample() {
  const fetchData = async () => {
    const response = await fetch('https://api.example.com/data');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  };

  try {
    const data = await retry(fetchData);
    console.log('Success:', data);
  } catch (error) {
    console.error('Failed after all retries:', error);
  }
}

// Example 2: Custom retry configuration
async function customConfigExample() {
  const fetchWithTimeout = async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch('https://api.example.com/slow', {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  };

  const data = await retryWithOptions(fetchWithTimeout, {
    maxAttempts: 5,
    baseDelay: 2000, // Start with 2 second delay
    maxDelay: 30000, // Cap at 30 seconds
  });

  console.log('Data fetched:', data);
}

// Example 3: Retry only specific error types
class NetworkError extends Error {}
class TimeoutError extends Error {}
class ValidationError extends Error {}

async function filteredRetryExample() {
  const validateAndFetch = async () => {
    // This won't retry on ValidationError
    const data = await fetch('https://api.example.com/data');
    const json = await response.json();

    if (!json.id) {
      throw new ValidationError('Missing required field: id');
    }

    return json;
  };

  try {
    const data = await retryWithOptions(validateAndFetch, {
      maxAttempts: 3,
      retryableErrors: [NetworkError, TimeoutError],
    });
    console.log('Data validated:', data);
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error('Validation failed (not retried):', error.message);
    } else {
      console.error('Other error:', error);
    }
  }
}

// Example 4: Type-safe retry with generics
interface User {
  id: number;
  name: string;
  email: string;
}

async function typedRetryExample() {
  const fetchUser = async (userId: number): Promise<User> => {
    const response = await fetch(`https://api.example.com/users/${userId}`);
    if (!response.ok) {
      throw new Error(`User ${userId} not found`);
    }
    return response.json();
  };

  // TypeScript knows the return type is User
  const user: User = await retryWithOptions(() => fetchUser(123), {
    maxAttempts: 3,
  });

  console.log('User:', user.name, user.email);
}

// Example 5: Retry with exponential backoff visualization
async function visualizeBackoffExample() {
  let attempt = 0;
  const fetchWithLogging = async () => {
    attempt++;
    console.log(`Attempt ${attempt} at ${new Date().toISOString()}`);

    const response = await fetch('https://api.example.com/unreliable');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  };

  try {
    await retryWithOptions(fetchWithLogging, {
      maxAttempts: 5,
      baseDelay: 1000, // 1 second
    });
  } catch (error) {
    console.log('All attempts failed');
  }
  // Output will show increasing delays between attempts:
  // Attempt 1 at 2024-01-01T00:00:00.000Z
  // Attempt 2 at 2024-01-01T00:00:01.123Z  (~1s delay + jitter)
  // Attempt 3 at 2024-01-01T00:00:03.234Z  (~2s delay + jitter)
  // Attempt 4 at 2024-01-01T00:00:07.456Z  (~4s delay + jitter)
  // Attempt 5 at 2024-01-01T00:00:13.567Z  (~8s delay + jitter)
}

// Example 6: Retry database operations
async function databaseRetryExample() {
  interface DatabaseConnection {
    query(sql: string): Promise<any[]>;
    close(): void;
  }

  const executeQuery = async (sql: string): Promise<any[]> => {
    const connection: DatabaseConnection = await connectToDatabase();

    try {
      return await connection.query(sql);
    } finally {
      connection.close();
    }
  };

  const results = await retryWithOptions(
    () => executeQuery('SELECT * FROM users WHERE active = true'),
    {
      maxAttempts: 3,
      baseDelay: 500, // Quick retry for database operations
    }
  );

  console.log(`Found ${results.length} active users`);
}

// Example 7: Retry file operations
import { readFile } from 'fs/promises';

async function fileOperationRetryExample() {
  const readConfig = async (): Promise<object> => {
    try {
      const content = await readFile('/tmp/config.json', 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      // File might be locked by another process
      throw new Error('Failed to read config file');
    }
  };

  const config = await retryWithOptions(readConfig, {
    maxAttempts: 3,
    baseDelay: 100, // Short delay for file operations
  });

  console.log('Config loaded:', config);
}

// Example 8: Combining retry with timeout
async function retryWithTimeoutExample() {
  const fetchWithTimeout = async (
    url: string,
    timeoutMs: number
  ): Promise<Response> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  };

  // Retry with per-attempt timeout
  const data = await retryWithOptions(
    () => fetchWithTimeout('https://api.example.com/slow', 5000),
    {
      maxAttempts: 3,
      baseDelay: 1000,
    }
  );

  console.log('Data fetched with retry and timeout:', await data.json());
}

// Helper function for examples
async function connectToDatabase(): Promise<any> {
  // Mock database connection
  return {
    query: async () => [],
    close: () => {},
  };
}
