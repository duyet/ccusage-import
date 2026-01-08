"""
Data parsers and transformers for ccusage and OpenCode data.
Handles conversion of JSON data to database-ready formats.
"""

import hashlib
import logging
from datetime import date, datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def hash_project_name(project_path: str, enabled: bool = True) -> str:
    """
    Create a stable, short hash of project paths for privacy.

    Args:
        project_path: Full project path or session ID
        enabled: Whether hashing is enabled (from config)

    Returns:
        8-character hexadecimal hash (stable and collision-resistant)
        or original path if hashing disabled
    """
    if not enabled:
        return project_path

    # Use SHA-256 for cryptographic security, take first 8 chars for brevity
    # This provides ~4 billion possible values with very low collision probability
    hash_object = hashlib.sha256(project_path.encode("utf-8"))
    return hash_object.hexdigest()[:8]


class DataParser:
    """
    Generic data parser for ccusage/OpenCode JSON data.

    Provides type-safe parsing methods for common data types.
    """

    def __init__(self, hash_projects: bool = True, machine_name: str = "localhost"):
        """
        Initialize data parser.

        Args:
            hash_projects: Whether to hash project/session identifiers
            machine_name: Machine name for multi-machine tracking
        """
        self.hash_projects = hash_projects
        self.machine_name = machine_name

    def parse_date(self, date_str: Optional[str]) -> Optional[date]:
        """
        Parse date string from ccusage/OpenCode format.

        Args:
            date_str: Date string (e.g., "2025-01-05")

        Returns:
            Date object or None if parsing fails
        """
        if not date_str:
            return None

        try:
            # Handle ISO format dates
            if isinstance(date_str, str):
                return datetime.fromisoformat(date_str.replace("Z", "+00:00")).date()
            elif isinstance(date_str, date):
                return date_str
        except (ValueError, AttributeError) as e:
            logger.warning(f"Failed to parse date '{date_str}': {e}")

        return None

    def parse_datetime(self, datetime_str: Optional[str]) -> Optional[datetime]:
        """
        Parse datetime string from ccusage/OpenCode format.

        Args:
            datetime_str: Datetime string (e.g., "2025-01-05T15:30:00.000Z")

        Returns:
            Datetime object or None if parsing fails
        """
        if not datetime_str:
            return None

        try:
            # Handle ISO format datetimes
            if isinstance(datetime_str, str):
                dt = datetime.fromisoformat(datetime_str.replace("Z", "+00:00"))
                # Strip timezone for ClickHouse compatibility
                return dt.replace(tzinfo=None)
            elif isinstance(datetime_str, datetime):
                return datetime_str
        except (ValueError, AttributeError) as e:
            logger.warning(f"Failed to parse datetime '{datetime_str}': {e}")

        return None

    def extract_burn_rate(self, burn_rate_data: Any) -> Optional[float]:
        """
        Extract burn rate from potentially complex data structure.

        Args:
            burn_rate_data: Either a float or a dict with 'costPerHour' key

        Returns:
            Float burn rate or None
        """
        if isinstance(burn_rate_data, (int, float)):
            return float(burn_rate_data)
        elif isinstance(burn_rate_data, dict):
            return burn_rate_data.get("costPerHour")
        return None

    def extract_projection(self, projection_data: Any) -> Optional[float]:
        """
        Extract projection from potentially complex data structure.

        Args:
            projection_data: Either a float or a dict with 'totalCost' key

        Returns:
            Float projection or None
        """
        if isinstance(projection_data, (int, float)):
            return float(projection_data)
        elif isinstance(projection_data, dict):
            return projection_data.get("totalCost")
        return None


