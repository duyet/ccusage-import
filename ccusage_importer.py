#!/usr/bin/env python3
"""
ccusage to ClickHouse Data Importer
Imports data from ccusage JSON output into ClickHouse database
Designed to be run as a cronjob, handles idempotent inserts
"""

import json
import os
import subprocess
import sys
from datetime import datetime
from typing import Dict, List, Any

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

    def run_ccusage_command(self, command: str) -> Dict[str, Any]:
        """Run ccusage command and return JSON data"""
        try:
            print(
                f"Running: {self.package_runner} ccusage@latest {command} --json"
            )
            result = subprocess.run(
                [self.package_runner, "ccusage@latest"]
                + command.split()
                + ["--json"],
                capture_output=True,
                text=True,
                check=True,
            )
            return json.loads(result.stdout)
        except subprocess.CalledProcessError as e:
            print(f"Error running ccusage {command}: {e}")
            if e.stderr:
                print(f"Error output: {e.stderr}")
            return {}
        except json.JSONDecodeError as e:
            print(f"Error parsing JSON from ccusage {command}: {e}")
            return {}

    def upsert_daily_data(self, daily_data: List[Dict[str, Any]]):
        """Insert or update daily usage data"""
        if not daily_data:
            print("No daily data to import")
            return

        # Delete existing data for these dates first
        dates = [item["date"] for item in daily_data]
        if dates:
            dates_str = ",".join([f"'{d}'" for d in dates])
            self.client.command(
                f"DELETE FROM ccusage_usage_daily WHERE date IN ({dates_str})"
            )

        # Prepare data for insertion
        rows = []
        model_breakdown_rows = []
        model_used_rows = []

        for item in daily_data:
            # Main daily record
            rows.append(
                [
                    item["date"],
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
                f"'daily' AND record_key IN ({dates_str})"
            )
            self.client.command(delete_query)
            self.client.insert("ccusage_models_used", model_used_rows)
            print(f"✓ Inserted {len(model_used_rows)} models used records")

    def upsert_monthly_data(self, monthly_data: List[Dict[str, Any]]):
        """Insert or update monthly usage data"""
        if not monthly_data:
            print("No monthly data to import")
            return

        # Delete existing data for these months first
        months = [item["month"] for item in monthly_data]
        if months:
            months_str = ",".join([f"'{m}'" for m in months])
            self.client.command(
                f"DELETE FROM ccusage_usage_monthly WHERE month IN ({months_str})"
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
                    ["monthly", item["month"], model, datetime.now()]
                )

        # Insert data
        if rows:
            self.client.insert("ccusage_usage_monthly", rows)
            print(f"✓ Inserted {len(rows)} monthly records")

        if model_breakdown_rows:
            months_str = ",".join([f"'{m}'" for m in months])
            delete_query = (
                f"DELETE FROM ccusage_model_breakdowns WHERE record_type = "
                f"'monthly' AND record_key IN ({months_str})"
            )
            self.client.command(delete_query)
            self.client.insert(
                "ccusage_model_breakdowns", model_breakdown_rows
            )

        if model_used_rows:
            months_str = ",".join([f"'{m}'" for m in months])
            delete_query = (
                f"DELETE FROM ccusage_models_used WHERE record_type = "
                f"'monthly' AND record_key IN ({months_str})"
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
                f"DELETE FROM ccusage_usage_sessions WHERE session_id IN ({sessions_str})"
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
                    item["projectPath"],
                    item["inputTokens"],
                    item["outputTokens"],
                    item["cacheCreationTokens"],
                    item["cacheReadTokens"],
                    item["totalTokens"],
                    item["totalCost"],
                    item["lastActivity"],
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
                    ["session", item["sessionId"], model, datetime.now()]
                )

        # Insert data
        if rows:
            self.client.insert("ccusage_usage_sessions", rows)
            print(f"✓ Inserted {len(rows)} session records")

        if model_breakdown_rows:
            sessions_str = ",".join([f"'{s}'" for s in session_ids])
            delete_query = (
                f"DELETE FROM ccusage_model_breakdowns WHERE record_type = "
                f"'session' AND record_key IN ({sessions_str})"
            )
            self.client.command(delete_query)
            self.client.insert(
                "ccusage_model_breakdowns", model_breakdown_rows
            )

        if model_used_rows:
            sessions_str = ",".join([f"'{s}'" for s in session_ids])
            delete_query = (
                f"DELETE FROM ccusage_models_used WHERE record_type = "
                f"'session' AND record_key IN ({sessions_str})"
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
                f"DELETE FROM ccusage_usage_blocks WHERE block_id IN ({blocks_str})"
            )

        # Prepare data for insertion
        rows = []
        model_used_rows = []

        for item in blocks_data:
            # Main block record
            rows.append(
                [
                    item["id"],
                    item["startTime"],
                    item["endTime"],
                    item.get("actualEndTime"),
                    1 if item["isActive"] else 0,
                    1 if item["isGap"] else 0,
                    item["entries"],
                    item["tokenCounts"]["inputTokens"],
                    item["tokenCounts"]["outputTokens"],
                    item["tokenCounts"]["cacheCreationInputTokens"],
                    item["tokenCounts"]["cacheReadInputTokens"],
                    item["totalTokens"],
                    item["costUSD"],
                    len(item["models"]),
                    item.get("usageLimitResetTime"),
                    item.get("burnRate"),
                    item.get("projection"),
                    datetime.now(),
                ]
            )

            # Models used (blocks don't have detailed breakdowns in the same format)
            for model in item["models"]:
                if model != "<synthetic>":  # Skip synthetic entries
                    model_used_rows.append(
                        ["block", item["id"], model, datetime.now()]
                    )

        # Insert data
        if rows:
            self.client.insert("ccusage_usage_blocks", rows)
            print(f"✓ Inserted {len(rows)} block records")

        if model_used_rows:
            blocks_str = ",".join([f"'{b}'" for b in block_ids])
            delete_query = (
                f"DELETE FROM ccusage_models_used WHERE record_type = "
                f"'block' AND record_key IN ({blocks_str})"
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
                        item["date"],
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
                            model,
                            datetime.now(),
                        ]
                    )

        # Delete existing data for these dates
        if dates_to_delete:
            dates_str = ",".join([f"'{d}'" for d in dates_to_delete])
            self.client.command(
                f"DELETE FROM ccusage_usage_projects_daily WHERE date IN ({dates_str})"
            )

        # Insert data
        if rows:
            self.client.insert("ccusage_usage_projects_daily", rows)
            print(f"✓ Inserted {len(rows)} project daily records")

        if model_breakdown_rows:
            self.client.insert(
                "ccusage_model_breakdowns", model_breakdown_rows
            )

        if model_used_rows:
            self.client.insert("ccusage_models_used", model_used_rows)

    def import_all_data(self):
        """Import all ccusage data into ClickHouse"""
        print(f"🚀 Starting ccusage data import at {datetime.now()}")
        print(f"📊 Target database: {CH_DATABASE} at {CH_HOST}:{CH_PORT}")

        try:
            # Import daily data
            print("\n📅 Importing daily data...")
            daily_data = self.run_ccusage_command("daily")
            if "daily" in daily_data:
                self.upsert_daily_data(daily_data["daily"])
            else:
                print("⚠️  No daily data found in ccusage output")

            # Import monthly data
            print("\n📆 Importing monthly data...")
            monthly_data = self.run_ccusage_command("monthly")
            if "monthly" in monthly_data:
                self.upsert_monthly_data(monthly_data["monthly"])
            else:
                print("⚠️  No monthly data found in ccusage output")

            # Import session data
            print("\n💼 Importing session data...")
            session_data = self.run_ccusage_command("session")
            if "sessions" in session_data:
                self.upsert_session_data(session_data["sessions"])
            else:
                print("⚠️  No session data found in ccusage output")

            # Import blocks data
            print("\n🧱 Importing blocks data...")
            blocks_data = self.run_ccusage_command("blocks")
            if "blocks" in blocks_data:
                self.upsert_blocks_data(blocks_data["blocks"])
            else:
                print("⚠️  No blocks data found in ccusage output")

            # Import projects daily data
            print("\n🗂️  Importing projects daily data...")
            projects_data = self.run_ccusage_command("daily --instances")
            if "projects" in projects_data:
                self.upsert_projects_daily_data(projects_data["projects"])
            else:
                print("⚠️  No projects data found in ccusage output")

            print(
                f"\n✅ ccusage data import completed successfully at {datetime.now()}"
            )

        except Exception as e:
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
