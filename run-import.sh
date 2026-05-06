#!/bin/bash
cd /Users/duet/project/ccusage-import
bun run src/scripts/import-all.ts --duckdb-path=md:ccusage 2>&1
