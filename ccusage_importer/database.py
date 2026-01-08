"""
ClickHouse database operations module.
Handles all database interactions with proper connection management and parameterized queries.
"""

import logging
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Tuple

import clickhouse_connect

logger = logging.getLogger(__name__)


class ClickHouseClient:
    """
    Wrapper around clickhouse-connect client with enhanced error handling
    and connection management.
    """

    def __init__(
        self,
        host: str,
        port: int,
        user: str,
        password: str,
        database: str,
        protocol: Optional[str] = None,
    ):
        """
        Initialize ClickHouse client.

        Args:
            host: ClickHouse server host
            port: ClickHouse server port
            user: Database user
            password: Database password
            database: Database name
            protocol: Connection protocol ('http' or 'https', auto-detected if None)
        """
        self.host = host
        self.port = port
        self.user = user
        self.password = password
        self.database = database

        # Auto-detect protocol based on port if not specified
        if protocol is None:
            protocol = "https" if port in (443, 8443, 9440) else "http"

        # Determine interface based on protocol
        interface = f"{protocol}s" if protocol == "https" else protocol

        try:
            self.client = clickhouse_connect.get_client(
                host=host,
                port=port,
                username=user,
                password=password,
                database=database,
                interface=interface,
            )
            logger.info(f"Connected to ClickHouse at {host}:{port} ({interface})")
        except Exception as e:
            logger.error(f"Failed to connect to ClickHouse: {e}")
            raise

    def command(self, query: str, parameters: Optional[Dict[str, Any]] = None) -> None:
        """
        Execute a command that doesn't return data.

        Args:
            query: SQL command to execute
            parameters: Optional query parameters for parameterized queries
        """
        try:
            if parameters:
                self.client.command(query, parameters=parameters)
            else:
                self.client.command(query)
        except Exception as e:
            logger.error(f"Command failed: {e}\nQuery: {query}")
            raise

    def query(self, query: str, parameters: Optional[Dict[str, Any]] = None) -> Any:
        """
        Execute a query that returns data.

        Args:
            query: SQL query to execute
            parameters: Optional query parameters for parameterized queries

        Returns:
            Query result with result_rows attribute
        """
        try:
            if parameters:
                return self.client.query(query, parameters=parameters)
            else:
                return self.client.query(query)
        except Exception as e:
            logger.error(f"Query failed: {e}\nQuery: {query}")
            raise

    def insert(self, table: str, data: List[List[Any]], column_names: Optional[List[str]] = None) -> None:
        """
        Insert data into a table.

        Args:
            table: Table name
            data: List of rows to insert
            column_names: Optional column names (for validation)
        """
        try:
            self.client.insert(table, data, column_names=column_names)
            logger.debug(f"Inserted {len(data)} rows into {table}")
        except Exception as e:
            logger.error(f"Insert failed for {table}: {e}")
            raise

    def delete(
        self,
        table: str,
        conditions: Dict[str, Any],
    ) -> None:
        """
        Delete rows from a table using parameterized conditions.

        Args:
            table: Table name
            conditions: Dictionary of column=value pairs for WHERE clause

        Example:
            client.delete('my_table', {'date': ['2025-01-01', '2025-01-02'], 'machine_name': 'myhost'})
        """
        if not conditions:
            raise ValueError("Conditions dictionary cannot be empty")

        # Build parameterized WHERE clause
        where_parts = []
        params = {}
        param_index = 0

        for column, value in conditions.items():
            if isinstance(value, (list, tuple, set)):
                # IN clause for multiple values
                param_names = []
                for v in value:
                    param_name = f"param_{param_index}"
                    params[param_name] = v
                    param_names.append(f"{{{param_name}}}")
                    param_index += 1
                where_parts.append(f"{column} IN ({', '.join(param_names)})")
            else:
                # Single value equality
                param_name = f"param_{param_index}"
                params[param_name] = value
                where_parts.append(f"{column} = {{{param_name}}}")
                param_index += 1

        where_clause = " AND ".join(where_parts)
        query = f"ALTER TABLE {table} DELETE WHERE {where_clause}"

        self.command(query, parameters=params)
        logger.debug(f"Deleted from {table} where {where_clause}")


