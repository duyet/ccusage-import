#!/usr/bin/env python3
"""
ccusage to ClickHouse Data Importer
Imports data from ccusage JSON output into ClickHouse database
Designed to be run as a cronjob, handles idempotent inserts
"""

import argparse
import concurrent.futures
import hashlib
import json
import os
import socket
import subprocess
import sys
import threading
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
import logging

import clickhouse_connect
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logger = logging.getLogger(__name__)

# ClickHouse connection settings from environment
CH_HOST = os.getenv("CH_HOST", "localhost")
CH_PORT = int(os.getenv("CH_PORT", "8123"))
CH_USER = os.getenv("CH_USER", "default")
CH_PASSWORD = os.getenv("CH_PASSWORD", "")
CH_DATABASE = os.getenv("CH_DATABASE", "default")

# Machine identification - use env override or detect hostname
MACHINE_NAME = os.getenv("MACHINE_NAME", socket.gethostname().lower())

# Project privacy settings (global configuration)
HASH_PROJECT_NAMES = True

# OpenCode settings (global configuration)
DEFAULT_OPENCODE_PATH = None  # Will be set from command-line args
SKIP_OPENCODE = False  # Will be set from command-line args
SKIP_CCUSAGE = False  # Will be set from command-line args


def hash_project_name(project_path: str) -> str:
    """
    Create a stable, short hash of project paths for privacy.

    Args:
        project_path: Full project path or session ID

    Returns:
        8-character hexadecimal hash (stable and collision-resistant)
    """
    if not HASH_PROJECT_NAMES:
        return project_path

    # Use SHA-256 for cryptographic security, take first 8 chars for brevity
    # This provides ~4 billion possible values with very low collision probability
    hash_object = hashlib.sha256(project_path.encode("utf-8"))
    return hash_object.hexdigest()[:8]


