#!/usr/bin/env python3
"""
UI and formatting utilities for ccusage-import
Provides loading animations and formatted output
"""

import threading
import time
from typing import Optional


class LoadingAnimation:
    """Animated loading indicator for long-running operations"""

    def __init__(
        self, message: str = "Loading", spinner_chars: str = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
    ):
        self.message = message
        self.spinner_chars = spinner_chars
        self.is_running = False
        self.thread = None
        self.current_line = ""

    def _animate(self):
        """Internal animation loop"""
        i = 0
        while self.is_running:
            char = self.spinner_chars[i % len(self.spinner_chars)]
            self.current_line = f"\r{char} {self.message}..."
            print(self.current_line, end="", flush=True)
            time.sleep(0.1)
            i += 1

    def start(self):
        """Start the loading animation"""
        if not self.is_running:
            self.is_running = True
            self.thread = threading.Thread(target=self._animate, daemon=True)
            self.thread.start()

    def stop(
        self, success_message: Optional[str] = None, error_message: Optional[str] = None
    ):
        """Stop the animation and show final message"""
        if self.is_running:
            self.is_running = False
            if self.thread:
                self.thread.join(timeout=0.2)

            # Clear the current line
            print("\r" + " " * len(self.current_line), end="\r", flush=True)

            # Show final message
            if error_message:
                print(f"❌ {error_message}")
            elif success_message:
                print(f"✅ {success_message}")
            else:
                print(f"✅ {self.message} completed")


class UIFormatter:
    """Enhanced UI formatting utilities"""

    @staticmethod
    def print_header(title: str, width: int = 50):
        """Print a compact header"""
        print(f"\n🚀 {title}")

    @staticmethod
    def print_section(title: str, width: int = 50):
        """Print a compact section"""
        print(f"\n{title}")

    @staticmethod
    def print_step(step_num: int, title: str, description: str = ""):
        """Print a numbered step"""
        if description:
            print(f"\n{step_num}️⃣  {title}")
            print(f"   {description}")
        else:
            print(f"\n{step_num}️⃣  {title}")

    @staticmethod
    def print_metric(label: str, value: str, width: int = 25):
        """Print a compact metric"""
        print(f"  {label}: {value}")

    @staticmethod
    def format_duration(seconds: float) -> str:
        """Format duration in a human-readable way"""
        if seconds < 1:
            return f"{seconds * 1000:.0f}ms"
        elif seconds < 60:
            return f"{seconds:.1f}s"
        else:
            mins = int(seconds // 60)
            secs = seconds % 60
            return f"{mins}m {secs:.1f}s"

    @staticmethod
    def format_number(num: int) -> str:
        """Format large numbers with appropriate suffixes"""
        if num >= 1_000_000_000:
            return f"{num / 1_000_000_000:.1f}B"
        elif num >= 1_000_000:
            return f"{num / 1_000_000:.1f}M"
        elif num >= 1_000:
            return f"{num / 1_000:.1f}K"
        else:
            return f"{num:,}"
