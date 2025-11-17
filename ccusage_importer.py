#!/usr/bin/env python3
"""
ccusage to ClickHouse Data Importer (Backwards Compatibility Wrapper)

This module provides backwards compatibility by re-exporting all classes
and functions from the refactored ccusage_import package.
"""

# Re-export external dependencies for test mocking compatibility
import clickhouse_connect  # noqa: F401
import subprocess  # noqa: F401

# Re-export everything from the new package for backwards compatibility
from ccusage_import import *  # noqa: F401, F403
from ccusage_import import (
    CH_DATABASE,
    CH_HOST,
    CH_PASSWORD,
    CH_PORT,
    CH_USER,
    HASH_PROJECT_NAMES,
    MACHINE_NAME,
    ClickHouseClient,
    ClickHouseImporter,
    LoadingAnimation,
    UIFormatter,
    extract_burn_rate,
    extract_projection,
    hash_project_name,
    main,
    parse_date,
    parse_datetime,
    set_hash_project_names,
    system_check,
)

# Export everything for backwards compatibility
__all__ = [
    # Core functions
    "main",
    "system_check",
    # Classes
    "ClickHouseImporter",
    "ClickHouseClient",
    "LoadingAnimation",
    "UIFormatter",
    # Configuration
    "CH_HOST",
    "CH_PORT",
    "CH_USER",
    "CH_PASSWORD",
    "CH_DATABASE",
    "MACHINE_NAME",
    "HASH_PROJECT_NAMES",
    "hash_project_name",
    "set_hash_project_names",
    # Data parsing
    "parse_date",
    "parse_datetime",
    "extract_burn_rate",
    "extract_projection",
    # External dependencies (for test mocking)
    "clickhouse_connect",
    "subprocess",
]

if __name__ == "__main__":
    main()
