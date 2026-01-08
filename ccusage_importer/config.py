"""
Configuration management for ccusage-importer.
Replaces global variables with a proper configuration class.
"""

import os
import socket
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ClickHouseConfig:
    """ClickHouse database connection configuration."""

    host: str
    port: int
    user: str
    password: str
    database: str
    protocol: Optional[str] = None

    @classmethod
    def from_env(cls) -> "ClickHouseConfig":
        """
        Create configuration from environment variables.

        Returns:
            ClickHouseConfig with values from environment or defaults
        """
        return cls(
            host=os.getenv("CH_HOST", "localhost"),
            port=int(os.getenv("CH_PORT", "8123")),
            user=os.getenv("CH_USER", "default"),
            password=os.getenv("CH_PASSWORD", ""),
            database=os.getenv("CH_DATABASE", "default"),
            protocol=os.getenv("CH_PROTOCOL"),
        )

    def get_interface(self) -> str:
        """
        Get the connection interface based on protocol/port.

        Returns:
            'http', 'https', or interface string for clickhouse-connect
        """
        if self.protocol:
            return f"{self.protocol}s" if self.protocol == "https" else self.protocol

        # Auto-detect based on port
        return "https" if self.port in (443, 8443, 9440) else "http"


@dataclass
class ImporterConfig:
    """
    Main configuration for the ccusage importer.

    Replaces global variables with a proper configuration class.
    """

    # Privacy settings
    hash_project_names: bool = True

    # OpenCode settings
    opencode_path: Optional[str] = None
    skip_opencode: bool = False

    # ccusage settings
    skip_ccusage: bool = False

    # Machine identification
    machine_name: str = field(default_factory=lambda: os.getenv("MACHINE_NAME", socket.gethostname().lower()))

    # Data source settings
    source: str = "ccusage"  # Default source identifier

    # Command execution settings
    command_timeout: int = 120  # Seconds to wait for ccusage commands
    command_retries: int = 2  # Number of retries for failed commands

    # Parallel execution settings
    max_parallel_workers: int = 3  # Max concurrent ccusage commands

    @classmethod
    def from_args(cls, args) -> "ImporterConfig":
        """
        Create configuration from argparse arguments.

        Args:
            args: Parsed command-line arguments

        Returns:
            ImporterConfig with values from arguments
        """
        config = cls()

        if hasattr(args, "no_hash_projects") and args.no_hash_projects:
            config.hash_project_names = False

        if hasattr(args, "opencode") and args.opencode:
            config.opencode_path = args.opencode

        if hasattr(args, "skip_opencode") and args.skip_opencode:
            config.skip_opencode = True

        if hasattr(args, "skip_ccusage") and args.skip_ccusage:
            config.skip_ccusage = True

        if hasattr(args, "source") and args.source:
            config.source = args.source

        return config


@dataclass
class UIConfig:
    """Configuration for UI formatting and display."""

    # Animation settings
    show_animations: bool = True
    spinner_chars: str = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"

    # Heatmap settings
    heatmap_days: int = 365
    heatmap_intensity_levels: int = 5

    # Number formatting
    use_smart_suffixes: bool = True  # K, M, B suffixes
    decimal_places: int = 1

    # Output settings
    verbose: bool = False
    quiet: bool = False


class ConfigManager:
    """
    Central configuration manager for the application.

    Provides a single point of access for all configuration settings.
    """

    def __init__(
        self,
        clickhouse: Optional[ClickHouseConfig] = None,
        importer: Optional[ImporterConfig] = None,
        ui: Optional[UIConfig] = None,
    ):
        """
        Initialize configuration manager.

        Args:
            clickhouse: ClickHouse configuration (defaults to env vars)
            importer: Importer configuration (defaults to class defaults)
            ui: UI configuration (defaults to class defaults)
        """
        self.clickhouse = clickhouse or ClickHouseConfig.from_env()
        self.importer = importer or ImporterConfig()
        self.ui = ui or UIConfig()

    @classmethod
    def from_args(cls, args) -> "ConfigManager":
        """
        Create configuration from command-line arguments.

        Args:
            args: Parsed command-line arguments

        Returns:
            ConfigManager with all configurations initialized
        """
        return cls(
            clickhouse=ClickHouseConfig.from_env(),
            importer=ImporterConfig.from_args(args),
        )
