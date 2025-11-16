#!/usr/bin/env python3
"""
Custom exception hierarchy for ccusage-import
Provides specific exception types for better error handling
"""


class CCUsageImportError(Exception):
    """Base exception for all ccusage-import errors"""

    pass


class ConfigurationError(CCUsageImportError):
    """Raised when configuration is invalid or missing"""

    pass


class ClickHouseError(CCUsageImportError):
    """Base exception for ClickHouse-related errors"""

    pass


class ClickHouseConnectionError(ClickHouseError):
    """Raised when connection to ClickHouse fails"""

    pass


class ClickHouseQueryError(ClickHouseError):
    """Raised when a ClickHouse query fails"""

    pass


class ClickHouseSchemaError(ClickHouseError):
    """Raised when there are schema-related issues"""

    pass


class DataFetchError(CCUsageImportError):
    """Base exception for data fetching errors"""

    pass


class CCUsageCommandError(DataFetchError):
    """Raised when ccusage command execution fails"""

    pass


class PackageManagerNotFoundError(DataFetchError):
    """Raised when neither bunx nor npx is available"""

    pass


class DataValidationError(CCUsageImportError):
    """Raised when data validation fails"""

    pass


class DataParseError(CCUsageImportError):
    """Raised when data parsing fails"""

    pass


class ImportError(CCUsageImportError):
    """Base exception for import-related errors"""

    pass


class ImportValidationError(ImportError):
    """Raised when import validation fails"""

    pass


class ImportRollbackError(ImportError):
    """Raised when import rollback fails"""

    pass


class RetryExhaustedError(CCUsageImportError):
    """Raised when all retries have been exhausted"""

    pass


class CircuitBreakerOpenError(CCUsageImportError):
    """Raised when circuit breaker is open"""

    pass
