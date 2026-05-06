# TypeScript Migration Plan: ccusage-import

## Executive Summary

This document outlines the plan to refactor the ccusage-import project from Python to **Bun + TypeScript**. The migration aims to improve performance, maintainability, and developer experience while leveraging the TypeScript ecosystem.

---

## Technology Stack

### Core Runtime
- **Bun 1.2+**: Ultra-fast JavaScript runtime, package manager, and test runner
  - Native TypeScript support
  - 10-20x faster than Node.js for I/O operations
  - Built-in package manager and test runner

### Database Client
- **@clickhouse/client**: Official ClickHouse TypeScript client
  - Pure TypeScript implementation
  - Compatible with Bun runtime
  - Full type safety for queries

### Terminal UI Framework

After comprehensive research, the recommended framework is **Ink 5** (React for CLI):

#### Why Ink 5?
1. **Component-Based Architecture**: React paradigm for CLI apps
2. **Excellent TypeScript Support**: First-class TypeScript with full type inference
3. **Rich Ecosystem**: @inkjs/ui for pre-built components
4. **Proven in Production**: Used by major projects (Next.js, Gatsby, etc.)
5. **Flexbox Layout**: Yoga layout engine for complex terminal layouts
6. **Easy Testing**: ink-testing-library for component testing

#### Alternatives Considered
| Framework | Pros | Cons | Use Case |
|-----------|------|------|----------|
| **Ink 5** ✅ | React-based, great UX, flexible | Requires React knowledge | Modern CLI apps |
| neo-blessed | Full-screen TUIs, powerful | Complex API, unmaintained original | Complex dashboards |
| cliui | Lightweight, simple | Limited features | Basic CLIs |
| Commander.js | Great argument parsing | Not a UI framework | CLI argument parsing only |

### CLI Framework
- **Commander.js**: For argument parsing (de facto standard)
- **Ora**: For loading spinners (Ink-compatible)
- **Chalk**: For terminal colors (Ink-compatible)

### Additional Dependencies
```json
{
  "@clickhouse/client": "^1.x",
  "ink": "^5.x",
  "@inkjs/ui": "^2.x",
  "commander": "^12.x",
  "ora": "^8.x",
  "chalk": "^5.x",
  "dotenv": "^16.x",
  "zod": "^3.x"  // Runtime type validation
}
```

---

## Project Structure

```
ccusage-import/
├── package.json              # Bun package configuration
├── tsconfig.json             # TypeScript configuration
├── bun.lockb                 # Bun lock file
├── README.md                 # Updated for TypeScript
├── CLAUDE.md                 # Development guide
├── TYPESCRIPT_MIGRATION.md   # This document
│
├── src/
│   ├── index.ts              # CLI entry point
│   ├── cli/
│   │   ├── index.ts          # CLI setup with Commander
│   │   ├── commands.ts       # Command definitions
│   │   └── args.ts           # Argument parsing
│   │
│   ├── config/
│   │   ├── index.ts          # Configuration management
│   │   ├── env.ts            # Environment variable loading
│   │   └── types.ts          # Configuration types
│   │
│   ├── database/
│   │   ├── client.ts         # ClickHouse client wrapper
│   │   ├── queries.ts        # Query builders
│   │   └── schema.ts         # Schema type definitions
│   │
│   ├── fetchers/
│   │   ├── index.ts          # Export all fetchers
│   │   ├── ccusage.ts        # ccusage CLI data fetcher
│   │   ├── opencode.ts       # OpenCode data fetcher
│   │   └── retry.ts          # Retry logic utilities
│   │
│   ├── parsers/
│   │   ├── index.ts          # Export all parsers
│   │   ├── types.ts          # Data type definitions
│   │   ├── ccusage.ts        # ccusage data parser
│   │   ├── opencode.ts       # OpenCode message parser
│   │   └── aggregators.ts    # Data aggregation logic
│   │
│   ├── importers/
│   │   ├── index.ts          # Main importer orchestration
│   │   ├── daily.ts          # Daily data importer
│   │   ├── monthly.ts        # Monthly data importer
│   │   ├── session.ts        # Session data importer
│   │   ├── blocks.ts         # Blocks data importer
│   │   └── projects.ts       # Projects data importer
│   │
│   ├── ui/
│   │   ├── index.ts          # Export all UI components
│   │   ├── components/       # Ink components
│   │   │   ├── App.tsx       # Root Ink component
│   │   │   ├── Loading.tsx   # Loading animation
│   │   │   ├── Stats.tsx     # Statistics display
│   │   │   ├── Heatmap.tsx   # Usage heatmap
│   │   │   └── ProgressBar.tsx
│   │   ├── formatters/
│   │   │   ├── numbers.ts    # Number formatting
│   │   │   ├── duration.ts   # Duration formatting
│   │   │   └── tables.ts     # Table formatting
│   │   └── utils/
│   │       └── layout.ts     # Layout utilities
│   │
│   ├── analytics/
│   │   ├── index.ts          # Export analytics
│   │   ├── statistics.ts     # Statistics generation
│   │   └── rankings.ts       # Model rankings
│   │
│   └── utils/
│       ├── crypto.ts         # Hash functions
│       ├── date.ts           # Date utilities
│       └── logger.ts         # Logging utilities
│
├── tests/
│   ├── unit/                 # Unit tests
│   ├── integration/          # Integration tests
│   ├── fixtures/             # Test fixtures
│   └── setup.ts              # Test setup
│
└── scripts/
    ├── setup.ts              # Development setup
    └── migrate-data.ts       # Data migration utilities
```

