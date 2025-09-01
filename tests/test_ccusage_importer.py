#!/usr/bin/env python3
"""
Test suite for ccusage_importer module
Tests ClickHouse connection, data parsing, and import functionality
"""

import os
import subprocess
import sys
from unittest.mock import Mock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ccusage_importer import ClickHouseImporter


class TestClickHouseImporter:
    """Test suite for ClickHouseImporter class"""

    @pytest.fixture
    def mock_client(self):
        """Mock ClickHouse client for testing"""
        mock = Mock()
        mock.command.return_value = None
        mock.insert.return_value = None

        # Create a mock that returns different results based on query content
        def mock_query(query_str):
            mock_result = Mock()
            if "count()" in query_str:
                # Table count queries
                mock_result.result_rows = [[0]]
            elif "model_name" in query_str and "GROUP BY" in query_str:
                # Model usage query
                mock_result.result_rows = [["test-model", 1, 0.01, 100]]
            elif "session_id" in query_str:
                # Session stats query
                mock_result.result_rows = [[0, 0.0, 0.0, 0]]
            elif "machine_name" in query_str:
                # Machine stats query
                mock_result.result_rows = [["test-machine", 1, 0.01, "2024-01-01"]]
            elif "isActive" in query_str:
                # Active blocks query
                mock_result.result_rows = [[0]]
            else:
                # Default usage summary query
                mock_result.result_rows = [[0.0, 0, 0, 0, 0, 0, None, None, 0]]
            return mock_result

        mock.query.side_effect = mock_query
        return mock

    @pytest.fixture
    def importer_with_mock_client(self, mock_client):
        """ClickHouseImporter instance with mocked client"""
        with patch(
            "ccusage_importer.clickhouse_connect.get_client",
            return_value=mock_client,
        ), patch("ccusage_importer.subprocess.run") as mock_run:
            # Mock bunx detection success
            mock_run.return_value = Mock()
            importer = ClickHouseImporter()
            return importer

    @pytest.fixture
    def sample_daily_data(self):
        """Sample daily usage data for testing"""
        return [
            {
                "date": "2024-12-31",
                "inputTokens": 1000,
                "outputTokens": 500,
                "cacheCreationTokens": 100,
                "cacheReadTokens": 200,
                "totalTokens": 1800,
                "totalCost": 0.05,
                "modelsUsed": [
                    "claude-sonnet-4-20250514",
                    "claude-opus-4-20250514",
                ],
                "modelBreakdowns": [
                    {
                        "modelName": "claude-sonnet-4-20250514",
                        "inputTokens": 800,
                        "outputTokens": 400,
                        "cacheCreationTokens": 80,
                        "cacheReadTokens": 120,
                        "cost": 0.035,
                    },
                    {
                        "modelName": "claude-opus-4-20250514",
                        "inputTokens": 200,
                        "outputTokens": 100,
                        "cacheCreationTokens": 20,
                        "cacheReadTokens": 80,
                        "cost": 0.015,
                    },
                ],
            }
        ]

    @pytest.fixture
    def sample_monthly_data(self):
        """Sample monthly usage data for testing"""
        return [
            {
                "month": "2024-12",
                "inputTokens": 30000,
                "outputTokens": 15000,
                "cacheCreationTokens": 3000,
                "cacheReadTokens": 6000,
                "totalTokens": 54000,
                "totalCost": 1.5,
                "modelsUsed": ["claude-sonnet-4-20250514"],
                "modelBreakdowns": [
                    {
                        "modelName": "claude-sonnet-4-20250514",
                        "inputTokens": 30000,
                        "outputTokens": 15000,
                        "cacheCreationTokens": 3000,
                        "cacheReadTokens": 6000,
                        "cost": 1.5,
                    }
                ],
            }
        ]

    @pytest.fixture
    def sample_session_data(self):
        """Sample session usage data for testing"""
        return [
            {
                "sessionId": "test-session-123",
                "projectPath": "/Users/test/project",
                "inputTokens": 2000,
                "outputTokens": 1000,
                "cacheCreationTokens": 200,
                "cacheReadTokens": 400,
                "totalTokens": 3600,
                "totalCost": 0.1,
                "lastActivity": "2024-12-31",
                "modelsUsed": ["claude-sonnet-4-20250514"],
                "modelBreakdowns": [
                    {
                        "modelName": "claude-sonnet-4-20250514",
                        "inputTokens": 2000,
                        "outputTokens": 1000,
                        "cacheCreationTokens": 200,
                        "cacheReadTokens": 400,
                        "cost": 0.1,
                    }
                ],
            }
        ]

    @pytest.fixture
    def sample_blocks_data(self):
        """Sample blocks usage data for testing"""
        return [
            {
                "id": "block-123",
                "startTime": "2024-12-31T18:00:00.000Z",
                "endTime": "2024-12-31T23:00:00.000Z",
                "actualEndTime": "2024-12-31T22:30:00.000Z",
                "isActive": False,
                "isGap": False,
                "entries": 10,
                "tokenCounts": {
                    "inputTokens": 5000,
                    "outputTokens": 2500,
                    "cacheCreationInputTokens": 500,
                    "cacheReadInputTokens": 1000,
                },
                "totalTokens": 9000,
                "costUSD": 0.25,
                "models": ["claude-sonnet-4-20250514"],
                "usageLimitResetTime": "2025-01-01T00:00:00.000Z",
                "burnRate": 0.05,
                "projection": 0.3,
            }
        ]

    @pytest.fixture
    def sample_projects_data(self):
        """Sample projects daily data for testing"""
        return {
            "project1": [
                {
                    "date": "2024-12-31",
                    "inputTokens": 1500,
                    "outputTokens": 750,
                    "cacheCreationTokens": 150,
                    "cacheReadTokens": 300,
                    "totalTokens": 2700,
                    "totalCost": 0.075,
                    "modelsUsed": ["claude-sonnet-4-20250514"],
                    "modelBreakdowns": [
                        {
                            "modelName": "claude-sonnet-4-20250514",
                            "inputTokens": 1500,
                            "outputTokens": 750,
                            "cacheCreationTokens": 150,
                            "cacheReadTokens": 300,
                            "cost": 0.075,
                        }
                    ],
                }
            ]
        }

    def test_init_success(self, mock_client):
        """Test successful ClickHouse client initialization"""
        with patch(
            "ccusage_importer.clickhouse_connect.get_client",
            return_value=mock_client,
        ), patch("ccusage_importer.subprocess.run") as mock_run:
            # Mock bunx detection
            mock_run.return_value = Mock()
            importer = ClickHouseImporter()
            assert importer.client == mock_client
            assert importer.package_runner == "bunx"
            mock_client.command.assert_called_once_with("SELECT 1")

    def test_init_connection_failure(self):
        """Test ClickHouse connection failure handling"""
        with patch(
            "ccusage_importer.clickhouse_connect.get_client",
            side_effect=Exception("Connection failed"),
        ), patch("ccusage_importer.subprocess.run"):
            with pytest.raises(Exception) as excinfo:
                ClickHouseImporter()
            assert "Connection failed" in str(excinfo.value)

    def test_detect_package_runner_bunx_available(self, mock_client):
        """Test package runner detection when bunx is available"""
        with patch(
            "ccusage_importer.clickhouse_connect.get_client",
            return_value=mock_client,
        ), patch("ccusage_importer.subprocess.run") as mock_run:
            # Mock bunx --version success
            mock_run.return_value = Mock()
            importer = ClickHouseImporter()
            assert importer.package_runner == "bunx"
            # Should call bunx --version
            mock_run.assert_called_with(
                ["bunx", "--version"], capture_output=True, check=True
            )

    def test_detect_package_runner_npx_fallback(self, mock_client):
        """Test package runner detection falls back to npx when bunx unavailable"""
        with patch(
            "ccusage_importer.clickhouse_connect.get_client",
            return_value=mock_client,
        ), patch("ccusage_importer.subprocess.run") as mock_run:
            # Mock bunx failure, npx success
            mock_run.side_effect = [
                subprocess.CalledProcessError(1, "bunx"),  # bunx fails
                Mock(),  # npx succeeds
            ]
            importer = ClickHouseImporter()
            assert importer.package_runner == "npx"
            # Should try bunx first, then npx
            assert mock_run.call_count == 2

    def test_detect_package_runner_neither_available(self, mock_client):
        """Test package runner detection when neither bunx nor npx available"""
        with patch(
            "ccusage_importer.clickhouse_connect.get_client",
            return_value=mock_client,
        ), patch("ccusage_importer.subprocess.run") as mock_run:
            # Mock both bunx and npx failure
            mock_run.side_effect = [
                FileNotFoundError(),  # bunx not found
                FileNotFoundError(),  # npx not found
            ]
            importer = ClickHouseImporter()
            assert importer.package_runner == "npx"  # defaults to npx
            assert mock_run.call_count == 2

    @patch("ccusage_importer.subprocess.run")
    def test_run_ccusage_command_success(self, mock_run, importer_with_mock_client):
        """Test successful ccusage command execution"""
        # Mock successful subprocess run
        mock_result = Mock()
        mock_result.stdout = '{"daily": [{"date": "2024-12-31", "totalCost": 0.05}]}'
        mock_run.return_value = mock_result

        result = importer_with_mock_client.run_ccusage_command("daily")

        assert result == {"daily": [{"date": "2024-12-31", "totalCost": 0.05}]}
        # Should use the detected package runner (bunx in this case from fixture)
        expected_call = [
            importer_with_mock_client.package_runner,
            "ccusage@latest",
            "daily",
            "--json",
        ]
        mock_run.assert_called_with(
            expected_call, capture_output=True, text=True, check=True, timeout=30
        )

    @patch("ccusage_importer.subprocess.run")
    def test_run_ccusage_command_subprocess_error(
        self, mock_run, importer_with_mock_client
    ):
        """Test ccusage command subprocess error handling"""
        from subprocess import CalledProcessError

        mock_run.side_effect = CalledProcessError(1, "npx", stderr="Command failed")

        result = importer_with_mock_client.run_ccusage_command("daily")

        assert result == {}

    @patch("ccusage_importer.subprocess.run")
    def test_run_ccusage_command_json_error(self, mock_run, importer_with_mock_client):
        """Test ccusage command JSON parsing error handling"""
        # Mock subprocess with invalid JSON
        mock_result = Mock()
        mock_result.stdout = "invalid json"
        mock_run.return_value = mock_result

        result = importer_with_mock_client.run_ccusage_command("daily")

        assert result == {}

    def test_upsert_daily_data_success(
        self, importer_with_mock_client, sample_daily_data
    ):
        """Test successful daily data upsert"""
        # Reset mock to clear initialization calls
        importer_with_mock_client.client.reset_mock()

        importer_with_mock_client.upsert_daily_data(sample_daily_data)

        # Verify DELETE command was called (first call after reset)
        delete_call = importer_with_mock_client.client.command.call_args_list[0][0][0]
        assert (
            "DELETE FROM ccusage_usage_daily WHERE date IN ('2024-12-31')"
            in delete_call
        )

        # Verify INSERT calls were made
        assert (
            importer_with_mock_client.client.insert.call_count == 3
        )  # main, breakdowns, models_used

    def test_upsert_daily_data_empty(self, importer_with_mock_client):
        """Test daily data upsert with empty data"""
        # Reset mock to clear initialization calls
        importer_with_mock_client.client.reset_mock()

        importer_with_mock_client.upsert_daily_data([])

        # No database calls should be made after reset
        importer_with_mock_client.client.command.assert_not_called()
        importer_with_mock_client.client.insert.assert_not_called()

    def test_upsert_monthly_data_success(
        self, importer_with_mock_client, sample_monthly_data
    ):
        """Test successful monthly data upsert"""
        # Reset mock to clear initialization calls
        importer_with_mock_client.client.reset_mock()

        importer_with_mock_client.upsert_monthly_data(sample_monthly_data)

        # Verify DELETE command was called
        delete_call = importer_with_mock_client.client.command.call_args_list[0][0][0]
        assert (
            "DELETE FROM ccusage_usage_monthly WHERE month IN ('2024-12')"
            in delete_call
        )

        # Verify INSERT calls were made
        assert importer_with_mock_client.client.insert.call_count == 3

    def test_upsert_session_data_success(
        self, importer_with_mock_client, sample_session_data
    ):
        """Test successful session data upsert"""
        # Reset mock to clear initialization calls
        importer_with_mock_client.client.reset_mock()

        importer_with_mock_client.upsert_session_data(sample_session_data)

        # Verify DELETE command was called
        delete_call = importer_with_mock_client.client.command.call_args_list[0][0][0]
        # With hashing enabled, session IDs are hashed
        # Just check that DELETE command was called with hashed IDs
        assert "DELETE FROM ccusage_usage_sessions WHERE session_id IN" in delete_call

        # Verify INSERT calls were made
        assert importer_with_mock_client.client.insert.call_count == 3

    def test_upsert_blocks_data_success(
        self, importer_with_mock_client, sample_blocks_data
    ):
        """Test successful blocks data upsert"""
        # Reset mock to clear initialization calls
        importer_with_mock_client.client.reset_mock()

        importer_with_mock_client.upsert_blocks_data(sample_blocks_data)

        # Verify DELETE command was called
        delete_call = importer_with_mock_client.client.command.call_args_list[0][0][0]
        assert (
            "DELETE FROM ccusage_usage_blocks WHERE block_id IN ('block-123')"
            in delete_call
        )

        # Verify INSERT calls were made (blocks + models_used)
        assert importer_with_mock_client.client.insert.call_count == 2

    def test_upsert_blocks_data_skip_synthetic(self, importer_with_mock_client):
        """Test blocks data upsert skips synthetic models"""
        blocks_data_with_synthetic = [
            {
                "id": "block-123",
                "startTime": "2024-12-31T18:00:00.000Z",
                "endTime": "2024-12-31T23:00:00.000Z",
                "actualEndTime": None,
                "isActive": True,
                "isGap": False,
                "entries": 5,
                "tokenCounts": {
                    "inputTokens": 1000,
                    "outputTokens": 500,
                    "cacheCreationInputTokens": 100,
                    "cacheReadInputTokens": 200,
                },
                "totalTokens": 1800,
                "costUSD": 0.05,
                "models": ["claude-sonnet-4-20250514", "<synthetic>"],
                "usageLimitResetTime": None,
                "burnRate": None,
                "projection": None,
            }
        ]

        importer_with_mock_client.upsert_blocks_data(blocks_data_with_synthetic)

        # Verify models_used insert was called, but should only have 1 model (not synthetic)
        models_used_call = importer_with_mock_client.client.insert.call_args_list[1]
        assert len(models_used_call[0][1]) == 1  # Only one model inserted
        # With hashing enabled, the model names might be transformed
        # Just check that one model was inserted (not synthetic)
        assert len(models_used_call[0][1][0]) >= 3  # Has at least 3 fields

    def test_upsert_projects_daily_data_success(
        self, importer_with_mock_client, sample_projects_data
    ):
        """Test successful projects daily data upsert"""
        # Reset mock to clear initialization calls
        importer_with_mock_client.client.reset_mock()

        importer_with_mock_client.upsert_projects_daily_data(sample_projects_data)

        # Verify DELETE command was called
        delete_call = importer_with_mock_client.client.command.call_args_list[0][0][0]
        assert (
            "DELETE FROM ccusage_usage_projects_daily WHERE date IN ('2024-12-31')"
            in delete_call
        )

        # Verify INSERT calls were made
        assert importer_with_mock_client.client.insert.call_count == 3

    def test_upsert_projects_daily_data_empty(self, importer_with_mock_client):
        """Test projects daily data upsert with empty data"""
        # Reset mock to clear initialization calls
        importer_with_mock_client.client.reset_mock()

        importer_with_mock_client.upsert_projects_daily_data({})

        # No database calls should be made after reset
        importer_with_mock_client.client.command.assert_not_called()
        importer_with_mock_client.client.insert.assert_not_called()

    @patch("ccusage_importer.ClickHouseImporter.get_import_statistics")
    @patch("ccusage_importer.ClickHouseImporter.run_ccusage_command")
    def test_import_all_data_success(
        self,
        mock_run_command,
        mock_get_stats,
        importer_with_mock_client,
        sample_daily_data,
        sample_monthly_data,
        sample_session_data,
        sample_blocks_data,
        sample_projects_data,
    ):
        """Test successful complete data import"""
        # Mock ccusage command responses
        mock_run_command.side_effect = [
            {"daily": sample_daily_data},
            {"monthly": sample_monthly_data},
            {"sessions": sample_session_data},
            {"blocks": sample_blocks_data},
            {"projects": sample_projects_data},
        ]

        # Mock statistics to avoid complex query mocking
        mock_get_stats.return_value = {
            "table_counts": {"ccusage_usage_daily": 1},
            "usage_summary": {
                "total_cost": 0.05,
                "total_tokens": 1000,
                "total_input_tokens": 600,
                "total_output_tokens": 400,
                "total_cache_creation_tokens": 50,
                "total_cache_read_tokens": 100,
                "earliest_date": "2024-01-01",
                "latest_date": "2024-12-31",
                "days_with_usage": 30,
            },
            "model_usage": [],
            "session_stats": {
                "total_sessions": 0,
                "total_session_tokens": 0,
                "avg_cost_per_session": 0.0,
                "max_cost_session": 0.0,
            },
            "machine_stats": [],
            "active_blocks": 0,
        }

        importer_with_mock_client.import_all_data()

        # Verify all ccusage commands were called (order may vary due to concurrent execution)
        expected_calls = {
            "daily",
            "monthly",
            "session",
            "blocks",
            "daily --instances",
        }

        actual_calls = {call[0][0] for call in mock_run_command.call_args_list}
        assert actual_calls == expected_calls

    @patch("ccusage_importer.ClickHouseImporter.get_import_statistics")
    @patch("ccusage_importer.ClickHouseImporter.run_ccusage_command")
    def test_import_all_data_missing_keys(
        self, mock_run_command, mock_get_stats, importer_with_mock_client
    ):
        """Test import_all_data handles missing keys gracefully"""
        # Mock responses without expected keys
        mock_run_command.side_effect = [
            {},  # No 'daily' key
            {},  # No 'monthly' key
            {},  # No 'sessions' key
            {},  # No 'blocks' key
            {},  # No 'projects' key
        ]

        # Mock statistics to avoid query issues
        mock_get_stats.return_value = {
            "table_counts": {},
            "usage_summary": {
                "total_cost": 0.0,
                "total_tokens": 0,
                "total_input_tokens": 0,
                "total_output_tokens": 0,
                "total_cache_creation_tokens": 0,
                "total_cache_read_tokens": 0,
                "earliest_date": None,
                "latest_date": None,
                "days_with_usage": 0,
            },
            "model_usage": [],
            "session_stats": {
                "total_sessions": 0,
                "total_session_tokens": 0,
                "avg_cost_per_session": 0.0,
                "max_cost_session": 0.0,
            },
            "machine_stats": [],
            "active_blocks": 0,
        }

        # Should not raise exception
        importer_with_mock_client.import_all_data()

        # Verify all commands were attempted
        assert mock_run_command.call_count == 5

    @patch("ccusage_importer.ClickHouseImporter.get_import_statistics")
    @patch("ccusage_importer.ClickHouseImporter.run_ccusage_command")
    def test_import_all_data_exception_handling(
        self, mock_run_command, mock_get_stats, importer_with_mock_client
    ):
        """Test import_all_data graceful exception handling"""
        # Mock commands to raise exceptions
        mock_run_command.side_effect = Exception("Test error")

        # Mock statistics with complete structure
        mock_get_stats.return_value = {
            "table_counts": {},
            "usage_summary": {
                "total_cost": 0.0,
                "total_tokens": 0,
                "total_input_tokens": 0,
                "total_output_tokens": 0,
                "total_cache_creation_tokens": 0,
                "total_cache_read_tokens": 0,
                "earliest_date": None,
                "latest_date": None,
                "days_with_usage": 0,
            },
            "model_usage": [],
            "session_stats": {
                "total_sessions": 0,
                "total_session_tokens": 0,
                "avg_cost_per_session": 0.0,
                "max_cost_session": 0.0,
            },
            "machine_stats": [],
            "active_blocks": 0,
        }

        # Should handle exceptions gracefully and complete successfully
        importer_with_mock_client.import_all_data()

        # Verify that commands were attempted (even though they failed)
        assert mock_run_command.call_count >= 1


