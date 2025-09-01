#!/usr/bin/env python3
"""
ccusage to ClickHouse Data Importer
Imports data from ccusage JSON output into ClickHouse database
Designed to be run as a cronjob, handles idempotent inserts
"""

import json
import os
import socket
import subprocess
import sys
import concurrent.futures
import threading
import time
from datetime import datetime, date
from typing import Dict, List, Any, Tuple

import clickhouse_connect
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# ClickHouse connection settings from environment
CH_HOST = os.getenv("CH_HOST", "localhost")
CH_PORT = int(os.getenv("CH_PORT", "8123"))
CH_USER = os.getenv("CH_USER", "default")
CH_PASSWORD = os.getenv("CH_PASSWORD", "")
CH_DATABASE = os.getenv("CH_DATABASE", "default")

# Machine identification - use env override or detect hostname
MACHINE_NAME = os.getenv("MACHINE_NAME", socket.gethostname().lower())


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
            
    def stop(self, success_message: str = None, error_message: str = None):
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
    def print_header(title: str, width: int = 70):
        """Print a formatted header"""
        print("\n" + "═" * width)
        print(f"  {title}")
        print("═" * width)
    
    @staticmethod
    def print_section(title: str, width: int = 70):
        """Print a section divider"""
        print(f"\n{'─' * width}")
        print(f"  {title}")
        print(f"{'─' * width}")
    
    @staticmethod
    def print_step(step_num: int, title: str, description: str = ""):
        """Print a numbered step"""
        if description:
            print(f"\n{step_num}️⃣  {title}")
            print(f"   {description}")
        else:
            print(f"\n{step_num}️⃣  {title}")
    
    @staticmethod
    def print_metric(label: str, value: str, width: int = 35):
        """Print a formatted metric"""
        print(f"  • {label:<{width}} {value:>15}")
    
    @staticmethod
    def format_duration(seconds: float) -> str:
        """Format duration in a human-readable way"""
        if seconds < 1:
            return f"{seconds*1000:.0f}ms"
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
            return f"{num/1_000_000_000:.1f}B"
        elif num >= 1_000_000:
            return f"{num/1_000_000:.1f}M"
        elif num >= 1_000:
            return f"{num/1_000:.1f}K"
        else:
            return f"{num:,}"


