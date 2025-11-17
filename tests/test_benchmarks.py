#!/usr/bin/env python3
"""
Performance benchmarks using pytest-benchmark
Tracks performance regressions over time
"""

import sys
from pathlib import Path

import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from ccusage_import.config import hash_project_name, set_hash_project_names
from ccusage_import.data_parser import extract_burn_rate, extract_projection, parse_date
from ccusage_import.ui import UIFormatter


@pytest.fixture(autouse=True)
def enable_hashing():
    """Ensure hashing is enabled for benchmarks"""
    set_hash_project_names(True)


class TestDataParserBenchmarks:
    """Benchmarks for data parsing functions"""

    def test_parse_date_performance(self, benchmark):
        """Benchmark date parsing"""
        result = benchmark(parse_date, "2024-12-31")
        assert result is not None

    def test_extract_burn_rate_float_performance(self, benchmark):
        """Benchmark burn rate extraction from float"""
        result = benchmark(extract_burn_rate, 0.05)
        assert result == 0.05

    def test_extract_burn_rate_dict_performance(self, benchmark):
        """Benchmark burn rate extraction from dict"""
        data = {"costPerHour": 0.05, "other": "data"}
        result = benchmark(extract_burn_rate, data)
        assert result == 0.05

    def test_extract_projection_float_performance(self, benchmark):
        """Benchmark projection extraction from float"""
        result = benchmark(extract_projection, 10.5)
        assert result == 10.5

    def test_extract_projection_dict_performance(self, benchmark):
        """Benchmark projection extraction from dict"""
        data = {"totalCost": 10.5, "other": "data"}
        result = benchmark(extract_projection, data)
        assert result == 10.5


class TestHashingBenchmarks:
    """Benchmarks for hashing functions"""

    def test_hash_project_name_short_performance(self, benchmark):
        """Benchmark hashing short project names"""
        result = benchmark(hash_project_name, "/home/user/project")
        assert len(result) == 8

    def test_hash_project_name_long_performance(self, benchmark):
        """Benchmark hashing long project names"""
        long_path = "/home/user/very/long/path/to/project" * 10
        result = benchmark(hash_project_name, long_path)
        assert len(result) == 8

    def test_hash_project_name_repeated_performance(self, benchmark):
        """Benchmark repeated hashing (tests caching if implemented)"""
        path = "/home/user/project"

        def hash_multiple():
            return [hash_project_name(path) for _ in range(100)]

        result = benchmark(hash_multiple)
        assert len(result) == 100
        assert all(h == result[0] for h in result)


class TestUIFormatterBenchmarks:
    """Benchmarks for UI formatting functions"""

    def test_format_number_small_performance(self, benchmark):
        """Benchmark formatting small numbers"""
        result = benchmark(UIFormatter.format_number, 123)
        assert result == "123"

    def test_format_number_thousands_performance(self, benchmark):
        """Benchmark formatting thousands"""
        result = benchmark(UIFormatter.format_number, 123456)
        assert "K" in result

    def test_format_number_millions_performance(self, benchmark):
        """Benchmark formatting millions"""
        result = benchmark(UIFormatter.format_number, 123456789)
        assert "M" in result

    def test_format_number_billions_performance(self, benchmark):
        """Benchmark formatting billions"""
        result = benchmark(UIFormatter.format_number, 123456789012)
        assert "B" in result

    def test_format_duration_milliseconds_performance(self, benchmark):
        """Benchmark formatting milliseconds"""
        result = benchmark(UIFormatter.format_duration, 0.123)
        assert "ms" in result

    def test_format_duration_seconds_performance(self, benchmark):
        """Benchmark formatting seconds"""
        result = benchmark(UIFormatter.format_duration, 12.345)
        assert "s" in result

    def test_format_duration_minutes_performance(self, benchmark):
        """Benchmark formatting minutes"""
        result = benchmark(UIFormatter.format_duration, 123.456)
        assert "m" in result


class TestPydanticModelBenchmarks:
    """Benchmarks for Pydantic model validation"""

    def test_model_breakdown_creation_performance(self, benchmark):
        """Benchmark ModelBreakdown creation"""
        from ccusage_import.models import ModelBreakdown

        def create_model():
            return ModelBreakdown(
                model_name="claude-sonnet-4",
                input_tokens=1000,
                output_tokens=500,
                cache_creation_tokens=100,
                cache_read_tokens=200,
                cost=0.05,
            )

        result = benchmark(create_model)
        assert result.total_tokens == 1800

    def test_daily_usage_creation_performance(self, benchmark):
        """Benchmark DailyUsage creation"""
        from ccusage_import.models import DailyUsage

        def create_model():
            return DailyUsage(
                date="2024-12-31",
                inputTokens=1000,
                outputTokens=500,
                cacheCreationTokens=100,
                cacheReadTokens=200,
                totalTokens=1800,
                totalCost=0.05,
                modelsUsed=["claude-sonnet-4"],
                modelBreakdowns=[],
            )

        result = benchmark(create_model)
        assert result.date == "2024-12-31"

    def test_daily_usage_with_breakdowns_performance(self, benchmark):
        """Benchmark DailyUsage with model breakdowns"""
        from ccusage_import.models import DailyUsage, ModelBreakdown

        def create_model():
            return DailyUsage(
                date="2024-12-31",
                inputTokens=1000,
                outputTokens=500,
                cacheCreationTokens=100,
                cacheReadTokens=200,
                totalTokens=1800,
                totalCost=0.05,
                modelsUsed=["claude-sonnet-4", "claude-opus-4"],
                modelBreakdowns=[
                    ModelBreakdown(
                        model_name="claude-sonnet-4",
                        input_tokens=800,
                        output_tokens=400,
                        cache_creation_tokens=80,
                        cache_read_tokens=120,
                        cost=0.035,
                    ),
                    ModelBreakdown(
                        model_name="claude-opus-4",
                        input_tokens=200,
                        output_tokens=100,
                        cache_creation_tokens=20,
                        cache_read_tokens=80,
                        cost=0.015,
                    ),
                ],
            )

        result = benchmark(create_model)
        assert len(result.model_breakdowns) == 2


# Comparison benchmarks to track relative performance
class TestComparisonBenchmarks:
    """Benchmarks comparing different approaches"""

    def test_hash_vs_no_hash(self, benchmark):
        """Compare performance with and without hashing"""
        path = "/home/user/project/name"

        def with_hash():
            set_hash_project_names(True)
            return hash_project_name(path)

        result = benchmark(with_hash)
        assert isinstance(result, str)

    @pytest.mark.parametrize(
        "num_size",
        [
            100,  # Small numbers
            100_000,  # Thousands
            100_000_000,  # Millions
            100_000_000_000,  # Billions
        ],
    )
    def test_format_number_scaling(self, benchmark, num_size):
        """Test how format_number scales with number size"""
        result = benchmark(UIFormatter.format_number, num_size)
        assert isinstance(result, str)
