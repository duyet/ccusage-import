#!/usr/bin/env python3
"""
Main importer module for ccusage-import
Handles data transformation and import into ClickHouse
"""

from datetime import datetime
from typing import Any, Dict, List

from .clickhouse_client import ClickHouseClient
from .config import MACHINE_NAME, hash_project_name
from .data_fetcher import detect_package_runner, fetch_ccusage_data_parallel, run_ccusage_command
from .data_parser import extract_burn_rate, extract_projection, parse_date, parse_datetime
from .ui import LoadingAnimation, UIFormatter


class ClickHouseImporter:
    """Main importer class for ccusage data"""

    def __init__(self):
        """Initialize the importer with ClickHouse client and package runner"""
        self.ch_client = ClickHouseClient()
        self.package_runner = detect_package_runner()
        self.ch_client.check_and_create_tables_if_needed()

    def upsert_daily_data(self, daily_data: List[Dict[str, Any]]):
        """Insert or update daily usage data"""
        if not daily_data:
            return

        # Delete existing data for these dates and machine first
        dates = [item["date"] for item in daily_data]
        if dates:
            dates_str = ",".join([f"'{d}'" for d in dates])
            self.ch_client.client.command(
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
                    parse_date(item["date"]),
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
                    ["daily", item["date"], MACHINE_NAME, model, datetime.now()]
                )

        # Insert data
        if rows:
            self.ch_client.client.insert("ccusage_usage_daily", rows)

        if model_breakdown_rows:
            # Delete existing model breakdowns
            dates_str = ",".join([f"'{d}'" for d in dates])
            delete_query = (
                f"DELETE FROM ccusage_model_breakdowns WHERE record_type = "
                f"'daily' AND record_key IN ({dates_str})"
            )
            self.ch_client.client.command(delete_query)
            self.ch_client.client.insert("ccusage_model_breakdowns", model_breakdown_rows)
            print(f"✓ Inserted {len(model_breakdown_rows)} model breakdown records")

        if model_used_rows:
            # Delete existing model used records
            dates_str = ",".join([f"'{d}'" for d in dates])
            delete_query = (
                f"DELETE FROM ccusage_models_used WHERE record_type = "
                f"'daily' AND record_key IN ({dates_str}) AND machine_name = '{MACHINE_NAME}'"
            )
            self.ch_client.client.command(delete_query)
            self.ch_client.client.insert("ccusage_models_used", model_used_rows)

    def upsert_monthly_data(self, monthly_data: List[Dict[str, Any]]):
        """Insert or update monthly usage data"""
        if not monthly_data:
            return

        # Delete existing data for these months and machine first
        months = [item["month"] for item in monthly_data]
        if months:
            months_str = ",".join([f"'{m}'" for m in months])
            self.ch_client.client.command(
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
            self.ch_client.client.insert("ccusage_usage_monthly", rows)

        if model_breakdown_rows:
            months_str = ",".join([f"'{m}'" for m in months])
            delete_query = (
                f"DELETE FROM ccusage_model_breakdowns WHERE record_type = "
                f"'monthly' AND record_key IN ({months_str}) AND machine_name = '{MACHINE_NAME}'"
            )
            self.ch_client.client.command(delete_query)
            self.ch_client.client.insert("ccusage_model_breakdowns", model_breakdown_rows)

        if model_used_rows:
            months_str = ",".join([f"'{m}'" for m in months])
            delete_query = (
                f"DELETE FROM ccusage_models_used WHERE record_type = "
                f"'monthly' AND record_key IN ({months_str}) AND machine_name = '{MACHINE_NAME}'"
            )
            self.ch_client.client.command(delete_query)
            self.ch_client.client.insert("ccusage_models_used", model_used_rows)

    def upsert_session_data(self, session_data: List[Dict[str, Any]]):
        """Insert or update session usage data"""
        if not session_data:
            return

        # Delete existing data for these sessions first
        session_ids = [hash_project_name(item["sessionId"]) for item in session_data]
        if session_ids:
            sessions_str = ",".join([f"'{s}'" for s in session_ids])
            self.ch_client.client.command(
                f"DELETE FROM ccusage_usage_sessions WHERE session_id IN ({sessions_str}) AND machine_name = '{MACHINE_NAME}'"
            )

        # Prepare data for insertion
        rows = []
        model_breakdown_rows = []
        model_used_rows = []

        for item in session_data:
            # Hash project information for privacy
            hashed_session_id = hash_project_name(item["sessionId"])
            hashed_project_path = hash_project_name(item["projectPath"])

            # Main session record
            rows.append(
                [
                    hashed_session_id,
                    hashed_project_path,
                    MACHINE_NAME,
                    item["inputTokens"],
                    item["outputTokens"],
                    item["cacheCreationTokens"],
                    item["cacheReadTokens"],
                    item["totalTokens"],
                    item["totalCost"],
                    parse_date(item["lastActivity"]),
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
                        hashed_session_id,
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
                    ["session", hashed_session_id, MACHINE_NAME, model, datetime.now()]
                )

        # Insert data
        if rows:
            self.ch_client.client.insert("ccusage_usage_sessions", rows)

        if model_breakdown_rows:
            sessions_str = ",".join([f"'{s}'" for s in session_ids])
            delete_query = (
                f"DELETE FROM ccusage_model_breakdowns WHERE record_type = "
                f"'session' AND record_key IN ({sessions_str}) AND machine_name = '{MACHINE_NAME}'"
            )
            self.ch_client.client.command(delete_query)
            self.ch_client.client.insert("ccusage_model_breakdowns", model_breakdown_rows)

        if model_used_rows:
            sessions_str = ",".join([f"'{s}'" for s in session_ids])
            delete_query = (
                f"DELETE FROM ccusage_models_used WHERE record_type = "
                f"'session' AND record_key IN ({sessions_str}) AND machine_name = '{MACHINE_NAME}'"
            )
            self.ch_client.client.command(delete_query)
            self.ch_client.client.insert("ccusage_models_used", model_used_rows)

    def upsert_blocks_data(self, blocks_data: List[Dict[str, Any]]):
        """Insert or update blocks usage data"""
        if not blocks_data:
            return

        # Delete existing data for these blocks first
        block_ids = [item["id"] for item in blocks_data]
        if block_ids:
            blocks_str = ",".join([f"'{b}'" for b in block_ids])
            self.ch_client.client.command(
                f"DELETE FROM ccusage_usage_blocks WHERE block_id IN ({blocks_str}) AND machine_name = '{MACHINE_NAME}'"
            )

        # Prepare data for insertion
        rows = []
        model_used_rows = []

        for item in blocks_data:
            # Main block record
            rows.append(
                [
                    item["id"],
                    MACHINE_NAME,
                    parse_datetime(item["startTime"]),
                    parse_datetime(item["endTime"]),
                    parse_datetime(item.get("actualEndTime")),
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
                    datetime.now(),
                    datetime.now(),
                    parse_datetime(item.get("usageLimitResetTime", None)),
                    extract_burn_rate(item.get("burnRate")),
                    extract_projection(item.get("projection")),
                ]
            )

            # Models used (blocks don't have detailed breakdowns)
            for model in item["models"]:
                if model != "<synthetic>":
                    model_used_rows.append(
                        ["block", item["id"], MACHINE_NAME, model, datetime.now()]
                    )

        # Insert data
        if rows:
            self.ch_client.client.insert("ccusage_usage_blocks", rows)

        if model_used_rows:
            blocks_str = ",".join([f"'{b}'" for b in block_ids])
            delete_query = (
                f"DELETE FROM ccusage_models_used WHERE record_type = "
                f"'block' AND record_key IN ({blocks_str}) AND machine_name = '{MACHINE_NAME}'"
            )
            self.ch_client.client.command(delete_query)
            self.ch_client.client.insert("ccusage_models_used", model_used_rows)

    def upsert_projects_daily_data(
        self, projects_data: Dict[str, List[Dict[str, Any]]]
    ):
        """Insert or update projects daily usage data"""
        if not projects_data:
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
                        parse_date(item["date"]),
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
            self.ch_client.client.command(
                f"DELETE FROM ccusage_usage_projects_daily WHERE date IN ({dates_str}) AND machine_name = '{MACHINE_NAME}'"
            )

        # Insert data
        if rows:
            self.ch_client.client.insert("ccusage_usage_projects_daily", rows)

        if model_breakdown_rows:
            # Delete existing model breakdowns
            record_keys = {
                f"{item['date']}_{project_id}"
                for project_id, daily_records in projects_data.items()
                for item in daily_records
            }
            if record_keys:
                keys_str = ",".join([f"'{k}'" for k in record_keys])
                delete_query = (
                    f"DELETE FROM ccusage_model_breakdowns WHERE record_type = "
                    f"'project_daily' AND record_key IN ({keys_str}) AND machine_name = '{MACHINE_NAME}'"
                )
                self.ch_client.client.command(delete_query)
            self.ch_client.client.insert("ccusage_model_breakdowns", model_breakdown_rows)

        if model_used_rows:
            # Delete existing models used
            record_keys = {
                f"{item['date']}_{project_id}"
                for project_id, daily_records in projects_data.items()
                for item in daily_records
            }
            if record_keys:
                keys_str = ",".join([f"'{k}'" for k in record_keys])
                delete_query = (
                    f"DELETE FROM ccusage_models_used WHERE record_type = "
                    f"'project_daily' AND record_key IN ({keys_str}) AND machine_name = '{MACHINE_NAME}'"
                )
                self.ch_client.client.command(delete_query)
            self.ch_client.client.insert("ccusage_models_used", model_used_rows)

    def print_statistics(self, stats: Dict[str, Any]):
        """Print beautifully formatted statistics"""
        UIFormatter.print_header("📊 IMPORT SUMMARY & STATISTICS", 70)

        # Table counts
        UIFormatter.print_section("📋 Database Records", 70)
        for table, count in stats["table_counts"].items():
            table_display = table.replace("ccusage_", "").replace("_", " ").title()
            count_formatted = UIFormatter.format_number(count)
            UIFormatter.print_metric(table_display, f"{count_formatted} records")

        # Usage summary
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

        # Model breakdown
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

        # Active blocks
        if stats["active_blocks"] > 0:
            UIFormatter.print_section("🧱 Active Blocks")
            UIFormatter.print_metric("Count", f"{stats['active_blocks']:,}")

        # Machine info
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

        print()

    def print_statistics_with_comparison(self, stats: Dict[str, Any]):
        """Print statistics with comparison to previous import"""
        previous_stats = self.ch_client.get_previous_statistics()

        UIFormatter.print_header("📊 IMPORT SUMMARY & STATISTICS", 70)

        # Table counts with comparison
        UIFormatter.print_section("📋 Database Records", 70)
        for table, count in stats["table_counts"].items():
            table_display = table.replace("ccusage_", "").replace("_", " ").title()
            count_formatted = UIFormatter.format_number(count)

            # Calculate difference
            diff_str = ""
            if previous_stats.get("table_counts", {}).get(table):
                prev_count = previous_stats["table_counts"][table]
                diff = count - prev_count
                if diff > 0:
                    diff_str = f" (+{UIFormatter.format_number(diff)})"
                elif diff < 0:
                    diff_str = f" ({UIFormatter.format_number(diff)})"

            UIFormatter.print_metric(
                table_display, f"{count_formatted} records{diff_str}"
            )

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

        # Other metrics
        UIFormatter.print_metric(
            "Input Tokens",
            UIFormatter.format_number(usage["total_input_tokens"]),
        )
        UIFormatter.print_metric(
            "Output Tokens",
            UIFormatter.format_number(usage["total_output_tokens"]),
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

        # Model breakdown
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

        # Machine info
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

        print()

    def import_all_data(self):
        """Import all ccusage data into ClickHouse with enhanced UI"""
        from .config import CH_DATABASE, CH_HOST, CH_PORT, HASH_PROJECT_NAMES

        UIFormatter.print_header("CCUSAGE DATA IMPORTER")
        privacy_status = "Enabled" if HASH_PROJECT_NAMES else "Disabled"
        print(
            f"Database: {CH_DATABASE} at {CH_HOST}:{CH_PORT} | Machine: {MACHINE_NAME}"
        )
        print(f"Project Privacy: {privacy_status}")

        # Check data freshness
        def run_command_wrapper(cmd, verbose=False):
            return run_ccusage_command(cmd, self.package_runner, verbose)

        freshness = self.ch_client.check_data_freshness(run_command_wrapper)
        if freshness.get("is_stale"):
            hours_old = freshness.get("seconds_since_import", 0) // 3600
            print(
                f"⚠️  Data is stale: ClickHouse has data up to {freshness['latest_ch_date']}, ccusage has {freshness['latest_ccusage_date']}"
            )
            print(f"   Last import was {hours_old} hours ago")

        print()

        overall_start = datetime.now()

        try:
            # Fetch all data in parallel
            all_data = fetch_ccusage_data_parallel(self.package_runner)

            # Check if identical
            is_identical = self.ch_client.is_identical_import(all_data)
            if is_identical:
                print("🔄 Identical data detected - No new data since last import")
                stats = self.ch_client.get_import_statistics()
                UIFormatter.print_header("📊 CURRENT DATABASE STATISTICS", 70)
                self.print_statistics(stats)
                return

            # Process and import data
            UIFormatter.print_step(
                2,
                "Processing and importing data",
                "Converting data types and inserting into ClickHouse...",
            )

            loader = LoadingAnimation("Processing data")
            loader.start()

            # Import daily data
            if "daily" in all_data and "daily" in all_data["daily"]:
                self.upsert_daily_data(all_data["daily"]["daily"])
                loader.stop("Daily data processed")
            else:
                loader.stop(error_message="No daily data found")

            # Import monthly data
            if "monthly" in all_data and "monthly" in all_data["monthly"]:
                self.upsert_monthly_data(all_data["monthly"]["monthly"])
                print("✓ Monthly")
            else:
                print("⚠️  No monthly data")

            # Import session data
            if "session" in all_data and "sessions" in all_data["session"]:
                self.upsert_session_data(all_data["session"]["sessions"])
                print("✓ Sessions")
            else:
                print("⚠️  No session data")

            # Import blocks data
            if "blocks" in all_data and "blocks" in all_data["blocks"]:
                self.upsert_blocks_data(all_data["blocks"]["blocks"])
                print("✓ Blocks")
            else:
                print("⚠️  No blocks data")

            # Import projects data
            if "projects" in all_data and "projects" in all_data["projects"]:
                loader = LoadingAnimation("Processing projects data")
                loader.start()
                self.upsert_projects_daily_data(all_data["projects"]["projects"])
                loader.stop("Projects data processed")
            else:
                print("⚠️  No projects data found")

            overall_duration = (datetime.now() - overall_start).total_seconds()

            UIFormatter.print_step(
                3, "Generating analytics", "Computing usage statistics and insights..."
            )

            stats = self.ch_client.get_import_statistics()
            print(
                f"\n✓ Import completed in {UIFormatter.format_duration(overall_duration)}"
            )

            # Display statistics with comparison
            self.print_statistics_with_comparison(stats)

            # Save import statistics
            total_records = sum(stats.get("table_counts", {}).values())
            current_hash = self.ch_client.calculate_data_hash(all_data)
            self.ch_client.save_import_statistics(
                stats, overall_duration, total_records, current_hash
            )

        except Exception as e:
            print(f"\n❌ Import failed: {e}")
            raise
