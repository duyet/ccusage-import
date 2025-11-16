#!/usr/bin/env python3
"""
Pydantic models for data validation
Provides type-safe data structures with automatic validation
"""

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ModelBreakdown(BaseModel):
    """Token and cost breakdown for a specific model"""

    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True)

    model_name: str = Field(..., min_length=1, description="Name of the Claude model")
    input_tokens: int = Field(..., ge=0, description="Number of input tokens")
    output_tokens: int = Field(..., ge=0, description="Number of output tokens")
    cache_creation_tokens: int = Field(
        ..., ge=0, description="Cache creation input tokens"
    )
    cache_read_tokens: int = Field(..., ge=0, description="Cache read input tokens")
    cost: float = Field(..., ge=0.0, description="Cost in USD")

    @property
    def total_tokens(self) -> int:
        """Calculate total tokens"""
        return (
            self.input_tokens
            + self.output_tokens
            + self.cache_creation_tokens
            + self.cache_read_tokens
        )


class DailyUsage(BaseModel):
    """Daily usage data from ccusage"""

    model_config = ConfigDict(str_strip_whitespace=True)

    date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$", description="Date (YYYY-MM-DD)")
    input_tokens: int = Field(..., ge=0)
    output_tokens: int = Field(..., ge=0)
    cache_creation_tokens: int = Field(..., ge=0, alias="cacheCreationTokens")
    cache_read_tokens: int = Field(..., ge=0, alias="cacheReadTokens")
    total_tokens: int = Field(..., ge=0, alias="totalTokens")
    total_cost: float = Field(..., ge=0.0, alias="totalCost")
    models_used: List[str] = Field(..., alias="modelsUsed")
    model_breakdowns: List[ModelBreakdown] = Field(..., alias="modelBreakdowns")

    @field_validator("date")
    @classmethod
    def validate_date(cls, v: str) -> str:
        """Validate date format"""
        try:
            datetime.strptime(v, "%Y-%m-%d")
            return v
        except ValueError as e:
            raise ValueError(f"Invalid date format: {v}") from e


class MonthlyUsage(BaseModel):
    """Monthly usage data from ccusage"""

    model_config = ConfigDict(str_strip_whitespace=True)

    month: str = Field(..., pattern=r"^\d{4}-\d{2}$", description="Month (YYYY-MM)")
    input_tokens: int = Field(..., ge=0, alias="inputTokens")
    output_tokens: int = Field(..., ge=0, alias="outputTokens")
    cache_creation_tokens: int = Field(..., ge=0, alias="cacheCreationTokens")
    cache_read_tokens: int = Field(..., ge=0, alias="cacheReadTokens")
    total_tokens: int = Field(..., ge=0, alias="totalTokens")
    total_cost: float = Field(..., ge=0.0, alias="totalCost")
    models_used: List[str] = Field(..., alias="modelsUsed")
    model_breakdowns: List[ModelBreakdown] = Field(..., alias="modelBreakdowns")


class SessionUsage(BaseModel):
    """Session usage data from ccusage"""

    model_config = ConfigDict(str_strip_whitespace=True)

    session_id: str = Field(..., min_length=1, alias="sessionId")
    project_path: str = Field(..., min_length=1, alias="projectPath")
    input_tokens: int = Field(..., ge=0, alias="inputTokens")
    output_tokens: int = Field(..., ge=0, alias="outputTokens")
    cache_creation_tokens: int = Field(..., ge=0, alias="cacheCreationTokens")
    cache_read_tokens: int = Field(..., ge=0, alias="cacheReadTokens")
    total_tokens: int = Field(..., ge=0, alias="totalTokens")
    total_cost: float = Field(..., ge=0.0, alias="totalCost")
    last_activity: str = Field(..., alias="lastActivity")
    models_used: List[str] = Field(..., alias="modelsUsed")
    model_breakdowns: List[ModelBreakdown] = Field(..., alias="modelBreakdowns")


class TokenCounts(BaseModel):
    """Token counts for billing blocks"""

    model_config = ConfigDict(str_strip_whitespace=True)

    input_tokens: int = Field(..., ge=0, alias="inputTokens")
    output_tokens: int = Field(..., ge=0, alias="outputTokens")
    cache_creation_input_tokens: int = Field(
        ..., ge=0, alias="cacheCreationInputTokens"
    )
    cache_read_input_tokens: int = Field(..., ge=0, alias="cacheReadInputTokens")


class BlockUsage(BaseModel):
    """Billing block usage data from ccusage"""

    model_config = ConfigDict(str_strip_whitespace=True)

    id: str = Field(..., min_length=1)
    start_time: str = Field(..., alias="startTime")
    end_time: str = Field(..., alias="endTime")
    actual_end_time: Optional[str] = Field(None, alias="actualEndTime")
    is_active: bool = Field(..., alias="isActive")
    is_gap: bool = Field(..., alias="isGap")
    entries: int = Field(..., ge=0)
    token_counts: TokenCounts = Field(..., alias="tokenCounts")
    total_tokens: int = Field(..., ge=0, alias="totalTokens")
    cost_usd: float = Field(..., ge=0.0, alias="costUSD")
    models: List[str]
    usage_limit_reset_time: Optional[str] = Field(None, alias="usageLimitResetTime")
    burn_rate: Optional[Any] = Field(None, alias="burnRate")
    projection: Optional[Any] = Field(None, alias="projection")


class ProjectDailyUsage(DailyUsage):
    """Project-specific daily usage (inherits from DailyUsage)"""

    pass


class CCUsageData(BaseModel):
    """Complete ccusage data structure"""

    model_config = ConfigDict(str_strip_whitespace=True)

    daily: Optional[List[DailyUsage]] = None
    monthly: Optional[List[MonthlyUsage]] = None
    sessions: Optional[List[SessionUsage]] = None
    blocks: Optional[List[BlockUsage]] = None
    projects: Optional[Dict[str, List[ProjectDailyUsage]]] = None


class ClickHouseConfig(BaseModel):
    """ClickHouse connection configuration"""

    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True)

    host: str = Field(..., min_length=1)
    port: int = Field(..., ge=1, le=65535)
    username: str = Field(..., min_length=1)
    password: str
    database: str = Field(..., min_length=1)
    secure: bool = False
    timeout: int = Field(default=10, ge=1, le=300)

    @property
    def interface(self) -> str:
        """Get interface type based on secure flag"""
        return "https" if self.secure else "http"


class ImportStatistics(BaseModel):
    """Statistics from an import operation"""

    model_config = ConfigDict(str_strip_whitespace=True)

    table_counts: Dict[str, int]
    usage_summary: Dict[str, Any]
    model_usage: List[Dict[str, Any]]
    session_stats: Dict[str, Any]
    active_blocks: int
    machine_stats: List[Dict[str, Any]]
    import_duration: float = Field(..., ge=0.0)
    records_imported: int = Field(..., ge=0)
