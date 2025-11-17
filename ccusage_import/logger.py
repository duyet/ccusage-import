#!/usr/bin/env python3
"""
Structured logging configuration for ccusage-import
Uses loguru for beautiful, structured logging
"""

import sys
from pathlib import Path
from typing import Optional

from loguru import logger

from .constants import LOG_FORMAT, LOG_RETENTION, LOG_ROTATION


def setup_logger(
    log_file: Optional[str] = None,
    level: str = "INFO",
    rotation: str = LOG_ROTATION,
    retention: str = LOG_RETENTION,
    serialize: bool = False,
) -> None:
    """
    Configure structured logging with loguru.

    Args:
        log_file: Path to log file (optional, logs to stdout if not provided)
        level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        rotation: When to rotate log files (e.g., "100 MB", "1 week")
        retention: How long to keep old log files (e.g., "30 days")
        serialize: Whether to serialize logs as JSON

    Example:
        >>> setup_logger("logs/app.log", level="DEBUG")
        >>> logger.info("Application started")
    """
    # Remove default handler
    logger.remove()

    # Add stdout handler with colors
    logger.add(
        sys.stdout,
        format=LOG_FORMAT,
        level=level,
        colorize=True,
        backtrace=True,
        diagnose=True,
    )

    # Add file handler if log_file is specified
    if log_file:
        log_path = Path(log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)

        logger.add(
            log_file,
            format=LOG_FORMAT,
            level=level,
            rotation=rotation,
            retention=retention,
            compression="zip",
            serialize=serialize,
            backtrace=True,
            diagnose=True,
        )


def get_logger(name: str):
    """
    Get a logger instance with the given name.

    Args:
        name: Logger name (usually __name__)

    Returns:
        Logger instance

    Example:
        >>> log = get_logger(__name__)
        >>> log.info("Processing data", records=100, duration=1.5)
    """
    return logger.bind(name=name)


# Default logger instance
log = logger
