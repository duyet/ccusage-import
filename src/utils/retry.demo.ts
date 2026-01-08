/**
 * Retry utility demonstration script
 *
 * Run with: bun run src/utils/retry.demo.ts
 */

import { retryWithOptions, retry } from './retry';

// Custom error types
class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// Demo 1: Basic retry
async function demoBasicRetry() {
  console.log('\n=== Demo 1: Basic Retry ===');

  let attempts = 0;
  const fetchWithRetry = async () => {
    attempts++;
    console.log(`Attempt ${attempts}...`);

    if (attempts < 3) {
      throw new Error('Temporary failure');
    }

    return 'Success!';
  };

  try {
    const result = await retry(fetchWithRetry);
    console.log(`Result: ${result}`);
    console.log(`Total attempts: ${attempts}`);
  } catch (error) {
    console.error(`Failed: ${(error as Error).message}`);
  }
}

// Demo 2: Exponential backoff visualization
async function demoExponentialBackoff() {
  console.log('\n=== Demo 2: Exponential Backoff ===');

  const delays: number[] = [];
  const originalSetTimeout = global.setTimeout;

  // Mock setTimeout to capture delays
  global.setTimeout = ((fn: Function, delay: number) => {
    delays.push(delay);
    console.log(`Waiting ${delay.toFixed(0)}ms before retry...`);
    return originalSetTimeout(fn, 0);
  }) as any;

  let attempts = 0;
  const fetchWithBackoff = async () => {
    attempts++;
    console.log(`Attempt ${attempts} at ${new Date().toISOString()}`);

    if (attempts < 5) {
      throw new Error('Network error');
    }

    return 'Success!';
  };

  try {
    await retryWithOptions(fetchWithBackoff, {
      maxAttempts: 5,
      baseDelay: 1000,
      maxDelay: 10000,
    });

    console.log('\nDelays captured:');
    delays.forEach((delay, i) => {
      console.log(`  ${i + 1}. ${delay.toFixed(0)}ms`);
    });
  } catch (error) {
    console.error(`Failed: ${(error as Error).message}`);
  }

  global.setTimeout = originalSetTimeout;
}

// Demo 3: Error filtering
async function demoErrorFiltering() {
  console.log('\n=== Demo 3: Error Filtering ===');

  let attempts = 0;
  const mixedErrors = async () => {
    attempts++;
    console.log(`Attempt ${attempts}...`);

    if (attempts === 1) {
      throw new NetworkError('Connection refused');
    } else if (attempts === 2) {
      throw new ValidationError('Invalid data format');
    }

    return 'Success!';
  };

  try {
    const result = await retryWithOptions(mixedErrors, {
      maxAttempts: 5,
      retryableErrors: [NetworkError], // Only retry NetworkError
    });

    console.log(`Result: ${result}`);
  } catch (error) {
    console.log(`Stopped on error: ${(error as Error).name}`);
    console.log(`Message: ${(error as Error).message}`);
    console.log(`Total attempts before stopping: ${attempts}`);
  }
}

// Demo 4: Real-world API simulation
async function demoApiSimulation() {
  console.log('\n=== Demo 4: Real-world API Simulation ===');

  const apiCall = async (endpoint: string) => {
    console.log(`Fetching ${endpoint}...`);

    // Simulate rate limiting
    const shouldRateLimit = Math.random() > 0.5;

    if (shouldRateLimit) {
      const error = new Error('Rate limit exceeded');
      (error as any).statusCode = 429;
      throw error;
    }

    return { data: 'API response', status: 200 };
  };

  try {
    const result = await retryWithOptions(
      () => apiCall('https://api.example.com/data'),
      {
        maxAttempts: 3,
        baseDelay: 1000,
      }
    );

    console.log('API call successful:', result);
  } catch (error) {
    console.error('API call failed after retries');
  }
}

// Demo 5: Type safety
async function demoTypeSafety() {
  console.log('\n=== Demo 5: Type Safety ===');

  interface User {
    id: number;
    name: string;
    email: string;
  }

  const fetchUser = async (id: number): Promise<User> => {
    console.log(`Fetching user ${id}...`);

    if (Math.random() > 0.5) {
      throw new Error('Network error');
    }

    return {
      id,
      name: 'John Doe',
      email: 'john@example.com',
    };
  };

  try {
    // TypeScript knows `user` is of type `User`
    const user: User = await retryWithOptions(() => fetchUser(123));

    console.log('User fetched:');
    console.log(`  ID: ${user.id}`);
    console.log(`  Name: ${user.name}`);
    console.log(`  Email: ${user.email}`);
  } catch (error) {
    console.error('Failed to fetch user');
  }
}

// Run all demos
async function main() {
  console.log('Retry Utility Demonstration');
  console.log('=============================\n');

  await demoBasicRetry();
  await demoExponentialBackoff();
  await demoErrorFiltering();
  await demoApiSimulation();
  await demoTypeSafety();

  console.log('\n=============================');
  console.log('Demos complete!');
}

main().catch(console.error);
