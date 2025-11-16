#!/usr/bin/env python3
"""
Data fetching utilities for ccusage-import
Handles ccusage command execution and parallel data fetching
"""

import concurrent.futures
import json
import subprocess
from datetime import datetime
from typing import Any, Dict

from .ui import LoadingAnimation, UIFormatter


def detect_package_runner() -> str:
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


def run_ccusage_command(
    command: str, package_runner: str = "npx", verbose: bool = False
) -> Dict[str, Any]:
    """Run ccusage command and return JSON data with retry logic"""
    max_retries = 2
    for attempt in range(max_retries):
        try:
            if verbose and attempt == 0:
                print(f"Running: {package_runner} ccusage@latest {command} --json")
            elif verbose:
                print(
                    f"  Retry {attempt}: {package_runner} ccusage@latest {command} --json"
                )

            result = subprocess.run(
                [package_runner, "ccusage@latest"] + command.split() + ["--json"],
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


def fetch_ccusage_data_parallel(package_runner: str = "npx") -> Dict[str, Dict[str, Any]]:
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
            executor.submit(run_ccusage_command, cmd, package_runner): key
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