class UpsertManager:
    """
    Generic upsert manager to eliminate code duplication across different data types.
    Handles idempotent upserts for usage data with model breakdowns and models used tracking.
    """

    def __init__(self, client: ClickHouseClient, machine_name: str):
        """
        Initialize upsert manager.

        Args:
            client: ClickHouse client wrapper
            machine_name: Machine name for multi-machine tracking
        """
        self.client = client
        self.machine_name = machine_name

    def upsert_usage_data(
        self,
        table_name: str,
        record_type: str,
        data: List[Dict[str, Any]],
        key_field: str,
        row_builder: Callable[[Dict[str, Any], str], List[Any]],
        source: str = "ccusage",
        hash_keys: bool = False,
    ) -> None:
        """
        Generic upsert method for usage data tables.

        Eliminates ~450 lines of duplicated code across 5 upsert methods.

        Args:
            table_name: Main table name (e.g., 'ccusage_usage_daily')
            record_type: Record type for model breakdowns ('daily', 'monthly', 'session', 'block', 'project_daily')
            data: List of data records to upsert
            key_field: Field name used as primary key (e.g., 'date', 'month', 'session_id')
            row_builder: Function that builds row array for main table
            source: Data source identifier
            hash_keys: Whether to hash key values (for session/project privacy)
        """
        if not data:
            logger.debug(f"No {record_type} data to upsert")
            return

        # Extract key values
        if hash_keys:
            import hashlib

            def hash_value(v: str) -> str:
                return hashlib.sha256(v.encode("utf-8")).hexdigest()[:8]

            keys = [hash_value(str(item[key_field])) for item in data]
        else:
            keys = [str(item[key_field]) for item in data]

        # Delete existing data from main table
        self.client.delete(
            table_name,
            {
                key_field: list(keys),
                "machine_name": self.machine_name,
                "source": source,
            },
        )

        # Prepare data for insertion
        rows = []
        model_breakdown_rows = []
        model_used_rows = []

        for item in data:
            # Build main table row
            rows.append(row_builder(item, self.machine_name))

            # Build model breakdown rows
            for breakdown in item.get("modelBreakdowns", []):
                record_key = hash_value(str(item[key_field])) if hash_keys else str(item[key_field])
                model_breakdown_rows.append(
                    [
                        record_type,
                        record_key,
                        self.machine_name,
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

            # Build models used rows
            for model in item.get("modelsUsed", []):
                record_key = hash_value(str(item[key_field])) if hash_keys else str(item[key_field])
                model_used_rows.append(
                    [record_type, record_key, self.machine_name, model, datetime.now(), source]
                )

        # Insert main data
        if rows:
            self.client.insert(table_name, rows)
            logger.debug(f"Inserted {len(rows)} rows into {table_name}")

        # Insert model breakdowns
        if model_breakdown_rows:
            # Delete existing model breakdowns
            self.client.delete(
                "ccusage_model_breakdowns",
                {
                    "record_type": record_type,
                    "record_key": keys,
                    "source": source,
                },
            )
            self.client.insert("ccusage_model_breakdowns", model_breakdown_rows)
            logger.debug(f"Inserted {len(model_breakdown_rows)} model breakdown records")

        # Insert models used
        if model_used_rows:
            # Delete existing models used
            self.client.delete(
                "ccusage_models_used",
                {
                    "record_type": record_type,
                    "record_key": keys,
                    "machine_name": self.machine_name,
                    "source": source,
                },
            )
            self.client.insert("ccusage_models_used", model_used_rows)
            logger.debug(f"Inserted {len(model_used_rows)} models used records")

    def upsert_blocks_data(
        self,
        blocks_data: List[Dict[str, Any]],
        row_builder: Callable[[Dict[str, Any], str], List[Any]],
        source: str = "ccusage",
    ) -> None:
        """
        Upsert blocks data (special case - blocks don't have model breakdowns).

        Args:
            blocks_data: List of block records to upsert
            row_builder: Function that builds row array for blocks table
            source: Data source identifier
        """
        if not blocks_data:
            logger.debug("No blocks data to upsert")
            return

        # Extract block IDs
        block_ids = [item["id"] for item in blocks_data]

        # Delete existing blocks
        self.client.delete(
            "ccusage_usage_blocks",
            {
                "block_id": block_ids,
                "machine_name": self.machine_name,
                "source": source,
            },
        )

        # Prepare data for insertion
        rows = []
        model_used_rows = []

        for item in blocks_data:
            # Build main block row
            rows.append(row_builder(item, self.machine_name))

            # Build models used rows (blocks don't have breakdowns)
            for model in item.get("models", []):
                if model != "<synthetic>":  # Skip synthetic entries
                    model_used_rows.append(
                        ["block", item["id"], self.machine_name, model, datetime.now(), source]
                    )

        # Insert blocks
        if rows:
            self.client.insert("ccusage_usage_blocks", rows)
            logger.debug(f"Inserted {len(rows)} block records")

        # Insert models used
        if model_used_rows:
            self.client.delete(
                "ccusage_models_used",
                {
                    "record_type": "block",
                    "record_key": block_ids,
                    "machine_name": self.machine_name,
                    "source": source,
                },
            )
            self.client.insert("ccusage_models_used", model_used_rows)
            logger.debug(f"Inserted {len(model_used_rows)} models used records for blocks")
