"""
Tests for UI formatting classes to achieve 100% coverage
"""

import sys
import time
from io import StringIO
from unittest.mock import patch, MagicMock

import pytest

# Add the project root to the path
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ccusage_importer import LoadingAnimation, UIFormatter


class TestLoadingAnimationCoverage:
    """Tests for LoadingAnimation edge cases"""

    def test_loading_animation_stop_no_messages(self):
        """Test LoadingAnimation.stop() with no success or error message (line 105)"""
        animation = LoadingAnimation("Test operation")
        
        # Start the animation
        animation.start()
        time.sleep(0.1)  # Let it run briefly
        
        # Capture output when stopping with no messages
        captured_output = StringIO()
        with patch('sys.stdout', captured_output):
            animation.stop()  # No success_message or error_message
            
        output = captured_output.getvalue()
        assert "✅ Test operation completed" in output
        
    def test_loading_animation_stop_with_success_message(self):
        """Test LoadingAnimation.stop() with success message"""
        animation = LoadingAnimation("Test operation")
        animation.start()
        time.sleep(0.1)
        
        captured_output = StringIO()
        with patch('sys.stdout', captured_output):
            animation.stop("Custom success message")
            
        output = captured_output.getvalue()
        assert "✅ Custom success message" in output
        
    def test_loading_animation_stop_with_error_message(self):
        """Test LoadingAnimation.stop() with error message"""
        animation = LoadingAnimation("Test operation")
        animation.start()
        time.sleep(0.1)
        
        captured_output = StringIO()
        with patch('sys.stdout', captured_output):
            animation.stop(error_message="Something went wrong")
            
        output = captured_output.getvalue()
        assert "❌ Something went wrong" in output


class TestUIFormatterCoverage:
    """Tests for UIFormatter edge cases"""

    def test_print_step_without_description(self):
        """Test UIFormatter.print_step() without description (line 128)"""
        captured_output = StringIO()
        
        with patch('sys.stdout', captured_output):
            # Call print_step without description parameter
            UIFormatter.print_step(1, "Test Title")
            
        output = captured_output.getvalue()
        assert "1️⃣  Test Title" in output
        # Should not contain the description line
        assert "   " not in output.split('\n')[1] if len(output.split('\n')) > 1 else True
        
    def test_print_step_with_description(self):
        """Test UIFormatter.print_step() with description"""
        captured_output = StringIO()
        
        with patch('sys.stdout', captured_output):
            UIFormatter.print_step(2, "Test Title", "Test description")
            
        output = captured_output.getvalue()
        assert "2️⃣  Test Title" in output
        assert "   Test description" in output

    def test_format_duration_milliseconds(self):
        """Test format_duration for values < 1 second"""
        result = UIFormatter.format_duration(0.5)
        assert result == "500ms"
        
        result = UIFormatter.format_duration(0.123)
        assert result == "123ms"
        
    def test_format_duration_seconds(self):
        """Test format_duration for values < 60 seconds (lines 140-141)"""
        result = UIFormatter.format_duration(30.5)
        assert result == "30.5s"
        
        result = UIFormatter.format_duration(59.9)
        assert result == "59.9s"
        
    def test_format_duration_minutes(self):
        """Test format_duration for values >= 60 seconds (lines 142-145)"""
        result = UIFormatter.format_duration(90.5)
        assert result == "1m 30.5s"
        
        result = UIFormatter.format_duration(125.7)
        assert result == "2m 5.7s"
        
        result = UIFormatter.format_duration(3661)  # 1 hour, 1 minute, 1 second
        assert result == "61m 1.0s"

    def test_format_number_billions(self):
        """Test format_number for billions (line 151)"""
        result = UIFormatter.format_number(5_000_000_000)
        assert result == "5.0B"
        
        result = UIFormatter.format_number(2_500_000_000)
        assert result == "2.5B"
        
    def test_format_number_millions(self):
        """Test format_number for millions (line 153)"""
        result = UIFormatter.format_number(15_000_000)
        assert result == "15.0M"
        
        result = UIFormatter.format_number(2_500_000)
        assert result == "2.5M"
        
    def test_format_number_thousands(self):
        """Test format_number for thousands"""
        result = UIFormatter.format_number(15_000)
        assert result == "15.0K"
        
        result = UIFormatter.format_number(2_500)
        assert result == "2.5K"
        
    def test_format_number_small(self):
        """Test format_number for small numbers"""
        result = UIFormatter.format_number(999)
        assert result == "999"
        
        result = UIFormatter.format_number(123)
        assert result == "123"
        
    def test_format_number_edge_cases(self):
        """Test format_number edge cases at boundaries"""
        # Test boundary values
        result = UIFormatter.format_number(1_000)  # Exactly 1K
        assert result == "1.0K"
        
        result = UIFormatter.format_number(1_000_000)  # Exactly 1M
        assert result == "1.0M"
        
        result = UIFormatter.format_number(1_000_000_000)  # Exactly 1B
        assert result == "1.0B"