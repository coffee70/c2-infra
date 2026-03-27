"""Pydantic request/response schemas."""

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator


class ChannelListItem(BaseModel):
    """Single telemetry channel entry for source-scoped pickers."""

    name: str
    aliases: list[str] = []
    channel_origin: str = "catalog"
    discovery_namespace: Optional[str] = None


# --- Schema ingestion ---
class TelemetrySchemaCreate(BaseModel):
    """Request body for POST /telemetry/schema."""

    source_id: str = "default"
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
    source_id: str = "default"  # backward compatible; used when telemetry_data is source-aware


class TelemetryDataResponse(BaseModel):
    """Response for POST /telemetry/data."""

    rows_inserted: int


# --- Search ---
class SearchResult(BaseModel):
    """Single search result."""

    name: str
    aliases: list[str] = []
    match_confidence: float
    description: Optional[str] = None
    subsystem_tag: Optional[str] = None
    units: str = ""
    channel_origin: str = "catalog"
    discovery_namespace: Optional[str] = None
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
    aliases: list[str] = []
    description: Optional[str] = None
    units: Optional[str] = None
    channel_origin: str = "catalog"
    discovery_namespace: Optional[str] = None
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
    requested_since: Optional[str] = None
    requested_until: Optional[str] = None
    effective_since: Optional[str] = None
    effective_until: Optional[str] = None
    applied_time_filter: bool = False
    fallback_to_recent: bool = False


class ChannelSourceItem(BaseModel):
    """Source that has data for a channel; label is display-friendly (e.g. 'Run started at 2026-03-11 19:03 UTC')."""

    source_id: str
    label: str


class ChannelSourcesResponse(BaseModel):
    """Response for channel run/source listing endpoints."""

    sources: list[ChannelSourceItem]


# --- Recompute stats ---
class RecomputeStatsResponse(BaseModel):
    """Response for POST /telemetry/recompute-stats."""

    telemetry_processed: int


# --- Overview ---
class OverviewChannel(BaseModel):
    """Single channel in overview response."""

    name: str
    aliases: list[str] = []
    units: Optional[str] = None
    description: Optional[str] = None
    subsystem_tag: str
    channel_origin: str = "catalog"
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

    source_id: str
    name: str
    aliases: list[str] = []
    display_order: int
    channel_origin: str = "catalog"
    discovery_namespace: Optional[str] = None


class WatchlistResponse(BaseModel):
    """Response for GET /telemetry/watchlist."""

    entries: list[WatchlistEntrySchema]


class WatchlistAddRequest(BaseModel):
    """Request body for POST /telemetry/watchlist."""

    source_id: str
    telemetry_name: str


class TelemetryListResponse(BaseModel):
    """Response for GET /telemetry/list."""

    names: list[str]
    channels: list[ChannelListItem] = []


# --- Realtime: canonical measurement event (ingest) ---
class MeasurementEvent(BaseModel):
    """Canonical internal measurement event from realtime ingest."""

    source_id: str = "default"
    channel_name: Optional[str] = None
    generation_time: Optional[str] = None  # RFC3339; may be synthesized from reception_time
    reception_time: Optional[str] = None  # RFC3339; server assigns if omitted
    value: float
    quality: str = "valid"  # valid | suspect | invalid
    sequence: Optional[int] = None
    tags: Optional[dict[str, Any]] = None

    @model_validator(mode="after")
    def validate_channel_identifier(self) -> "MeasurementEvent":
        channel_name = (self.channel_name or "").strip()
        tags = self.tags or {}

        dynamic_channel_name = tags.get("dynamic_channel_name")
        field_name = tags.get("field_name") or tags.get("field") or tags.get("key")
        decoder = tags.get("decoder") or tags.get("decoder_name") or tags.get("parser")
        namespace = tags.get("namespace")

        has_dynamic_name = isinstance(dynamic_channel_name, str) and dynamic_channel_name.strip() != ""
        has_field_name = isinstance(field_name, str) and field_name.strip() != ""
        has_decoder = isinstance(decoder, str) and decoder.strip() != ""
        has_namespace = isinstance(namespace, str) and namespace.strip() != ""

        if not self.generation_time and not self.reception_time:
            raise ValueError("measurement event requires generation_time or reception_time")

        if channel_name or has_dynamic_name or (has_field_name and (has_decoder or has_namespace)):
            return self

        raise ValueError("measurement event requires channel_name or dynamic channel tags")


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
    channel_origin: str = "catalog"
    discovery_namespace: Optional[str] = None
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


