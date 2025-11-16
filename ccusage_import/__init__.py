#!/usr/bin/env python3
"""
ccusage-import: Import ccusage data into ClickHouse for analytics

A production-ready tool for importing Claude Code usage analytics into ClickHouse
with enterprise features: structured logging, data validation, retry logic, and more.
"""

__version__ = "0.2.0"

from .cli import main, system_check
from .clickhouse_client import ClickHouseClient
from .config import (
    CH_DATABASE,
    CH_HOST,
    CH_PASSWORD,
    CH_PORT,
    CH_USER,
    HASH_PROJECT_NAMES,
    MACHINE_NAME,
    hash_project_name,
    set_hash_project_names,
)
from .data_fetcher import (
    detect_package_runner,
    fetch_ccusage_data_parallel,
    run_ccusage_command,
)
from .data_parser import (
    extract_burn_rate,
    extract_projection,
    parse_date,
    parse_datetime,
)
from .exceptions import (
    CCUsageCommandError,
    CCUsageImportError,
    CircuitBreakerOpenError,
    ClickHouseConnectionError,
    ClickHouseError,
    ClickHouseQueryError,
    ClickHouseSchemaError,
    ConfigurationError,
    DataFetchError,
    DataParseError,
    DataValidationError,
    ImportError as CCUsageImportImportError,
    ImportRollbackError,
    ImportValidationError,
    PackageManagerNotFoundError,
    RetryExhaustedError,
)
from .importer import ClickHouseImporter
from .logger import get_logger, log, setup_logger
from .models import (
    BlockUsage,
    CCUsageData,
    ClickHouseConfig,
    DailyUsage,
    ImportStatistics,
    ModelBreakdown,
    MonthlyUsage,
    ProjectDailyUsage,
    SessionUsage,
    TokenCounts,
)
from .ui import LoadingAnimation, UIFormatter

__all__ = [
    # Version
    "__version__",
    # Main entry points
    "main",
    "system_check",
    # Core classes
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
    # Data fetching
    "detect_package_runner",
    "run_ccusage_command",
    "fetch_ccusage_data_parallel",
    # Data parsing
    "parse_date",
    "parse_datetime",
    "extract_burn_rate",
    "extract_projection",
    # Exceptions
    "CCUsageImportError",
    "ConfigurationError",
    "ClickHouseError",
    "ClickHouseConnectionError",
    "ClickHouseQueryError",
    "ClickHouseSchemaError",
    "DataFetchError",
    "CCUsageCommandError",
    "PackageManagerNotFoundError",
    "DataValidationError",
    "DataParseError",
    "CCUsageImportImportError",
    "ImportValidationError",
    "ImportRollbackError",
    "RetryExhaustedError",
    "CircuitBreakerOpenError",
    # Logging
    "setup_logger",
    "get_logger",
    "log",
    # Models
    "DailyUsage",
    "MonthlyUsage",
    "SessionUsage",
    "BlockUsage",
    "ProjectDailyUsage",
    "ModelBreakdown",
    "TokenCounts",
    "CCUsageData",
    "ClickHouseConfig",
    "ImportStatistics",
]
