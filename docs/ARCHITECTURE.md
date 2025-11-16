# Architecture Documentation

## System Overview

```mermaid
graph TB
    subgraph "Data Sources"
        CLI[ccusage CLI]
    end

    subgraph "ccusage-import Application"
        FETCH[Data Fetcher<br/>Parallel Execution]
        PARSE[Data Parser<br/>Validation]
        IMPORT[Importer<br/>Transformation]
        CLIENT[ClickHouse Client<br/>Connection Pool]
    end

    subgraph "Storage"
        CH[(ClickHouse<br/>Database)]
    end

    subgraph "Monitoring"
        LOGS[Structured Logs<br/>loguru]
        METRICS[Metrics<br/>Prometheus]
    end

    CLI -->|JSON| FETCH
    FETCH -->|Raw Data| PARSE
    PARSE -->|Validated Models| IMPORT
    IMPORT -->|SQL| CLIENT
    CLIENT -->|Insert/Query| CH

    FETCH -.->|Logs| LOGS
    PARSE -.->|Logs| LOGS
    IMPORT -.->|Logs| LOGS
    CLIENT -.->|Metrics| METRICS

    style CLI fill:#e1f5ff
    style CH fill:#ffe1e1
    style LOGS fill:#fff4e1
    style METRICS fill:#e1ffe1
```

## Module Architecture

```mermaid
graph LR
    subgraph "Core Modules"
        CLI[cli.py<br/>Entry Point]
        CONFIG[config.py<br/>Configuration]
        CONST[constants.py<br/>Constants]
        EXC[exceptions.py<br/>Custom Errors]
        LOG[logger.py<br/>Logging Setup]
        MODELS[models.py<br/>Pydantic Validation]
    end

    subgraph "Business Logic"
        FETCHER[data_fetcher.py<br/>Command Execution]
        PARSER[data_parser.py<br/>Data Transform]
        CH_CLIENT[clickhouse_client.py<br/>DB Operations]
        IMPORTER[importer.py<br/>Import Logic]
    end

    subgraph "UI Layer"
        UI[ui.py<br/>Progress & Format]
    end

    CLI --> CONFIG
    CLI --> IMPORTER
    CLI --> LOG

    IMPORTER --> FETCHER
    IMPORTER --> PARSER
    IMPORTER --> CH_CLIENT
    IMPORTER --> UI

    FETCHER --> MODELS
    PARSER --> MODELS
    CH_CLIENT --> MODELS

    FETCHER --> EXC
    PARSER --> EXC
    CH_CLIENT --> EXC
    IMPORTER --> EXC

    CONFIG --> CONST
    FETCHER --> CONST
    PARSER --> CONST
    CH_CLIENT --> CONST

    style CLI fill:#b3d9ff
    style IMPORTER fill:#ffcccc
    style CH_CLIENT fill:#ccffcc
    style MODELS fill:#ffffcc
```

## Data Flow

```mermaid
sequenceDiagram
    participant User
    participant CLI
    participant Fetcher
    participant Validator
    participant Importer
    participant ClickHouse

    User->>CLI: Run Import
    CLI->>Fetcher: Fetch All Data (Parallel)

    par Daily Data
        Fetcher->>Fetcher: Execute ccusage daily
    and Monthly Data
        Fetcher->>Fetcher: Execute ccusage monthly
    and Session Data
        Fetcher->>Fetcher: Execute ccusage session
    and Blocks Data
        Fetcher->>Fetcher: Execute ccusage blocks
    and Projects Data
        Fetcher->>Fetcher: Execute ccusage projects
    end

    Fetcher->>Validator: Raw JSON Data
    Validator->>Validator: Validate with Pydantic
    Validator->>Importer: Validated Models

    Importer->>ClickHouse: Delete Existing Records
    Importer->>ClickHouse: Insert Daily Data
    Importer->>ClickHouse: Insert Monthly Data
    Importer->>ClickHouse: Insert Session Data
    Importer->>ClickHouse: Insert Block Data
    Importer->>ClickHouse: Insert Project Data

    ClickHouse->>Importer: Insert Confirmation
    Importer->>Importer: Generate Statistics
    Importer->>CLI: Return Stats
    CLI->>User: Display Results
```

## Error Handling Strategy

