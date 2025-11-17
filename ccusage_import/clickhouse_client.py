#!/usr/bin/env python3
"""
ClickHouse client wrapper for ccusage-import
Handles database operations and schema management
"""

import hashlib
import json
import os
from datetime import datetime
from typing import Any, Dict

import clickhouse_connect

from .config import CH_DATABASE, CH_HOST, CH_PASSWORD, CH_PORT, CH_USER, MACHINE_NAME
from .ui import LoadingAnimation


class ClickHouseClient:
    """Wrapper for ClickHouse connection and operations"""

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

    def check_and_create_tables_if_needed(self):
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
        schema_file = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "ccusage_clickhouse_schema.sql",
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

    def get_import_statistics(self) -> Dict[str, Any]:
        """Get comprehensive statistics after import"""
        stats = {}

        # Table row counts
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
                count_result = self.client.query(
                    f"SELECT count() FROM {table}"
                ).result_rows[0]
                table_counts[table] = int(count_result[0])
            except Exception:
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

    def save_import_statistics(
        self,
        stats: Dict[str, Any],
        import_duration_seconds: float,
        records_imported: int = 0,
        data_hash: str = "",
    ):
        """Save import statistics to history table for comparison tracking"""
        try:
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
                return json.loads(result.result_rows[0][0])
            return {}

        except Exception as e:
            print(f"⚠️  Warning: Could not retrieve previous statistics: {e}")
            return {}

    def calculate_data_hash(self, all_data: Dict[str, Any]) -> str:
        """Calculate a hash of the imported data to detect identical imports"""
        try:
            # Create a stable hash of the data content
            data_str = json.dumps(all_data, sort_keys=True, default=str)
            return hashlib.md5(data_str.encode()).hexdigest()[:12]  # Short hash
        except Exception:
            return ""

    def is_identical_import(self, all_data: Dict[str, Any]) -> bool:
        """Check if this data is identical to the previous import"""
        try:
            current_hash = self.calculate_data_hash(all_data)

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

    def check_data_freshness(self, run_ccusage_command_fn) -> Dict[str, Any]:
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
                ccusage_data = run_ccusage_command_fn("daily", verbose=False)
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
