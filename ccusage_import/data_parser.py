#!/usr/bin/env python3
"""
Data parsing utilities for ccusage-import
Handles date/datetime conversion and data extraction
"""

from datetime import date, datetime
from typing import Optional


def parse_date(date_str: str) -> date:
    """Parse date string to Python date object"""
    return datetime.strptime(date_str, "%Y-%m-%d").date()


def parse_datetime(datetime_str: Optional[str]) -> Optional[datetime]:
    """Parse datetime string to Python datetime object"""
    if datetime_str is None:
        return None
    # Handle ISO format: "2025-08-02T15:00:00.000Z"
    if datetime_str.endswith("Z"):
        # Remove 'Z' and parse as UTC
        datetime_str = datetime_str[:-1]
        return datetime.fromisoformat(datetime_str).replace(tzinfo=None)
    return datetime.fromisoformat(datetime_str).replace(tzinfo=None)


def extract_burn_rate(burn_rate_data) -> Optional[float]:
    """Extract burn rate value from data (can be None, float, or dict)"""
    if burn_rate_data is None:
        return None
    if isinstance(burn_rate_data, (int, float)):
        return float(burn_rate_data)
    if isinstance(burn_rate_data, dict):
        # Extract costPerHour from complex burn rate object
        return burn_rate_data.get("costPerHour", None)
    return None


def extract_projection(projection_data) -> Optional[float]:
    """Extract projection value from data (can be None, float, or dict)"""
    if projection_data is None:
        return None
    if isinstance(projection_data, (int, float)):
        return float(projection_data)
    if isinstance(projection_data, dict):
        # Extract totalCost from complex projection object
        return projection_data.get("totalCost", None)
    return None