```mermaid
graph TD
    START[Operation Start]
    TRY[Try Operation]
    SUCCESS{Success?}
    RETRY{Retries<br/>Left?}
    BACKOFF[Exponential<br/>Backoff]
    LOG_ERROR[Log Error]
    RAISE[Raise Custom<br/>Exception]
    HANDLE[Handle in<br/>Caller]
    END[Operation End]

    START --> TRY
    TRY --> SUCCESS
    SUCCESS -->|Yes| END
    SUCCESS -->|No| RETRY
    RETRY -->|Yes| BACKOFF
    BACKOFF --> TRY
    RETRY -->|No| LOG_ERROR
    LOG_ERROR --> RAISE
    RAISE --> HANDLE
    HANDLE --> END

    style START fill:#e1f5ff
    style END fill:#e1ffe1
    style RAISE fill:#ffe1e1
    style LOG_ERROR fill:#fff4e1
```

## Component Responsibilities

### 1. CLI Layer (`cli.py`)
- **Purpose**: Command-line interface and application entry point
- **Responsibilities**:
  - Parse command-line arguments
  - Initialize logging
  - Orchestrate system check or import operation
  - Handle keyboard interrupts gracefully
- **Dependencies**: All other modules

### 2. Configuration (`config.py`)
- **Purpose**: Centralized configuration management
- **Responsibilities**:
  - Load environment variables
  - Provide configuration constants
  - Handle machine identification
  - Manage project privacy settings
- **Dependencies**: `constants.py`

### 3. Constants (`constants.py`)
- **Purpose**: Single source of truth for all magic values
- **Responsibilities**:
  - Define table names
  - Define timeouts and limits
  - Define format strings
  - Define enum-like values
- **Dependencies**: None

### 4. Exceptions (`exceptions.py`)
- **Purpose**: Custom exception hierarchy
- **Responsibilities**:
  - Provide specific exception types
  - Enable fine-grained error handling
  - Improve error messages
- **Dependencies**: None

### 5. Logger (`logger.py`)
- **Purpose**: Structured logging configuration
- **Responsibilities**:
  - Configure loguru
  - Provide logger instances
  - Handle log rotation and retention
  - Support JSON serialization
- **Dependencies**: `constants.py`

### 6. Models (`models.py`)
- **Purpose**: Data validation with Pydantic
- **Responsibilities**:
  - Define data structures
  - Validate input data
  - Provide type safety
  - Enable automatic documentation
- **Dependencies**: None

### 7. Data Fetcher (`data_fetcher.py`)
- **Purpose**: Execute ccusage commands
- **Responsibilities**:
  - Detect package manager (bunx/npx)
  - Execute ccusage commands in parallel
  - Handle timeouts and retries
  - Parse JSON responses
- **Dependencies**: `ui.py`, `constants.py`, `exceptions.py`

### 8. Data Parser (`data_parser.py`)
- **Purpose**: Transform data types
- **Responsibilities**:
  - Parse dates and datetimes
  - Extract complex nested values
  - Handle optional fields
- **Dependencies**: None

### 9. ClickHouse Client (`clickhouse_client.py`)
- **Purpose**: Database operations
- **Responsibilities**:
  - Manage database connections
  - Execute queries safely
  - Handle table creation
  - Generate statistics
  - Track import history
- **Dependencies**: `config.py`, `constants.py`, `exceptions.py`, `models.py`

### 10. Importer (`importer.py`)
- **Purpose**: Core import logic
- **Responsibilities**:
  - Coordinate data fetching
  - Transform data for database
  - Execute upsert operations
  - Generate and display statistics
  - Handle comparison with previous imports
- **Dependencies**: All modules

### 11. UI (`ui.py`)
- **Purpose**: User interface utilities
- **Responsibilities**:
  - Provide loading animations
  - Format numbers and durations
  - Display progress
  - Create consistent output
- **Dependencies**: None

## Design Patterns

### 1. Repository Pattern
**Location**: `clickhouse_client.py`

Abstracts database operations, making it easy to:
- Test with mocks
- Swap database implementations
- Centralize query logic

### 2. Dependency Injection
**Location**: Throughout codebase

Dependencies are passed as parameters:
- Improves testability
- Reduces coupling
- Makes dependencies explicit

### 3. Strategy Pattern
**Location**: `data_fetcher.py`

Different package managers (bunx, npx) are strategies:
- Runtime selection
- Easy to add new package managers
- Consistent interface

### 4. Template Method
**Location**: `importer.py`

Common import flow with specific steps:
- Fetch data
- Validate data
- Transform data
- Insert data
- Generate statistics

### 5. Builder Pattern
**Location**: `models.py`

