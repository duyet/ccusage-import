"""
Tests for exception handling paths to achieve 100% coverage
"""

# Add the project root to the path
import os
import subprocess
import sys
from unittest.mock import Mock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ccusage_importer import ClickHouseImporter


class TestClickHouseImporterExceptionHandling:
    """Tests for exception handling in ClickHouseImporter"""

    @patch("ccusage_importer.clickhouse_connect.get_client")
    def test_extract_burn_rate_branches(self, mock_get_client):
        """Test all branches of _extract_burn_rate method"""
        # Mock successful client creation
        mock_client = Mock()
        mock_get_client.return_value = mock_client

        importer = ClickHouseImporter()

        # Test None case (line 214-215)
        result = importer._extract_burn_rate(None)
        assert result is None

        # Test numeric case (line 216-217)
        result = importer._extract_burn_rate(5.5)
        assert result == 5.5

        result = importer._extract_burn_rate(10)
        assert result == 10.0

        # Test dict case with costPerHour (line 218-220)
        result = importer._extract_burn_rate({"costPerHour": 2.5})
        assert result == 2.5

        # Test dict case without costPerHour (returns None)
        result = importer._extract_burn_rate({"other": "value"})
        assert result is None

        # Test invalid type case (line 221)
        result = importer._extract_burn_rate("invalid")
        assert result is None

    @patch("ccusage_importer.clickhouse_connect.get_client")
    def test_extract_projection_branches(self, mock_get_client):
        """Test all branches of _extract_projection method"""
        # Mock successful client creation
        mock_client = Mock()
        mock_get_client.return_value = mock_client

        importer = ClickHouseImporter()

        # Test None case (line 225-226)
        result = importer._extract_projection(None)
        assert result is None

        # Test numeric case (line 227-228)
        result = importer._extract_projection(15.5)
        assert result == 15.5

        result = importer._extract_projection(20)
        assert result == 20.0

        # Test dict case with totalCost (line 229-231)
        result = importer._extract_projection({"totalCost": 12.5})
        assert result == 12.5

        # Test dict case without totalCost (returns None)
        result = importer._extract_projection({"other": "value"})
        assert result is None

        # Test invalid type case (line 232)
        result = importer._extract_projection("invalid")
        assert result is None

    @patch("ccusage_importer.clickhouse_connect.get_client")
    def test_parse_datetime_non_z_format(self, mock_get_client):
        """Test parse_datetime without Z suffix (line 210)"""
        # Mock successful client creation
        mock_client = Mock()
        mock_get_client.return_value = mock_client

        importer = ClickHouseImporter()

        # Test datetime string without Z suffix
        result = importer._parse_datetime("2025-08-02T15:00:00.000")
        assert result.year == 2025
        assert result.month == 8
        assert result.day == 2

    @patch("ccusage_importer.clickhouse_connect.get_client")
    @patch("ccusage_importer.subprocess.run")
    def test_run_ccusage_command_verbose_retry(self, mock_run, mock_get_client):
        """Test verbose output during retries (lines 301, 305)"""
        # Mock successful client creation
        mock_client = Mock()
        mock_get_client.return_value = mock_client

        importer = ClickHouseImporter()

        # Mock subprocess to raise TimeoutExpired on first call, succeed on second
        mock_run.side_effect = [
            subprocess.TimeoutExpired(cmd=["bunx"], timeout=30),
            Mock(stdout='{"test": "data"}', returncode=0),
        ]

        # Capture print output to verify verbose messages
        import io
        from contextlib import redirect_stdout

        captured_output = io.StringIO()
        with redirect_stdout(captured_output):
            result = importer.run_ccusage_command("daily", verbose=True)

        output = captured_output.getvalue()
        assert "Running: bunx ccusage@latest daily --json" in output  # Line 301-303
        assert "Retry 1: bunx ccusage@latest daily --json" in output  # Line 305-307
        assert result == {"test": "data"}

    @patch("ccusage_importer.clickhouse_connect.get_client")
    @patch("ccusage_importer.subprocess.run")
    def test_run_ccusage_command_timeout_final_attempt(self, mock_run, mock_get_client):
        """Test timeout on final attempt (lines 320-325)"""
        # Mock successful client creation
        mock_client = Mock()
        mock_get_client.return_value = mock_client

        importer = ClickHouseImporter()

        # Mock subprocess to raise TimeoutExpired on all attempts
        mock_run.side_effect = subprocess.TimeoutExpired(cmd=["bunx"], timeout=30)

        import io
        from contextlib import redirect_stdout

        captured_output = io.StringIO()
        with redirect_stdout(captured_output):
            result = importer.run_ccusage_command("daily", verbose=True)

        output = captured_output.getvalue()
        assert "Timeout running ccusage daily (attempt" in output  # Lines 321-323
        assert result == {}  # Line 325

    @patch("ccusage_importer.clickhouse_connect.get_client")
    @patch("ccusage_importer.subprocess.run")
    def test_run_ccusage_command_process_error_with_stderr(
        self, mock_run, mock_get_client
    ):
        """Test CalledProcessError with stderr (lines 326-334)"""
        # Mock successful client creation
        mock_client = Mock()
        mock_get_client.return_value = mock_client

        importer = ClickHouseImporter()

        # Create a CalledProcessError with stderr
        error = subprocess.CalledProcessError(1, ["bunx"])
        error.stderr = "Command failed with error"
        mock_run.side_effect = error

        import io
        from contextlib import redirect_stdout

        captured_output = io.StringIO()
        with redirect_stdout(captured_output):
            result = importer.run_ccusage_command("daily", verbose=True)

        output = captured_output.getvalue()
        assert "Error running ccusage daily" in output  # Lines 328-330
        assert "Error output: Command failed with error" in output  # Lines 331-332
        assert result == {}  # Line 334

    @patch("ccusage_importer.clickhouse_connect.get_client")
    @patch("ccusage_importer.subprocess.run")
    def test_run_ccusage_command_json_decode_error(self, mock_run, mock_get_client):
        """Test JSON decode error (lines 335-338)"""
        # Mock successful client creation
        mock_client = Mock()
        mock_get_client.return_value = mock_client

        importer = ClickHouseImporter()

        # Mock subprocess to return invalid JSON
        mock_run.return_value = Mock(stdout="invalid json", returncode=0)

        import io
        from contextlib import redirect_stdout

        captured_output = io.StringIO()
        with redirect_stdout(captured_output):
            result = importer.run_ccusage_command("daily", verbose=True)

        output = captured_output.getvalue()
        assert "Error parsing JSON from ccusage daily" in output  # Line 337
        assert result == {}  # Line 338

    @patch("ccusage_importer.clickhouse_connect.get_client")
    def test_empty_data_early_returns(self, mock_get_client):
        """Test early return paths for empty data (lines 433, 519)"""
        # Mock successful client creation
        mock_client = Mock()
        mock_get_client.return_value = mock_client

        importer = ClickHouseImporter()

        # Reset the mock call count to ignore initialization calls
        mock_client.reset_mock()

        # Test upsert_monthly_data with empty data (line 433)
        result = importer.upsert_monthly_data([])  # Should return early
        assert result is None  # Early return should return None

        # Test upsert_session_data with empty data (line 519)
        result = importer.upsert_session_data([])  # Should return early
        assert result is None  # Early return should return None

        # Verify no database modification calls were made for empty data
        # (command is used for DELETE/INSERT statements)
        assert not mock_client.command.called

    @patch("ccusage_importer.clickhouse_connect.get_client")
    def test_statistics_generation_table_count_error(self, mock_get_client):
        """Test statistics generation table count error (lines 805-807)"""
        # Mock client that raises exception during table count query
        mock_client = Mock()

        # Make the client raise exception on specific table count queries
        def mock_query(query):
            if "SELECT count() FROM" in query:
                raise Exception("Table does not exist")
            # Return mock data for other queries (usage summary, model stats, etc.)
            mock_result = Mock()
            if "sum(total_cost)" in query:
                # Usage summary query - return 9 values as expected
                mock_result.result_rows = [[0.0, 0, 0, 0, 0, 0, None, None, 0]]
            elif "model_name" in query:
                # Model stats query
                mock_result.result_rows = []
            elif "count() as total_sessions" in query:
                # Session stats query
                mock_result.result_rows = [[0, 0.0, 0.0, 0]]
            elif "count() as active_blocks" in query:
                # Active blocks query
                mock_result.result_rows = [[0]]
            else:
                # Default fallback
                mock_result.result_rows = [[0]]
            return mock_result

        mock_client.query.side_effect = mock_query
        mock_get_client.return_value = mock_client

        importer = ClickHouseImporter()

        # This should trigger the exception handling in get_import_statistics
        # The exception should be caught and table count set to 0
        stats = importer.get_import_statistics()

        # Verify that table_counts exists and contains 0 for tables that failed
        assert "table_counts" in stats
        # At least one table count should be 0 due to the exception
        table_counts = stats["table_counts"]
        assert any(count == 0 for count in table_counts.values())