class RowBuilder:
    """
    Builds row arrays for database insertion from parsed data.

    Each method corresponds to a specific table schema and returns
    a list of values in the exact order required by that table.
    """

    def __init__(self, parser: DataParser, source: str = "ccusage"):
        """
        Initialize row builder.

        Args:
            parser: DataParser instance for parsing values
            source: Data source identifier
        """
        self.parser = parser
        self.source = source

    def build_daily_row(self, item: Dict[str, Any], machine_name: str) -> List[Any]:
        """
        Build row for ccusage_usage_daily table.

        Schema order: date, machine_name, input_tokens, output_tokens,
                     cache_creation_tokens, cache_read_tokens, total_tokens,
                     total_cost, models_count, created_at, updated_at, source
        """
        return [
            self.parser.parse_date(item["date"]),
            machine_name,
            item["inputTokens"],
            item["outputTokens"],
            item["cacheCreationTokens"],
            item["cacheReadTokens"],
            item["totalTokens"],
            item["totalCost"],
            len(item["modelsUsed"]),
            datetime.now(),
            datetime.now(),
            self.source,
        ]

    def build_monthly_row(self, item: Dict[str, Any], machine_name: str) -> List[Any]:
        """
        Build row for ccusage_usage_monthly table.

        Schema order: month, year, month_num, machine_name, input_tokens,
                     output_tokens, cache_creation_tokens, cache_read_tokens,
                     total_tokens, total_cost, models_count, created_at,
                     updated_at, source
        """
        year, month_num = item["month"].split("-")
        return [
            item["month"],
            int(year),
            int(month_num),
            machine_name,
            item["inputTokens"],
            item["outputTokens"],
            item["cacheCreationTokens"],
            item["cacheReadTokens"],
            item["totalTokens"],
            item["totalCost"],
            len(item["modelsUsed"]),
            datetime.now(),
            datetime.now(),
            self.source,
        ]

    def build_session_row(self, item: Dict[str, Any], machine_name: str) -> List[Any]:
        """
        Build row for ccusage_usage_sessions table.

        Schema order: session_id, project_path, machine_name, input_tokens,
                     output_tokens, cache_creation_tokens, cache_read_tokens,
                     total_tokens, total_cost, last_activity, models_count,
                     created_at, updated_at, source
        """
        hashed_session_id = hash_project_name(item["sessionId"], self.parser.hash_projects)
        hashed_project_path = hash_project_name(item["projectPath"], self.parser.hash_projects)

        return [
            hashed_session_id,
            hashed_project_path,
            machine_name,
            item["inputTokens"],
            item["outputTokens"],
            item["cacheCreationTokens"],
            item["cacheReadTokens"],
            item["totalTokens"],
            item["totalCost"],
            self.parser.parse_date(item["lastActivity"]),
            len(item["modelsUsed"]),
            datetime.now(),
            datetime.now(),
            self.source,
        ]

    def build_blocks_row(self, item: Dict[str, Any], machine_name: str) -> List[Any]:
        """
        Build row for ccusage_usage_blocks table.

        Schema order: block_id, machine_name, start_time, end_time, actual_end_time,
                     is_active, is_gap, entries, input_tokens, output_tokens,
                     cache_creation_tokens, cache_read_tokens, total_tokens, cost_usd,
                     models_count, created_at, updated_at, usage_limit_reset_time,
                     burn_rate, projection, source
        """
        return [
            item["id"],
            machine_name,
            self.parser.parse_datetime(item["startTime"]),
            self.parser.parse_datetime(item["endTime"]),
            self.parser.parse_datetime(item.get("actualEndTime")),
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
            self.parser.parse_datetime(item.get("usageLimitResetTime")),
            self.parser.extract_burn_rate(item.get("burnRate")),
            self.parser.extract_projection(item.get("projection")),
            self.source,
        ]

    def build_project_daily_row(self, item: Dict[str, Any], project_id: str, machine_name: str) -> List[Any]:
        """
        Build row for ccusage_usage_projects_daily table.

        Schema order: date, project_id, machine_name, input_tokens, output_tokens,
                     cache_creation_tokens, cache_read_tokens, total_tokens, total_cost,
                     models_count, created_at, updated_at, source
        """
        return [
            self.parser.parse_date(item["date"]),
            project_id,
            machine_name,
            item["inputTokens"],
            item["outputTokens"],
            item["cacheCreationTokens"],
            item["cacheReadTokens"],
            item["totalTokens"],
            item["totalCost"],
            len(item["modelsUsed"]),
            datetime.now(),
            datetime.now(),
            self.source,
        ]