Pydantic models act as builders:
- Step-by-step construction
- Validation at each step
- Immutable once built

## Security Considerations

### 1. SQL Injection Prevention
- ✅ Use parameterized queries
- ✅ Validate all input with Pydantic
- ✅ Sanitize table/column names
- ✅ Use allowlists for identifiers

### 2. Secrets Management
- ✅ Environment variables for credentials
- ✅ No secrets in code
- ✅ .env file in .gitignore
- ✅ Validate secrets on startup

### 3. Input Validation
- ✅ Pydantic models for all external data
- ✅ Type checking with mypy
- ✅ Range validation for numbers
- ✅ Format validation for strings

### 4. Error Handling
- ✅ Never expose stack traces to users
- ✅ Log full details server-side
- ✅ Return sanitized error messages
- ✅ Use custom exception types

## Performance Optimizations

### 1. Parallel Data Fetching
- Execute ccusage commands concurrently
- ThreadPoolExecutor with 3 workers
- Reduces total time by ~60%

### 2. Batch Operations
- Bulk inserts instead of row-by-row
- Delete operations use IN clause
- Reduces database round-trips

### 3. Connection Pooling
- Reuse database connections
- Reduce connection overhead
- Improve throughput

### 4. Lazy Loading
- Load configuration only when needed
- Parse data incrementally
- Stream large datasets

## Testing Strategy

### 1. Unit Tests
- Test each module in isolation
- Mock external dependencies
- Focus on business logic

### 2. Integration Tests
- Test module interactions
- Use real ClickHouse with testcontainers
- Verify end-to-end flows

### 3. Property-Based Tests
- Use Hypothesis for data generation
- Test invariants and properties
- Catch edge cases automatically

### 4. Performance Tests
- Benchmark critical paths
- Track performance regressions
- Ensure acceptable latency

## Monitoring & Observability

### 1. Structured Logging
- JSON logs for machine parsing
- Contextual information
- Log levels for filtering
- Centralized log aggregation

### 2. Metrics
- Import duration
- Record counts
- Error rates
- Resource usage

### 3. Health Checks
- Database connectivity
- Command availability
- System resources

### 4. Alerting
- Failed imports
- Performance degradation
- Resource exhaustion

## Future Enhancements

### 1. Async Operations
- Use asyncio for I/O operations
- Improve concurrency
- Better resource utilization

### 2. Caching Layer
- Cache frequently accessed data
- Reduce database load
- Improve response times

### 3. Plugin System
- Custom data transformers
- Custom exporters
- Extensible architecture

### 4. Web Dashboard
- Real-time visualization
- Interactive queries
- Export functionality

### 5. Incremental Imports
- Track last import timestamp
- Only fetch new data
- Reduce processing time

## Deployment Considerations

### 1. Environment Setup
- Use Docker for consistency
- Provide docker-compose.yml
- Document all dependencies

### 2. Configuration Management
- Environment-specific configs
- Secrets in environment variables
- Validation on startup

### 3. Monitoring
- Centralized logging
- Metrics collection
- Health check endpoints

### 4. Scaling
- Horizontal scaling possible
- Stateless design
- Shared database

## Development Workflow

```mermaid
graph LR
    DEV[Developer]
    CODE[Write Code]
    PRECOMMIT[Pre-commit<br/>Hooks]
    TESTS[Run Tests]
    PR[Create PR]
    CI[GitHub Actions]
    REVIEW[Code Review]
    MERGE[Merge]
    RELEASE[Release]

    DEV --> CODE
    CODE --> PRECOMMIT
    PRECOMMIT -->|Pass| TESTS
    PRECOMMIT -->|Fail| CODE
    TESTS -->|Pass| PR
    TESTS -->|Fail| CODE
    PR --> CI
    CI -->|Pass| REVIEW
    CI -->|Fail| CODE
    REVIEW -->|Approved| MERGE
    REVIEW -->|Changes| CODE
    MERGE --> RELEASE

    style PRECOMMIT fill:#ffffcc
    style CI fill:#ccffcc
    style REVIEW fill:#ffcccc
    style RELEASE fill:#ccccff
```

## Conclusion

This architecture prioritizes:
- **Modularity**: Each component has a single responsibility
- **Testability**: Easy to test in isolation
- **Maintainability**: Clear structure and documentation
- **Security**: Multiple layers of protection
- **Performance**: Optimized for speed
- **Observability**: Easy to monitor and debug

The design enables rapid development while maintaining high quality and reliability.
