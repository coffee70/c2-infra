"""Pydantic request/response schemas."""

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# --- Schema ingestion ---
class TelemetrySchemaCreate(BaseModel):
    """Request body for POST /telemetry/schema."""

    name: str
    units: str
    description: Optional[str] = None
    subsystem_tag: Optional[str] = None
    red_low: Optional[float] = None
    red_high: Optional[float] = None


class TelemetrySchemaResponse(BaseModel):
    """Response for POST /telemetry/schema."""

    status: str = "created"
    telemetry_id: UUID


# --- Data ingestion ---
class DataPoint(BaseModel):
    """Single telemetry data point."""

    timestamp: str
    value: float


class TelemetryDataIngest(BaseModel):
    """Request body for POST /telemetry/data."""

    telemetry_name: str
    data: list[DataPoint]


class TelemetryDataResponse(BaseModel):
    """Response for POST /telemetry/data."""

    rows_inserted: int


# --- Search ---
class SearchResult(BaseModel):
    """Single search result."""

    name: str
    match_confidence: float
    description: Optional[str] = None
    subsystem_tag: Optional[str] = None
    units: str = ""
    current_value: Optional[float] = None
    current_status: Optional[str] = None  # normal, caution, warning
    last_timestamp: Optional[str] = None


class SearchResponse(BaseModel):
    """Response for GET /telemetry/search."""

    results: list[SearchResult]


# --- Explain ---
class StatisticsResponse(BaseModel):
    """Statistics for explain response."""

    mean: float
    std_dev: float
    min_value: float
    max_value: float
    p5: float
    p50: float
    p95: float
    n_samples: int


class RelatedChannel(BaseModel):
    """Channel linked by subsystem/physics for 'What to check next'."""

    name: str
    subsystem_tag: str
    link_reason: str  # e.g. "same subsystem", "same units"
    current_value: Optional[float] = None
    current_status: Optional[str] = None  # normal, caution, warning
    last_timestamp: Optional[str] = None
    units: Optional[str] = None


class ExplainResponse(BaseModel):
    """Response for GET /telemetry/{name}/explain."""

    name: str
    description: Optional[str] = None
    units: Optional[str] = None
    statistics: StatisticsResponse
    recent_value: float
    z_score: Optional[float] = None
    is_anomalous: bool
    state: str  # normal, caution, warning
    state_reason: Optional[str] = None  # out_of_limits, out_of_family
    last_timestamp: Optional[str] = None
    red_low: Optional[float] = None
    red_high: Optional[float] = None
    what_this_means: str
    what_to_check_next: list[RelatedChannel] = []
    confidence_indicator: Optional[str] = None
    llm_explanation: str


# --- Recent data ---
class RecentDataPoint(BaseModel):
    """Single point for recent data endpoint."""

    timestamp: str
    value: float


class RecentDataResponse(BaseModel):
    """Response for GET /telemetry/{name}/recent."""

    data: list[RecentDataPoint]


# --- Recompute stats ---
class RecomputeStatsResponse(BaseModel):
    """Response for POST /telemetry/recompute-stats."""

    telemetry_processed: int


# --- Overview ---
class OverviewChannel(BaseModel):
    """Single channel in overview response."""

    name: str
    units: Optional[str] = None
    description: Optional[str] = None
    subsystem_tag: str
    current_value: float
    last_timestamp: str
    state: str
    state_reason: Optional[str] = None
    z_score: Optional[float] = None
    sparkline_data: list[RecentDataPoint]


class OverviewResponse(BaseModel):
    """Response for GET /telemetry/overview."""

    channels: list[OverviewChannel]


# --- Anomalies ---
class AnomalyEntry(BaseModel):
    """Single anomaly entry."""

    name: str
    units: Optional[str] = None
    current_value: float
    last_timestamp: str
    z_score: Optional[float] = None
    state_reason: Optional[str] = None


class AnomaliesResponse(BaseModel):
    """Response for GET /telemetry/anomalies. Grouped by subsystem."""

    model_config = {"extra": "allow"}

    power: list[AnomalyEntry] = []
    thermal: list[AnomalyEntry] = []
    adcs: list[AnomalyEntry] = []
    comms: list[AnomalyEntry] = []
    other: list[AnomalyEntry] = []


# --- Watchlist ---
class WatchlistEntrySchema(BaseModel):
    """Single watchlist entry."""

    name: str
    display_order: int


class WatchlistResponse(BaseModel):
    """Response for GET /telemetry/watchlist."""

    entries: list[WatchlistEntrySchema]


class WatchlistAddRequest(BaseModel):
    """Request body for POST /telemetry/watchlist."""

    telemetry_name: str


class TelemetryListResponse(BaseModel):
    """Response for GET /telemetry/list."""

    names: list[str]
