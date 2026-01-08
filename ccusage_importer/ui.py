"""
UI formatting and display module.
Handles output formatting, animations, and visual elements.
"""

import logging
import threading
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class LoadingAnimation:
    """Animated loading indicator for long-running operations."""

    def __init__(
        self,
        message: str = "Loading",
        spinner_chars: str = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏",
        enabled: bool = True,
    ):
        """
        Initialize loading animation.

        Args:
            message: Message to display with spinner
            spinner_chars: Characters to use for spinner animation
            enabled: Whether animation is enabled
        """
        self.message = message
        self.spinner_chars = spinner_chars
        self.enabled = enabled
        self.is_running = False
        self.thread: Optional[threading.Thread] = None
        self.current_line = ""

    def _animate(self):
        """Internal animation loop."""
        if not self.enabled:
            return

        i = 0
        while self.is_running:
            char = self.spinner_chars[i % len(self.spinner_chars)]
            self.current_line = f"\r{char} {self.message}..."
            print(self.current_line, end="", flush=True)
            time.sleep(0.1)
            i += 1

    def start(self):
        """Start the loading animation."""
        if not self.is_running and self.enabled:
            self.is_running = True
            self.thread = threading.Thread(target=self._animate, daemon=True)
            self.thread.start()

    def stop(
        self,
        success_message: Optional[str] = None,
        error_message: Optional[str] = None,
    ):
        """
        Stop the animation and show final message.

        Args:
            success_message: Message to show on success
            error_message: Message to show on error
        """
        self.is_running = False

        if self.thread:
            self.thread.join(timeout=0.2)

        if self.enabled and self.current_line:
            # Clear the spinner line
            print("\r" + " " * len(self.current_line) + "\r", end="", flush=True)

        if success_message:
            print(f"✅ {success_message}")
        elif error_message:
            print(f"❌ {error_message}")


class NumberFormatter:
    """Format numbers with human-readable suffixes."""

    def __init__(self, decimal_places: int = 1):
        """
        Initialize number formatter.

        Args:
            decimal_places: Number of decimal places to show
        """
        self.decimal_places = decimal_places

    def format_number(self, num: float) -> str:
        """
        Format a number with K/M/B suffixes.

        Args:
            num: Number to format

        Returns:
            Formatted string with suffix
        """
        if num >= 1_000_000_000:
            return f"{num / 1_000_000_000:.{self.decimal_places}f}B"
        elif num >= 1_000_000:
            return f"{num / 1_000_000:.{self.decimal_places}f}M"
        elif num >= 1_000:
            return f"{num / 1_000:.{self.decimal_places}f}K"
        else:
            return f"{num:.{self.decimal_places}f}"

    def format_cost(self, cost: float) -> str:
        """
        Format a cost value in USD.

        Args:
            cost: Cost value

        Returns:
            Formatted cost string
        """
        return f"${self.format_number(cost)}"


