"""
Data fetchers for ccusage and OpenCode sources.
Handles parallel execution, retry logic, and error handling.
"""

import json
import logging
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class FetchError(Exception):
    """Exception raised when data fetching fails."""

    def __init__(self, source: str, command: str, message: str):
        """
        Initialize fetch error.

        Args:
            source: Data source name (e.g., 'ccusage', 'opencode')
            command: Command that failed
            message: Error message
        """
        self.source = source
        self.command = command
        self.message = message
        super().__init__(f"{source} fetch error for '{command}': {message}")


class CcusageFetcher:
    """
    Fetches data from the ccusage CLI tool.

    Handles parallel execution of multiple ccusage commands with
    retry logic and proper error handling.
    """

    def __init__(
        self,
        timeout: int = 120,
        max_retries: int = 2,
        package_runner: Optional[str] = None,
    ):
        """
        Initialize ccusage fetcher.

        Args:
            timeout: Command timeout in seconds
            max_retries: Number of retry attempts
            package_runner: Package runner ('npx', 'bunx', or auto-detect)
        """
        self.timeout = timeout
        self.max_retries = max_retries
        self.package_runner = package_runner or self._detect_package_runner()

    def _detect_package_runner(self) -> str:
        """
        Detect available package runner.

        Returns:
            'bunx' if available, otherwise 'npx'
        """
        try:
            subprocess.run(
                ["bunx", "--version"],
                capture_output=True,
                check=True,
                timeout=5,
            )
            return "bunx"
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
            pass

        try:
            subprocess.run(
                ["npx", "--version"],
                capture_output=True,
                check=True,
                timeout=5,
            )
            return "npx"
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
            pass

        raise FetchError("ccusage", "detect", "No package runner found (npx or bunx required)")

    def fetch_all(self, verbose: bool = False) -> Dict[str, Any]:
        """
        Fetch all ccusage data types in parallel.

        Args:
            verbose: Whether to show verbose output

        Returns:
            Dictionary with 'daily', 'monthly', 'session', 'blocks', 'projects' keys
        """
        commands = {
            "daily": "daily",
            "monthly": "monthly",
            "session": "session",
            "blocks": "blocks",
            "projects": "daily --instances",
        }

        results = {}

        with ThreadPoolExecutor(max_workers=3) as executor:
            # Submit all fetch jobs
            future_to_key = {
                executor.submit(self._fetch_command, cmd, key, verbose): key
                for key, cmd in commands.items()
            }

            # Collect results as they complete
            for future in as_completed(future_to_key):
                key = future_to_key[future]
                try:
                    results[key] = future.result()
                    if verbose:
                        print(f"✓ {key} data fetched")
                except Exception as e:
                    logger.error(f"Failed to fetch {key}: {e}")
                    results[key] = {}

        # Extract inner arrays from wrapped responses
        return self._extract_response_data(results)

    def _fetch_command(
        self,
        command: str,
        data_type: str,
        verbose: bool = False,
    ) -> Dict[str, Any]:
        """
        Execute a single ccusage command with retry logic.

        Args:
            command: Command arguments (without 'ccusage@latest')
            data_type: Type of data being fetched
            verbose: Whether to show verbose output

        Returns:
            Parsed JSON response or empty dict on failure
        """
        for attempt in range(self.max_retries):
            try:
                cmd = [self.package_runner, "ccusage@latest"]
                cmd.extend(command.split())
                cmd.append("--json")

                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=self.timeout,
                )

                if result.returncode == 0:
                    try:
                        return json.loads(result.stdout)
                    except json.JSONDecodeError as e:
                        if verbose:
                            print(f"  Error parsing JSON from ccusage {command}: {e}")
                        return {}
                else:
                    if verbose and attempt == self.max_retries - 1:
                        print(f"  ccusage {command} failed: {result.stderr}")

            except subprocess.TimeoutExpired:
                if verbose and attempt == self.max_retries - 1:
                    print(f"  ccusage {command} timed out after {self.timeout}s")

            except subprocess.CalledProcessError as e:
                if verbose and attempt == self.max_retries - 1:
                    print(f"  ccusage {command} failed: {e}")

            # Wait before retry (exponential backoff)
            if attempt < self.max_retries - 1:
                time.sleep(2 ** attempt)

        return {}

    def _extract_response_data(self, raw_results: Dict[str, Any]) -> Dict[str, List]:
        """
        Extract inner arrays from ccusage wrapped response objects.

        ccusage CLI wraps responses like:
        {"daily": [...], "totals": {...}}
        {"sessions": [...], "totals": {...}}
        {"blocks": [...]}
        {"projects": [...], "totals": {...}}

        Args:
            raw_results: Raw responses from ccusage commands

        Returns:
            Dictionary with extracted data arrays
        """
        extracted = {}

        # Daily data
        raw_daily = raw_results.get("daily", {})
        if isinstance(raw_daily, dict):
            extracted["daily"] = raw_daily.get("daily", [])
        else:
            extracted["daily"] = []

        # Monthly data
        raw_monthly = raw_results.get("monthly", {})
        if isinstance(raw_monthly, dict):
            extracted["monthly"] = raw_monthly.get("monthly", [])
        else:
            extracted["monthly"] = []

        # Session data (note: key is "sessions" not "session")
        raw_session = raw_results.get("session", {})
        if isinstance(raw_session, dict):
            extracted["session"] = raw_session.get("sessions", [])
        else:
            extracted["session"] = []

        # Blocks data (no wrapping)
        raw_blocks = raw_results.get("blocks", {})
        if isinstance(raw_blocks, dict) and "blocks" in raw_blocks:
            extracted["blocks"] = raw_blocks["blocks"]
        elif isinstance(raw_blocks, list):
            extracted["blocks"] = raw_blocks
        else:
            extracted["blocks"] = []

        # Projects data
        raw_projects = raw_results.get("projects", {})
        if isinstance(raw_projects, dict):
            extracted["projects"] = raw_projects.get("projects", {})
        else:
            extracted["projects"] = {}

        return extracted