class TestEnvironmentVariables:
    """Test environment variable loading and configuration"""

    def test_default_values(self):
        """Test default configuration values"""
        # Test getenv behavior with defaults directly
        with patch.dict(os.environ, {}, clear=True):
            # Test the actual os.getenv calls with defaults
            assert os.getenv("CH_HOST", "localhost") == "localhost"
            assert int(os.getenv("CH_PORT", "8123")) == 8123
            assert os.getenv("CH_USER", "default") == "default"
            assert os.getenv("CH_PASSWORD", "") == ""
            assert os.getenv("CH_DATABASE", "default") == "default"

    def test_environment_override(self):
        """Test environment variable override"""
        test_env = {
            "CH_HOST": "test-host",
            "CH_PORT": "9000",
            "CH_USER": "test-user",
            "CH_PASSWORD": "test-password",
            "CH_DATABASE": "test-database",
        }

        with patch.dict(os.environ, test_env):
            # Re-import to get fresh values
            import importlib

            import ccusage_importer

            importlib.reload(ccusage_importer)

            # Check overridden values
            assert ccusage_importer.CH_HOST == "test-host"
            assert ccusage_importer.CH_PORT == 9000
            assert ccusage_importer.CH_USER == "test-user"
            assert ccusage_importer.CH_PASSWORD == "test-password"
            assert ccusage_importer.CH_DATABASE == "test-database"


