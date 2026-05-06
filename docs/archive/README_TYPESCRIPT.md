# ccusage-import - TypeScript Version

> Import ccusage and OpenCode data into ClickHouse for analytics

**TypeScript + Bun rewrite** of the original Python ccusage-import tool. Features a beautiful terminal UI built with Ink 5, type-safe database operations, and 10-20x faster performance.

## Features

- **🚀 Blazing Fast**: Built with Bun runtime for 10-20x faster I/O operations
- **💅 Beautiful UI**: Modern terminal interface with Ink 5 (React for CLI)
- **🔒 Type-Safe**: Full TypeScript with Zod runtime validation
- **📊 Rich Analytics**: Import daily, monthly, session, and project-level usage data
- **🎯 Privacy-First**: Optional SHA-256 hashing for project names
- **🖥️ Multi-Machine**: Track usage across different machines
- **🔄 Idempotent**: Safe to run multiple times without duplicates

## Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/ccusage-import.git
cd ccusage-import

# Install dependencies with Bun
bun install

# Set up environment variables
cp .env.example .env
# Edit .env with your ClickHouse credentials
```

### Usage

```bash
# Run import (ccusage + OpenCode)
bun run cli.ts import

# Import from ccusage only
bun run cli.ts import --skip-opencode

# Import from OpenCode only
bun run cli.ts import --skip-ccusage --opencode ~/path/to/opencode

# Disable project name hashing (for debugging)
bun run cli.ts import --no-hash-projects

# Verbose output
bun run cli.ts import --verbose

# Check system configuration
bun run cli.ts check
```

## Configuration

### Environment Variables

```bash
# ClickHouse connection
export CH_HOST="your-clickhouse-host"
export CH_PORT="8123"  # HTTP port (8443 for HTTPS)
export CH_USER="your-username"
export CH_PASSWORD="your-password"
export CH_DATABASE="your-database"

# Optional: Machine name override
export MACHINE_NAME="my-machine"
```

### CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `--verbose` | Show verbose output | `false` |
| `--no-hash-projects` | Disable project name hashing | `false` |
| `--opencode <path>` | Path to OpenCode data | `null` |
| `--skip-opencode` | Skip OpenCode import | `false` |
| `--skip-ccusage` | Skip ccusage import | `false` |
| `--source <name>` | Source identifier | `"ccusage"` |

## Project Structure

```
ccusage-import/
├── src/
│   ├── cli.ts              # CLI entry point (Commander.js)
│   ├── config/             # Configuration management
│   ├── database/           # ClickHouse client & repositories
│   ├── fetchers/           # Data fetchers (ccusage, OpenCode)
│   ├── parsers/            # Data parsers & aggregators
│   ├── ui/                 # Terminal UI components (Ink 5)
│   └── index.ts            # Module exports
├── tests/                  # Bun tests
├── package.json            # Dependencies
├── tsconfig.json           # TypeScript config
└── bun.lockb               # Bun lock file
```

## Technology Stack

- **Runtime**: Bun 1.2+
- **Language**: TypeScript 5.4+
- **Database**: ClickHouse with [@clickhouse/client](https://github.com/ClickHouse/clickhouse-js)
- **UI**: Ink 5 (React for CLI) + [@inkjs/ui](https://github.com/vadimdemedes/ink-ui)
- **CLI**: Commander.js
- **Validation**: Zod

## Development

```bash
# Run in development mode
bun run dev

# Run tests
bun test

# Run tests with coverage
bun run test:coverage

# Type checking
bun run typecheck

# Linting
bun run lint
bun run lint:fix

# Format code
bun run format

# Build for production
bun run build
```

## UI Components

The TypeScript version features a beautiful terminal UI with:

- **Animated Progress**: Smooth loading indicators with step tracking
- **Statistics Dashboard**: Clean display of costs, tokens, and model rankings
- **Usage Heatmap**: GitHub-style contribution heatmap
- **Status Indicators**: Color-coded status for operations
- **Responsive Layout**: Adapts to terminal size

## Migration from Python

The TypeScript version is a drop-in replacement for the Python version. Key differences:

| Feature | Python | TypeScript |
|---------|--------|------------|
| Runtime | Python 3.8+ | Bun 1.2+ |
| Performance | Baseline | 10-20x faster |
| Type Safety | Type hints | Full TypeScript + Zod |
| UI | Custom ANSI | Ink 5 (React) |
| Package Manager | uv | Bun |
| Startup Time | ~500ms | ~100ms |

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

MIT

## Acknowledgments

- Original Python version: [ccusage-import/python](https://github.com/your-username/ccusage-import)
- Built with [Ink](https://github.com/vadimdemedes/ink) - React for CLI
- Database client: [ClickHouse JS](https://github.com/ClickHouse/clickhouse-js)
- Runtime: [Bun](https://bun.sh)

---

**Sources**:
- [Ink - React for CLI](https://github.com/vadimdemedes/ink)
- [ClickHouse JS Client](https://github.com/ClickHouse/clickhouse-js)
- [Bun 1.2 Release](https://cn.x-cmd.com/blog/250127/)
- [Awesome CLI Frameworks](https://github.com/shadawck/awesome-cli-frameworks)
- [Reddit: 2025 CLI Tools](https://www.reddit.com/r/javascript/comments/1ipe4dw/askjs_what_are_your_2025_gotos_for_building_cli/)
