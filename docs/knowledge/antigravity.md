# Antigravity CLI Integration

This document details the integration of Antigravity CLI (`agy`) token consumption data into the `ccusage-import` pipeline.

## Overview

The Antigravity CLI stores conversation history and token metrics locally under `~/.gemini/antigravity-cli/`:
1. **SQLite Databases (`.db`)**: Conversations since June 1, 2026. These store raw Protobuf data inside a SQLite table named `gen_metadata` which contains exact token counts, timestamps, and model names.
2. **Protobuf Files (`.pb`)**: Encrypted older conversations (May 20 to May 28, 2026).
3. **Implicit Subagents (`implicit/*.pb`)**: Background tasks/subagents whose usage is estimated based on their Protobuf file size.
4. **History Log (`history.jsonl`)**: User-visible prompt history used to map conversation IDs to project paths and estimate older encrypted logs.

## Pipeline Integration

We implemented `AntigravitySource` at [src/sources/antigravity.ts](file:///Users/duet/project/ccusage-import/src/sources/antigravity.ts) and registered it inside [src/scripts/import-all.ts](file:///Users/duet/project/ccusage-import/src/scripts/import-all.ts).

### 1. Protobuf Decoding Schema
Exact SQLite conversations store binary blobs in SQLite `gen_metadata.data`. We decode these blobs using a custom low-level Protobuf parser (`decodeProto`) that reads wire tags:
- **Tokens**: Located at `Field 1` -> `Field 4`.
  - `Field 2`: New Prompt/Input tokens
  - `Field 3`: Completion/Output tokens
  - `Field 5`: Cached Prompt/Input tokens
- **Model**: Located at `Field 1` -> `Field 19` (or fallback to `Field 21`).
- **Timestamp**: Located at `Field 1` -> `Field 9` -> `Field 4` -> `Field 1` (seconds) and `Field 2` (nanoseconds).

### 2. Estimation Model (Encrypted & Implicit)
- **Older Conversations**: Key-stretching attempts on encrypted `.pb` files are bypassed by correlating `history.jsonl` prompts to database actuals. From actuals, we derived the following averages per prompt:
  - **New Input/Prompt Tokens**: `198,705`
  - **Completion/Output Tokens**: `11,990`
  - **Cached Input Tokens**: `4,075,117`
- **Implicit Subagents**: Estimated via byte density:
  - **Density**: `500,000` tokens burned & `9,600,000` cached per 1 MB of Protobuf files.

---

## Commands

### Run Full Import (ClickHouse & MotherDuck/DuckDB)
Run the import pipeline to sync all data sources (including Antigravity) to ClickHouse and DuckDB/MotherDuck:
```bash
bun run src/scripts/import-all.ts --verbose
```

### Skip Antigravity Source
If you want to run the import without Antigravity data:
```bash
bun run src/scripts/import-all.ts --skip-antigravity
```

### Unit Tests
Run the Antigravity integration tests:
```bash
bun test tests/unit/antigravity.test.ts
```