class OpenCodeFetcher:
    """
    Fetches data from OpenCode message store.

    Reads and parses OpenCode message files for usage analytics.
    """

    def __init__(self, opencode_path: Optional[Path] = None):
        """
        Initialize OpenCode fetcher.

        Args:
            opencode_path: Path to OpenCode data directory
        """
        self.opencode_path = opencode_path

    def fetch_messages(self) -> List[Dict[str, Any]]:
        """
        Fetch all messages from OpenCode store.

        Returns:
            List of message dictionaries

        Raises:
            FetchError: If OpenCode path is invalid or messages cannot be loaded
        """
        if not self.opencode_path:
            raise FetchError("opencode", "messages", "OpenCode path not configured")

        opencode_dir = Path(self.opencode_path)

        if not opencode_dir.exists():
            raise FetchError("opencode", "messages", f"Path does not exist: {opencode_dir}")

        # Try to find messages.jsonl or messages directory
        messages_file = opencode_dir / "messages.jsonl"
        messages_dir = opencode_dir / "messages"

        if messages_file.exists():
            return self._load_jsonl(messages_file)
        elif messages_dir.exists():
            return self._load_messages_directory(messages_dir)
        else:
            raise FetchError(
                "opencode",
                "messages",
                f"No messages found at: {opencode_dir} (expected messages.jsonl or messages/ directory)",
            )

    def _load_jsonl(self, jsonl_file: Path) -> List[Dict[str, Any]]:
        """
        Load messages from JSONL file.

        Args:
            jsonl_file: Path to JSONL file

        Returns:
            List of message dictionaries
        """
        messages = []

        try:
            with open(jsonl_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            message = json.loads(line)
                            messages.append(message)
                        except json.JSONDecodeError as e:
                            logger.warning(f"Failed to parse message line: {e}")
        except IOError as e:
            raise FetchError("opencode", "messages", f"Failed to read messages file: {e}")

        logger.info(f"Loaded {len(messages)} messages from {jsonl_file}")
        return messages

    def _load_messages_directory(self, messages_dir: Path) -> List[Dict[str, Any]]:
        """
        Load messages from messages directory (multiple JSONL files).

        Args:
            messages_dir: Path to messages directory

        Returns:
            List of message dictionaries
        """
        messages = []

        for jsonl_file in messages_dir.glob("*.jsonl"):
            try:
                messages.extend(self._load_jsonl(jsonl_file))
            except FetchError as e:
                logger.warning(f"Failed to load {jsonl_file}: {e}")

        logger.info(f"Loaded {len(messages)} messages from {messages_dir}")
        return messages


class DataFetcher:
    """
    Unified data fetcher that combines ccusage and OpenCode sources.

    Provides a single interface for fetching all usage data.
    """

    def __init__(
        self,
        ccusage_fetcher: Optional[CcusageFetcher] = None,
        opencode_fetcher: Optional[OpenCodeFetcher] = None,
        skip_ccusage: bool = False,
        skip_opencode: bool = False,
    ):
        """
        Initialize unified data fetcher.

        Args:
            ccusage_fetcher: CcusageFetcher instance (created if None)
            opencode_fetcher: OpenCodeFetcher instance (created if None)
            skip_ccusage: Whether to skip ccusage data fetching
            skip_opencode: Whether to skip OpenCode data fetching
        """
        self.ccusage_fetcher = ccusage_fetcher
        self.opencode_fetcher = opencode_fetcher
        self.skip_ccusage = skip_ccusage
        self.skip_opencode = skip_opencode

    def fetch_all(self, verbose: bool = False) -> Dict[str, Any]:
        """
        Fetch all available usage data.

        Args:
            verbose: Whether to show verbose output

        Returns:
            Dictionary with all fetched data organized by source
        """
        results = {
            "ccusage": {},
            "opencode": {},
        }

        # Fetch ccusage data
        if not self.skip_ccusage and self.ccusage_fetcher:
            if verbose:
                print("Fetching ccusage data...")

            results["ccusage"] = self.ccusage_fetcher.fetch_all(verbose=verbose)

        # Fetch OpenCode data
        if not self.skip_opencode and self.opencode_fetcher:
            if verbose:
                print("Fetching OpenCode data...")

            try:
                messages = self.opencode_fetcher.fetch_messages()
                results["opencode"]["messages"] = messages
            except FetchError as e:
                logger.error(f"Failed to fetch OpenCode data: {e}")
                results["opencode"]["messages"] = []

        return results