class ClickHouseImporter:
    def __init__(self):
        """Initialize ClickHouse client with environment-based configuration"""
        try:
            self.client = clickhouse_connect.get_client(
                host=CH_HOST,
                port=CH_PORT,
                username=CH_USER,
                password=CH_PASSWORD,
                database=CH_DATABASE,
                interface="http",
            )
            # Test connection
            self.client.command("SELECT 1")
            print(f"✓ Connected to ClickHouse at {CH_HOST}:{CH_PORT}")
        except Exception as e:
            print(f"✗ Failed to connect to ClickHouse: {e}")
            print(f"  Host: {CH_HOST}:{CH_PORT}")
            print(f"  User: {CH_USER}")
            print(f"  Database: {CH_DATABASE}")
            raise

        # Detect available package runner (bunx or npx)
        self.package_runner = self._detect_package_runner()

    def _detect_package_runner(self) -> str:
        """Detect whether bunx or npx is available, prefer bunx"""
        try:
            # Try bunx first (faster)
            subprocess.run(
                ["bunx", "--version"], capture_output=True, check=True
            )
            return "bunx"
        except (subprocess.CalledProcessError, FileNotFoundError):
            try:
                # Fall back to npx
                subprocess.run(
                    ["npx", "--version"], capture_output=True, check=True
                )
                return "npx"
            except (subprocess.CalledProcessError, FileNotFoundError):
                print("⚠️  Neither bunx nor npx found, defaulting to npx")
                return "npx"

    def _parse_date(self, date_str: str) -> date:
        """Parse date string to Python date object"""
        return datetime.strptime(date_str, "%Y-%m-%d").date()
    
    def _parse_datetime(self, datetime_str: str) -> datetime:
        """Parse datetime string to Python datetime object"""
        if datetime_str is None:
            return None
        # Handle ISO format: "2025-08-02T15:00:00.000Z"
        if datetime_str.endswith('Z'):
            # Remove 'Z' and parse as UTC
            datetime_str = datetime_str[:-1]
            return datetime.fromisoformat(datetime_str).replace(tzinfo=None)
        return datetime.fromisoformat(datetime_str).replace(tzinfo=None)
    
    def _extract_burn_rate(self, burn_rate_data) -> float:
        """Extract burn rate value from data (can be None, float, or dict)"""
        if burn_rate_data is None:
            return None
        if isinstance(burn_rate_data, (int, float)):
            return float(burn_rate_data)
        if isinstance(burn_rate_data, dict):
            # Extract costPerHour from complex burn rate object
            return burn_rate_data.get('costPerHour', None)
        return None
    
    def _extract_projection(self, projection_data) -> float:
        """Extract projection value from data (can be None, float, or dict)"""
        if projection_data is None:
            return None
        if isinstance(projection_data, (int, float)):
            return float(projection_data)
        if isinstance(projection_data, dict):
            # Extract totalCost from complex projection object
            return projection_data.get('totalCost', None)
        return None

    def fetch_ccusage_data_parallel(self) -> Dict[str, Dict[str, Any]]:
        """Fetch all ccusage data in parallel with animated loading indicator"""
        commands = [
            ("daily", "daily"),
            ("monthly", "monthly"), 
            ("session", "session"),
            ("blocks", "blocks"),
            ("projects", "daily --instances")
        ]
        
        UIFormatter.print_step(1, "Fetching ccusage data", 
                              "Executing 5 ccusage commands concurrently...")
        
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
                    loader.stop(f"{key} data fetched ({completed_count}/{len(commands)})")
                    if completed_count < len(commands):
                        loader = LoadingAnimation(f"Fetching remaining data ({completed_count}/{len(commands)} complete)")
                        loader.start()
                except Exception as e:
                    loader.stop(error_message=f"{key} data failed: {e}")
                    results[key] = {}
                    if completed_count < len(commands):
                        loader = LoadingAnimation(f"Fetching remaining data ({completed_count}/{len(commands)} complete)")
                        loader.start()
        
        fetch_duration = (datetime.now() - start_time).total_seconds()
        print(f"\n✅ All data sources fetched in {UIFormatter.format_duration(fetch_duration)}")
        return results

    def run_ccusage_command(self, command: str, verbose: bool = False) -> Dict[str, Any]:
        """Run ccusage command and return JSON data with retry logic"""
        max_retries = 2
        for attempt in range(max_retries):
            try:
                if verbose and attempt == 0:
                    print(f"Running: {self.package_runner} ccusage@latest {command} --json")
                elif verbose:
                    print(f"  Retry {attempt}: {self.package_runner} ccusage@latest {command} --json")
                    
                result = subprocess.run(
                    [self.package_runner, "ccusage@latest"]
                    + command.split()
                    + ["--json"],
                    capture_output=True,
                    text=True,
                    check=True,
                    timeout=30,  # 30 second timeout per command
                )
                return json.loads(result.stdout)
            except subprocess.TimeoutExpired:
                if verbose:
                    print(f"  Timeout running ccusage {command} (attempt {attempt + 1})")
                if attempt == max_retries - 1:
                    return {}
            except subprocess.CalledProcessError as e:
                if verbose:
                    print(f"  Error running ccusage {command} (attempt {attempt + 1}): {e}")
                    if e.stderr:
                        print(f"  Error output: {e.stderr}")
                if attempt == max_retries - 1:
                    return {}
            except json.JSONDecodeError as e:
                if verbose:
                    print(f"  Error parsing JSON from ccusage {command}: {e}")
                return {}
        
        return {}

    def upsert_daily_data(self, daily_data: List[Dict[str, Any]]):
        """Insert or update daily usage data"""
        if not daily_data:
            print("No daily data to import")
            return

        # Delete existing data for these dates and machine first
        dates = [item["date"] for item in daily_data]
        if dates:
            dates_str = ",".join([f"'{d}'" for d in dates])
            self.client.command(
                f"DELETE FROM ccusage_usage_daily WHERE date IN ({dates_str}) AND machine_name = '{MACHINE_NAME}'"
            )

        # Prepare data for insertion
        rows = []
        model_breakdown_rows = []
        model_used_rows = []

        for item in daily_data:
            # Main daily record
            rows.append(
                [
                    self._parse_date(item["date"]),
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
                    ]
                )

            # Models used
            for model in item["modelsUsed"]:
                model_used_rows.append(
                    ["daily", item["date"], model, datetime.now()]
                )

        # Insert data
        if rows:
            self.client.insert("ccusage_usage_daily", rows)
            print(f"✓ Inserted {len(rows)} daily records")

        if model_breakdown_rows:
            # Delete existing model breakdowns
            dates_str = ",".join([f"'{d}'" for d in dates])
            delete_query = (
                f"DELETE FROM ccusage_model_breakdowns WHERE record_type = "
                f"'daily' AND record_key IN ({dates_str})"
            )
            self.client.command(delete_query)
            self.client.insert(
                "ccusage_model_breakdowns", model_breakdown_rows
            )
            print(
                f"✓ Inserted {len(model_breakdown_rows)} model breakdown records"
            )

        if model_used_rows:
            # Delete existing model used records
            dates_str = ",".join([f"'{d}'" for d in dates])
            delete_query = (
                f"DELETE FROM ccusage_models_used WHERE record_type = "
                f"'daily' AND record_key IN ({dates_str}) AND machine_name = '{MACHINE_NAME}'"
            )
            self.client.command(delete_query)
            self.client.insert("ccusage_models_used", model_used_rows)
            print(f"✓ Inserted {len(model_used_rows)} models used records")

    def upsert_monthly_data(self, monthly_data: List[Dict[str, Any]]):
        """Insert or update monthly usage data"""
        if not monthly_data:
            print("No monthly data to import")
            return

        # Delete existing data for these months and machine first
        months = [item["month"] for item in monthly_data]
        if months:
            months_str = ",".join([f"'{m}'" for m in months])
            self.client.command(
                f"DELETE FROM ccusage_usage_monthly WHERE month IN ({months_str}) AND machine_name = '{MACHINE_NAME}'"
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
                    ]
                )

            for model in item["modelsUsed"]:
                model_used_rows.append(
                    ["monthly", item["month"], MACHINE_NAME, model, datetime.now()]
                )

        # Insert data
        if rows:
            self.client.insert("ccusage_usage_monthly", rows)
            print(f"✓ Inserted {len(rows)} monthly records")

        if model_breakdown_rows:
            months_str = ",".join([f"'{m}'" for m in months])
            delete_query = (
                f"DELETE FROM ccusage_model_breakdowns WHERE record_type = "
                f"'monthly' AND record_key IN ({months_str}) AND machine_name = '{MACHINE_NAME}'"
            )
            self.client.command(delete_query)
            self.client.insert(
                "ccusage_model_breakdowns", model_breakdown_rows
            )

        if model_used_rows:
            months_str = ",".join([f"'{m}'" for m in months])
            delete_query = (
                f"DELETE FROM ccusage_models_used WHERE record_type = "
                f"'monthly' AND record_key IN ({months_str}) AND machine_name = '{MACHINE_NAME}'"
            )
            self.client.command(delete_query)
            self.client.insert("ccusage_models_used", model_used_rows)

    def upsert_session_data(self, session_data: List[Dict[str, Any]]):
        """Insert or update session usage data"""
        if not session_data:
            print("No session data to import")
            return

        # Delete existing data for these sessions first
        session_ids = [item["sessionId"] for item in session_data]
        if session_ids:
            sessions_str = ",".join([f"'{s}'" for s in session_ids])
            self.client.command(
                f"DELETE FROM ccusage_usage_sessions WHERE session_id IN ({sessions_str}) AND machine_name = '{MACHINE_NAME}'"
            )

        # Prepare data for insertion
        rows = []
        model_breakdown_rows = []
        model_used_rows = []

        for item in session_data:
            # Main session record
            rows.append(
                [
                    item["sessionId"],
                    MACHINE_NAME,
                    item["projectPath"],
                    item["inputTokens"],
                    item["outputTokens"],
                    item["cacheCreationTokens"],
                    item["cacheReadTokens"],
                    item["totalTokens"],
                    item["totalCost"],
                    self._parse_date(item["lastActivity"]),
                    len(item["modelsUsed"]),
                    datetime.now(),
                    datetime.now(),
                ]
            )

            # Model breakdowns and models used
            for breakdown in item.get("modelBreakdowns", []):
                model_breakdown_rows.append(
                    [
                        "session",
                        item["sessionId"],
                        MACHINE_NAME,
                        breakdown["modelName"],
                        breakdown["inputTokens"],
                        breakdown["outputTokens"],
                        breakdown["cacheCreationTokens"],
                        breakdown["cacheReadTokens"],
                        breakdown["cost"],
                        datetime.now(),
                    ]
                )

            for model in item["modelsUsed"]:
                model_used_rows.append(
                    ["session", item["sessionId"], MACHINE_NAME, model, datetime.now()]
                )

        # Insert data
        if rows:
            self.client.insert("ccusage_usage_sessions", rows)
            print(f"✓ Inserted {len(rows)} session records")

        if model_breakdown_rows:
            sessions_str = ",".join([f"'{s}'" for s in session_ids])
            delete_query = (
                f"DELETE FROM ccusage_model_breakdowns WHERE record_type = "
                f"'session' AND record_key IN ({sessions_str}) AND machine_name = '{MACHINE_NAME}'"
            )
            self.client.command(delete_query)
            self.client.insert(
                "ccusage_model_breakdowns", model_breakdown_rows
            )

        if model_used_rows:
            sessions_str = ",".join([f"'{s}'" for s in session_ids])
            delete_query = (
                f"DELETE FROM ccusage_models_used WHERE record_type = "
                f"'session' AND record_key IN ({sessions_str}) AND machine_name = '{MACHINE_NAME}'"
            )
            self.client.command(delete_query)
            self.client.insert("ccusage_models_used", model_used_rows)

    def upsert_blocks_data(self, blocks_data: List[Dict[str, Any]]):
        """Insert or update blocks usage data"""
        if not blocks_data:
            print("No blocks data to import")
            return

        # Delete existing data for these blocks first
        block_ids = [item["id"] for item in blocks_data]
        if block_ids:
            blocks_str = ",".join([f"'{b}'" for b in block_ids])
            self.client.command(
                f"DELETE FROM ccusage_usage_blocks WHERE block_id IN ({blocks_str}) AND machine_name = '{MACHINE_NAME}'"
            )

        # Prepare data for insertion
        rows = []
        model_used_rows = []

        for item in blocks_data:
            # Main block record - order matches actual table schema
            rows.append(
                [
                    item["id"],                                                    # block_id
                    MACHINE_NAME,                                              # machine_name
                    self._parse_datetime(item["startTime"]),                      # start_time
                    self._parse_datetime(item["endTime"]),                       # end_time
                    1 if item["isActive"] else 0,                               # is_active
                    1 if item["isGap"] else 0,                                  # is_gap
                    item["entries"],                                            # entries
                    item["tokenCounts"]["inputTokens"],                         # input_tokens
                    item["tokenCounts"]["outputTokens"],                        # output_tokens
                    item["tokenCounts"]["cacheCreationInputTokens"],            # cache_creation_tokens
                    item["tokenCounts"]["cacheReadInputTokens"],                # cache_read_tokens
                    item["totalTokens"],                                        # total_tokens
                    item["costUSD"],                                           # cost_usd
                    len(item["models"]),                                       # models_count
                    datetime.now(),                                            # created_at
                    self._parse_datetime(item.get("actualEndTime")),           # actual_end_time
                    self._parse_datetime(item.get("usageLimitResetTime", None)),     # usage_limit_reset_time
                    self._extract_burn_rate(item.get("burnRate")),             # burn_rate
                    self._extract_projection(item.get("projection")),          # projection
                    datetime.now(),                                            # updated_at
                ]
            )

            # Models used (blocks don't have detailed breakdowns in the same format)
            for model in item["models"]:
                if model != "<synthetic>":  # Skip synthetic entries
                    model_used_rows.append(
                        ["block", item["id"], MACHINE_NAME, model, datetime.now()]
                    )

        # Insert data
        if rows:
            self.client.insert("ccusage_usage_blocks", rows)
            print(f"✓ Inserted {len(rows)} block records")

        if model_used_rows:
            blocks_str = ",".join([f"'{b}'" for b in block_ids])
            delete_query = (
                f"DELETE FROM ccusage_models_used WHERE record_type = "
                f"'block' AND record_key IN ({blocks_str}) AND machine_name = '{MACHINE_NAME}'"
            )
            self.client.command(delete_query)
            self.client.insert("ccusage_models_used", model_used_rows)

    def upsert_projects_daily_data(
        self, projects_data: Dict[str, List[Dict[str, Any]]]
    ):
        """Insert or update projects daily usage data"""
        if not projects_data:
            print("No projects daily data to import")
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
                        MACHINE_NAME,
                        project_id,
                        item["inputTokens"],
                        item["outputTokens"],
                        item["cacheCreationTokens"],
                        item["cacheReadTokens"],
                        item["totalTokens"],
                        item["totalCost"],
                        len(item["modelsUsed"]),
                        datetime.now(),
                        datetime.now(),
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
                        ]
                    )

        # Delete existing data for these dates
        if dates_to_delete:
            dates_str = ",".join([f"'{d}'" for d in dates_to_delete])
            self.client.command(
                f"DELETE FROM ccusage_usage_projects_daily WHERE date IN ({dates_str}) AND machine_name = '{MACHINE_NAME}'"
            )

        # Insert data
        if rows:
            self.client.insert("ccusage_usage_projects_daily", rows)
            print(f"✓ Inserted {len(rows)} project daily records")

        if model_breakdown_rows:
            # Delete existing model breakdowns for these records
            record_keys = set([f"{item['date']}_{project_id}" for project_id, daily_records in projects_data.items() for item in daily_records])
            if record_keys:
                keys_str = ",".join([f"'{k}'" for k in record_keys])
                delete_query = (
                    f"DELETE FROM ccusage_model_breakdowns WHERE record_type = "
                    f"'project_daily' AND record_key IN ({keys_str}) AND machine_name = '{MACHINE_NAME}'"
                )
                self.client.command(delete_query)
            self.client.insert(
                "ccusage_model_breakdowns", model_breakdown_rows
            )

        if model_used_rows:
            # Delete existing models used for these records
            record_keys = set([f"{item['date']}_{project_id}" for project_id, daily_records in projects_data.items() for item in daily_records])
            if record_keys:
                keys_str = ",".join([f"'{k}'" for k in record_keys])
                delete_query = (
                    f"DELETE FROM ccusage_models_used WHERE record_type = "
                    f"'project_daily' AND record_key IN ({keys_str}) AND machine_name = '{MACHINE_NAME}'"
                )
                self.client.command(delete_query)
            self.client.insert("ccusage_models_used", model_used_rows)

    def get_import_statistics(self) -> Dict[str, Any]:
        """Get comprehensive statistics after import"""
        print("📈 Generating import statistics...")
        
        stats = {}
        
        # Table row counts - get them individually to avoid SQL issues
        tables = [
            'ccusage_usage_daily',
            'ccusage_usage_monthly', 
            'ccusage_usage_sessions',
            'ccusage_usage_blocks',
            'ccusage_usage_projects_daily',
            'ccusage_model_breakdowns',
            'ccusage_models_used'
        ]
        
        table_counts = {}
        for table in tables:
            try:
                count_result = self.client.query(f"SELECT count() FROM {table}").result_rows[0]
                table_counts[table] = int(count_result[0])
            except Exception as e:
                print(f"  ⚠️  Could not get count for {table}: {e}")
                table_counts[table] = 0
        
        stats['table_counts'] = table_counts
        
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
        stats['usage_summary'] = {
            'total_cost': float(usage_result[0]) if usage_result[0] else 0.0,
            'total_tokens': int(usage_result[1]) if usage_result[1] else 0,
            'total_input_tokens': int(usage_result[2]) if usage_result[2] else 0,
            'total_output_tokens': int(usage_result[3]) if usage_result[3] else 0,
            'total_cache_creation_tokens': int(usage_result[4]) if usage_result[4] else 0,
            'total_cache_read_tokens': int(usage_result[5]) if usage_result[5] else 0,
            'earliest_date': str(usage_result[6]) if usage_result[6] else None,
            'latest_date': str(usage_result[7]) if usage_result[7] else None,
            'days_with_usage': int(usage_result[8]) if usage_result[8] else 0
        }
        
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
        stats['model_usage'] = [
            {
                'model_name': row[0],
                'usage_count': int(row[1]),
                'total_cost': float(row[2]),
                'total_tokens': int(row[3])
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
        stats['session_stats'] = {
            'total_sessions': int(session_result[0]) if session_result[0] else 0,
            'avg_cost_per_session': float(session_result[1]) if session_result[1] else 0.0,
            'max_cost_session': float(session_result[2]) if session_result[2] else 0.0,
            'total_session_tokens': int(session_result[3]) if session_result[3] else 0
        }
        
        # Active blocks
        active_blocks_query = """
        SELECT count() as active_blocks
        FROM ccusage_usage_blocks 
        WHERE is_active = 1
        """
        
        active_result = self.client.query(active_blocks_query).result_rows[0]
        stats['active_blocks'] = int(active_result[0]) if active_result[0] else 0
        
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
        stats['machine_stats'] = [
            {
                'machine_name': row[0],
                'total_cost': float(row[1]),
                'total_tokens': int(row[2]), 
                'active_days': int(row[3]),
                'last_activity': str(row[4])
            }
            for row in machine_results
        ]
        
        return stats
    
    def print_statistics(self, stats: Dict[str, Any]):
        """Print beautifully formatted statistics"""
        UIFormatter.print_header("📊 IMPORT SUMMARY & STATISTICS", 70)
        
        # Table counts with enhanced formatting
        UIFormatter.print_section("📋 Database Records", 70)
        for table, count in stats['table_counts'].items():
            table_display = table.replace('ccusage_', '').replace('_', ' ').title()
            count_formatted = UIFormatter.format_number(count)
            UIFormatter.print_metric(table_display, f"{count_formatted} records")
        
        # Usage summary with better number formatting
        usage = stats['usage_summary']
        UIFormatter.print_section("💰 Usage Analytics", 70)
        UIFormatter.print_metric("Total Cost", f"${usage['total_cost']:,.2f}")
        UIFormatter.print_metric("Total Tokens", UIFormatter.format_number(usage['total_tokens']))
        UIFormatter.print_metric("Input Tokens", UIFormatter.format_number(usage['total_input_tokens']))
        UIFormatter.print_metric("Output Tokens", UIFormatter.format_number(usage['total_output_tokens']))
        UIFormatter.print_metric("Cache Creation Tokens", UIFormatter.format_number(usage['total_cache_creation_tokens']))
        UIFormatter.print_metric("Cache Read Tokens", UIFormatter.format_number(usage['total_cache_read_tokens']))
        UIFormatter.print_metric("Date Range", f"{usage['earliest_date']} → {usage['latest_date']}")
        UIFormatter.print_metric("Days with Usage", f"{usage['days_with_usage']:,} days")
        
        # Model breakdown with cleaner formatting
        UIFormatter.print_section("🤖 Top Models by Cost", 70)
        for i, model in enumerate(stats['model_usage'][:5], 1):
            model_name = model['model_name'].replace('claude-', '').replace('-20250514', '')
            cost_str = f"${model['total_cost']:,.2f}"
            tokens_str = UIFormatter.format_number(model['total_tokens'])
            UIFormatter.print_metric(f"{i}. {model_name}", f"{cost_str} ({tokens_str} tokens)")
        
        # Session stats
        session = stats['session_stats']
        UIFormatter.print_section("💼 Session Insights", 70)
        UIFormatter.print_metric("Total Sessions", f"{session['total_sessions']:,}")
        UIFormatter.print_metric("Avg Cost per Session", f"${session['avg_cost_per_session']:,.2f}")
        UIFormatter.print_metric("Max Cost Session", f"${session['max_cost_session']:,.2f}")
        UIFormatter.print_metric("Total Session Tokens", UIFormatter.format_number(session['total_session_tokens']))
        
        # Active blocks
        UIFormatter.print_section("🧱 Real-time Status", 70)
        UIFormatter.print_metric("Active Blocks", f"{stats['active_blocks']:,}")
        
        # Machine breakdown statistics
        if stats.get('machine_stats') and len(stats['machine_stats']) > 1:
            UIFormatter.print_section("🖥️  Multi-Machine Breakdown", 70)
            for i, machine in enumerate(stats['machine_stats'], 1):
                machine_name = machine['machine_name']
                cost_str = f"${machine['total_cost']:,.2f}"
                tokens_str = UIFormatter.format_number(machine['total_tokens'])
                days_str = f"{machine['active_days']} days"
                last_activity = machine['last_activity']
                UIFormatter.print_metric(f"{i}. {machine_name}", f"{cost_str} ({tokens_str} tokens, {days_str}, last: {last_activity})")
        elif stats.get('machine_stats') and len(stats['machine_stats']) == 1:
            # Single machine - show machine name for reference
            machine = stats['machine_stats'][0]
            UIFormatter.print_section("🖥️  Machine Info", 70)
            UIFormatter.print_metric("Current Machine", machine['machine_name'])
        
        print("═" * 70 + "\n")

    def import_all_data(self):
        """Import all ccusage data into ClickHouse with enhanced UI and animations"""
        UIFormatter.print_header("🚀 CCUSAGE DATA IMPORTER", 70)
        print(f"   Target: {CH_DATABASE} at {CH_HOST}:{CH_PORT}")
        print(f"   Machine: {MACHINE_NAME}")
        print(f"   Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

        overall_start = datetime.now()
        
        try:
            # Fetch all data in parallel
            all_data = self.fetch_ccusage_data_parallel()
            
            # Process and import data
            UIFormatter.print_step(2, "Processing and importing data",
                                  "Converting data types and inserting into ClickHouse...")
            
            loader = LoadingAnimation("Processing data")
            loader.start()
            import_start = datetime.now()
            
            # Import daily data
            if "daily" in all_data and "daily" in all_data["daily"]:
                self.upsert_daily_data(all_data["daily"]["daily"])
                loader.stop("Daily data processed")
            else:
                loader.stop(error_message="No daily data found")

            # Import monthly data 
            if "monthly" in all_data and "monthly" in all_data["monthly"]:
                loader = LoadingAnimation("Processing monthly data")
                loader.start()
                self.upsert_monthly_data(all_data["monthly"]["monthly"])
                loader.stop("Monthly data processed")
            else:
                print("⚠️  No monthly data found")

            # Import session data
            if "session" in all_data and "sessions" in all_data["session"]:
                loader = LoadingAnimation("Processing session data")
                loader.start()
                self.upsert_session_data(all_data["session"]["sessions"])
                loader.stop("Session data processed")
            else:
                print("⚠️  No session data found")

            # Import blocks data
            if "blocks" in all_data and "blocks" in all_data["blocks"]:
                loader = LoadingAnimation("Processing blocks data")
                loader.start()
                self.upsert_blocks_data(all_data["blocks"]["blocks"])
                loader.stop("Blocks data processed")
            else:
                print("⚠️  No blocks data found")

            # Import projects daily data
            if "projects" in all_data and "projects" in all_data["projects"]:
                loader = LoadingAnimation("Processing projects data")
                loader.start()
                self.upsert_projects_daily_data(all_data["projects"]["projects"])
                loader.stop("Projects data processed")
            else:
                print("⚠️  No projects data found")

            import_duration = (datetime.now() - import_start).total_seconds()
            overall_duration = (datetime.now() - overall_start).total_seconds()
            
            UIFormatter.print_step(3, "Generating analytics", 
                                  "Computing usage statistics and insights...")
            
            loader = LoadingAnimation("Computing statistics")
            loader.start()
            stats = self.get_import_statistics()
            loader.stop("Statistics generated")
            
            print(f"\n✅ Import completed successfully!")
            print(f"   Processing time: {UIFormatter.format_duration(import_duration)}")
            print(f"   Total time: {UIFormatter.format_duration(overall_duration)}")
            
            # Display beautiful statistics
            self.print_statistics(stats)

        except Exception as e:
            if 'loader' in locals():
                loader.stop(error_message=f"Import failed: {e}")
            else:
                print(f"\n❌ Import failed: {e}")
            raise


def main():
    """Main function"""
    try:
        importer = ClickHouseImporter()
        importer.import_all_data()
    except KeyboardInterrupt:
        print("\n⏹️  Import cancelled by user")
        sys.exit(0)
    except Exception as e:
        print(f"\n💥 Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
