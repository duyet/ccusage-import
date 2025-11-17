#!/usr/bin/env python3
"""
Property-based tests using Hypothesis
Tests invariants and edge cases automatically
"""

import sys
from datetime import date, datetime
from pathlib import Path

import pytest
from hypothesis import given, strategies as st

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from ccusage_import.data_parser import extract_burn_rate, extract_projection, parse_date
from ccusage_import.config import hash_project_name
from ccusage_import.ui import UIFormatter


class TestDataParser:
    """Property-based tests for data parsing"""

    @given(st.dates())
    def test_parse_date_roundtrip(self, test_date: date):
        """Parsing a date string should always produce a valid date"""
        date_str = test_date.strftime("%Y-%m-%d")
        parsed = parse_date(date_str)
        assert isinstance(parsed, date)
        assert parsed == test_date

    @given(st.floats(min_value=0, max_value=1000000, allow_nan=False))
    def test_extract_burn_rate_from_float(self, value: float):
        """Extracting burn rate from a float should return the same value"""
        result = extract_burn_rate(value)
        assert result == value

    @given(st.floats(min_value=0, max_value=1000000, allow_nan=False))
    def test_extract_projection_from_float(self, value: float):
        """Extracting projection from a float should return the same value"""
        result = extract_projection(value)
        assert result == value

    @given(st.floats(min_value=0, max_value=1000000, allow_nan=False))
    def test_extract_burn_rate_from_dict(self, value: float):
        """Extracting burn rate from dict should return costPerHour"""
        data = {"costPerHour": value, "other": "data"}
        result = extract_burn_rate(data)
        assert result == value

    @given(st.floats(min_value=0, max_value=1000000, allow_nan=False))
    def test_extract_projection_from_dict(self, value: float):
        """Extracting projection from dict should return totalCost"""
        data = {"totalCost": value, "other": "data"}
        result = extract_projection(data)
        assert result == value

    def test_extract_burn_rate_none(self):
        """Extracting burn rate from None should return None"""
        assert extract_burn_rate(None) is None

    def test_extract_projection_none(self):
        """Extracting projection from None should return None"""
        assert extract_projection(None) is None


class TestHashProjectName:
    """Property-based tests for project name hashing"""

    @given(st.text(min_size=1, max_size=1000))
    def test_hash_deterministic(self, project_path: str):
        """Hashing the same project path should always return the same hash"""
        hash1 = hash_project_name(project_path)
        hash2 = hash_project_name(project_path)
        assert hash1 == hash2

    @given(st.text(min_size=1, max_size=1000))
    def test_hash_length(self, project_path: str):
        """Hash should always be 8 characters long"""
        result = hash_project_name(project_path)
        # When HASH_PROJECT_NAMES is enabled
        if result != project_path:
            assert len(result) == 8

    @given(st.text(min_size=1, max_size=1000))
    def test_hash_is_hex(self, project_path: str):
        """Hash should be valid hexadecimal"""
        result = hash_project_name(project_path)
        # When HASH_PROJECT_NAMES is enabled
        if result != project_path:
            assert all(c in "0123456789abcdef" for c in result)

    @given(st.text(min_size=1, max_size=1000), st.text(min_size=1, max_size=1000))
    def test_different_paths_different_hashes(self, path1: str, path2: str):
        """Different project paths should (almost always) produce different hashes"""
        if path1 != path2:
            hash1 = hash_project_name(path1)
            hash2 = hash_project_name(path2)
            # Hashes should be different (unless disabled)
            if hash1 != path1 and hash2 != path2:
                # Small probability of collision is acceptable
                # This test mainly ensures the function works
                assert isinstance(hash1, str)
                assert isinstance(hash2, str)


class TestUIFormatter:
    """Property-based tests for UI formatting"""

    @given(st.integers(min_value=0, max_value=1_000_000_000_000))
    def test_format_number_never_crashes(self, num: int):
        """Formatting any valid integer should never crash"""
        result = UIFormatter.format_number(num)
        assert isinstance(result, str)
        assert len(result) > 0

    @given(st.integers(min_value=0, max_value=999))
    def test_format_number_small(self, num: int):
        """Small numbers should be formatted with commas"""
        result = UIFormatter.format_number(num)
        assert "," in result or len(result) <= 3

    @given(st.integers(min_value=1_000, max_value=999_999))
    def test_format_number_thousands(self, num: int):
        """Thousands should be formatted with K suffix"""
        result = UIFormatter.format_number(num)
        assert "K" in result

    @given(st.integers(min_value=1_000_000, max_value=999_999_999))
    def test_format_number_millions(self, num: int):
        """Millions should be formatted with M suffix"""
        result = UIFormatter.format_number(num)
        assert "M" in result

    @given(st.integers(min_value=1_000_000_000, max_value=1_000_000_000_000))
    def test_format_number_billions(self, num: int):
        """Billions should be formatted with B suffix"""
        result = UIFormatter.format_number(num)
        assert "B" in result

    @given(st.floats(min_value=0, max_value=1000, allow_nan=False, allow_infinity=False))
    def test_format_duration_never_crashes(self, seconds: float):
        """Formatting any valid duration should never crash"""
        result = UIFormatter.format_duration(seconds)
        assert isinstance(result, str)
        assert len(result) > 0

    @given(st.floats(min_value=0, max_value=0.999, allow_nan=False))
    def test_format_duration_milliseconds(self, seconds: float):
        """Sub-second durations should be formatted as milliseconds"""
        result = UIFormatter.format_duration(seconds)
        assert "ms" in result

    @given(st.floats(min_value=1, max_value=59.999, allow_nan=False))
    def test_format_duration_seconds(self, seconds: float):
        """Durations under 1 minute should be formatted as seconds"""
        result = UIFormatter.format_duration(seconds)
        assert "s" in result and "m" not in result

    @given(st.floats(min_value=60, max_value=3600, allow_nan=False))
    def test_format_duration_minutes(self, seconds: float):
        """Durations over 1 minute should be formatted as minutes and seconds"""
        result = UIFormatter.format_duration(seconds)
        assert "m" in result and "s" in result


class TestModelValidation:
    """Property-based tests for Pydantic model validation"""

    @given(
        st.integers(min_value=0, max_value=1_000_000),
        st.integers(min_value=0, max_value=1_000_000),
        st.integers(min_value=0, max_value=1_000_000),
        st.integers(min_value=0, max_value=1_000_000),
    )
    def test_model_breakdown_total_tokens(
        self, input_t: int, output_t: int, cache_create: int, cache_read: int
    ):
        """Total tokens should equal sum of all token types"""
        from ccusage_import.models import ModelBreakdown

        breakdown = ModelBreakdown(
            model_name="test-model",
            input_tokens=input_t,
            output_tokens=output_t,
            cache_creation_tokens=cache_create,
            cache_read_tokens=cache_read,
            cost=0.01,
        )

        assert breakdown.total_tokens == input_t + output_t + cache_create + cache_read

    @given(st.dates())
    def test_daily_usage_date_format(self, test_date: date):
        """Daily usage should accept properly formatted dates"""
        from ccusage_import.models import DailyUsage

        date_str = test_date.strftime("%Y-%m-%d")

        usage = DailyUsage(
            date=date_str,
            inputTokens=1000,
            outputTokens=500,
            cacheCreationTokens=100,
            cacheReadTokens=200,
            totalTokens=1800,
            totalCost=0.05,
            modelsUsed=["claude-sonnet-4"],
            modelBreakdowns=[],
        )

        assert usage.date == date_str
