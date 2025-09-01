"""
Tests for main.py entry point
"""

import sys
from io import StringIO
from unittest.mock import patch

import pytest

# Add the project root to the path
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from main import main


class TestMainModule:
    """Tests for main.py module"""

    def test_main_function_output(self):
        """Test that main function prints expected message"""
        # Capture stdout
        captured_output = StringIO()
        
        with patch('sys.stdout', captured_output):
            main()
        
        # Verify output
        output = captured_output.getvalue().strip()
        assert output == "Hello from ccusage-import!"
    
    def test_main_script_execution(self):
        """Test main.py execution as a script"""
        import subprocess
        import sys
        import os
        
        # Execute main.py as a script to test __name__ == "__main__" 
        result = subprocess.run(
            [sys.executable, 'main.py'],
            capture_output=True,
            text=True,
            cwd=os.path.dirname(os.path.dirname(__file__))  # Project root
        )
        
        assert result.returncode == 0
        assert "Hello from ccusage-import!" in result.stdout.strip()
    
    def test_main_function_call_count(self):
        """Test that main function is called exactly once"""
        call_count = 0
        
        def mock_print(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            
        with patch('builtins.print', mock_print):
            main()
            
        assert call_count == 1