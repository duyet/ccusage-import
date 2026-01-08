/**
 * Test setup and fixtures
 */

// Global test configuration
export const testConfig = {
  // Mock ClickHouse connection
  clickhouse: {
    host: 'localhost',
    port: 8123,
    user: 'default',
    password: '',
    database: 'test_ccusage',
  },
  // Test machine name
  machineName: 'test-machine',
  // Privacy setting (disabled for testing predictability)
  hashProjects: false,
};

// Mock data for ccusage responses
export const mockCcusageData = {
  daily: {
    daily: [
      {
        date: '2025-01-05',
        inputTokens: 1000,
        outputTokens: 2000,
        cacheCreationTokens: 100,
        cacheReadTokens: 200,
        totalTokens: 3300,
        totalCost: 0.05,
        models: ['claude-3-5-sonnet'],
      },
    ],
  },
  monthly: {
    monthly: [
      {
        year: 2025,
        month: 1,
        inputTokens: 10000,
        outputTokens: 20000,
        cacheCreationTokens: 1000,
        cacheReadTokens: 2000,
        totalTokens: 33000,
        totalCost: 0.5,
        models: ['claude-3-5-sonnet', 'claude-3-haiku'],
      },
    ],
  },
  session: {
    sessions: [
      {
        sessionId: '/home/user/project',
        projectPath: '/home/user/project',
        inputTokens: 500,
        outputTokens: 1000,
        cacheCreationTokens: 50,
        cacheReadTokens: 100,
        totalTokens: 1650,
        totalCost: 0.025,
        lastActivity: '2025-01-05',
        modelsUsed: ['claude-3-5-sonnet'],
      },
    ],
  },
  blocks: {
    blocks: [
      {
        id: 'block-123',
        startTime: '2025-01-05T10:00:00.000Z',
        endTime: '2025-01-05T15:00:00.000Z',
        actualEndTime: null,
        isActive: true,
        isGap: false,
        entries: 5,
        tokenCounts: {
          inputTokens: 5000,
          outputTokens: 10000,
          cacheCreationInputTokens: 500,
          cacheReadInputTokens: 1000,
        },
        totalTokens: 16500,
        costUSD: 0.25,
        models: ['claude-3-5-sonnet'],
        usageLimitResetTime: '2025-01-05T16:00:00.000Z',
        burnRate: { costPerHour: 0.1 },
        projection: { totalCost: 0.5 },
      },
    ],
  },
  projects: {
    projects: [
      {
        date: '2025-01-05',
        projectPath: '/home/user/project',
        inputTokens: 500,
        outputTokens: 1000,
        cacheCreationTokens: 50,
        cacheReadTokens: 100,
        totalTokens: 1650,
        totalCost: 0.025,
        modelsUsed: ['claude-3-5-sonnet'],
      },
    ],
  },
};

// Mock OpenCode messages
export const mockOpenCodeMessages = [
  {
    role: 'user',
    content: 'Hello, how are you?',
    timestamp: '2025-01-05T10:00:00.000Z',
  },
  {
    role: 'assistant',
    content: 'I am doing well, thank you!',
    timestamp: '2025-01-05T10:00:05.000Z',
    model: 'claude-3-5-sonnet',
    tokens: {
      input: 10,
      output: 20,
      total: 30,
    },
  },
  {
    role: 'user',
    content: 'What is the weather?',
    timestamp: '2025-01-05T10:01:00.000Z',
  },
  {
    role: 'assistant',
    content: 'I do not have access to real-time weather data.',
    timestamp: '2025-01-05T10:01:05.000Z',
    model: 'claude-3-5-sonnet',
    tokens: {
      input: 8,
      output: 15,
      total: 23,
    },
  },
];

/**
 * Create a mock ClickHouse client for testing
 */
export class MockCHClient {
  private data: Map<string, Array<Record<string, unknown>>> = new Map();
  private connected = false;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async query<T>(sql: string): Promise<T[]> {
    // Simple mock implementation
    return [] as T[];
  }

  async insert(table: string, values: Array<Record<string, unknown>>): Promise<void> {
    if (!this.data.has(table)) {
      this.data.set(table, []);
    }
    this.data.get(table)!.push(...values);
  }

  async delete(table: string, conditions: Record<string, unknown>): Promise<void> {
    if (!this.data.has(table)) return;
    // In tests, we typically just clear the data
    this.data.set(table, []);
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  // Helper method to get inserted data for assertions
  getData(table: string): Array<Record<string, unknown>> {
    return this.data.get(table) ?? [];
  }

  clear(): void {
    this.data.clear();
  }
}
