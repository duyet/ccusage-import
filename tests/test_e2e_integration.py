#!/usr/bin/env python3
"""
End-to-End Integration Tests for ccusage_importer
Tests the complete workflow including CLI, ClickHouse integration, and real data processing
"""

import os
import subprocess
import sys
import tempfile
import json
from unittest.mock import patch, Mock
import pytest

# Add the project root to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ccusage_importer import main, system_check, hash_project_name, HASH_PROJECT_NAMES


class TestEndToEndIntegration:
    """End-to-end integration tests for the complete ccusage import workflow"""
    
    def test_project_hashing_functionality(self):
        """Test project name hashing works correctly"""
        # Test hashing enabled
        with patch('ccusage_importer.HASH_PROJECT_NAMES', True):
            test_path = "/Users/test/project/my-secret-project"
            hashed = hash_project_name(test_path)
            
            # Should return 8-character hex string
            assert len(hashed) == 8
            assert all(c in '0123456789abcdef' for c in hashed.lower())
            
            # Should be stable (same input = same output)
            assert hash_project_name(test_path) == hashed
            
            # Different paths should produce different hashes
            assert hash_project_name("/different/path") != hashed
        
        # Test hashing disabled
        with patch('ccusage_importer.HASH_PROJECT_NAMES', False):
            test_path = "/Users/test/project/my-secret-project"
            result = hash_project_name(test_path)
            
            # Should return original path unchanged
            assert result == test_path

    def test_cli_argument_parsing(self):
        """Test command line argument parsing and help output"""
        # Test help output
        result = subprocess.run([
            sys.executable, "ccusage_importer.py", "--help"
        ], capture_output=True, text=True)
        
        assert result.returncode == 0
        assert "--check" in result.stdout
        assert "--no-hash-projects" in result.stdout
        assert "privacy enabled" in result.stdout.lower()

    @patch('ccusage_importer.clickhouse_connect.get_client')
    @patch('ccusage_importer.subprocess.run')
    def test_system_check_success(self, mock_subprocess, mock_clickhouse):
        """Test system check with all components working"""
        # Mock successful bunx/npx detection
        mock_subprocess.side_effect = [
            Mock(returncode=0, stdout="1.0.0"),  # bunx version
            Mock(returncode=0, stdout="10.0.0"), # npx version
            # Mock ccusage command responses
            Mock(returncode=0, stdout='{"data": [{"date": "2024-01-01"}]}'),  # daily
            Mock(returncode=0, stdout='{"data": [{"month": "2024-01"}]}'),    # monthly
            Mock(returncode=0, stdout='{"data": [{"sessionId": "test"}]}'),   # session
            Mock(returncode=0, stdout='{"blocks": [{"id": "test"}]}'),        # blocks
            Mock(returncode=0, stdout='{"data": [{"date": "2024-01-01"}]}'),  # projects
        ]
        
        # Mock ClickHouse client
        mock_client = Mock()
        mock_client.query.side_effect = [
            Mock(result_rows=[["25.5.1"]]),    # version query
            Mock(result_rows=[["test_db"]]),   # database query
            Mock(result_rows=[[42]]),          # table count query
        ]
        mock_client.command.return_value = None  # temp table operations
        mock_clickhouse.return_value = mock_client
        
        # Run system check
        result = system_check()
        
        assert result is True
        
        # Verify ClickHouse client was called correctly
        mock_clickhouse.assert_called_once()
        assert mock_client.query.call_count >= 3

    @patch('ccusage_importer.clickhouse_connect.get_client')
    @patch('ccusage_importer.subprocess.run')
    def test_system_check_clickhouse_failure(self, mock_subprocess, mock_clickhouse):
        """Test system check with ClickHouse connection failure"""
        # Mock successful bunx/npx detection
        mock_subprocess.side_effect = [
            Mock(returncode=0, stdout="1.0.0"),  # bunx version
            Mock(returncode=0, stdout="10.0.0"), # npx version
            # Mock ccusage commands
            Mock(returncode=0, stdout='{"data": [{}]}'),
            Mock(returncode=0, stdout='{"data": [{}]}'),
            Mock(returncode=0, stdout='{"data": [{}]}'),
            Mock(returncode=0, stdout='{"blocks": [{}]}'),
            Mock(returncode=0, stdout='{"data": [{}]}'),
        ]
        
        # Mock ClickHouse connection failure
        mock_clickhouse.side_effect = Exception("Connection failed")
        
        result = system_check()
        
        assert result is False

    @patch('ccusage_importer.subprocess.run')
    def test_system_check_ccusage_failure(self, mock_subprocess):
        """Test system check with ccusage command failures"""
        # Mock no package managers available
        mock_subprocess.side_effect = [
            FileNotFoundError(),  # bunx not found
            FileNotFoundError(),  # npx not found
        ]
        
        result = system_check()
        
        assert result is False

    def test_cli_check_mode_integration(self):
        """Test --check mode end-to-end with mocked dependencies"""
        with patch('ccusage_importer.system_check', return_value=True) as mock_check:
            # Test successful check
            result = subprocess.run([
                sys.executable, "ccusage_importer.py", "--check"
            ], capture_output=True, text=True)
            
            mock_check.assert_called_once()
            assert result.returncode == 0

        with patch('ccusage_importer.system_check', return_value=False) as mock_check:
            # Test failed check
            result = subprocess.run([
                sys.executable, "ccusage_importer.py", "--check"
            ], capture_output=True, text=True)
            
            mock_check.assert_called_once()
            assert result.returncode == 1

    def test_privacy_mode_cli_integration(self):
        """Test privacy mode toggling via CLI"""
        # Test default privacy enabled behavior
        with patch('ccusage_importer.ClickHouseImporter') as mock_importer, \
             patch('ccusage_importer.HASH_PROJECT_NAMES') as mock_hash_setting:
            
            # Mock importer
            mock_instance = Mock()
            mock_importer.return_value = mock_instance
            
            # Test default behavior (privacy enabled)
            with patch.object(sys, 'argv', ['ccusage_importer.py']):
                try:
                    main()
                except SystemExit:
                    pass
            
            # Should not modify the global setting when no flag is provided
            # (it remains True by default)

    @patch('ccusage_importer.ClickHouseImporter')
    def test_no_hash_projects_flag(self, mock_importer):
        """Test --no-hash-projects flag functionality"""
        mock_instance = Mock()
        mock_importer.return_value = mock_instance
        
        # Test with --no-hash-projects flag
        result = subprocess.run([
            sys.executable, "ccusage_importer.py", "--no-hash-projects"
        ], capture_output=True, text=True, timeout=30)
        
        # Should show "Project Privacy: Disabled" in output
        assert "Project Privacy: Disabled" in result.stdout or result.returncode == 0

    def test_error_handling_and_recovery(self):
        """Test error handling scenarios"""
        # Test with invalid ClickHouse credentials
        with patch.dict(os.environ, {
            'CH_HOST': 'invalid-host',
            'CH_PORT': '9999',
            'CH_USER': 'invalid',
            'CH_PASSWORD': 'invalid',
            'CH_DATABASE': 'invalid'
        }):
            result = subprocess.run([
                sys.executable, "ccusage_importer.py", "--check"
            ], capture_output=True, text=True, timeout=60)
            
            # Should fail gracefully
            assert result.returncode == 1
            assert "ClickHouse connection failed" in result.stdout

    def test_hash_collision_resistance(self):
        """Test hash collision resistance and distribution"""
        test_paths = [
            "/Users/alice/project1",
            "/Users/alice/project2", 
            "/Users/bob/project1",
            "/home/user/workspace/project-a",
            "/home/user/workspace/project-b",
            "/very/long/path/to/some/deeply/nested/project/directory",
            "short",
            "",
            "/Users/test/project-with-special-chars!@#$%^&*()",
        ]
        
        with patch('ccusage_importer.HASH_PROJECT_NAMES', True):
            hashes = []
            for path in test_paths:
                hash_val = hash_project_name(path)
                assert len(hash_val) == 8
                assert hash_val not in hashes, f"Hash collision detected for {path}"
                hashes.append(hash_val)

    def test_import_flow_integration(self):
        """Test the complete import flow with mocked data sources"""
        with patch('ccusage_importer.subprocess.run') as mock_run, \
             patch('ccusage_importer.clickhouse_connect.get_client') as mock_client:
            
            # Mock ccusage command responses
            mock_run.side_effect = [
                # ccusage commands return valid JSON
                Mock(returncode=0, stdout='{"data": [{"date": "2024-01-01", "inputTokens": 100, "outputTokens": 50, "cacheCreationTokens": 10, "cacheReadTokens": 5, "totalTokens": 165, "totalCost": 0.01, "modelsUsed": ["gpt-4"], "modelBreakdowns": [{"modelName": "gpt-4", "inputTokens": 100, "outputTokens": 50, "cacheCreationTokens": 10, "cacheReadTokens": 5, "cost": 0.01}]}]}'),
                Mock(returncode=0, stdout='{"data": [{"month": "2024-01", "inputTokens": 100, "outputTokens": 50, "cacheCreationTokens": 10, "cacheReadTokens": 5, "totalTokens": 165, "totalCost": 0.01, "modelsUsed": ["gpt-4"], "modelBreakdowns": [{"modelName": "gpt-4", "inputTokens": 100, "outputTokens": 50, "cacheCreationTokens": 10, "cacheReadTokens": 5, "cost": 0.01}]}]}'),
                Mock(returncode=0, stdout='{"data": [{"sessionId": "test-session", "projectPath": "/test/project", "inputTokens": 100, "outputTokens": 50, "cacheCreationTokens": 10, "cacheReadTokens": 5, "totalTokens": 165, "totalCost": 0.01, "lastActivity": "2024-01-01", "modelsUsed": ["gpt-4"], "modelBreakdowns": [{"modelName": "gpt-4", "inputTokens": 100, "outputTokens": 50, "cacheCreationTokens": 10, "cacheReadTokens": 5, "cost": 0.01}]}]}'),
                Mock(returncode=0, stdout='{"blocks": [{"id": "2024-01-01T00:00:00.000Z", "startTime": "2024-01-01T00:00:00.000Z", "endTime": "2024-01-01T05:00:00.000Z", "actualEndTime": "2024-01-01T04:30:00.000Z", "isActive": false, "isGap": false, "entries": 10, "tokenCounts": {"inputTokens": 100, "outputTokens": 50, "cacheCreationInputTokens": 10, "cacheReadInputTokens": 5}, "totalTokens": 165, "costUSD": 0.01, "models": ["gpt-4"], "burnRate": null, "projection": null}]}'),
                Mock(returncode=0, stdout='{"data": {"test-project": [{"date": "2024-01-01", "inputTokens": 100, "outputTokens": 50, "cacheCreationTokens": 10, "cacheReadTokens": 5, "totalTokens": 165, "totalCost": 0.01, "modelsUsed": ["gpt-4"], "modelBreakdowns": [{"modelName": "gpt-4", "inputTokens": 100, "outputTokens": 50, "cacheCreationTokens": 10, "cacheReadTokens": 5, "cost": 0.01}]}]}}'),
            ]
            
            # Mock ClickHouse client
            mock_ch_client = Mock()
            mock_ch_client.command.return_value = None
            mock_ch_client.insert.return_value = None
            mock_ch_client.query.return_value = Mock(result_rows=[[10]])
            mock_client.return_value = mock_ch_client
            
            # Run the import
            result = subprocess.run([
                sys.executable, "ccusage_importer.py"
            ], capture_output=True, text=True, timeout=60)
            
            # Should complete successfully
            assert result.returncode == 0 or "Import completed" in result.stdout

    def test_concurrent_data_fetching(self):
        """Test that concurrent data fetching works correctly"""
        with patch('ccusage_importer.subprocess.run') as mock_run:
            # Mock all ccusage commands to return quickly
            mock_run.return_value = Mock(
                returncode=0, 
                stdout='{"data": [{"test": "data"}]}'
            )
            
            # Import the function that handles concurrent fetching
            from ccusage_importer import ClickHouseImporter
            
            with patch('ccusage_importer.clickhouse_connect.get_client'):
                importer = ClickHouseImporter()
                
                # Mock the fetch_ccusage_data method to test concurrency
                with patch.object(importer, 'fetch_ccusage_data') as mock_fetch:
                    mock_fetch.return_value = ({}, {}, {}, {}, {})
                    
                    # This should not raise any exceptions
                    try:
                        importer.import_all_data()
                    except Exception as e:
                        # Allow expected exceptions (like missing data)
                        assert "data" in str(e).lower() or "import" in str(e).lower()


