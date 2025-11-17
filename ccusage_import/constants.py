#!/usr/bin/env python3
"""
Constants and configuration values for ccusage-import
Centralized location for all magic strings and configuration
"""

from typing import Final

# Table Names
TABLE_USAGE_DAILY: Final[str] = "ccusage_usage_daily"
TABLE_USAGE_MONTHLY: Final[str] = "ccusage_usage_monthly"
TABLE_USAGE_SESSIONS: Final[str] = "ccusage_usage_sessions"
TABLE_USAGE_BLOCKS: Final[str] = "ccusage_usage_blocks"
TABLE_USAGE_PROJECTS_DAILY: Final[str] = "ccusage_usage_projects_daily"
TABLE_MODEL_BREAKDOWNS: Final[str] = "ccusage_model_breakdowns"
TABLE_MODELS_USED: Final[str] = "ccusage_models_used"
TABLE_IMPORT_HISTORY: Final[str] = "ccusage_import_history"

# All required tables
REQUIRED_TABLES: Final[list[str]] = [
    TABLE_USAGE_DAILY,
    TABLE_USAGE_MONTHLY,
    TABLE_USAGE_SESSIONS,
    TABLE_USAGE_BLOCKS,
    TABLE_USAGE_PROJECTS_DAILY,
    TABLE_MODEL_BREAKDOWNS,
    TABLE_MODELS_USED,
    TABLE_IMPORT_HISTORY,
]

# Record Types
RECORD_TYPE_DAILY: Final[str] = "daily"
RECORD_TYPE_MONTHLY: Final[str] = "monthly"
RECORD_TYPE_SESSION: Final[str] = "session"
RECORD_TYPE_BLOCK: Final[str] = "block"
RECORD_TYPE_PROJECT_DAILY: Final[str] = "project_daily"

# Synthetic Model Marker
SYNTHETIC_MODEL: Final[str] = "<synthetic>"

# HTTPS Ports
HTTPS_PORTS: Final[tuple[int, ...]] = (443, 8443, 9440)

# Default Timeouts (seconds)
CCUSAGE_COMMAND_TIMEOUT: Final[int] = 30
CLICKHOUSE_CONNECTION_TIMEOUT: Final[int] = 10
CLICKHOUSE_QUERY_TIMEOUT: Final[int] = 60

# Retry Configuration
MAX_RETRIES: Final[int] = 3
RETRY_BACKOFF_FACTOR: Final[float] = 2.0
RETRY_INITIAL_DELAY: Final[float] = 1.0

# Parallel Execution
MAX_WORKERS_DATA_FETCH: Final[int] = 3

# Hash Configuration
PROJECT_HASH_LENGTH: Final[int] = 8
DATA_HASH_LENGTH: Final[int] = 12

# Date/Time Formats
DATE_FORMAT: Final[str] = "%Y-%m-%d"
DATETIME_ISO_FORMAT: Final[str] = "%Y-%m-%dT%H:%M:%S.%fZ"

# UI Configuration
SPINNER_CHARS: Final[str] = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
SPINNER_INTERVAL: Final[float] = 0.1

# Number Formatting Thresholds
BILLION: Final[int] = 1_000_000_000
MILLION: Final[int] = 1_000_000
THOUSAND: Final[int] = 1_000

# Package Manager Priority
PACKAGE_MANAGERS: Final[tuple[str, ...]] = ("bunx", "npx")

# ccusage Commands
CCUSAGE_COMMANDS: Final[dict[str, str]] = {
    "daily": "daily",
    "monthly": "monthly",
    "session": "session",
    "blocks": "blocks",
    "projects": "daily --instances",
}

# Environment Variable Names
ENV_CH_HOST: Final[str] = "CH_HOST"
ENV_CH_PORT: Final[str] = "CH_PORT"
ENV_CH_USER: Final[str] = "CH_USER"
ENV_CH_PASSWORD: Final[str] = "CH_PASSWORD"
ENV_CH_DATABASE: Final[str] = "CH_DATABASE"
ENV_MACHINE_NAME: Final[str] = "MACHINE_NAME"

# Default Values
DEFAULT_CH_HOST: Final[str] = "localhost"
DEFAULT_CH_PORT: Final[int] = 8123
DEFAULT_CH_USER: Final[str] = "default"
DEFAULT_CH_PASSWORD: Final[str] = ""
DEFAULT_CH_DATABASE: Final[str] = "default"

# Model Name Replacements (for display)
MODEL_NAME_REPLACEMENTS: Final[dict[str, str]] = {
    "claude-": "",
    "-20250514": "",
}

# Progress Display
PROGRESS_BAR_WIDTH: Final[int] = 50
PROGRESS_UPDATE_INTERVAL: Final[float] = 0.1

# Logging
LOG_FORMAT: Final[str] = "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>"
LOG_ROTATION: Final[str] = "100 MB"
LOG_RETENTION: Final[str] = "30 days"