---

## Migration Strategy

### Phase 1: Foundation (Week 1)
- [ ] Set up Bun project structure
- [ ] Configure TypeScript (strict mode, path aliases)
- [ ] Set up ClickHouse client with type-safe queries
- [ ] Create configuration management system
- [ ] Set up testing infrastructure (Bun test)

### Phase 2: Core Functionality (Week 2)
- [ ] Port data fetchers (ccusage + OpenCode)
- [ ] Port data parsers with Zod validation
- [ ] Implement data aggregators
- [ ] Create database layer with parameterized queries

### Phase 3: UI & CLI (Week 3)
- [ ] Implement Ink 5 UI components
- [ ] Create CLI interface with Commander
- [ ] Build statistics display
- [ ] Implement loading animations

### Phase 4: Testing & Polish (Week 4)
- [ ] Write comprehensive unit tests
- [ ] Add integration tests
- [ ] Performance benchmarks
- [ ] Update documentation

---

## Type Safety Strategy

### Zod Schemas for Runtime Validation

```typescript
import { z } from 'zod';

// ccusage daily data schema
export const DailyUsageSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  totalCost: z.number().nonnegative(),
  modelsUsed: z.array(z.string()),
  modelBreakdowns: z.array(ModelBreakdownSchema),
});

export type DailyUsage = z.infer<typeof DailyUsageSchema>;
```

### ClickHouse Query Types

```typescript
import type { ResultSet } from '@clickhouse/client';

interface DailyUsageRow {
  date: Date;
  machine_name: string;
  input_tokens: number;
  output_tokens: number;
  // ... other fields
}

async function getDailyUsage(): Promise<DailyUsageRow[]> {
  const result = await client.query({
    query: 'SELECT * FROM ccusage_usage_daily',
    format: 'JSONEachRow',
  });

  return result.json<DailyUsageRow>();
}
```

---

## Performance Optimizations

### 1. Parallel Data Fetching
```typescript
const results = await Promise.allSettled([
  fetchDailyData(),
  fetchMonthlyData(),
  fetchSessionData(),
  fetchBlocksData(),
  fetchProjectData(),
]);
```

### 2. Streaming for Large Datasets
```typescript
for await (const row of client.stream({
  query: 'SELECT * FROM large_table',
})) {
  processRow(row);
}
```

### 3. Batch Insertions
```typescript
await client.insert({
  table: 'ccusage_usage_daily',
  values: batch,
  format: 'JSONEachRow',
});
```

---

## Code Quality Tools

### Recommended Setup
```json
{
  "scripts": {
    "dev": "bun run src/index.ts",
    "build": "bun build src/index.ts --outdir ./dist",
    "test": "bun test",
    "test:coverage": "bun test --coverage",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write src/"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.x",
    "eslint": "^9.x",
    "eslint-config-prettier": "^9.x",
    "prettier": "^3.x"
  }
}
```

---

## Testing Strategy

### Unit Tests (Bun Test)
```typescript
import { describe, expect, test } from 'bun:test';

describe('NumberFormatter', () => {
  test('formats large numbers with suffixes', () => {
    const formatter = new NumberFormatter();
    expect(formatter.format(1_500_000)).toBe('1.5M');
  });
});
```

### Integration Tests
```typescript
test('imports ccusage data to ClickHouse', async () => {
  const importer = new ClickHouseImporter(testConfig);
  await importer.importDailyData(mockDailyData);

  const result = await importer.client.query(
    'SELECT count() FROM ccusage_usage_daily'
  );

  expect(result.rows).toBeGreaterThan(0);
});
```

---

## Migration Benefits

### Performance
- **10-20x faster I/O** with Bun vs Node.js
- **Faster startup time** (< 100ms vs 500ms+)
- **Lower memory footprint**

### Developer Experience
- **First-class TypeScript** with strict type checking
- **Hot reload** during development
- **Faster test runs** with Bun test
- **Better IDE support** with React/Ink components

### Maintainability
- **Component-based UI** with React/Ink
- **Type-safe database queries**
- **Modular architecture** with clear separation
- **Comprehensive test coverage**

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| ClickHouse client compatibility | Use official @clickhouse/client, test thoroughly |
| Ink 5 Bun compatibility | Verify Bun compatibility, use polyfills if needed |
| OpenCode message parsing | Port parser logic carefully, add extensive tests |
| Performance regression | Benchmark Python vs TypeScript, optimize bottlenecks |
| Breaking changes for users | Keep CLI interface identical, document migration |

---

## References

### Research Sources
- [Ink - React for CLI](https://github.com/vadimdemedes/ink)
- [ClickHouse JS Client](https://github.com/ClickHouse/clickhouse-js)
- [Bun 1.2 Release](https://cn.x-cmd.com/blog/250127/)
- [Awesome CLI Frameworks](https://github.com/shadawck/awesome-cli-frameworks)
- [Reddit: 2025 CLI Tools](https://www.reddit.com/r/javascript/comments/1ipe4dw/askjs_what_are_your_2025_gotos_for_building_cli/)

---

## Next Steps

1. **Review and approve** this migration plan
2. **Set up prototype** to verify technology choices
3. **Create detailed task breakdown** for each phase
4. **Begin Phase 1**: Foundation setup

**Estimated Timeline**: 4 weeks for complete migration
**Team Size**: 1-2 developers
**Risk Level**: Medium (well-established technologies)