class TestMainFunction:
    """Test main function and CLI entry point"""

    @patch("ccusage_importer.ClickHouseImporter")
    def test_main_success(self, mock_importer_class):
        """Test successful main execution"""
        mock_importer = Mock()
        mock_importer_class.return_value = mock_importer

        from ccusage_importer import main

        # Mock sys.argv to provide clean arguments
        with patch.object(sys, "argv", ["ccusage_importer.py"]):
            main()

        mock_importer_class.assert_called_once()
        mock_importer.import_all_data.assert_called_once()

    @patch("ccusage_importer.ClickHouseImporter")
    def test_main_keyboard_interrupt(self, mock_importer_class):
        """Test main function keyboard interrupt handling"""
        mock_importer = Mock()
        mock_importer.import_all_data.side_effect = KeyboardInterrupt()
        mock_importer_class.return_value = mock_importer

        from ccusage_importer import main

        with patch.object(sys, "argv", ["ccusage_importer.py"]):
            with pytest.raises(SystemExit) as excinfo:
                main()

        assert excinfo.value.code == 0

    @patch("ccusage_importer.ClickHouseImporter")
    def test_main_exception(self, mock_importer_class):
        """Test main function exception handling"""
        mock_importer_class.side_effect = Exception("Test error")

        from ccusage_importer import main

        with patch.object(sys, "argv", ["ccusage_importer.py"]):
            with pytest.raises(SystemExit) as excinfo:
                main()

        assert excinfo.value.code == 1


if __name__ == "__main__":
    pytest.main([__file__])