class DurationFormatter:
    """Format time durations in human-readable format."""

    @staticmethod
    def format_duration(seconds: float) -> str:
        """
        Format duration in seconds to human-readable string.

        Args:
            seconds: Duration in seconds

        Returns:
            Formatted duration string (e.g., "1h 23m 45s")
        """
        if seconds < 60:
            return f"{seconds:.1f}s"

        minutes = int(seconds // 60)
        remaining_seconds = seconds % 60

        if minutes < 60:
            return f"{minutes}m {remaining_seconds:.0f}s"

        hours = minutes // 60
        remaining_minutes = minutes % 60

        if hours < 24:
            return f"{hours}h {remaining_minutes}m"

        days = hours // 24
        remaining_hours = hours % 24

        return f"{days}d {remaining_hours}h"


class StatisticsFormatter:
    """Format and display import statistics."""

    def __init__(
        self,
        number_formatter: Optional[NumberFormatter] = None,
        verbose: bool = False,
    ):
        """
        Initialize statistics formatter.

        Args:
            number_formatter: Number formatter instance
            verbose: Whether to show verbose output
        """
        self.number_formatter = number_formatter or NumberFormatter()
        self.verbose = verbose

    def print_statistics(self, stats: Dict[str, Any]):
        """
        Print comprehensive import statistics.

        Args:
            stats: Statistics dictionary from importer
        """
        # Section header
        print("\n" + "═" * 60)
        print("📊 IMPORT STATISTICS")
        print("═" * 60)

        # Table row counts
        self._print_table_counts(stats.get("table_counts", {}))

        # Cost breakdown
        self._print_cost_breakdown(stats.get("cost_breakdown", {}))

        # Token consumption
        self._print_token_consumption(stats.get("token_consumption", {}))

        # Model rankings
        self._print_model_rankings(stats.get("model_rankings", []))

        # Active blocks
        self._print_active_blocks(stats.get("active_blocks", []))

        print("═" * 60 + "\n")

    def _print_table_counts(self, counts: Dict[str, Dict[str, int]]):
        """Print table row counts by source."""
        print("\n📈 Table Record Counts:")

        table_names = {
            "ccusage_usage_daily": "Daily Usage",
            "ccusage_usage_monthly": "Monthly Usage",
            "ccusage_usage_sessions": "Sessions",
            "ccusage_usage_blocks": "Billing Blocks",
            "ccusage_usage_projects_daily": "Project Daily",
            "ccusage_model_breakdowns": "Model Breakdowns",
            "ccusage_models_used": "Models Used",
        }

        for table, display_name in table_names.items():
            if table in counts:
                sources = counts[table]
                total = sum(sources.values())

                # Format source breakdown
                source_str = ", ".join([f"{src}: {self.number_formatter.format_number(cnt)}" for src, cnt in sources.items()])

                print(f"  {display_name:20} {self.number_formatter.format_number(total):>10} ({source_str})")

    def _print_cost_breakdown(self, costs: Dict[str, float]):
        """Print cost breakdown by source."""
        print("\n💰 Cost Breakdown:")

        for source, cost in sorted(costs.items()):
            print(f"  {source.capitalize():10} {self.number_formatter.format_cost(cost):>15}")

        total_cost = sum(costs.values())
        print(f"  {'Total':10} {self.number_formatter.format_cost(total_cost):>15}")

    def _print_token_consumption(self, tokens: Dict[str, float]):
        """Print token consumption metrics."""
        print("\n🔢 Token Consumption:")

        labels = {
            "input": "Input Tokens",
            "output": "Output Tokens",
            "cache_read": "Cache Read Tokens",
            "cache_creation": "Cache Creation Tokens",
            "total": "Total Tokens",
        }

        for key, label in labels.items():
            if key in tokens:
                print(f"  {label:20} {self.number_formatter.format_number(tokens[key]):>15}")

    def _print_model_rankings(self, rankings: List[Dict[str, Any]]):
        """Print model usage rankings by cost."""
        if not rankings:
            return

        print("\n🤖 Model Rankings (by Cost):")

        for i, model in enumerate(rankings[:10], 1):
            cost_str = self.number_formatter.format_cost(model["cost"])
            tokens_str = self.number_formatter.format_number(model["total_tokens"])
            print(f"  {i:2}. {model['model_name']:30} {cost_str:>12} ({tokens_str} tokens)")

    def _print_active_blocks(self, blocks: List[Dict[str, Any]]):
        """Print active billing blocks."""
        if not blocks:
            print("\n⚠️  No active billing blocks")
            return

        print(f"\n⏰ Active Billing Blocks ({len(blocks)}):")

        for block in blocks[:5]:  # Show max 5 blocks
            end_time = block.get("end_time", "unknown")
            cost_str = self.number_formatter.format_cost(block.get("cost", 0))
            print(f"  • Ends: {end_time}, Cost: {cost_str}")


class HeatmapBuilder:
    """Build heatmap grids for usage visualization."""

    def __init__(self, intensity_levels: int = 5):
        """
        Initialize heatmap builder.

        Args:
            intensity_levels: Number of intensity levels for heatmap
        """
        self.intensity_levels = intensity_levels

    def build_heatmap_grid(
        self,
        daily_data: List[Dict[str, Any]],
        days: int = 365,
    ) -> List[List[Optional[int]]]:
        """
        Build heatmap grid from daily usage data.

        Args:
            daily_data: List of daily usage records
            days: Number of days to include in heatmap

        Returns:
            2D grid of intensity values (None for no data)
        """
        # Create date -> value mapping
        date_values: Dict[str, float] = {}
        for record in daily_data:
            date_str = record.get("date", "")
            cost = record.get("total_cost", 0)
            date_values[date_str] = cost

        # Calculate max value for normalization
        max_value = max(date_values.values()) if date_values else 1

        # Build grid (weeks x days_of_week)
        # Start from 'days' ago and go backwards
        grid = []
        end_date = datetime.now().date()

        # Create 7-day row for each week
        current_date = end_date - timedelta(days=days)

        # Align to Sunday
        current_date = current_date - timedelta(days=current_date.weekday() + 1 % 7)

        while current_date < end_date:
            week_row = []
            for day_offset in range(7):
                check_date = current_date + timedelta(days=day_offset)
                date_str = check_date.isoformat()

                if date_str in date_values:
                    # Calculate intensity level (1 to intensity_levels)
                    value = date_values[date_str]
                    if max_value > 0:
                        intensity = int((value / max_value) * self.intensity_levels) + 1
                        intensity = min(intensity, self.intensity_levels)
                    else:
                        intensity = 1
                    week_row.append(intensity)
                else:
                    week_row.append(None)

            grid.append(week_row)
            current_date += timedelta(days=7)

        return grid

    def calculate_intensity_level(self, value: float, max_value: float) -> int:
        """
        Calculate intensity level for a value.

        Args:
            value: Value to normalize
            max_value: Maximum value for normalization

        Returns:
            Intensity level from 1 to intensity_levels
        """
        if max_value == 0:
            return 1

        intensity = int((value / max_value) * self.intensity_levels) + 1
        return min(intensity, self.intensity_levels)

    def get_intensity_char(self, level: Optional[int]) -> str:
        """
        Get character for intensity level.

        Args:
            level: Intensity level (None for no data)

        Returns:
            Character representing intensity
        """
        if level is None:
            return "░"

        chars = [" ", "░", "▒", "▓", "█"]
        return chars[min(level, len(chars) - 1)]


class ProgressBar:
    """Simple progress bar for tracking operation progress."""

    def __init__(
        self,
        total: int,
        width: int = 50,
        prefix: str = "Progress",
        enabled: bool = True,
    ):
        """
        Initialize progress bar.

        Args:
            total: Total items to process
            width: Width of progress bar in characters
            prefix: Prefix text to display
            enabled: Whether progress bar is enabled
        """
        self.total = total
        self.width = width
        self.prefix = prefix
        self.enabled = enabled
        self.current = 0

    def update(self, n: int = 1):
        """
        Update progress.

        Args:
            n: Number of items completed
        """
        self.current += n
        self._display()

    def _display(self):
        """Display current progress."""
        if not self.enabled:
            return

        percent = self.current / self.total
        filled = int(self.width * percent)
        bar = "█" * filled + "░" * (self.width - filled)

        print(f"\r{self.prefix}: [{bar}] {percent:.1%} ({self.current}/{self.total})", end="", flush=True)

        if self.current >= self.total:
            print()  # New line when complete

    def finish(self):
        """Mark progress as complete."""
        self.current = self.total
        self._display()
