#!/usr/bin/env python3
"""
Configuration module for ccusage-import
Handles environment variables and application settings
"""

import hashlib
import os
import socket

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

# Project privacy settings (global configuration)
HASH_PROJECT_NAMES = True


def hash_project_name(project_path: str) -> str:
    """
    Create a stable, short hash of project paths for privacy.

    Args:
        project_path: Full project path or session ID

    Returns:
        8-character hexadecimal hash (stable and collision-resistant)
    """
    if not HASH_PROJECT_NAMES:
        return project_path

    # Use SHA-256 for cryptographic security, take first 8 chars for brevity
    # This provides ~4 billion possible values with very low collision probability
    hash_object = hashlib.sha256(project_path.encode("utf-8"))
    return hash_object.hexdigest()[:8]


def set_hash_project_names(enabled: bool):
    """
    Enable or disable project name hashing.

    Args:
        enabled: True to enable hashing, False to disable
    """
    global HASH_PROJECT_NAMES
    HASH_PROJECT_NAMES = enabled