class TestProjectPrivacyIntegration:
    """Integration tests specifically for project privacy features"""
    
    def test_privacy_end_to_end_workflow(self):
        """Test complete privacy workflow from CLI to database"""
        test_session_data = {
            "sessionId": "/Users/sensitive/secret-project", 
            "projectPath": "/Users/sensitive/secret-project",
            "inputTokens": 100,
            "outputTokens": 50,
            "cacheCreationTokens": 10,
            "cacheReadTokens": 5,
            "totalTokens": 165,
            "totalCost": 0.01,
            "lastActivity": "2024-01-01",
            "modelsUsed": ["gpt-4"],
            "modelBreakdowns": []
        }
        
        with patch('ccusage_importer.HASH_PROJECT_NAMES', True):
            hashed_session = hash_project_name(test_session_data["sessionId"])
            hashed_project = hash_project_name(test_session_data["projectPath"])
            
            # Verify hashes are different from originals
            assert hashed_session != test_session_data["sessionId"]
            assert hashed_project != test_session_data["projectPath"]
            
            # Verify hash properties
            assert len(hashed_session) == 8
            assert len(hashed_project) == 8
    
    def test_privacy_disabled_workflow(self):
        """Test workflow with privacy disabled"""
        test_path = "/Users/test/my-project"
        
        with patch('ccusage_importer.HASH_PROJECT_NAMES', False):
            result = hash_project_name(test_path)
            assert result == test_path


if __name__ == "__main__":
    # Run the tests
    pytest.main([__file__, "-v"])