class LoadingAnimation:
    """Animated loading indicator for long-running operations"""

    def __init__(self, message: str = "Loading", spinner_chars: str = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"):
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

    # Unicode block characters for intensity levels
    INTENSITY_CHARS = {
        0: '·',  # No activity
        1: '░',  # Light
        2: '▒',  # Medium
        3: '▓',  # Dark
        4: '█',  # Full
    }

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

    @staticmethod
    def _get_intensity_level(value: int, max_value: int) -> int:
        """
        Calculate intensity level (0-4) using logarithmic scale.

        Logarithmic scale handles skewed data better:
        - Level 0: No activity
        - Level 1: < 1% of max
        - Level 2: 1% - 10% of max
        - Level 3: 10% - 50% of max
        - Level 4: > 50% of max
        """
        if value == 0:
            return 0
        if max_value == 0:
            return 0

        ratio = value / max_value

        if ratio < 0.01:
            return 1
        elif ratio < 0.1:
            return 2
        elif ratio < 0.5:
            return 3
        else:
            return 4

    @staticmethod
    def _build_heatmap_grid(daily_data: List[Dict], days: int = 365) -> Dict:
        """
        Build 2D grid for heatmap display.

        Returns:
            Dict with:
            - 'grid': Dict[week_num][day_of_week] = tokens
            - 'max_value': Maximum token count for scaling
            - 'month_labels': List of (week_num, month_name) for headers
        """
        from collections import defaultdict
        import datetime

        grid = defaultdict(lambda: defaultdict(int))
        max_value = 0
        month_labels = []

        # Create date lookup
        data_by_date = {d["date"]: d["tokens"] for d in daily_data}

        # Calculate end date (today or last data date)
        end_date = daily_data[-1]["date"] if daily_data else datetime.date.today()

        # Build grid from end_date backwards
        for day_offset in range(days):
            current_date = end_date - datetime.timedelta(days=day_offset)

            # Calculate week and day of week
            week_num = (days - day_offset - 1) // 7
            day_of_week = current_date.weekday() + 1  # 1=Monday, 7=Sunday

            tokens = data_by_date.get(current_date, 0)
            if tokens > max_value:
                max_value = tokens

            grid[week_num][day_of_week] = tokens

            # Track month labels (first week of each month)
            if current_date.day <= 7:
                month_name = current_date.strftime("%b")
                if not month_labels or month_labels[-1][1] != month_name:
                    month_labels.append((week_num, month_name))

        return {
            "grid": grid,
            "max_value": max_value,
            "month_labels": month_labels
        }

    @staticmethod
    def print_heatmap(daily_data: List[Dict], days: int = 365, title: str = "Activity Heatmap"):
        """
        Print GitHub-style contribution heatmap.

        Args:
            daily_data: List of dicts with date, day_of_week, week_num, tokens
            days: Number of days to display (default 365)
            title: Chart title
        """
        import datetime

        UIFormatter.print_section(title, 70)
        print()

        if not daily_data:
            print("  No activity data available")
            return

        # Build grid
        grid_data = UIFormatter._build_heatmap_grid(daily_data, days)
        grid = grid_data["grid"]
        max_value = grid_data["max_value"]
        month_labels = grid_data["month_labels"]

        # Day labels
        day_labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

        # Calculate grid dimensions
        max_week = max(grid.keys()) if grid else 0

        # Reverse month labels so they display chronologically (left to right)
        # Grid is built backwards, so labels come in reverse order
        month_labels = list(reversed(month_labels))

        # Print month headers
        print("     ", end="")
        last_printed_pos = 0
        for week_num, month_name in month_labels:
            # Calculate target position (each week column is 2 chars wide)
            target_pos = week_num * 2
            # Add spacing to reach target position
            while last_printed_pos < target_pos:
                print(" ", end="")
                last_printed_pos += 1
            print(month_name, end="")
            last_printed_pos += len(month_name)
        print()

        # Print day rows
        for day_idx in range(7):  # 0=Monday, 6=Sunday
            day_name = day_labels[day_idx]
            print(f"  {day_name} ", end="")

            for week_num in range(max_week + 1):
                day_of_week = day_idx + 1  # 1-7
                tokens = grid[week_num][day_of_week]
                level = UIFormatter._get_intensity_level(tokens, max_value)
                char = UIFormatter.INTENSITY_CHARS[level]
                print(char, end=" ")
            print()

        # Print legend
        print("      Less ", end="")
        for level in range(5):
            print(UIFormatter.INTENSITY_CHARS[level], end="")
        print(" More")

    @staticmethod
    def print_statistics_summary(stats: Dict[str, Any]):
        """
        Print summary statistics in two columns.

        Args:
            stats: Dict with favorite_model, total_tokens, streaks, peak_hour, sessions
        """
        UIFormatter.print_section("Statistics Summary", 70)

        # Helper for two-column layout
        def print_stat_row(label1: str, value1: str, label2: str, value2: str):
            print(f"  {label1}: {value1:<30}  {label2}: {value2}")

        # Format values
        total_tokens = UIFormatter.format_number(stats.get("total_tokens", 0))

        favorite = stats.get("favorite_model", {})
        model_name = favorite.get("model_name", "N/A")
        if len(model_name) > 25:
            model_name = model_name[:22] + "..."

        sessions = stats.get("sessions", {})
        session_count = UIFormatter.format_number(sessions.get("session_count", 0))
        longest_sec = sessions.get("longest_session_seconds", 0)
        longest = UIFormatter.format_duration(longest_sec) if longest_sec > 0 else "N/A"

        streaks = stats.get("streaks", {})
        current = streaks.get("current_streak", 0)
        longest_streak = streaks.get("longest_streak", 0)

        heatmap = stats.get("heatmap", {})
        active_days = heatmap.get("active_days", 0)
        total_days = heatmap.get("total_days", 365)

        peak = stats.get("peak_hour", "N/A")

        # Print rows
        print_stat_row("Favorite model", model_name, "Total tokens", total_tokens)
        print()
        print_stat_row("Sessions", session_count, "Longest session", longest)
        print_stat_row("Current streak", f"{current} days", "Longest streak", f"{longest_streak} days")
        print_stat_row("Active days", f"{active_days}/{total_days}", "Peak hour", peak)

    @staticmethod
    def print_models_tab(model_data: List[Dict]):
        """
        Print model usage breakdown as ranked list.

        Args:
            model_data: List of {model_name, tokens, cost, percentage}
        """
        UIFormatter.print_section("Model Usage Breakdown", 70)

        # Sort by tokens descending
        sorted_models = sorted(model_data, key=lambda x: x.get("tokens", 0), reverse=True)

        # Print header
        print(f"  {'Model':<30} {'Tokens':>15} {'Cost':>12} {'%':>6}")
        print("  " + "-" * 68)

        # Print top 10 models
        for model in sorted_models[:10]:
            name = model.get("model_name", "Unknown")
            if len(name) > 30:
                name = name[:27] + "..."
            tokens = UIFormatter.format_number(model.get("tokens", 0))
            cost = f"${model.get('cost', 0):,.2f}"
            pct = f"{model.get('percentage', 0):.1f}%"

            print(f"  {name:<30} {tokens:>15} {cost:>12} {pct:>6}")

        if len(sorted_models) > 10:
            print(f"  ... and {len(sorted_models) - 10} more models")


class ClickHouseImporter:
    def __init__(self):
        """Initialize ClickHouse client with environment-based configuration"""
        try:
            # Determine if we should use HTTPS based on port
            use_https = CH_PORT in [443, 8443, 9440]

            self.client = clickhouse_connect.get_client(
                host=CH_HOST,
                port=CH_PORT,
                username=CH_USER,
                password=CH_PASSWORD,
                database=CH_DATABASE,
                interface="https" if use_https else "http",
                secure=use_https,
            )
            # Test connection
            self.client.command("SELECT 1")
            # Connection successful - no need to print
        except Exception as e:
            print(f"✗ Connection failed: {e}")
            raise

        # Detect available package runner (bunx or npx)
        self.package_runner = self._detect_package_runner()

        # Check and prompt for missing tables
        self._check_and_create_tables_if_needed()

    def _detect_package_runner(self) -> str:
        """Detect whether bunx or npx is available, prefer bunx"""
        try:
            # Try bunx first (faster)
            subprocess.run(["bunx", "--version"], capture_output=True, check=True)
            return "bunx"
        except (subprocess.CalledProcessError, FileNotFoundError):
            try:
                # Fall back to npx
                subprocess.run(["npx", "--version"], capture_output=True, check=True)
                return "npx"
            except (subprocess.CalledProcessError, FileNotFoundError):
                # Silently default to npx
                return "npx"

    def _check_and_create_tables_if_needed(self):
        """Check if required tables exist and prompt to create them if missing"""
        required_tables = [
            "ccusage_usage_daily",
            "ccusage_usage_monthly",
            "ccusage_usage_sessions",
            "ccusage_usage_blocks",
            "ccusage_usage_projects_daily",
            "ccusage_model_breakdowns",
            "ccusage_models_used",
            "ccusage_import_history",
        ]

        missing_tables = []

        try:
            # Check which tables exist
            result = self.client.query("SHOW TABLES")
            existing_tables = {row[0] for row in result.result_rows}

            # Find missing required tables
            for table in required_tables:
                if table not in existing_tables:
                    missing_tables.append(table)

            if missing_tables:
                print("\n⚠️  Missing ClickHouse tables detected:")
                for table in missing_tables:
                    table_display = (
                        table.replace("ccusage_", "").replace("_", " ").title()
                    )
                    print(f"   - {table_display} ({table})")

                print(f"\n🔧 Required tables: {len(required_tables)}")
                print(f"📋 Found: {len(existing_tables & set(required_tables))}")
                print(f"❌ Missing: {len(missing_tables)}")

                response = (
                    input(f"\n❓ Create {len(missing_tables)} missing tables? [Y/n]: ")
                    .strip()
                    .lower()
                )

                if response in ["", "y", "yes"]:
                    self._create_missing_tables()
                    print("✅ Tables created successfully!")
                else:
                    print("⚠️  Warning: Missing tables may cause import errors")

        except Exception as e:
            print(f"⚠️  Warning: Could not check table existence: {e}")

    def _create_missing_tables(self):
        """Execute the ClickHouse schema to create missing tables"""
        import os

        schema_file = os.path.join(
            os.path.dirname(__file__), "ccusage_clickhouse_schema.sql"
        )

        if not os.path.exists(schema_file):
            print(f"❌ Schema file not found: {schema_file}")
            return

        try:
            # Read and execute the schema file
            with open(schema_file) as f:
                schema_sql = f.read()

            # Split into individual statements and execute
            statements = [
                stmt.strip() for stmt in schema_sql.split(";") if stmt.strip()
            ]

            print("🔧 Creating tables...")
            loader = LoadingAnimation("Creating database tables")
            loader.start()

            for statement in statements:
                if statement.upper().startswith(("CREATE TABLE", "CREATE DATABASE")):
                    try:
                        self.client.command(statement)
                    except Exception as e:
                        # Ignore "table already exists" errors
                        if "already exists" not in str(e).lower():
                            loader.stop(f"Error creating table: {e}")
                            raise

            loader.stop("Database tables created")

        except Exception as e:
            print(f"❌ Error creating tables: {e}")
            raise

    def _parse_date(self, date_str: str) -> date:
        """Parse date string to Python date object"""
        return datetime.strptime(date_str, "%Y-%m-%d").date()

    def _parse_datetime(self, datetime_str: Optional[str]) -> Optional[datetime]:
        """Parse datetime string to Python datetime object"""
        if datetime_str is None:
            return None
        # Handle ISO format: "2025-08-02T15:00:00.000Z"
        if datetime_str.endswith("Z"):
            # Remove 'Z' and parse as UTC
            datetime_str = datetime_str[:-1]
            return datetime.fromisoformat(datetime_str).replace(tzinfo=None)
        return datetime.fromisoformat(datetime_str).replace(tzinfo=None)

    def _extract_burn_rate(self, burn_rate_data) -> Optional[float]:
        """Extract burn rate value from data (can be None, float, or dict)"""
        if burn_rate_data is None:
            return None
        if isinstance(burn_rate_data, (int, float)):
            return float(burn_rate_data)
        if isinstance(burn_rate_data, dict):
            # Extract costPerHour from complex burn rate object
            return burn_rate_data.get("costPerHour", None)
        return None

    def _extract_projection(self, projection_data) -> Optional[float]:
        """Extract projection value from data (can be None, float, or dict)"""
        if projection_data is None:
            return None
        if isinstance(projection_data, (int, float)):
            return float(projection_data)
        if isinstance(projection_data, dict):
            # Extract totalCost from complex projection object
            return projection_data.get("totalCost", None)
        return None

    def fetch_ccusage_data_parallel(self) -> Dict[str, Dict[str, Any]]:
        """Fetch all ccusage data in parallel with animated loading indicator"""
        commands = [
            ("daily", "daily"),
            ("monthly", "monthly"),
            ("session", "session"),
            ("blocks", "blocks"),
            ("projects", "daily --instances"),
        ]

        UIFormatter.print_step(
            1, "Fetching ccusage data", "Executing 5 ccusage commands concurrently..."
        )

        # Start loading animation
        loader = LoadingAnimation("Fetching data from ccusage")
        loader.start()

        start_time = datetime.now()
        results = {}
        completed_count = 0

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            # Submit all commands
            future_to_key = {
                executor.submit(self.run_ccusage_command, cmd): key
                for key, cmd in commands
            }

            # Collect results as they complete
            for future in concurrent.futures.as_completed(future_to_key):
                key = future_to_key[future]
                completed_count += 1

                try:
                    results[key] = future.result()
                    loader.stop(
                        f"{key} data fetched ({completed_count}/{len(commands)})"
                    )
                    if completed_count < len(commands):
                        loader = LoadingAnimation(
                            f"Fetching remaining data ({completed_count}/{len(commands)} complete)"
                        )
                        loader.start()
                except Exception as e:
                    loader.stop(error_message=f"{key} data failed: {e}")
                    results[key] = {}
                    if completed_count < len(commands):
                        loader = LoadingAnimation(
                            f"Fetching remaining data ({completed_count}/{len(commands)} complete)"
                        )
                        loader.start()

        fetch_duration = (datetime.now() - start_time).total_seconds()
        print(
            f"\n✅ All data sources fetched in {UIFormatter.format_duration(fetch_duration)}"
        )
        return results

    def _fetch_opencode_messages(self, opencode_path: str = None) -> List[Dict[str, Any]]:
        """
        Fetch all OpenCode message files from storage and parse them.

        Args:
            opencode_path: Path to OpenCode storage (default: ~/.local/share/opencode/storage/message)

        Returns:
            List of message dictionaries. Malformed files are skipped with warnings.
        """
        if opencode_path is None:
            opencode_path = Path.home() / ".local/share/opencode/storage/message"

        opencode_path = Path(opencode_path)

        # Validate path exists
        if not opencode_path.exists():
            logger.warning(f"OpenCode storage path does not exist: {opencode_path}")
            return []

        if not opencode_path.is_dir():
            logger.warning(f"OpenCode storage path is not a directory: {opencode_path}")
            return []

        messages = []
        parse_failures = 0

        for json_file in opencode_path.rglob("msg_*.json"):
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    msg = json.load(f)
                    messages.append(msg)
            except (json.JSONDecodeError, IOError) as e:
                parse_failures += 1
                logger.debug(f"Failed to parse {json_file.name}: {e}")

        logger.info(f"Fetched {len(messages)} OpenCode messages from {opencode_path}")
        if parse_failures > 0:
            logger.warning(f"Failed to parse {parse_failures} OpenCode message files")

        return messages

    def _fetch_and_aggregate_opencode(self, opencode_path: str = None) -> Dict[str, Any]:
        """
        Fetch and aggregate OpenCode messages for parallel execution.

        This is a helper method that wraps the OpenCode fetching and aggregation
        for use in ThreadPoolExecutor. It handles errors gracefully and returns
        an empty dict on failure.

        Args:
            opencode_path: Path to OpenCode storage directory

        Returns:
            Dictionary with aggregated OpenCode data (daily, monthly, session, projects)
            Returns empty dict if fetching fails
        """
        try:
            messages = self._fetch_opencode_messages(opencode_path)
            if not messages:
                return {}
            return self._aggregate_opencode_messages(messages, MACHINE_NAME)
        except Exception as e:
            logger.error(f"Failed to fetch and aggregate OpenCode data: {e}")
            return {}

    def _aggregate_opencode_messages(self, messages: List[Dict[str, Any]], machine_name: str) -> Dict[str, Any]:
        """
        Aggregate raw OpenCode messages into ccusage-compatible format.

        Args:
            messages: List of OpenCode message dictionaries
            machine_name: Machine name for multi-machine support

        Returns:
            Dict with keys: 'daily', 'monthly', 'session', 'projects'
        """
        # Filter only assistant messages (they have token data)
        assistant_messages = [m for m in messages if m.get("role") == "assistant"]

        if not assistant_messages:
            logger.info("No assistant messages found in OpenCode data")
            return {"daily": [], "monthly": [], "session": [], "projects": {}}

        # Group by date for daily aggregation
        daily_groups = {}
        monthly_groups = {}
        session_groups = {}
        project_daily_groups = {}

        for msg in assistant_messages:
            # Extract timestamp
            created_ts = msg.get("time", {}).get("created", 0)
            if created_ts == 0:
                continue

            msg_date = datetime.fromtimestamp(created_ts / 1000).date()
            date_str = msg_date.isoformat()
            month_str = msg_date.strftime("%Y-%m")

            # Extract token data
            tokens = msg.get("tokens", {})
            input_tokens = tokens.get("input", 0)
            output_tokens = tokens.get("output", 0)

            # Handle cache tokens - cache is a dict with 'read' and 'write' keys
            cache_data = tokens.get("cache", {})
            if isinstance(cache_data, dict):
                cache_read = cache_data.get("read", 0)
                cache_write = cache_data.get("write", 0)
            else:
                cache_read = 0
                cache_write = 0

            reasoning_tokens = tokens.get("reasoning", 0)

            total_tokens = input_tokens + output_tokens + cache_read + reasoning_tokens

            model_id = msg.get("modelID", "unknown")
            cost = msg.get("cost", 0)

            # Daily grouping
            if date_str not in daily_groups:
                daily_groups[date_str] = {
                    "inputTokens": 0,
                    "outputTokens": 0,
                    "cacheCreationTokens": 0,
                    "cacheReadTokens": 0,
                    "totalTokens": 0,
                    "totalCost": 0,
                    "modelsUsed": set(),
                    "modelBreakdowns": {}
                }

            daily_groups[date_str]["inputTokens"] += input_tokens
            daily_groups[date_str]["outputTokens"] += output_tokens
            daily_groups[date_str]["cacheReadTokens"] += cache_read
            daily_groups[date_str]["cacheCreationTokens"] += cache_write
            daily_groups[date_str]["totalTokens"] += total_tokens
            daily_groups[date_str]["totalCost"] += cost
            daily_groups[date_str]["modelsUsed"].add(model_id)

            # Model breakdowns
            if model_id not in daily_groups[date_str]["modelBreakdowns"]:
                daily_groups[date_str]["modelBreakdowns"][model_id] = {
                    "modelName": model_id,
                    "inputTokens": 0,
                    "outputTokens": 0,
                    "cacheCreationTokens": 0,
                    "cacheReadTokens": 0,
                    "cost": 0
                }

            daily_groups[date_str]["modelBreakdowns"][model_id]["inputTokens"] += input_tokens
            daily_groups[date_str]["modelBreakdowns"][model_id]["outputTokens"] += output_tokens
            daily_groups[date_str]["modelBreakdowns"][model_id]["cacheReadTokens"] += cache_read
            daily_groups[date_str]["modelBreakdowns"][model_id]["cacheCreationTokens"] += cache_write
            daily_groups[date_str]["modelBreakdowns"][model_id]["cost"] += cost

            # Monthly grouping
            if month_str not in monthly_groups:
                monthly_groups[month_str] = {
                    "inputTokens": 0,
                    "outputTokens": 0,
                    "cacheCreationTokens": 0,
                    "cacheReadTokens": 0,
                    "totalTokens": 0,
                    "totalCost": 0,
                    "modelsUsed": set(),
                    "modelBreakdowns": {}
                }

            monthly_groups[month_str]["inputTokens"] += input_tokens
            monthly_groups[month_str]["outputTokens"] += output_tokens
            monthly_groups[month_str]["cacheReadTokens"] += cache_read
            monthly_groups[month_str]["cacheCreationTokens"] += cache_write
            monthly_groups[month_str]["totalTokens"] += total_tokens
            monthly_groups[month_str]["totalCost"] += cost
            monthly_groups[month_str]["modelsUsed"].add(model_id)

            # Session grouping
            session_id = msg.get("sessionID", "unknown")
            if session_id not in session_groups:
                session_groups[session_id] = {
                    "sessionId": session_id,
                    "startTime": created_ts,
                    "endTime": created_ts,
                    "inputTokens": 0,
                    "outputTokens": 0,
                    "cacheCreationTokens": 0,
                    "cacheReadTokens": 0,
                    "totalTokens": 0,
                    "totalCost": 0,
                    "modelsUsed": set(),
                    "modelBreakdowns": {},
                    "projectPath": None
                }

            session_groups[session_id]["endTime"] = max(session_groups[session_id]["endTime"], created_ts)
            session_groups[session_id]["inputTokens"] += input_tokens
            session_groups[session_id]["outputTokens"] += output_tokens
            session_groups[session_id]["cacheReadTokens"] += cache_read
            session_groups[session_id]["cacheCreationTokens"] += cache_write
            session_groups[session_id]["totalTokens"] += total_tokens
            session_groups[session_id]["totalCost"] += cost
            session_groups[session_id]["modelsUsed"].add(model_id)

            # Get project path from first message with path
            if session_groups[session_id]["projectPath"] is None:
                path_data = msg.get("path", {})
                if path_data and path_data.get("root"):
                    project_path = path_data["root"]
                    session_groups[session_id]["projectPath"] = project_path

                    # Project daily grouping
                    if project_path not in project_daily_groups:
                        project_daily_groups[project_path] = {}
                    if date_str not in project_daily_groups[project_path]:
                        project_daily_groups[project_path][date_str] = {
                            "inputTokens": 0,
                            "outputTokens": 0,
                            "cacheCreationTokens": 0,
                            "cacheReadTokens": 0,
                            "totalTokens": 0,
                            "totalCost": 0,
                            "modelsUsed": set(),
                            "modelBreakdowns": {}
                        }

                    project_daily_groups[project_path][date_str]["inputTokens"] += input_tokens
                    project_daily_groups[project_path][date_str]["outputTokens"] += output_tokens
                    project_daily_groups[project_path][date_str]["cacheReadTokens"] += cache_read
                    project_daily_groups[project_path][date_str]["cacheCreationTokens"] += cache_write
                    project_daily_groups[project_path][date_str]["totalTokens"] += total_tokens
                    project_daily_groups[project_path][date_str]["totalCost"] += cost
                    project_daily_groups[project_path][date_str]["modelsUsed"].add(model_id)

        # Convert to final format
        daily_records = []
        for date_str, data in daily_groups.items():
            daily_records.append({
                "date": date_str,
                "inputTokens": data["inputTokens"],
                "outputTokens": data["outputTokens"],
                "cacheCreationTokens": data["cacheCreationTokens"],
                "cacheReadTokens": data["cacheReadTokens"],
                "totalTokens": data["totalTokens"],
                "totalCost": data["totalCost"],
                "modelsUsed": sorted(list(data["modelsUsed"])),
                "modelBreakdowns": list(data["modelBreakdowns"].values())
            })

        monthly_records = []
        for month_str, data in monthly_groups.items():
            monthly_records.append({
                "month": month_str,
                "inputTokens": data["inputTokens"],
                "outputTokens": data["outputTokens"],
                "cacheCreationTokens": data["cacheCreationTokens"],
                "cacheReadTokens": data["cacheReadTokens"],
                "totalTokens": data["totalTokens"],
                "totalCost": data["totalCost"],
                "modelsUsed": sorted(list(data["modelsUsed"])),
                "modelBreakdowns": list(data["modelBreakdowns"].values())
            })

        session_records = []
        for session_id, data in session_groups.items():
            # Calculate last activity date from endTime timestamp
            end_timestamp = data["endTime"]
            last_activity_date = datetime.fromtimestamp(end_timestamp / 1000).date().isoformat()

            session_records.append({
                "sessionId": data["sessionId"],
                "lastActivity": last_activity_date,
                "inputTokens": data["inputTokens"],
                "outputTokens": data["outputTokens"],
                "cacheCreationTokens": data["cacheCreationTokens"],
                "cacheReadTokens": data["cacheReadTokens"],
                "totalTokens": data["totalTokens"],
                "totalCost": data["totalCost"],
                "modelsUsed": sorted(list(data["modelsUsed"])),
                "modelBreakdowns": list(data["modelBreakdowns"].values()),
                "projectPath": data["projectPath"] or "unknown"
            })

        # Project daily records - convert to dict keyed by project_id
        projects_dict = {}
        for project_path, daily_data in project_daily_groups.items():
            project_id = hash_project_name(project_path) if HASH_PROJECT_NAMES else project_path
            project_daily_records = []
            for date_str, data in daily_data.items():
                project_daily_records.append({
                    "date": date_str,
                    "inputTokens": data["inputTokens"],
                    "outputTokens": data["outputTokens"],
                    "cacheCreationTokens": data["cacheCreationTokens"],
                    "cacheReadTokens": data["cacheReadTokens"],
                    "totalTokens": data["totalTokens"],
                    "totalCost": data["totalCost"],
                    "modelsUsed": sorted(list(data["modelsUsed"])),
                    "modelBreakdowns": list(data["modelBreakdowns"].values())
                })
            projects_dict[project_id] = project_daily_records

        logger.info(f"Aggregated {len(daily_records)} daily, {len(monthly_records)} monthly, {len(session_records)} session records from OpenCode")

        return {
            "daily": daily_records,
            "monthly": monthly_records,
            "session": session_records,
            "projects": projects_dict
        }

    def fetch_all_data_parallel(self, opencode_path: str = None, skip_opencode: bool = False) -> Dict[str, Any]:
        """
        Fetch all data from both ccusage and OpenCode sources in parallel.

        OpenCode fetching runs concurrently with ccusage commands in the same
        ThreadPoolExecutor for optimal performance.

        Args:
            opencode_path: Custom path to OpenCode storage directory
            skip_opencode: If True, skip OpenCode data fetching

        Returns:
            Dict with keys: 'daily', 'monthly', 'session', 'blocks', 'projects', 'opencode'
            All sources fetched in parallel where possible
            'opencode' contains aggregated OpenCode data or empty dict if skipped/unavailable

        Resource Management:
            - Creates and properly shuts down ThreadPoolExecutor
            - All loading animations tracked for cleanup
        """
        commands = [
            ("daily", "daily"),
            ("monthly", "monthly"),
            ("session", "session"),
            ("blocks", "blocks"),
            ("projects", "daily --instances"),
        ]

        # Determine total task count based on which sources to fetch
        skip_ccusage = SKIP_CCUSAGE
        total_tasks = 0
        if not skip_ccusage:
            total_tasks += len(commands)
        if not skip_opencode:
            total_tasks += 1

        # Show which sources are being fetched
        sources_to_fetch = []
        if not skip_ccusage:
            sources_to_fetch.append("ccusage")
        if not skip_opencode:
            sources_to_fetch.append("OpenCode")
        task_description = f"Fetching {', '.join(sources_to_fetch)} data ({total_tasks} tasks)..."
        UIFormatter.print_step(
            1, "Fetching all data sources", task_description
        )

        # Start loading animation
        loader = LoadingAnimation("Fetching data from all sources")
        loader.start()

        start_time = datetime.now()
        results = {}
        completed_count = 0

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            # Submit ccusage commands if not skipped
            if not skip_ccusage:
                future_to_key = {
                    executor.submit(self.run_ccusage_command, cmd): key
                    for key, cmd in commands
                }
            else:
                future_to_key = {}

            # Also submit OpenCode fetching if not skipped
            if not skip_opencode:
                future_to_key[
                    executor.submit(self._fetch_and_aggregate_opencode, opencode_path)
                ] = "opencode"

            # Collect results as they complete
            for future in concurrent.futures.as_completed(future_to_key):
                key = future_to_key[future]
                completed_count += 1

                try:
                    results[key] = future.result()

                    # Format success message based on data source type
                    if key == "opencode":
                        daily_count = len(results[key].get("daily", []))
                        loader.stop(
                            f"{key} data fetched ({completed_count}/{total_tasks}, {daily_count} daily records)"
                        )
                    else:
                        loader.stop(
                            f"{key} data fetched ({completed_count}/{total_tasks})"
                        )

                    if completed_count < total_tasks:
                        loader = LoadingAnimation(
                            f"Fetching remaining data ({completed_count}/{total_tasks} complete)"
                        )
                        loader.start()
                except Exception as e:
                    loader.stop(error_message=f"{key} data failed: {e}")
                    results[key] = {}
                    if completed_count < total_tasks:
                        loader = LoadingAnimation(
                            f"Fetching remaining data ({completed_count}/{total_tasks} complete)"
                        )
                        loader.start()

        fetch_duration = (datetime.now() - start_time).total_seconds()
        print(
            f"\n✅ All data sources fetched in {UIFormatter.format_duration(fetch_duration)}"
        )
        return results

    def run_ccusage_command(
        self, command: str, verbose: bool = False
    ) -> Dict[str, Any]:
        """Run ccusage command and return JSON data with retry logic"""
        max_retries = 2
        for attempt in range(max_retries):
            try:
                if verbose and attempt == 0:
                    print(
                        f"Running: {self.package_runner} ccusage@latest {command} --json"
                    )
                elif verbose:
                    print(
                        f"  Retry {attempt}: {self.package_runner} ccusage@latest {command} --json"
                    )

                result = subprocess.run(
                    [self.package_runner, "ccusage@latest"]
                    + command.split()
                    + ["--json"],
                    capture_output=True,
                    text=True,
                    check=True,
                    timeout=120,  # 120 second timeout per command (ccusage can be slow with large datasets)
                )
                return json.loads(result.stdout)
            except subprocess.TimeoutExpired:
                if verbose:
                    print(
                        f"  Timeout running ccusage {command} (attempt {attempt + 1})"
                    )
                if attempt == max_retries - 1:
                    return {}
            except subprocess.CalledProcessError as e:
                if verbose:
                    print(
                        f"  Error running ccusage {command} (attempt {attempt + 1}): {e}"
                    )
                    if e.stderr:
                        print(f"  Error output: {e.stderr}")
                if attempt == max_retries - 1:
                    return {}
            except json.JSONDecodeError as e:
                if verbose:
                    print(f"  Error parsing JSON from ccusage {command}: {e}")
                return {}

        return {}

    def upsert_daily_data(self, daily_data: List[Dict[str, Any]], source: str = 'ccusage'):
        """Insert or update daily usage data"""
        if not daily_data:
            # No daily data available
            return

        # Delete existing data for these dates and machine first
        dates = [item["date"] for item in daily_data]
        if dates:
            dates_str = ",".join([f"'{d}'" for d in dates])
            self.client.command(
                f"DELETE FROM ccusage_usage_daily WHERE date IN ({dates_str}) AND machine_name = '{MACHINE_NAME}' AND source = '{source}'"
            )

        # Prepare data for insertion
        rows = []
        model_breakdown_rows = []
        model_used_rows = []

        for item in daily_data:
            # Main daily record
            rows.append(
                [
                    self._parse_date(item["date"]),  # date
                    MACHINE_NAME,  # machine_name
                    item["inputTokens"],  # input_tokens
                    item["outputTokens"],  # output_tokens
                    item["cacheCreationTokens"],  # cache_creation_tokens
                    item["cacheReadTokens"],  # cache_read_tokens
                    item["totalTokens"],  # total_tokens
                    item["totalCost"],  # total_cost
                    len(item["modelsUsed"]),  # models_count
                    datetime.now(),  # created_at
                    datetime.now(),  # updated_at
                    source,  # source (must be last to match schema)
                ]
            )

            # Model breakdowns
            for breakdown in item.get("modelBreakdowns", []):
                model_breakdown_rows.append(
                    [
                        "daily",
                        item["date"],
                        MACHINE_NAME,
                        breakdown["modelName"],
                        breakdown["inputTokens"],
                        breakdown["outputTokens"],
                        breakdown["cacheCreationTokens"],
                        breakdown["cacheReadTokens"],
                        breakdown["cost"],
                        datetime.now(),
                        source,
                    ]
                )

            # Models used
            for model in item["modelsUsed"]:
                model_used_rows.append(
                    ["daily", item["date"], MACHINE_NAME, model, datetime.now(), source]
                )

        # Insert data
        if rows:
            self.client.insert("ccusage_usage_daily", rows)
            # Daily records inserted

        if model_breakdown_rows:
            # Delete existing model breakdowns
            dates_str = ",".join([f"'{d}'" for d in dates])
            delete_query = (
                f"DELETE FROM ccusage_model_breakdowns WHERE record_type = "
                f"'daily' AND record_key IN ({dates_str}) AND source = '{source}'"
            )
            self.client.command(delete_query)
            self.client.insert("ccusage_model_breakdowns", model_breakdown_rows)
            print(f"✓ Inserted {len(model_breakdown_rows)} model breakdown records")

        if model_used_rows:
            # Delete existing model used records
            dates_str = ",".join([f"'{d}'" for d in dates])
            delete_query = (
                f"DELETE FROM ccusage_models_used WHERE record_type = "
                f"'daily' AND record_key IN ({dates_str}) AND machine_name = '{MACHINE_NAME}' AND source = '{source}'"
            )
            self.client.command(delete_query)
            self.client.insert("ccusage_models_used", model_used_rows)
            # Models used records inserted

    def upsert_monthly_data(self, monthly_data: List[Dict[str, Any]], source: str = 'ccusage'):
        """Insert or update monthly usage data"""
        if not monthly_data:
            # No monthly data available
            return

        # Delete existing data for these months and machine first
        months = [item["month"] for item in monthly_data]
        if months:
            months_str = ",".join([f"'{m}'" for m in months])
            self.client.command(
                f"DELETE FROM ccusage_usage_monthly WHERE month IN ({months_str}) AND machine_name = '{MACHINE_NAME}' AND source = '{source}'"
            )

        # Prepare data for insertion
        rows = []
        model_breakdown_rows = []
        model_used_rows = []

        for item in monthly_data:
            year, month_num = item["month"].split("-")

            # Main monthly record
            rows.append(
                [
                    item["month"],
                    int(year),
                    int(month_num),
                    MACHINE_NAME,
                    item["inputTokens"],
                    item["outputTokens"],
                    item["cacheCreationTokens"],
                    item["cacheReadTokens"],
                    item["totalTokens"],
                    item["totalCost"],
                    len(item["modelsUsed"]),
                    datetime.now(),
                    datetime.now(),
                    source,
                ]
            )

            # Model breakdowns and models used
            for breakdown in item.get("modelBreakdowns", []):
                model_breakdown_rows.append(
                    [
                        "monthly",
                        item["month"],
                        MACHINE_NAME,
                        breakdown["modelName"],
                        breakdown["inputTokens"],
                        breakdown["outputTokens"],
                        breakdown["cacheCreationTokens"],
                        breakdown["cacheReadTokens"],
                        breakdown["cost"],
                        datetime.now(),
                        source,
                    ]
                )

            for model in item["modelsUsed"]:
                model_used_rows.append(
                    ["monthly", item["month"], MACHINE_NAME, model, datetime.now(), source]
                )

        # Insert data
        if rows:
            self.client.insert("ccusage_usage_monthly", rows)
            # Monthly records inserted

        if model_breakdown_rows:
            months_str = ",".join([f"'{m}'" for m in months])
            delete_query = (
                f"DELETE FROM ccusage_model_breakdowns WHERE record_type = "
                f"'monthly' AND record_key IN ({months_str}) AND source = '{source}'"
            )
            self.client.command(delete_query)
            self.client.insert("ccusage_model_breakdowns", model_breakdown_rows)

        if model_used_rows:
            months_str = ",".join([f"'{m}'" for m in months])
            delete_query = (
                f"DELETE FROM ccusage_models_used WHERE record_type = "
                f"'monthly' AND record_key IN ({months_str}) AND machine_name = '{MACHINE_NAME}' AND source = '{source}'"
            )
            self.client.command(delete_query)
            self.client.insert("ccusage_models_used", model_used_rows)

    def upsert_session_data(self, session_data: List[Dict[str, Any]], source: str = 'ccusage'):
        """Insert or update session usage data"""
        if not session_data:
            # No session data available
            return

        # Debug: print first session item to check data types
        if session_data:
            logger.debug(f"First session data item: {session_data[0]}")
            for key, value in session_data[0].items():
                logger.debug(f"  {key}: {value} (type: {type(value).__name__})")

        # Delete existing data for these sessions first
        session_ids = [hash_project_name(item["sessionId"]) for item in session_data]
        if session_ids:
            sessions_str = ",".join([f"'{s}'" for s in session_ids])
            self.client.command(
                f"DELETE FROM ccusage_usage_sessions WHERE session_id IN ({sessions_str}) AND machine_name = '{MACHINE_NAME}' AND source = '{source}'"
            )

        # Prepare data for insertion
        rows = []
        model_breakdown_rows = []
        model_used_rows = []

        for item in session_data:
            # Hash project information for privacy
            hashed_session_id = hash_project_name(item["sessionId"])
            hashed_project_path = hash_project_name(item["projectPath"])

            # Main session record (order matches table schema)
            rows.append(
                [
                    hashed_session_id,  # session_id
                    hashed_project_path,  # project_path
                    MACHINE_NAME,  # machine_name
                    item["inputTokens"],  # input_tokens
                    item["outputTokens"],  # output_tokens
                    item["cacheCreationTokens"],  # cache_creation_tokens
                    item["cacheReadTokens"],  # cache_read_tokens
                    item["totalTokens"],  # total_tokens
                    item["totalCost"],  # total_cost
                    self._parse_date(item["lastActivity"]),  # last_activity
                    len(item["modelsUsed"]),  # models_count
                    datetime.now(),  # created_at
                    datetime.now(),  # updated_at
                    source,  # source (must be last to match schema)
                ]
            )

            # Model breakdowns and models used
            for breakdown in item.get("modelBreakdowns", []):
                model_breakdown_rows.append(
                    [
                        "session",
                        hashed_session_id,
                        MACHINE_NAME,
                        breakdown["modelName"],
                        breakdown["inputTokens"],
                        breakdown["outputTokens"],
                        breakdown["cacheCreationTokens"],
                        breakdown["cacheReadTokens"],
                        breakdown["cost"],
                        datetime.now(),
                        source,
                    ]
                )

            for model in item["modelsUsed"]:
                model_used_rows.append(
                    ["session", hashed_session_id, MACHINE_NAME, model, datetime.now(), source]
                )

        # Insert data
        if rows:
            self.client.insert("ccusage_usage_sessions", rows)
            # Session records inserted

        if model_breakdown_rows:
            sessions_str = ",".join([f"'{s}'" for s in session_ids])
            delete_query = (
                f"DELETE FROM ccusage_model_breakdowns WHERE record_type = "
                f"'session' AND record_key IN ({sessions_str}) AND source = '{source}'"
            )
            self.client.command(delete_query)
            self.client.insert("ccusage_model_breakdowns", model_breakdown_rows)

        if model_used_rows:
            sessions_str = ",".join([f"'{s}'" for s in session_ids])
            delete_query = (
                f"DELETE FROM ccusage_models_used WHERE record_type = "
                f"'session' AND record_key IN ({sessions_str}) AND machine_name = '{MACHINE_NAME}' AND source = '{source}'"
            )
            self.client.command(delete_query)
            self.client.insert("ccusage_models_used", model_used_rows)

    def upsert_blocks_data(self, blocks_data: List[Dict[str, Any]], source: str = 'ccusage'):
        """Insert or update blocks usage data"""
        if not blocks_data:
            # No blocks data available
            return

        # Delete existing data for these blocks first
        block_ids = [item["id"] for item in blocks_data]
        if block_ids:
            blocks_str = ",".join([f"'{b}'" for b in block_ids])
            self.client.command(
                f"DELETE FROM ccusage_usage_blocks WHERE block_id IN ({blocks_str}) AND machine_name = '{MACHINE_NAME}' AND source = '{source}'"
            )

        # Prepare data for insertion
        rows = []
        model_used_rows = []

        for item in blocks_data:
            # Main block record - order matches actual table schema
            rows.append(
                [
                    item["id"],  # block_id
                    MACHINE_NAME,  # machine_name
                    self._parse_datetime(item["startTime"]),  # start_time
                    self._parse_datetime(item["endTime"]),  # end_time
                    self._parse_datetime(item.get("actualEndTime")),  # actual_end_time
                    1 if item["isActive"] else 0,  # is_active
                    1 if item["isGap"] else 0,  # is_gap
                    item["entries"],  # entries
                    item["tokenCounts"]["inputTokens"],  # input_tokens
                    item["tokenCounts"]["outputTokens"],  # output_tokens
                    item["tokenCounts"][
                        "cacheCreationInputTokens"
                    ],  # cache_creation_tokens
                    item["tokenCounts"]["cacheReadInputTokens"],  # cache_read_tokens
                    item["totalTokens"],  # total_tokens
                    item["costUSD"],  # cost_usd
                    len(item["models"]),  # models_count
                    datetime.now(),  # created_at
                    datetime.now(),  # updated_at
                    self._parse_datetime(
                        item.get("usageLimitResetTime", None)
                    ),  # usage_limit_reset_time
                    self._extract_burn_rate(item.get("burnRate")),  # burn_rate
                    self._extract_projection(item.get("projection")),  # projection
                    source,  # source (must be last to match schema)
                ]
            )

            # Models used (blocks don't have detailed breakdowns in the same format)
            for model in item["models"]:
                if model != "<synthetic>":  # Skip synthetic entries
                    model_used_rows.append(
                        ["block", item["id"], MACHINE_NAME, model, datetime.now(), source]
                    )

        # Insert data
        if rows:
            self.client.insert("ccusage_usage_blocks", rows)
            # Block records inserted

        if model_used_rows:
            blocks_str = ",".join([f"'{b}'" for b in block_ids])
            delete_query = (
                f"DELETE FROM ccusage_models_used WHERE record_type = "
                f"'block' AND record_key IN ({blocks_str}) AND machine_name = '{MACHINE_NAME}' AND source = '{source}'"
            )
            self.client.command(delete_query)
            self.client.insert("ccusage_models_used", model_used_rows)

    def upsert_projects_daily_data(
        self, projects_data: Dict[str, List[Dict[str, Any]]], source: str = 'ccusage'
    ):
        """Insert or update projects daily usage data"""
        if not projects_data:
            # No projects data available
            return

        # Prepare data for insertion
        rows = []
        model_breakdown_rows = []
        model_used_rows = []
        dates_to_delete = set()

        for project_id, daily_records in projects_data.items():
            for item in daily_records:
                dates_to_delete.add(item["date"])

                # Main project daily record
                rows.append(
                    [
                        self._parse_date(item["date"]),
                        project_id,
                        MACHINE_NAME,
                        item["inputTokens"],
                        item["outputTokens"],
                        item["cacheCreationTokens"],
                        item["cacheReadTokens"],
                        item["totalTokens"],
                        item["totalCost"],
                        len(item["modelsUsed"]),
                        datetime.now(),
                        datetime.now(),
                        source,
                    ]
                )

                # Model breakdowns and models used
                for breakdown in item.get("modelBreakdowns", []):
                    model_breakdown_rows.append(
                        [
                            "project_daily",
                            f"{item['date']}_{project_id}",
                            MACHINE_NAME,
                            breakdown["modelName"],
                            breakdown["inputTokens"],
                            breakdown["outputTokens"],
                            breakdown["cacheCreationTokens"],
                            breakdown["cacheReadTokens"],
                            breakdown["cost"],
                            datetime.now(),
                            source,
                        ]
                    )

                for model in item["modelsUsed"]:
                    model_used_rows.append(
                        [
                            "project_daily",
                            f"{item['date']}_{project_id}",
                            MACHINE_NAME,
                            model,
                            datetime.now(),
                            source,
                        ]
                    )

        # Delete existing data for these dates
        if dates_to_delete:
            dates_str = ",".join([f"'{d}'" for d in dates_to_delete])
            self.client.command(
                f"DELETE FROM ccusage_usage_projects_daily WHERE date IN ({dates_str}) AND machine_name = '{MACHINE_NAME}' AND source = '{source}'"
            )

        # Insert data
        if rows:
            self.client.insert("ccusage_usage_projects_daily", rows)
            # Project daily records inserted

        if model_breakdown_rows:
            # Delete existing model breakdowns for these records
            record_keys = {
                f"{item['date']}_{project_id}"
                for project_id, daily_records in projects_data.items()
                for item in daily_records
            }
            if record_keys:
                keys_str = ",".join([f"'{k}'" for k in record_keys])
                delete_query = (
                    f"DELETE FROM ccusage_model_breakdowns WHERE record_type = "
                    f"'project_daily' AND record_key IN ({keys_str}) AND source = '{source}'"
                )
                self.client.command(delete_query)
            self.client.insert("ccusage_model_breakdowns", model_breakdown_rows)

        if model_used_rows:
            # Delete existing models used for these records
            record_keys = {
                f"{item['date']}_{project_id}"
                for project_id, daily_records in projects_data.items()
                for item in daily_records
            }
            if record_keys:
                keys_str = ",".join([f"'{k}'" for k in record_keys])
                delete_query = (
                    f"DELETE FROM ccusage_models_used WHERE record_type = "
                    f"'project_daily' AND record_key IN ({keys_str}) AND machine_name = '{MACHINE_NAME}' AND source = '{source}'"
                )
                self.client.command(delete_query)
            self.client.insert("ccusage_models_used", model_used_rows)

    def get_import_statistics(self) -> Dict[str, Any]:
        """Get comprehensive statistics after import with source grouping"""
        # Generate statistics silently

        stats = {}

        # Table row counts - get them grouped by source
        tables = [
            "ccusage_usage_daily",
            "ccusage_usage_monthly",
            "ccusage_usage_sessions",
            "ccusage_usage_blocks",
            "ccusage_usage_projects_daily",
            "ccusage_model_breakdowns",
            "ccusage_models_used",
        ]

        table_counts = {}
        for table in tables:
            try:
                # Try to get counts grouped by source (if column exists)
                count_result = self.client.query(
                    f"SELECT source, count() FROM {table} WHERE machine_name = '{MACHINE_NAME}' GROUP BY source ORDER BY source"
                ).result_rows
                # Store as dict: {'ccusage': 123, 'opencode': 45}
                table_counts[table] = {row[0]: int(row[1]) for row in count_result}
            except Exception:
                # Fallback to simple count if source column doesn't exist
                try:
                    count_result = self.client.query(
                        f"SELECT count() FROM {table} WHERE machine_name = '{MACHINE_NAME}'"
                    ).result_rows[0]
                    table_counts[table] = int(count_result[0])
                except Exception:
                    # Silently handle table count error
                    table_counts[table] = 0

        stats["table_counts"] = table_counts

        # Usage summary
        usage_summary_query = """
        SELECT
            sum(total_cost) as total_cost,
            sum(total_tokens) as total_tokens,
            sum(input_tokens) as total_input_tokens,
            sum(output_tokens) as total_output_tokens,
            sum(cache_creation_tokens) as total_cache_creation_tokens,
            sum(cache_read_tokens) as total_cache_read_tokens,
            min(date) as earliest_date,
            max(date) as latest_date,
            count(distinct date) as days_with_usage
        FROM ccusage_usage_daily
        """

        usage_result = self.client.query(usage_summary_query).result_rows[0]
        stats["usage_summary"] = {
            "total_cost": float(usage_result[0]) if usage_result[0] else 0.0,
            "total_tokens": int(usage_result[1]) if usage_result[1] else 0,
            "total_input_tokens": int(usage_result[2]) if usage_result[2] else 0,
            "total_output_tokens": int(usage_result[3]) if usage_result[3] else 0,
            "total_cache_creation_tokens": (
                int(usage_result[4]) if usage_result[4] else 0
            ),
            "total_cache_read_tokens": int(usage_result[5]) if usage_result[5] else 0,
            "earliest_date": str(usage_result[6]) if usage_result[6] else None,
            "latest_date": str(usage_result[7]) if usage_result[7] else None,
            "days_with_usage": int(usage_result[8]) if usage_result[8] else 0,
        }

        # Usage by source (ccusage vs OpenCode)
        stats["usage_by_source"] = {}
        for source in ['ccusage', 'opencode']:
            source_query = f"""
            SELECT
                sum(total_cost) as total_cost,
                sum(total_tokens) as total_tokens,
                min(date) as earliest_date,
                max(date) as latest_date
            FROM ccusage_usage_daily
            WHERE source = '{source}' AND machine_name = '{MACHINE_NAME}'
            """
            try:
                result = self.client.query(source_query).result_rows[0]
                stats["usage_by_source"][source] = {
                    "total_cost": float(result[0]) if result[0] else 0.0,
                    "total_tokens": int(result[1]) if result[1] else 0,
                    "earliest_date": str(result[2]) if result[2] else None,
                    "latest_date": str(result[3]) if result[3] else None,
                }
            except Exception:
                stats["usage_by_source"][source] = {"total_cost": 0, "total_tokens": 0, "earliest_date": None, "latest_date": None}

        # Model usage
        model_stats_query = """
        SELECT
            model_name,
            count() as usage_count,
            sum(cost) as total_cost,
            sum(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens) as total_tokens
        FROM ccusage_model_breakdowns
        WHERE record_type = 'daily'
        GROUP BY model_name
        ORDER BY total_cost DESC
        """

        model_results = self.client.query(model_stats_query).result_rows
        stats["model_usage"] = [
            {
                "model_name": row[0],
                "usage_count": int(row[1]),
                "total_cost": float(row[2]),
                "total_tokens": int(row[3]),
            }
            for row in model_results
        ]

        # Session statistics
        session_stats_query = """
        SELECT
            count() as total_sessions,
            avg(total_cost) as avg_cost_per_session,
            max(total_cost) as max_cost_session,
            sum(total_tokens) as total_session_tokens
        FROM ccusage_usage_sessions
        """

        session_result = self.client.query(session_stats_query).result_rows[0]
        stats["session_stats"] = {
            "total_sessions": int(session_result[0]) if session_result[0] else 0,
            "avg_cost_per_session": (
                float(session_result[1]) if session_result[1] else 0.0
            ),
            "max_cost_session": float(session_result[2]) if session_result[2] else 0.0,
            "total_session_tokens": int(session_result[3]) if session_result[3] else 0,
        }

        # Active blocks
        active_blocks_query = """
        SELECT count() as active_blocks
        FROM ccusage_usage_blocks
        WHERE is_active = 1
        """

        active_result = self.client.query(active_blocks_query).result_rows[0]
        stats["active_blocks"] = int(active_result[0]) if active_result[0] else 0

        # Machine-specific statistics
        machine_stats_query = """
        SELECT
            machine_name,
            sum(total_cost) as machine_total_cost,
            sum(total_tokens) as machine_total_tokens,
            count(distinct date) as machine_active_days,
            max(date) as machine_last_activity
        FROM ccusage_usage_daily
        GROUP BY machine_name
        ORDER BY machine_total_cost DESC
        """

        machine_results = self.client.query(machine_stats_query).result_rows
        stats["machine_stats"] = [
            {
                "machine_name": row[0],
                "total_cost": float(row[1]),
                "total_tokens": int(row[2]),
                "active_days": int(row[3]),
                "last_activity": str(row[4]),
            }
            for row in machine_results
        ]

        return stats

    def get_heatmap_data(self, days: int = 365) -> Dict[str, Any]:
        """
        Query daily usage data for heatmap visualization.

        Args:
            days: Number of days to include (default 365)

        Returns:
            Dict with:
            - 'daily_data': List of {date, day_of_week, week_num, tokens, cost}
            - 'total_tokens': Total tokens in period
            - 'active_days': Number of days with activity
            - 'date_range': (min_date, max_date)
        """
        query = f"""
        SELECT
            date,
            toDayOfWeek(date) as day_of_week,
            toRelativeWeekNum(date) as week_num,
            sum(total_tokens) as tokens,
            sum(total_cost) as cost
        FROM ccusage_usage_daily
        WHERE date >= today() - INTERVAL {days} DAY
          AND machine_name = '{MACHINE_NAME}'
        GROUP BY date, day_of_week, week_num
        ORDER BY date
        """
        result = self.client.query(query).result_rows

        daily_data = []
        total_tokens = 0
        active_days = len(result)

        for row in result:
            daily_data.append({
                "date": row[0],
                "day_of_week": row[1],  # 1-7
                "week_num": row[2],
                "tokens": int(row[3]),
                "cost": float(row[4])
            })
            total_tokens += int(row[3])

        return {
            "daily_data": daily_data,
            "total_tokens": total_tokens,
            "active_days": active_days,
            "date_range": (result[0][0] if result else None, result[-1][0] if result else None)
        }

    def get_streak_stats(self) -> Dict[str, Any]:
        """
        Calculate current and longest streaks of consecutive active days.

        Returns:
            Dict with current_streak, longest_streak
        """
        query = f"""
        WITH ordered_dates AS (
            SELECT date, total_tokens
            FROM ccusage_usage_daily
            WHERE machine_name = '{MACHINE_NAME}'
            ORDER BY date DESC
        ),
        streak_groups AS (
            SELECT
                date,
                total_tokens,
                date - toInt32(rowNumber() - 1) as group_id
            FROM ordered_dates
            WHERE total_tokens > 0
        )
        SELECT
            count() as current_streak,
            max(group_count) as longest_streak
        FROM (
            SELECT
                group_id,
                count() as group_count
            FROM streak_groups
            GROUP BY group_id
            ORDER BY group_id
            LIMIT 1
        )
        CROSS JOIN (
            SELECT max(group_count) as group_count
            FROM (
                SELECT count() as group_count
                FROM streak_groups
                GROUP BY group_id
            )
        )
        """

        try:
            result = self.client.query(query).result_rows[0]
            return {
                "current_streak": int(result[0]) if result[0] else 0,
                "longest_streak": int(result[1]) if result[1] else 0
            }
        except Exception:
            return {"current_streak": 0, "longest_streak": 0}

    def get_peak_hour(self) -> Optional[str]:
        """
        Find peak usage day of week from daily data.

        Note: Session data stores dates only (no time), so we calculate
        peak activity from daily usage patterns instead.

        Returns:
            Day string like "Mon" or None
        """
        query = f"""
        SELECT
            toDayOfWeek(date) as day_of_week,
            sum(total_tokens) as tokens
        FROM ccusage_usage_daily
        WHERE machine_name = '{MACHINE_NAME}'
          AND date >= today() - INTERVAL 90 DAY
        GROUP BY day_of_week
        ORDER BY tokens DESC
        LIMIT 1
        """

        try:
            result = self.client.query(query).result_rows
            if result and result[0]:
                day_num = int(result[0][0])  # 1=Monday, 7=Sunday
                days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
                return days[day_num - 1] if 1 <= day_num <= 7 else None
        except Exception:
            pass
        return None

    def get_favorite_model(self) -> Dict[str, Any]:
        """
        Find most-used model by total tokens.

        Returns:
            Dict with model_name, token_count, percentage
        """
        query = f"""
        SELECT
            model_name,
            sum(input_tokens + output_tokens) as total_tokens
        FROM ccusage_model_breakdowns
        WHERE machine_name = '{MACHINE_NAME}'
        GROUP BY model_name
        ORDER BY total_tokens DESC
        LIMIT 1
        """

        try:
            result = self.client.query(query).result_rows
            if result and result[0]:
                # Get total for percentage calculation
                total_query = f"""
                SELECT sum(input_tokens + output_tokens)
                FROM ccusage_model_breakdowns
                WHERE machine_name = '{MACHINE_NAME}'
                """
                total = self.client.query(total_query).result_rows[0][0]

                model_name = result[0][0]
                tokens = int(result[0][1])
                percentage = (tokens / total * 100) if total > 0 else 0

                return {
                    "model_name": model_name,
                    "tokens": tokens,
                    "percentage": percentage
                }
        except Exception:
            pass

        return {"model_name": "N/A", "tokens": 0, "percentage": 0}

    def get_session_stats(self) -> Dict[str, Any]:
        """
        Get session statistics: total count.

        Note: The sessions table doesn't track duration, only counts.

        Returns:
            Dict with session_count
        """
        query = f"""
        SELECT
            count() as session_count
        FROM ccusage_usage_sessions
        WHERE machine_name = '{MACHINE_NAME}'
        """

        try:
            result = self.client.query(query).result_rows[0]
            return {
                "session_count": int(result[0]),
                "longest_session_seconds": 0  # Not tracked in schema
            }
        except Exception:
            return {"session_count": 0, "longest_session_seconds": 0}

    def display_charts(self, days: int = 365, tabs: List[str] = ["Overview", "Models"], auto_cycle: bool = True):
        """
        Display chart visualizations with tab navigation.

        Args:
            days: Number of days to include in heatmap
            tabs: List of tab names to display
            auto_cycle: If True, automatically cycle through tabs with delay
        """
        import time
        import signal

        # Fetch all data
        heatmap_data = self.get_heatmap_data(days)
        streaks = self.get_streak_stats()
        peak_hour = self.get_peak_hour()
        favorite_model = self.get_favorite_model()
        sessions = self.get_session_stats()

        # Fetch model breakdown for Models tab
        model_query = f"""
        SELECT
            model_name,
            sum(input_tokens + output_tokens) as tokens,
            sum(cost) as cost
        FROM ccusage_model_breakdowns
        WHERE machine_name = '{MACHINE_NAME}'
        GROUP BY model_name
        ORDER BY tokens DESC
        """
        model_result = self.client.query(model_query).result_rows
        total_tokens = sum(m[1] for m in model_result) if model_result else 0

        model_data = []
        for row in model_result:
            model_data.append({
                "model_name": row[0],
                "tokens": int(row[1]),
                "cost": float(row[2]),
                "percentage": (row[1] / total_tokens * 100) if total_tokens > 0 else 0
            })

        # Prepare stats dict
        stats = {
            "total_tokens": heatmap_data.get("total_tokens", 0),
            "heatmap": {
                **heatmap_data,
                "total_days": days
            },
            "streaks": streaks,
            "peak_hour": peak_hour,
            "favorite_model": favorite_model,
            "sessions": sessions
        }

        # Tab display function
        def show_tab(tab_name: str):
            print("\033[2J\033[H")  # Clear screen (works on most terminals)
            UIFormatter.print_header(f"AI USAGE ANALYTICS - {tab_name}", 70)

            if tab_name == "Overview":
                UIFormatter.print_heatmap(heatmap_data["daily_data"], days, "Activity Heatmap")
                print()
                UIFormatter.print_statistics_summary(stats)
            elif tab_name == "Models":
                UIFormatter.print_models_tab(model_data)

            print()
            print("  Press Ctrl+C to exit", end="")
            if auto_cycle and len(tabs) > 1:
                next_idx = (tabs.index(tab_name) + 1) % len(tabs)
                print(f", or wait for next tab ({tabs[next_idx]})...", end="", flush=True)

        # Display tabs
        if auto_cycle:
            try:
                for tab in tabs:
                    show_tab(tab)
                    time.sleep(8)  # Wait 8 seconds before next tab
            except KeyboardInterrupt:
                print("\n\n  Exiting charts...")
        else:
            # Single tab display
            for tab in tabs:
                show_tab(tab)
                if len(tabs) > 1:
                    input("\n  Press Enter to continue...")

    def print_statistics(self, stats: Dict[str, Any]):
        """Print beautifully formatted statistics with source grouping"""
        UIFormatter.print_header("📊 IMPORT SUMMARY & STATISTICS", 70)

        # Table counts with source breakdown
        UIFormatter.print_section("📋 Database Records", 70)
        for table, count in stats["table_counts"].items():
            table_display = table.replace("ccusage_", "").replace("_", " ").title()
            if isinstance(count, dict):
                # Format: "Usage Daily: ccusage: 123 | opencode: 45"
                parts = [f"{s}: {UIFormatter.format_number(c)}" for s, c in count.items()]
                UIFormatter.print_metric(table_display, " | ".join(parts))
            else:
                # Backward compatibility: simple count
                count_formatted = UIFormatter.format_number(count)
                UIFormatter.print_metric(table_display, f"{count_formatted} records")

        # Data source statistics (NEW)
        if stats.get("usage_by_source"):
            has_data = any(
                stats["usage_by_source"].get(s, {}).get("total_tokens", 0) > 0
                for s in ['ccusage', 'opencode']
            )
            if has_data:
                UIFormatter.print_section("📊 Data Source Statistics", 70)
                for source in ['ccusage', 'opencode']:
                    source_data = stats["usage_by_source"].get(source, {})
                    if source_data.get("total_tokens", 0) > 0:
                        tokens_str = UIFormatter.format_number(source_data["total_tokens"])
                        cost_str = f"${source_data['total_cost']:,.2f}"
                        UIFormatter.print_metric(source.title(), f"{tokens_str} tokens, {cost_str}")

        # Usage summary with better number formatting
        usage = stats["usage_summary"]
        UIFormatter.print_section("💰 Usage Analytics", 70)
        UIFormatter.print_metric("Total Cost", f"${usage['total_cost']:,.2f}")
        UIFormatter.print_metric(
            "Total Tokens", UIFormatter.format_number(usage["total_tokens"])
        )
        UIFormatter.print_metric(
            "Input Tokens", UIFormatter.format_number(usage["total_input_tokens"])
        )
        UIFormatter.print_metric(
            "Output Tokens", UIFormatter.format_number(usage["total_output_tokens"])
        )
        UIFormatter.print_metric(
            "Cache Creation Tokens",
            UIFormatter.format_number(usage["total_cache_creation_tokens"]),
        )
        UIFormatter.print_metric(
            "Cache Read Tokens",
            UIFormatter.format_number(usage["total_cache_read_tokens"]),
        )
        UIFormatter.print_metric(
            "Date Range", f"{usage['earliest_date']} → {usage['latest_date']}"
        )
        UIFormatter.print_metric(
            "Days with Usage", f"{usage['days_with_usage']:,} days"
        )

        # Model breakdown with cleaner formatting
        UIFormatter.print_section("🤖 Top Models by Cost", 70)
        for i, model in enumerate(stats["model_usage"][:5], 1):
            model_name = (
                model["model_name"].replace("claude-", "").replace("-20250514", "")
            )
            cost_str = f"${model['total_cost']:,.2f}"
            tokens_str = UIFormatter.format_number(model["total_tokens"])
            UIFormatter.print_metric(
                f"{i}. {model_name}", f"{cost_str} ({tokens_str} tokens)"
            )

        # Session stats
        session = stats["session_stats"]
        UIFormatter.print_section("💼 Session Insights", 70)
        UIFormatter.print_metric("Total Sessions", f"{session['total_sessions']:,}")
        UIFormatter.print_metric(
            "Avg Cost per Session", f"${session['avg_cost_per_session']:,.2f}"
        )
        UIFormatter.print_metric(
            "Max Cost Session", f"${session['max_cost_session']:,.2f}"
        )
        UIFormatter.print_metric(
            "Total Session Tokens",
            UIFormatter.format_number(session["total_session_tokens"]),
        )

        # Active blocks - compact
        if stats["active_blocks"] > 0:
            UIFormatter.print_section("🧱 Active Blocks")
            UIFormatter.print_metric("Count", f"{stats['active_blocks']:,}")

        # Machine info - compact
        if stats.get("machine_stats"):
            if len(stats["machine_stats"]) > 1:
                UIFormatter.print_section("🖥️  Machines")
                for i, machine in enumerate(stats["machine_stats"], 1):
                    cost_str = f"${machine['total_cost']:,.2f}"
                    UIFormatter.print_metric(
                        f"{i}. {machine['machine_name']}", cost_str
                    )
            else:
                machine = stats["machine_stats"][0]
                UIFormatter.print_section("🖥️  Machine")
                UIFormatter.print_metric("Name", machine["machine_name"])

        print()  # Just a blank line

    def save_import_statistics(
        self,
        stats: Dict[str, Any],
        import_duration_seconds: float,
        records_imported: int = 0,
        data_hash: str = "",
    ):
        """Save import statistics to history table for comparison tracking"""
        try:
            import json

            statistics_json = json.dumps(stats, default=str, separators=(",", ":"))

            # Include data hash to detect identical imports
            self.client.command(f"""
                INSERT INTO ccusage_import_history
                (import_timestamp, machine_name, import_duration_seconds, statistics_json, records_imported, import_status, data_hash)
                VALUES (now(), '{MACHINE_NAME}', {import_duration_seconds}, '{statistics_json}', {records_imported}, 'completed', '{data_hash}')
            """)

        except Exception as e:
            print(f"⚠️  Warning: Could not save import statistics: {e}")

    def get_previous_statistics(self) -> Dict[str, Any]:
        """Retrieve the most recent import statistics for comparison"""
        try:
            result = self.client.query(f"""
                SELECT statistics_json
                FROM ccusage_import_history
                WHERE machine_name = '{MACHINE_NAME}'
                ORDER BY import_timestamp DESC
                LIMIT 1 OFFSET 1
            """)

            if result.result_rows:
                import json

                return json.loads(result.result_rows[0][0])
            return {}

        except Exception as e:
            print(f"⚠️  Warning: Could not retrieve previous statistics: {e}")
            return {}

    def _calculate_data_hash(self, all_data: Dict[str, Any]) -> str:
        """Calculate a hash of the imported data to detect identical imports"""
        import hashlib
        import json

        try:
            # Create a stable hash of the data content
            data_str = json.dumps(all_data, sort_keys=True, default=str)
            return hashlib.md5(data_str.encode()).hexdigest()[:12]  # Short hash
        except Exception:
            return ""

    def _is_identical_import(self, all_data: Dict[str, Any]) -> bool:
        """Check if this data is identical to the previous import"""
        try:
            current_hash = self._calculate_data_hash(all_data)

            result = self.client.query(f"""
                SELECT data_hash
                FROM ccusage_import_history
                WHERE machine_name = '{MACHINE_NAME}'
                ORDER BY import_timestamp DESC
                LIMIT 1
            """)

            if result.result_rows:
                last_hash = result.result_rows[0][0]
                return last_hash == current_hash

            return False

        except Exception:
            return False

    def print_statistics_with_comparison(self, stats: Dict[str, Any]):
        """Print statistics with comparison to previous import with source grouping"""
        previous_stats = self.get_previous_statistics()

        UIFormatter.print_header("📊 IMPORT SUMMARY & STATISTICS", 70)

        # Table counts with source-aware comparison
        UIFormatter.print_section("📋 Database Records", 70)
        for table, count in stats["table_counts"].items():
            table_display = table.replace("ccusage_", "").replace("_", " ").title()
            if isinstance(count, dict):
                # Format: "Usage Daily: ccusage: 123 | opencode: 45"
                parts = []
                for source, current_count in count.items():
                    diff_str = ""
                    prev_counts = previous_stats.get("table_counts", {}).get(table, {})
                    if isinstance(prev_counts, dict) and source in prev_counts:
                        prev_count = prev_counts[source]
                        diff = current_count - prev_count
                        if diff > 0:
                            diff_str = f" (+{UIFormatter.format_number(diff)})"
                        elif diff < 0:
                            diff_str = f" ({UIFormatter.format_number(diff)})"
                    parts.append(f"{source}: {UIFormatter.format_number(current_count)}{diff_str}")
                UIFormatter.print_metric(table_display, " | ".join(parts))
            else:
                # Backward compatibility: simple count
                count_formatted = UIFormatter.format_number(count)
                diff_str = ""
                if previous_stats.get("table_counts", {}).get(table):
                    prev_count = previous_stats["table_counts"][table]
                    if not isinstance(prev_count, dict):
                        diff = count - prev_count
                        if diff > 0:
                            diff_str = f" (+{UIFormatter.format_number(diff)})"
                        elif diff < 0:
                            diff_str = f" ({UIFormatter.format_number(diff)})"
                UIFormatter.print_metric(table_display, f"{count_formatted} records{diff_str}")

        # Data source statistics (NEW)
        if stats.get("usage_by_source"):
            has_data = any(
                stats["usage_by_source"].get(s, {}).get("total_tokens", 0) > 0
                for s in ['ccusage', 'opencode']
            )
            if has_data:
                UIFormatter.print_section("📊 Data Source Statistics", 70)
                for source in ['ccusage', 'opencode']:
                    source_data = stats["usage_by_source"].get(source, {})
                    if source_data.get("total_tokens", 0) > 0:
                        tokens_str = UIFormatter.format_number(source_data["total_tokens"])
                        cost_str = f"${source_data['total_cost']:,.2f}"
                        UIFormatter.print_metric(source.title(), f"{tokens_str} tokens, {cost_str}")

        # Usage summary with comparison
        usage = stats["usage_summary"]
        prev_usage = previous_stats.get("usage_summary", {})

        UIFormatter.print_section("💰 Usage Analytics", 70)

        # Total Cost
        cost_diff = ""
        if prev_usage.get("total_cost"):
            diff = usage["total_cost"] - prev_usage["total_cost"]
            if diff > 0:
                cost_diff = f" (+${diff:,.2f})"
            elif diff < 0:
                cost_diff = f" (${diff:,.2f})"
        UIFormatter.print_metric(
            "Total Cost", f"${usage['total_cost']:,.2f}{cost_diff}"
        )

        # Total Tokens
        tokens_diff = ""
        if prev_usage.get("total_tokens"):
            diff = usage["total_tokens"] - prev_usage["total_tokens"]
            if diff > 0:
                tokens_diff = f" (+{UIFormatter.format_number(diff)})"
            elif diff < 0:
                tokens_diff = f" ({UIFormatter.format_number(diff)})"
        UIFormatter.print_metric(
            "Total Tokens",
            f"{UIFormatter.format_number(usage['total_tokens'])}{tokens_diff}",
        )

        # Input Tokens
        input_diff = ""
        if prev_usage.get("total_input_tokens"):
            diff = usage["total_input_tokens"] - prev_usage["total_input_tokens"]
            if diff > 0:
                input_diff = f" (+{UIFormatter.format_number(diff)})"
            elif diff < 0:
                input_diff = f" ({UIFormatter.format_number(diff)})"
        UIFormatter.print_metric(
            "Input Tokens",
            f"{UIFormatter.format_number(usage['total_input_tokens'])}{input_diff}",
        )

        # Output Tokens
        output_diff = ""
        if prev_usage.get("total_output_tokens"):
            diff = usage["total_output_tokens"] - prev_usage["total_output_tokens"]
            if diff > 0:
                output_diff = f" (+{UIFormatter.format_number(diff)})"
            elif diff < 0:
                output_diff = f" ({UIFormatter.format_number(diff)})"
        UIFormatter.print_metric(
            "Output Tokens",
            f"{UIFormatter.format_number(usage['total_output_tokens'])}{output_diff}",
        )

        # Cache Creation Tokens
        cache_create_diff = ""
        if prev_usage.get("total_cache_creation_tokens"):
            diff = (
                usage["total_cache_creation_tokens"]
                - prev_usage["total_cache_creation_tokens"]
            )
            if diff > 0:
                cache_create_diff = f" (+{UIFormatter.format_number(diff)})"
            elif diff < 0:
                cache_create_diff = f" ({UIFormatter.format_number(diff)})"
        UIFormatter.print_metric(
            "Cache Creation Tokens",
            f"{UIFormatter.format_number(usage['total_cache_creation_tokens'])}{cache_create_diff}",
        )

        # Cache Read Tokens
        cache_read_diff = ""
        if prev_usage.get("total_cache_read_tokens"):
            diff = (
                usage["total_cache_read_tokens"] - prev_usage["total_cache_read_tokens"]
            )
            if diff > 0:
                cache_read_diff = f" (+{UIFormatter.format_number(diff)})"
            elif diff < 0:
                cache_read_diff = f" ({UIFormatter.format_number(diff)})"
        UIFormatter.print_metric(
            "Cache Read Tokens",
            f"{UIFormatter.format_number(usage['total_cache_read_tokens'])}{cache_read_diff}",
        )

        UIFormatter.print_metric(
            "Date Range", f"{usage['earliest_date']} → {usage['latest_date']}"
        )
        UIFormatter.print_metric(
            "Days with Usage", f"{usage['days_with_usage']:,} days"
        )

        # Model breakdown with cleaner formatting
        UIFormatter.print_section("🤖 Top Models by Cost", 70)
        for i, model in enumerate(stats["model_usage"][:5], 1):
            model_name = (
                model["model_name"].replace("claude-", "").replace("-20250514", "")
            )
            cost_str = f"${model['total_cost']:,.2f}"
            tokens_str = UIFormatter.format_number(model["total_tokens"])
            UIFormatter.print_metric(
                f"{i}. {model_name}", f"{cost_str} ({tokens_str} tokens)"
            )

        # Session stats with comparison
        session = stats["session_stats"]
        prev_session = previous_stats.get("session_stats", {})

        UIFormatter.print_section("💼 Session Insights", 70)

        # Total Sessions
        sessions_diff = ""
        if prev_session.get("total_sessions"):
            diff = session["total_sessions"] - prev_session["total_sessions"]
            if diff > 0:
                sessions_diff = f" (+{diff})"
            elif diff < 0:
                sessions_diff = f" ({diff})"
        UIFormatter.print_metric(
            "Total Sessions", f"{session['total_sessions']:,}{sessions_diff}"
        )

        UIFormatter.print_metric(
            "Avg Cost per Session", f"${session['avg_cost_per_session']:,.2f}"
        )
        UIFormatter.print_metric(
            "Max Cost Session", f"${session['max_cost_session']:,.2f}"
        )
        UIFormatter.print_metric(
            "Total Session Tokens",
            UIFormatter.format_number(session["total_session_tokens"]),
        )

        # Active blocks with comparison
        if stats["active_blocks"] > 0:
            UIFormatter.print_section("🧱 Active Blocks")
            blocks_diff = ""
            if previous_stats.get("active_blocks"):
                diff = stats["active_blocks"] - previous_stats["active_blocks"]
                if diff > 0:
                    blocks_diff = f" (+{diff})"
                elif diff < 0:
                    blocks_diff = f" ({diff})"
            UIFormatter.print_metric(
                "Count", f"{stats['active_blocks']:,}{blocks_diff}"
            )

        # Machine info - compact
        if stats.get("machine_stats"):
            if len(stats["machine_stats"]) > 1:
                UIFormatter.print_section("🖥️  Machines")
                for i, machine in enumerate(stats["machine_stats"], 1):
                    cost_str = f"${machine['total_cost']:,.2f}"
                    UIFormatter.print_metric(
                        f"{i}. {machine['machine_name']}", cost_str
                    )
            else:
                machine = stats["machine_stats"][0]
                UIFormatter.print_section("🖥️  Machine")
                UIFormatter.print_metric("Name", machine["machine_name"])

        print()  # Just a blank line

    def _check_data_freshness(self) -> Dict[str, Any]:
        """Check if ClickHouse data is stale compared to ccusage current state"""
        try:
            # Get last import time from history
            result = self.client.query(f"""
                SELECT
                    import_timestamp,
                    dateDiff('second', import_timestamp, now()) as seconds_since_import
                FROM ccusage_import_history
                WHERE machine_name = '{MACHINE_NAME}'
                ORDER BY import_timestamp DESC
                LIMIT 1
            """)

            if result.result_rows:
                last_import_time = result.result_rows[0][0]
                seconds_since_import = int(result.result_rows[0][1])

                # Get latest date in ClickHouse
                ch_result = self.client.query("""
                    SELECT max(date) as latest_date
                    FROM ccusage_usage_daily
                """)
                latest_ch_date = (
                    str(ch_result.result_rows[0][0]) if ch_result.result_rows else None
                )

                # Get latest date from ccusage
                ccusage_data = self.run_ccusage_command("daily", verbose=False)
                latest_ccusage_date = None
                if ccusage_data.get("daily"):
                    latest_ccusage_date = ccusage_data["daily"][-1]["date"]

                return {
                    "last_import_time": last_import_time,
                    "seconds_since_import": seconds_since_import,
                    "latest_ch_date": latest_ch_date,
                    "latest_ccusage_date": latest_ccusage_date,
                    "is_stale": latest_ch_date != latest_ccusage_date
                    if latest_ch_date and latest_ccusage_date
                    else False,
                }

            return {"is_stale": False}

        except Exception:
            return {"is_stale": False}

    def import_all_data(self):
        """Import all ccusage and/or OpenCode data into ClickHouse with enhanced UI and animations"""
        UIFormatter.print_header("CCUSAGE DATA IMPORTER")
        privacy_status = "Enabled" if HASH_PROJECT_NAMES else "Disabled"
        print(
            f"Database: {CH_DATABASE} at {CH_HOST}:{CH_PORT} | Machine: {MACHINE_NAME}"
        )
        print(f"Project Privacy: {privacy_status}")

        # Show which sources are being imported
        sources_to_import = []
        if not SKIP_CCUSAGE:
            sources_to_import.append("ccusage")
        if not SKIP_OPENCODE:
            sources_to_import.append("OpenCode")
        print(f"Import sources: {', '.join(sources_to_import)}")

        # Check data freshness before import (only if importing ccusage)
        if not SKIP_CCUSAGE:
            freshness = self._check_data_freshness()
            if freshness.get("is_stale"):
                hours_old = freshness.get("seconds_since_import", 0) // 3600
                print(f"⚠️  Data is stale: ClickHouse has data up to {freshness['latest_ch_date']}, ccusage has {freshness['latest_ccusage_date']}")
                print(f"   Last import was {hours_old} hours ago")

        print()

        overall_start = datetime.now()

        try:
            # Fetch all data in parallel (ccusage + OpenCode)
            all_data = self.fetch_all_data_parallel(
                opencode_path=DEFAULT_OPENCODE_PATH,
                skip_opencode=SKIP_OPENCODE
            )

            # Separate ccusage and OpenCode data
            ccusage_data = {
                "daily": all_data.get("daily", {}),
                "monthly": all_data.get("monthly", {}),
                "session": all_data.get("session", {}),
                "blocks": all_data.get("blocks", {}),
                "projects": all_data.get("projects", {}),
            }
            opencode_data = all_data.get("opencode", {})

            # Check if we have any data to import
            has_ccusage_data = any(ccusage_data.values())
            has_opencode_data = bool(opencode_data.get("daily") or opencode_data.get("monthly") or opencode_data.get("session"))

            if not has_ccusage_data and not has_opencode_data:
                print("⚠️  No data found to import")
                return

            # Process and import data
            UIFormatter.print_step(
                2,
                "Processing and importing data",
                "Converting data types and inserting into ClickHouse...",
            )

            loader = LoadingAnimation("Processing data")
            loader.start()
            # import_start = datetime.now()

            # Import ccusage data
            if not SKIP_CCUSAGE:
                # Import daily data
                if "daily" in ccusage_data and ccusage_data["daily"]:
                    self.upsert_daily_data(ccusage_data["daily"], source='ccusage')
                    loader.stop("ccusage daily data processed")
                else:
                    loader.stop(error_message="No ccusage daily data found")

                # Import monthly data
                if "monthly" in ccusage_data and ccusage_data["monthly"]:
                    self.upsert_monthly_data(ccusage_data["monthly"], source='ccusage')
                    print("✓ ccusage Monthly")
                else:
                    print("⚠️  No ccusage monthly data")

                # Import session data
                if "session" in ccusage_data and ccusage_data["session"]:
                    self.upsert_session_data(ccusage_data["session"], source='ccusage')
                    print("✓ ccusage Sessions")
                else:
                    print("⚠️  No ccusage session data")

                # Import blocks data
                if "blocks" in ccusage_data and ccusage_data["blocks"]:
                    self.upsert_blocks_data(ccusage_data["blocks"], source='ccusage')
                    print("✓ ccusage Blocks")
                else:
                    print("⚠️  No ccusage blocks data")

                # Import projects daily data
                if "projects" in ccusage_data and ccusage_data["projects"]:
                    loader = LoadingAnimation("Processing ccusage projects data")
                    loader.start()
                    self.upsert_projects_daily_data(ccusage_data["projects"], source='ccusage')
                    loader.stop("ccusage Projects data processed")
                else:
                    print("⚠️  No ccusage projects data found")

            # Import OpenCode data
            if not SKIP_OPENCODE and opencode_data:
                try:
                    # Import daily data
                    if opencode_data.get("daily"):
                        self.upsert_daily_data(opencode_data["daily"], source='opencode')
                        print("✓ OpenCode Daily")
                    else:
                        print("⚠️  No OpenCode daily data")

                    # Import monthly data
                    if opencode_data.get("monthly"):
                        self.upsert_monthly_data(opencode_data["monthly"], source='opencode')
                        print("✓ OpenCode Monthly")
                    else:
                        print("⚠️  No OpenCode monthly data")

                    # Import session data
                    if opencode_data.get("session"):
                        self.upsert_session_data(opencode_data["session"], source='opencode')
                        print("✓ OpenCode Sessions")
                    else:
                        print("⚠️  No OpenCode session data")

                    # Import projects daily data
                    if opencode_data.get("projects"):
                        loader = LoadingAnimation("Processing OpenCode projects data")
                        loader.start()
                        self.upsert_projects_daily_data(opencode_data["projects"], source='opencode')
                        loader.stop("OpenCode Projects data processed")
                    else:
                        print("⚠️  No OpenCode projects data found")

                    print("✅ OpenCode data imported successfully")

                except Exception as e:
                    import traceback
                    print(f"⚠️  OpenCode import failed (non-critical): {e}")
                    traceback.print_exc()

            # import_duration = (datetime.now() - import_start).total_seconds()
            overall_duration = (datetime.now() - overall_start).total_seconds()

            UIFormatter.print_step(
                3, "Generating analytics", "Computing usage statistics and insights..."
            )

            stats = self.get_import_statistics()
            print(
                f"\n✓ Import completed in {UIFormatter.format_duration(overall_duration)}"
            )

            # Display beautiful statistics with comparison to previous import
            self.print_statistics_with_comparison(stats)

            # Show overview chart after import
            print()
            try:
                self.display_charts(days=365, tabs=["Overview"], auto_cycle=False)
            except KeyboardInterrupt:
                print("\n  Charts skipped by user")

            # Save import statistics for future comparison with data hash
            # Calculate total records - handle both dict (per-source) and int (simple) formats
            table_counts = stats.get("table_counts", {})
            total_records = 0
            if isinstance(table_counts, dict):
                for count in table_counts.values():
                    if isinstance(count, dict):
                        total_records += sum(count.values())
                    else:
                        total_records += count
            current_hash = self._calculate_data_hash(all_data)
            self.save_import_statistics(
                stats, overall_duration, total_records, current_hash
            )

        except Exception as e:
            print(f"\n❌ Import failed: {e}")
            raise


def system_check():
    """Comprehensive system validation and prerequisites check"""
    print("🚀 CCUSAGE SYSTEM CHECK")
    print(f"Machine: {MACHINE_NAME}")
    print()

    all_checks_passed = True

    # 1. Check ccusage availability
    print("🔧 Checking ccusage availability...")

    # Check bunx
    bunx_available = False
    try:
        result = subprocess.run(["bunx", "--version"], capture_output=True, text=True)
        if result.returncode == 0:
            print(f"  ✅ bunx available: {result.stdout.strip()}")
            bunx_available = True
    except FileNotFoundError:
        pass

    # Check npx
    npx_available = False
    try:
        result = subprocess.run(["npx", "--version"], capture_output=True, text=True)
        if result.returncode == 0:
            print(f"  ✅ npx available: {result.stdout.strip()}")
            npx_available = True
    except FileNotFoundError:
        pass

    if not (bunx_available or npx_available):
        print("  ❌ Neither bunx nor npx is available - ccusage cannot be executed")
        all_checks_passed = False

    # Test ccusage execution
    print("\n📊 Testing ccusage execution...")
    ccusage_commands = [
        ("daily", "npx ccusage@latest daily --json"),
        ("monthly", "npx ccusage@latest monthly --json"),
        ("session", "npx ccusage@latest session --json"),
        ("blocks", "npx ccusage@latest blocks --json"),
        ("projects", "npx ccusage@latest daily --instances --json"),
    ]

    for cmd_name, cmd in ccusage_commands:
        try:
            result = subprocess.run(
                cmd.split(), capture_output=True, text=True, timeout=120
            )
            if result.returncode == 0:
                data = json.loads(result.stdout)
                print(
                    f"  ✅ {cmd_name}: {len(data.get('data', data))} records available"
                )
            else:
                print(f"  ❌ {cmd_name}: Failed to execute - {result.stderr}")
                all_checks_passed = False
        except subprocess.TimeoutExpired:
            print(f"  ⚠️  {cmd_name}: Command timed out (120s)")
            all_checks_passed = False
        except json.JSONDecodeError:
            print(f"  ⚠️  {cmd_name}: Invalid JSON response")
            all_checks_passed = False
        except Exception as e:
            print(f"  ❌ {cmd_name}: Error - {e}")
            all_checks_passed = False

    # 2. Enhanced ClickHouse connection check
    print("\n🗄️  Checking ClickHouse connection...")
    try:
        # Determine if we should use HTTPS based on port
        use_https = CH_PORT in [443, 8443, 9440]

        # Test basic connection
        client = clickhouse_connect.get_client(
            host=CH_HOST,
            port=CH_PORT,
            username=CH_USER,
            password=CH_PASSWORD,
            database=CH_DATABASE,
            interface="https" if use_https else "http",
            secure=use_https,
        )

        # Get version and server info
        result = client.query("SELECT version() as version")
        version = result.result_rows[0][0] if result.result_rows else "Unknown"
        print(f"  ✅ Connected to ClickHouse {version} at {CH_HOST}:{CH_PORT}")

        # Test database access
        result = client.query("SELECT database() as current_db")
        current_db = result.result_rows[0][0] if result.result_rows else "Unknown"
        print(f"  ✅ Database access: {current_db}")

        # Test basic query execution
        result = client.query(
            f"SELECT count() as total_tables FROM system.tables WHERE database = '{CH_DATABASE}'"
        )
        table_count = result.result_rows[0][0] if result.result_rows else 0
        print(f"  ✅ Query execution: {table_count} tables in database")

        # Test write permissions (create/drop temp table)
        try:
            client.command(
                "CREATE TABLE IF NOT EXISTS temp_check_table (id UInt32) ENGINE = Memory"
            )
            client.command("DROP TABLE IF EXISTS temp_check_table")
            print("  ✅ Write permissions: Verified")
        except Exception as perm_e:
            print(f"  ⚠️  Write permissions: Limited - {perm_e}")
            # Don't fail the overall check for write permission issues

    except Exception as e:
        print(f"  ❌ ClickHouse connection failed: {e}")
        all_checks_passed = False
        return all_checks_passed

    # 3. Check permissions and environment
    print("\n🔐 Environment check...")
    print(f"  ✅ CH_HOST: {CH_HOST}")
    print(f"  ✅ CH_PORT: {CH_PORT}")
    print(f"  ✅ CH_USER: {CH_USER}")
    print(f"  ✅ CH_DATABASE: {CH_DATABASE}")
    print(f"  ✅ MACHINE_NAME: {MACHINE_NAME}")

    # 4. Summary
    print(f"\n{'=' * 50}")
    if all_checks_passed:
        print("✅ ALL CHECKS PASSED - System ready for ccusage import")
    else:
        print("❌ SOME CHECKS FAILED - Please fix issues above")

    print(f"{'=' * 50}")
    return all_checks_passed


def main():
    """Main function with argument parsing"""
    global HASH_PROJECT_NAMES, DEFAULT_OPENCODE_PATH, SKIP_OPENCODE, SKIP_CCUSAGE

    parser = argparse.ArgumentParser(
        description="ccusage to ClickHouse Data Importer with OpenCode support",
        epilog="Examples:\n  %(prog)s                    # Import both ccusage and OpenCode (default)\n  %(prog)s --source ccusage    # Import only ccusage data\n  %(prog)s --source opencode   # Import only OpenCode data\n  %(prog)s --no-hash-projects  # Import with original project names\n  %(prog)s --check             # Validate system prerequisites",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Run comprehensive system check instead of importing data",
    )
    parser.add_argument(
        "--no-hash-projects",
        action="store_true",
        help="Disable project name hashing (store original paths/session IDs)",
    )
    parser.add_argument(
        "--source",
        type=str,
        choices=["ccusage", "opencode", "both"],
        default="both",
        help="Data source to import: 'ccusage', 'opencode', or 'both' (default: both)",
    )
    parser.add_argument(
        "--opencode-path",
        type=str,
        default=None,
        help="Path to OpenCode storage directory (default: ~/.local/share/opencode/storage/message)",
    )
    parser.add_argument(
        "--charts",
        action="store_true",
        help="Display usage charts and exit (skip import)",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=365,
        help="Number of days to include in charts (default: 365)",
    )
    parser.add_argument(
        "--tab",
        type=str,
        choices=["overview", "models", "both"],
        default="both",
        help="Which chart tab(s) to display (default: both)",
    )

    args = parser.parse_args()

    # Set global privacy configuration
    if args.no_hash_projects:
        HASH_PROJECT_NAMES = False

    # Set global source configuration
    DEFAULT_OPENCODE_PATH = args.opencode_path
    SKIP_OPENCODE = args.source == "ccusage"
    SKIP_CCUSAGE = args.source == "opencode"

    try:
        if args.charts:
            # Display charts in standalone mode
            importer = ClickHouseImporter()
            tabs = []
            if args.tab in ["overview", "both"]:
                tabs.append("Overview")
            if args.tab in ["models", "both"]:
                tabs.append("Models")

            importer.display_charts(days=args.days, tabs=tabs, auto_cycle=len(tabs) > 1)
            sys.exit(0)
        elif args.check:
            # Run system check
            success = system_check()
            sys.exit(0 if success else 1)
        else:
            # Run normal import
            importer = ClickHouseImporter()
            importer.import_all_data()
    except KeyboardInterrupt:
        print("\n⏹️  Operation cancelled by user")
        sys.exit(0)
    except Exception as e:
        print(f"\n💥 Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
