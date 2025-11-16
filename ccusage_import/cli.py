#!/usr/bin/env python3
"""
CLI module for ccusage-import
Handles command-line argument parsing and main entry point
"""

import argparse
import json
import subprocess
import sys

import clickhouse_connect

from .config import (
    CH_DATABASE,
    CH_HOST,
    CH_PASSWORD,
    CH_PORT,
    CH_USER,
    MACHINE_NAME,
    set_hash_project_names,
)
from .importer import ClickHouseImporter


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
                cmd.split(), capture_output=True, text=True, timeout=30
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
            print(f"  ⚠️  {cmd_name}: Command timed out (30s)")
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

        # Test write permissions
        try:
            client.command(
                "CREATE TABLE IF NOT EXISTS temp_check_table (id UInt32) ENGINE = Memory"
            )
            client.command("DROP TABLE IF EXISTS temp_check_table")
            print("  ✅ Write permissions: Verified")
        except Exception as perm_e:
            print(f"  ⚠️  Write permissions: Limited - {perm_e}")

    except Exception as e:
        print(f"  ❌ ClickHouse connection failed: {e}")
        all_checks_passed = False
        return all_checks_passed

    # 3. Check environment
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
    parser = argparse.ArgumentParser(
        description="ccusage to ClickHouse Data Importer",
        epilog="Examples:\n  %(prog)s                    # Import with privacy enabled (default)\n  %(prog)s --no-hash-projects  # Import with original project names\n  %(prog)s --check             # Validate system prerequisites",
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

    args = parser.parse_args()

    # Set global privacy configuration
    if args.no_hash_projects:
        set_hash_project_names(False)

    try:
        if args.check:
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
