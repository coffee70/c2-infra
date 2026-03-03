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


# --- Realtime: canonical measurement event (ingest) ---
class MeasurementEvent(BaseModel):
    """Canonical internal measurement event from realtime ingest."""

    source_id: str = "default"
    channel_name: str
    generation_time: str  # RFC3339
    reception_time: Optional[str] = None  # RFC3339; server assigns if omitted
    value: float
    quality: str = "valid"  # valid | suspect | invalid
    sequence: Optional[int] = None
    tags: Optional[dict[str, Any]] = None


class MeasurementEventBatch(BaseModel):
    """Batch of measurement events for POST /telemetry/realtime/ingest."""

    events: list[MeasurementEvent]


# --- Realtime: telemetry update (to UI) ---
class RealtimeChannelUpdate(BaseModel):
    """Single channel update pushed to WebSocket clients."""

    source_id: str = "default"
    name: str
    units: Optional[str] = None
    description: Optional[str] = None
    subsystem_tag: str
    current_value: float
    generation_time: str
    reception_time: str
    state: str  # normal, caution, warning
    state_reason: Optional[str] = None
    z_score: Optional[float] = None
    quality: str = "valid"
    sparkline_data: list[RecentDataPoint] = []


# --- Realtime: alert lifecycle ---
class TelemetryAlertSchema(BaseModel):
    """Alert as sent over WebSocket and stored."""

    id: str
    source_id: str = "default"
    channel_name: str
    telemetry_id: str
    subsystem: str
    units: Optional[str] = None
    severity: str  # caution, warning
    reason: Optional[str] = None  # out_of_limits, out_of_family
    status: str  # new, acked, resolved
    opened_at: str
    opened_reception_at: str
    last_update_at: str
    current_value: float
    red_low: Optional[float] = None
    red_high: Optional[float] = None
    z_score: Optional[float] = None
    acked_at: Optional[str] = None
    acked_by: Optional[str] = None
    cleared_at: Optional[str] = None
    resolved_at: Optional[str] = None
    resolved_by: Optional[str] = None
    resolution_text: Optional[str] = None
    resolution_code: Optional[str] = None


class AlertEventMessage(BaseModel):
    """Server -> client: alert lifecycle event."""

    type: str  # opened, updated, cleared, acked, resolved
    alert: TelemetryAlertSchema


# --- Realtime: WebSocket client -> server messages ---
class WsHello(BaseModel):
    """Client hello."""

    type: str = "hello"
    client_version: Optional[str] = None
    requested_features: Optional[list[str]] = None


class WsSubscribeWatchlist(BaseModel):
    """Subscribe to watchlist channels."""

    type: str = "subscribe_watchlist"
    channels: list[str]


class WsSubscribeChannel(BaseModel):
    """Subscribe to single channel for detail view."""

    type: str = "subscribe_channel"
    name: str
    window_points: Optional[int] = 100


class WsSubscribeAlerts(BaseModel):
    """Subscribe to alert stream."""

    type: str = "subscribe_alerts"
    subsystems: Optional[list[str]] = None
    severities: Optional[list[str]] = None


class WsAckAlert(BaseModel):
    """Ack an alert."""

    type: str = "ack_alert"
    alert_id: str


class WsResolveAlert(BaseModel):
    """Resolve an alert with optional resolution text."""

    type: str = "resolve_alert"
    alert_id: str
    resolution_text: str = ""
    resolution_code: Optional[str] = None


# --- Realtime: WebSocket server -> client messages ---
class WsSnapshotWatchlist(BaseModel):
    """Initial snapshot of watchlist channels."""

    type: str = "snapshot_watchlist"
    channels: list[RealtimeChannelUpdate]


class WsTelemetryUpdate(BaseModel):
    """Incremental telemetry update."""

    type: str = "telemetry_update"
    channel: RealtimeChannelUpdate


class WsSnapshotAlerts(BaseModel):
    """Initial snapshot of active alerts."""

    type: str = "snapshot_alerts"
    active: list[TelemetryAlertSchema]


class WsAlertEvent(BaseModel):
    """Alert lifecycle event."""

    type: str = "alert_event"
    event_type: str  # opened, updated, cleared, acked, resolved
    alert: TelemetryAlertSchema


class WsFeedStatus(BaseModel):
    """Feed health status (best-effort in dev/demo)."""

    type: str = "feed_status"
    source_id: str
    connected: bool
    last_reception_time: Optional[str] = None
    approx_rate_hz: Optional[float] = None
    drop_count: Optional[int] = None
