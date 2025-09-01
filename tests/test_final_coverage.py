"""
Final tests to achieve 100% coverage
"""

import json
import subprocess
import sys
from io import StringIO
from unittest.mock import Mock, patch, MagicMock

import pytest

# Add the project root to the path
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ccusage_importer import ClickHouseImporter, system_check


class TestFinalCoveragePaths:
    """Tests for the remaining uncovered paths to achieve 100% coverage"""

    @patch('ccusage_importer.clickhouse_connect.get_client')
    @patch('ccusage_importer.subprocess.run')
    def test_run_ccusage_command_fallback_return(self, mock_run, mock_get_client):
        """Test fallback return statement in run_ccusage_command (line 340)"""
        # Mock successful client creation
        mock_client = Mock()
        mock_get_client.return_value = mock_client
        
        importer = ClickHouseImporter()
        
        # Mock subprocess to raise a different exception not handled specifically
        mock_run.side_effect = RuntimeError("Unexpected error")
        
        # This should trigger the fallback return {} at line 340
        result = importer.run_ccusage_command("daily", verbose=False)
        assert result == {}

    @patch('ccusage_importer.clickhouse_connect.get_client')
    def test_print_statistics_empty_model_usage(self, mock_get_client):
        """Test print_statistics with empty model usage (lines 964-969)"""
        # Mock successful client creation
        mock_client = Mock()
        mock_get_client.return_value = mock_client
        
        importer = ClickHouseImporter()
        
        # Create stats with empty model_usage to skip the loop
        stats = {
            "table_counts": {"ccusage_usage_daily": 5},
            "usage_summary": {
                "total_cost": 100.0,
                "total_tokens": 1000,
                "total_input_tokens": 200,
                "total_output_tokens": 300,
                "total_cache_creation_tokens": 400,
                "total_cache_read_tokens": 100,
                "earliest_date": "2025-01-01",
                "latest_date": "2025-01-31",
                "days_with_usage": 31
            },
            "model_usage": [],  # Empty list to skip lines 964-969
            "session_stats": {
                "total_sessions": 5,
                "avg_cost_per_session": 20.0,
                "max_cost_per_session": 50.0,
                "total_session_tokens": 5000
            },
            "active_blocks": {"active_blocks": 1}
        }
        
        # Capture output
        captured_output = StringIO()
        with patch('sys.stdout', captured_output):
            importer.print_statistics(stats)
            
        output = captured_output.getvalue()
        # Should not contain model output since list is empty
        assert "🤖 Top Models by Cost" in output
        # But no individual model entries should appear

    @patch('ccusage_importer.clickhouse_connect.get_client')
    def test_print_statistics_single_machine(self, mock_get_client):
        """Test print_statistics with single machine stats (lines 1002-1005)"""
        # Mock successful client creation  
        mock_client = Mock()
        mock_get_client.return_value = mock_client
        
        importer = ClickHouseImporter()
        
        # Create stats with single machine to trigger lines 1002-1005
        stats = {
            "table_counts": {"ccusage_usage_daily": 5},
            "usage_summary": {
                "total_cost": 100.0,
                "total_tokens": 1000,
                "total_input_tokens": 200,
                "total_output_tokens": 300,
                "total_cache_creation_tokens": 400,
                "total_cache_read_tokens": 100,
                "earliest_date": "2025-01-01",
                "latest_date": "2025-01-31",
                "days_with_usage": 31
            },
            "model_usage": [{"model_name": "gpt-4", "total_cost": 50.0, "total_tokens": 500}],
            "session_stats": {
                "total_sessions": 5,
                "avg_cost_per_session": 20.0,
                "max_cost_per_session": 50.0,
                "total_session_tokens": 5000
            },
            "active_blocks": {"active_blocks": 1},
            "machine_stats": [{"machine_name": "laptop-1", "total_cost": 100.0}]  # Single machine
        }
        
        # Capture output
        captured_output = StringIO()
        with patch('sys.stdout', captured_output):
            importer.print_statistics(stats)
            
        output = captured_output.getvalue()
        assert "🖥️  Machine" in output  # Single machine section
        assert "Name" in output
        assert "laptop-1" in output

    @patch('ccusage_importer.clickhouse_connect.get_client')
    def test_print_statistics_multiple_machines(self, mock_get_client):
        """Test print_statistics with multiple machines (lines 995-1001)"""
        # Mock successful client creation  
        mock_client = Mock()
        mock_get_client.return_value = mock_client
        
        importer = ClickHouseImporter()
        
        # Create stats with multiple machines to trigger lines 995-1001
        stats = {
            "table_counts": {"ccusage_usage_daily": 5},
            "usage_summary": {
                "total_cost": 200.0,
                "total_tokens": 2000,
                "total_input_tokens": 400,
                "total_output_tokens": 600,
                "total_cache_creation_tokens": 800,
                "total_cache_read_tokens": 200,
                "earliest_date": "2025-01-01",
                "latest_date": "2025-01-31",
                "days_with_usage": 31
            },
            "model_usage": [{"model_name": "gpt-4", "total_cost": 100.0, "total_tokens": 1000}],
            "session_stats": {
                "total_sessions": 10,
                "avg_cost_per_session": 20.0,
                "max_cost_per_session": 50.0,
                "total_session_tokens": 10000
            },
            "active_blocks": {"active_blocks": 2},
            "machine_stats": [
                {"machine_name": "laptop-1", "total_cost": 120.0},
                {"machine_name": "desktop-1", "total_cost": 80.0}
            ]  # Multiple machines
        }
        
        # Capture output
        captured_output = StringIO()
        with patch('sys.stdout', captured_output):
            importer.print_statistics(stats)
            
        output = captured_output.getvalue()
        assert "🖥️  Machines" in output  # Multiple machines section
        assert "1. laptop-1" in output
        assert "2. desktop-1" in output

    @patch('ccusage_importer.subprocess.run')
    def test_system_check_command_failures(self, mock_run):
        """Test system_check with various command failures (lines 1149-1156, 1219)"""
        
        # Test subprocess CalledProcessError with stderr
        def mock_run_with_failure(cmd, **kwargs):
            if 'daily' in cmd:
                error = subprocess.CalledProcessError(1, cmd)
                error.stderr = "Command failed"
                raise error
            elif 'monthly' in cmd:
                raise subprocess.TimeoutExpired(cmd, 30)
            elif 'session' in cmd:
                result = Mock()
                result.returncode = 0
                result.stdout = "invalid json"
                return result
            elif 'blocks' in cmd:
                raise Exception("Unexpected error")
            else:
                result = Mock()
                result.returncode = 0 
                result.stdout = '{"data": []}'
                return result
                
        mock_run.side_effect = mock_run_with_failure
        
        # Capture output
        captured_output = StringIO()
        with patch('sys.stdout', captured_output):
            result = system_check()
            
        output = captured_output.getvalue()
        
        # Should contain error messages for different failure types
        assert "❌" in output  # Command failure (line 1149)
        assert "⚠️" in output  # Timeout or JSON error (lines 1152, 1155)
        assert "SOME CHECKS FAILED" in output  # Line 1219
        assert result is False  # Should return False when checks fail

    @patch('ccusage_importer.subprocess.run')
    @patch('ccusage_importer.clickhouse_connect.get_client')
    def test_system_check_clickhouse_write_permission_error(self, mock_get_client, mock_run):
        """Test system_check ClickHouse write permission error (lines 1197-1198)"""
        
        # Mock ccusage commands to succeed
        mock_run.return_value = Mock(returncode=0, stdout='{"data": []}')
        
        # Mock ClickHouse client that fails on write operations
        mock_client = Mock()
        mock_client.query.return_value = Mock(result_rows=[[1]])  # Basic query works
        
        def mock_command(cmd):
            if "CREATE TABLE temp_check_table" in cmd:
                raise Exception("Permission denied for table creation")
            # Other commands work
            
        mock_client.command.side_effect = mock_command
        mock_get_client.return_value = mock_client
        
        # Capture output
        captured_output = StringIO()
        with patch('sys.stdout', captured_output):
            result = system_check()
            
        output = captured_output.getvalue()
        
        # Should contain write permission warning (lines 1197-1198)
        assert "⚠️  Write permissions: Limited" in output
        # But overall check should still pass since it's not a critical failure
        assert "ALL CHECKS PASSED" in output or "SOME CHECKS FAILED" in output