# --- Ops events (timeline) ---
class OpsEventSchema(BaseModel):
    """Single ops event for timeline API."""

    id: str
    source_id: str
    event_time: str
    event_type: str
    severity: str
    summary: str
    entity_type: str
    entity_id: Optional[str] = None
    payload: Optional[dict] = None
    created_at: str


class OpsEventsResponse(BaseModel):
    """Response for GET /ops/events."""

    events: list[OpsEventSchema]
    total: int


class WsFeedStatus(BaseModel):
    """Feed health status (best-effort in dev/demo)."""

    type: str = "feed_status"
    source_id: str
    connected: bool
    state: str = "disconnected"  # connected | degraded | disconnected
    last_reception_time: Optional[str] = None
    approx_rate_hz: Optional[float] = None
    drop_count: Optional[int] = None


class WsOrbitStatus(BaseModel):
    """Orbit validation status update (real-time push)."""

    type: str = "orbit_status"
    source_id: str
    status: str
    reason: str = ""
    orbit_type: Optional[str] = None
    perigee_km: Optional[float] = None
    apogee_km: Optional[float] = None
    eccentricity: Optional[float] = None
    velocity_kms: Optional[float] = None
    period_sec: Optional[float] = None


# --- Sources (constellation) ---
class SourceCreate(BaseModel):
    """Request body for POST /telemetry/sources."""

    source_type: str = Field(..., description="vehicle | simulator")
    name: str
    description: Optional[str] = None
    base_url: Optional[str] = None  # required for simulator
    telemetry_definition_path: str


class SourceUpdate(BaseModel):
    """Request body for PATCH /telemetry/sources/{id}."""

    name: Optional[str] = None
    description: Optional[str] = None
    base_url: Optional[str] = None  # for simulators
    telemetry_definition_path: Optional[str] = None


# --- Position mapping and samples ---
class PositionChannelMappingSchema(BaseModel):
    """Per-source mapping from telemetry channels to position vectors."""

    model_config = {"from_attributes": True}

    id: str
    source_id: str
    frame_type: str  # gps_lla | ecef | eci

    @field_validator("id", mode="before")
    @classmethod
    def coerce_id_to_str(cls, v: Any) -> str:
        if v is None:
            return ""
        if isinstance(v, UUID):
            return str(v)
        return v
    lat_channel_name: Optional[str] = None
    lon_channel_name: Optional[str] = None
    alt_channel_name: Optional[str] = None
    x_channel_name: Optional[str] = None
    y_channel_name: Optional[str] = None
    z_channel_name: Optional[str] = None
    active: bool = True


class PositionChannelMappingUpsert(BaseModel):
    """Create or update a position mapping for a source."""

    source_id: str
    frame_type: str  # gps_lla | ecef | eci
    lat_channel_name: Optional[str] = None
    lon_channel_name: Optional[str] = None
    alt_channel_name: Optional[str] = None
    x_channel_name: Optional[str] = None
    y_channel_name: Optional[str] = None
    z_channel_name: Optional[str] = None
    active: bool = True


class PositionSample(BaseModel):
    """Canonical geodetic position sample for Earth view."""

    source_id: str
    source_name: str
    source_type: str
    lat_deg: Optional[float] = None
    lon_deg: Optional[float] = None
    alt_m: Optional[float] = None
    timestamp: Optional[str] = None
    valid: bool = False
    frame_type: str
    raw_channels: Optional[dict[str, Optional[float]]] = None

class ActiveRunUpdate(BaseModel):
    source_id: str
    run_id: Optional[str] = None
    state: str  # "active" | "idle"