class OpenCodeAggregator:
    """
    Aggregates OpenCode message data into usage statistics.

    Refactored from the monolithic _aggregate_opencode_messages method
    to improve maintainability and testability.
    """

    def __init__(self, parser: DataParser, machine_name: str = "localhost"):
        """
        Initialize OpenCode aggregator.

        Args:
            parser: DataParser instance for parsing values
            machine_name: Machine name for multi-machine tracking
        """
        self.parser = parser
        self.machine_name = machine_name

    def aggregate_messages(self, messages: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Aggregate OpenCode messages into usage statistics.

        Args:
            messages: List of OpenCode message objects

        Returns:
            Dictionary with aggregated data for daily, monthly, session, and projects
        """
        # Filter for assistant messages only
        assistant_messages = self._filter_assistant_messages(messages)

        # Aggregate by different dimensions
        daily_data = self._aggregate_by_date(assistant_messages)
        monthly_data = self._aggregate_by_month(assistant_messages)
        session_data = self._aggregate_by_session(assistant_messages)
        project_data = self._aggregate_by_project(assistant_messages)

        return {
            "daily": daily_data,
            "monthly": monthly_data,
            "session": session_data,
            "projects": project_data,
        }

    def _filter_assistant_messages(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Filter messages to only include assistant messages.

        Args:
            messages: List of all messages

        Returns:
            List of assistant messages
        """
        return [m for m in messages if m.get("role") == "assistant"]

    def _aggregate_by_date(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Aggregate messages by date.

        Args:
            messages: List of assistant messages

        Returns:
            List of daily aggregated records
        """
        # Group by date
        by_date: Dict[str, List[Dict[str, Any]]] = {}
        for msg in messages:
            msg_date = msg.get("date", "")
            if msg_date not in by_date:
                by_date[msg_date] = []
            by_date[msg_date].append(msg)

        # Aggregate each date
        result = []
        for date_str, date_messages in by_date.items():
            aggregated = self._aggregate_messages_list(date_messages)
            aggregated["date"] = date_str
            result.append(aggregated)

        return result

    def _aggregate_by_month(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Aggregate messages by month.

        Args:
            messages: List of assistant messages

        Returns:
            List of monthly aggregated records
        """
        # Group by month
        by_month: Dict[str, List[Dict[str, Any]]] = {}
        for msg in messages:
            msg_date = self.parser.parse_date(msg.get("date", ""))
            if not msg_date:
                continue

            month_key = f"{msg_date.year}-{msg_date.month:02d}"
            if month_key not in by_month:
                by_month[month_key] = []
            by_month[month_key].append(msg)

        # Aggregate each month
        result = []
        for month_key, month_messages in by_month.items():
            aggregated = self._aggregate_messages_list(month_messages)
            aggregated["month"] = month_key
            result.append(aggregated)

        return result

    def _aggregate_by_session(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Aggregate messages by session.

        Args:
            messages: List of assistant messages

        Returns:
            List of session aggregated records
        """
        # Group by session
        by_session: Dict[str, List[Dict[str, Any]]] = {}
        for msg in messages:
            session_id = msg.get("sessionId", "")
            if not session_id:
                continue

            if session_id not in by_session:
                by_session[session_id] = []
            by_session[session_id].append(msg)

        # Aggregate each session
        result = []
        for session_id, session_messages in by_session.items():
            aggregated = self._aggregate_messages_list(session_messages)
            aggregated["sessionId"] = session_id
            aggregated["projectPath"] = session_messages[0].get("projectPath", "unknown")
            aggregated["lastActivity"] = session_messages[0].get("date", "")
            result.append(aggregated)

        return result

    def _aggregate_by_project(self, messages: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
        """
        Aggregate messages by project and date.

        Args:
            messages: List of assistant messages

        Returns:
            Dictionary mapping project_id to list of daily records
        """
        # Group by project and date
        by_project_date: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}

        for msg in messages:
            project_path = msg.get("projectPath", "unknown")
            project_id = hash_project_name(project_path, self.parser.hash_projects)
            msg_date = msg.get("date", "")

            if project_id not in by_project_date:
                by_project_date[project_id] = {}

            if msg_date not in by_project_date[project_id]:
                by_project_date[project_id][msg_date] = []

            by_project_date[project_id][msg_date].append(msg)

        # Aggregate each project-date combination
        result = {}
        for project_id, dates in by_project_date.items():
            project_records = []
            for date_str, date_messages in dates.items():
                aggregated = self._aggregate_messages_list(date_messages)
                aggregated["date"] = date_str
                project_records.append(aggregated)
            result[project_id] = project_records

        return result

    def _aggregate_messages_list(self, messages: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Aggregate a list of messages into a single record.

        Args:
            messages: List of messages to aggregate

        Returns:
            Aggregated record with token counts, costs, and models
        """
        total_input = 0
        total_output = 0
        total_cache_creation = 0
        total_cache_read = 0
        total_cost = 0.0

        model_costs: Dict[str, Dict[str, Any]] = {}
        models_used = set()

        for msg in messages:
            usage = msg.get("usage", {})

            input_tokens = usage.get("inputTokens", 0) or 0
            output_tokens = usage.get("outputTokens", 0) or 0
            cache_creation = usage.get("cacheCreationTokens", 0) or 0
            cache_read = usage.get("cacheReadTokens", 0) or 0
            cost = usage.get("costUSD", 0.0) or 0.0
            model = msg.get("model", "unknown")

            total_input += input_tokens
            total_output += output_tokens
            total_cache_creation += cache_creation
            total_cache_read += cache_read
            total_cost += cost

            models_used.add(model)

            # Track model breakdowns
            if model not in model_costs:
                model_costs[model] = {
                    "inputTokens": 0,
                    "outputTokens": 0,
                    "cacheCreationTokens": 0,
                    "cacheReadTokens": 0,
                    "cost": 0.0,
                }

            model_costs[model]["inputTokens"] += input_tokens
            model_costs[model]["outputTokens"] += output_tokens
            model_costs[model]["cacheCreationTokens"] += cache_creation
            model_costs[model]["cacheReadTokens"] += cache_read
            model_costs[model]["cost"] += cost

        # Build model breakdowns array
        model_breakdowns = [
            {
                "modelName": model,
                "inputTokens": data["inputTokens"],
                "outputTokens": data["outputTokens"],
                "cacheCreationTokens": data["cacheCreationTokens"],
                "cacheReadTokens": data["cacheReadTokens"],
                "cost": data["cost"],
            }
            for model, data in model_costs.items()
        ]

        return {
            "inputTokens": total_input,
            "outputTokens": total_output,
            "cacheCreationTokens": total_cache_creation,
            "cacheReadTokens": total_cache_read,
            "totalTokens": total_input + total_output + total_cache_creation + total_cache_read,
            "totalCost": total_cost,
            "modelsUsed": list(models_used),
            "modelBreakdowns": model_breakdowns,
        }
