"""Telemetry API routes."""

import logging
import re
from datetime import datetime
from typing import Optional
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.telemetry import (
    TelemetryCurrent,
    TelemetryData,
    TelemetryMetadata,
    TelemetrySource,
    TelemetryStatistics,
    TelemetryStream,
)
from app.models.schemas import (
    ActiveStreamUpdate,
    AnomaliesResponse,
    ChannelSourceItem,
    ChannelSourcesResponse,
    DataPoint,
    ExplainResponse,
    RecentDataPoint,
    RelatedChannel,
    SourceCreate,
    SourceUpdate,
    StatisticsResponse,
    OverviewChannel,
    OverviewResponse,
    RecentDataResponse,
    RecomputeStatsResponse,
    SearchResponse,
    TelemetryDataIngest,
    TelemetryDataResponse,
    TelemetryListResponse,
    TelemetrySchemaCreate,
    TelemetrySchemaResponse,
    WatchlistAddRequest,
    WatchlistResponse,
)
from app.services.embedding_service import SentenceTransformerEmbeddingProvider
from app.services.llm_service import MockLLMProvider, OpenAICompatibleLLMProvider
from app.services.channel_alias_service import get_aliases_by_telemetry_ids, resolve_channel_metadata
from app.services.overview_service import (
    add_to_watchlist,
    get_all_telemetry_channels_for_source,
    get_anomalies,
    get_overview,
    get_watchlist,
    remove_from_watchlist,
)
from app.services.realtime_service import (
    bootstrap_builtin_sources,
    create_source,
    get_telemetry_sources,
    update_source,
)
from app.utils.subsystem import infer_subsystem
from app.services.statistics_service import StatisticsService
from app.services.telemetry_service import TelemetryService, _compute_state
from app.services.source_stream_service import (
    clear_active_stream,
    normalize_source_id,
    ensure_stream_belongs_to_source,
    get_stream_source_id,
    SourceNotFoundError,
    register_stream,
    StreamIdConflictError,
    resolve_active_stream_id,
)
from app.config import get_settings
from app.lib.audit import audit_log

logger = logging.getLogger(__name__)

router = APIRouter()

# Lazy-load providers (embedding model is heavy)
_embedding_provider = None
_llm_provider = None


def _get_channel_meta(db: Session, source_id: str, name: str) -> TelemetryMetadata | None:
    return resolve_channel_metadata(db, source_id=source_id, channel_name=name)


def _resolve_scoped_stream_id(db: Session, source_id: str, stream_id: Optional[str] = None) -> str:
    """Return the active stream id or validate an explicit stream id for a source."""
    if stream_id is None:
        logical_source_id = normalize_source_id(source_id)
        resolved_stream_id = resolve_active_stream_id(db, logical_source_id)
        if resolved_stream_id == logical_source_id:
            latest_stream_id = (
                db.execute(
                    select(TelemetryStream.id)
                    .where(TelemetryStream.source_id == logical_source_id)
                    .order_by(TelemetryStream.last_seen_at.desc(), TelemetryStream.id.desc())
                )
                .scalars()
                .first()
            )
            if isinstance(latest_stream_id, str) and latest_stream_id:
                return latest_stream_id
        return resolved_stream_id
    try:
        return ensure_stream_belongs_to_source(db, source_id, stream_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Stream not found for source")


def _resolve_latest_stream_id_for_channel(db: Session, source_id: str, name: str) -> str:
    """Resolve the latest stream for a source that actually contains the channel."""
    logical_source_id = normalize_source_id(source_id)
    meta = _get_channel_meta(db, logical_source_id, name)
    if not meta:
        raise HTTPException(status_code=404, detail="Telemetry not found")

    current_stream_id = (
        db.execute(
            select(TelemetryCurrent.stream_id)
            .where(TelemetryCurrent.telemetry_id == meta.id)
            .order_by(
                TelemetryCurrent.reception_time.desc(),
                TelemetryCurrent.generation_time.desc(),
            )
        )
        .scalars()
        .first()
    )
    if isinstance(current_stream_id, str) and current_stream_id:
        return current_stream_id

    historical_stream_id = (
        db.execute(
            select(TelemetryData.stream_id)
            .where(TelemetryData.telemetry_id == meta.id)
            .order_by(TelemetryData.timestamp.desc())
        )
        .scalars()
        .first()
    )
    if isinstance(historical_stream_id, str) and historical_stream_id:
        return historical_stream_id

    return _resolve_scoped_stream_id(db, logical_source_id)


def get_embedding_provider() -> SentenceTransformerEmbeddingProvider:
    """Dependency for embedding provider."""
    global _embedding_provider
    if _embedding_provider is None:
        _embedding_provider = SentenceTransformerEmbeddingProvider()
    return _embedding_provider


def get_llm_provider():
    """Dependency for LLM provider (mock if no API key)."""
    global _llm_provider
    if _llm_provider is None:
        settings = get_settings()
        if settings.openai_api_key:
            _llm_provider = OpenAICompatibleLLMProvider()
        else:
            logger.info("No OPENAI_API_KEY configured, using mock LLM provider")
            _llm_provider = MockLLMProvider()
    return _llm_provider


@router.post("/schema", response_model=TelemetrySchemaResponse)
def create_schema(
    body: TelemetrySchemaCreate,
    db: Session = Depends(get_db),
    embedding: SentenceTransformerEmbeddingProvider = Depends(get_embedding_provider),
    llm: object = Depends(get_llm_provider),
):
    """Create telemetry schema with embedding."""
    service = TelemetryService(db, embedding, llm)
    try:
        telemetry_id = service.create_schema(
            source_id=body.source_id,
            name=body.name,
            units=body.units,
            description=body.description,
            subsystem_tag=body.subsystem_tag,
            red_low=body.red_low,
            red_high=body.red_high,
        )
    except IntegrityError:
        raise HTTPException(status_code=409, detail="Telemetry name already exists")
    audit_log(
        "schema.create",
        source_id=body.source_id,
        name=body.name,
        telemetry_id=str(telemetry_id),
    )
    return TelemetrySchemaResponse(
        status="created",
        telemetry_id=telemetry_id,
    )


@router.post("/data", response_model=TelemetryDataResponse)
def ingest_data(
    body: TelemetryDataIngest,
    db: Session = Depends(get_db),
    embedding: SentenceTransformerEmbeddingProvider = Depends(get_embedding_provider),
    llm: object = Depends(get_llm_provider),
):
    """Ingest batch of telemetry data. source_id in body (default: default) scopes data when telemetry_data is source-aware."""
    service = TelemetryService(db, embedding, llm)
    try:
        data = []
        for pt in body.data:
            ts = datetime.fromisoformat(pt.timestamp.replace("Z", "+00:00"))
            data.append((ts, pt.value))
        rows = service.insert_data(
            body.stream_id,
            body.telemetry_name,
            data,
            source_id=body.source_id,
            packet_source=body.packet_source,
            receiver_id=body.receiver_id,
        )
    except StreamIdConflictError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    audit_log(
        "ingest.batch",
        telemetry_name=body.telemetry_name,
        count=rows,
        source_id=body.source_id,
        stream_id=body.stream_id,
    )
    return TelemetryDataResponse(rows_inserted=rows)


@router.post("/recompute-stats", response_model=RecomputeStatsResponse)
def recompute_stats(
    source_id: Optional[str] = None,
    all_sources: bool = False,
    db: Session = Depends(get_db),
):
    """Recompute statistics. source_id= filters to one source; all_sources=true recomputes per source (when source-aware). Default: single source 'default'."""
    stats_service = StatisticsService(db)
    count = stats_service.recompute_all(source_id=source_id, all_sources=all_sources)
    audit_log(
        "stats.recompute",
        source_id=source_id or "default",
        all_sources=all_sources,
        telemetry_processed=count,
    )
    return RecomputeStatsResponse(telemetry_processed=count)


@router.get("/overview", response_model=OverviewResponse)
def overview(
    source_id: str = "default",
    db: Session = Depends(get_db),
):
    """Get overview data for watchlist channels, optionally filtered by source."""
    channels = get_overview(db, source_id=source_id)
    return OverviewResponse(channels=[OverviewChannel(**c) for c in channels])


@router.get("/anomalies", response_model=AnomaliesResponse)
def anomalies(
    source_id: str = "default",
    db: Session = Depends(get_db),
):
    """Get anomalous channels grouped by subsystem, optionally filtered by source."""
    data = get_anomalies(db, source_id=source_id)
    return AnomaliesResponse(**data)


@router.get("/sources")
def list_sources(db: Session = Depends(get_db)):
    """List registered telemetry stream sources."""
    return get_telemetry_sources(db)


@router.post("/sources")
def create_source_route(
    body: SourceCreate,
    db: Session = Depends(get_db),
    embedding: SentenceTransformerEmbeddingProvider = Depends(get_embedding_provider),
):
    """Create a new telemetry source and seed its telemetry catalog."""
    try:
        result = create_source(
            db,
            embedding_provider=embedding,
            source_type=body.source_type,
            name=body.name,
            description=body.description,
            base_url=body.base_url,
            telemetry_definition_path=body.telemetry_definition_path,
        )
        audit_log("sources.create", source_id=result["id"], name=body.name)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/sources/{source_id}")
def update_source_route(
    source_id: str,
    body: SourceUpdate,
    db: Session = Depends(get_db),
    embedding: SentenceTransformerEmbeddingProvider = Depends(get_embedding_provider),
):
    """Update a telemetry source (name, description, base_url for simulators)."""
    updates = body.model_dump(exclude_unset=True)
    try:
        result = update_source(
            db,
            embedding_provider=embedding,
            source_id=source_id,
            name=updates.get("name"),
            description=updates.get("description"),
            base_url=updates.get("base_url"),
            telemetry_definition_path=updates.get("telemetry_definition_path"),
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if result is None:
        raise HTTPException(status_code=404, detail="Source not found")
    audit_log("sources.update", source_id=source_id)
    return result


@router.get("/sources/{source_id}/streams", response_model=ChannelSourcesResponse)
def get_source_streams(
    source_id: str,
    db: Session = Depends(get_db),
):
    """List stream ids for a source (any channel). Newest first."""
    logical_source_id = normalize_source_id(source_id)
    registry_rows = db.execute(
        select(
            TelemetryStream.id,
            TelemetryStream.last_seen_at,
        ).where(TelemetryStream.source_id == logical_source_id)
    ).fetchall()
    history_rows = db.execute(
        select(
            TelemetryData.stream_id,
            func.max(TelemetryData.timestamp).label("last_seen_at"),
        )
        .join(TelemetryMetadata, TelemetryMetadata.id == TelemetryData.telemetry_id)
        .where(TelemetryMetadata.source_id == logical_source_id)
        .group_by(TelemetryData.stream_id)
    ).fetchall()

    stream_seen_at: dict[str, datetime | None] = {}
    for stream_id, seen_at in registry_rows:
        stream_seen_at[stream_id] = seen_at
    for stream_id, seen_at in history_rows:
        prior = stream_seen_at.get(stream_id)
        if prior is None or (seen_at is not None and seen_at > prior):
            stream_seen_at[stream_id] = seen_at

    rows = sorted(
        stream_seen_at.items(),
        key=lambda item: (item[1].timestamp() if item[1] is not None else float("-inf"), item[0]),
        reverse=True,
    )
    return ChannelSourcesResponse(
        sources=[
            ChannelSourceItem(stream_id=stream_id, label=_format_source_label(stream_id))
            for stream_id, _seen_at in rows
        ]
    )


@router.get("/watchlist", response_model=WatchlistResponse)
def list_watchlist(
    source_id: str = "default",
    db: Session = Depends(get_db),
):
    """List watchlist entries."""
    entries = get_watchlist(db, source_id)
    return WatchlistResponse(
        entries=[
            {
                "source_id": e["source_id"],
                "name": e["name"],
                "aliases": e.get("aliases", []),
                "display_order": e["display_order"],
                "channel_origin": e["channel_origin"],
                "discovery_namespace": e["discovery_namespace"],
            }
            for e in entries
        ]
    )


@router.post("/watchlist")
def add_watchlist(
    body: WatchlistAddRequest,
    db: Session = Depends(get_db),
):
    """Add a channel to the watchlist."""
    try:
        add_to_watchlist(db, body.source_id, body.telemetry_name)
        db.flush()
        audit_log(
            "watchlist.add",
            source_id=body.source_id,
            telemetry_name=body.telemetry_name,
        )
        return {"status": "added"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/watchlist/{name}")
def delete_watchlist(
    name: str,
    source_id: str = "default",
    db: Session = Depends(get_db),
):
    """Remove a channel from the watchlist."""
    name = unquote(name)
    remove_from_watchlist(db, source_id, name)
    audit_log("watchlist.remove", source_id=source_id, name=name)
    return {"status": "removed"}


@router.get("/list", response_model=TelemetryListResponse)
def list_telemetry(
    source_id: str = "default",
    db: Session = Depends(get_db),
):
    """List all telemetry names for watchlist config."""
    channels = get_all_telemetry_channels_for_source(db, source_id)
    return TelemetryListResponse(
        names=[channel["name"] for channel in channels],
        channels=channels,
    )


@router.get("/subsystems")
def list_subsystems(
    source_id: str = "default",
    db: Session = Depends(get_db),
):
    """Get distinct subsystem tags for filter dropdown."""
    logical_source_id = normalize_source_id(source_id)
    stmt = (
        select(TelemetryMetadata)
        .where(TelemetryMetadata.source_id == logical_source_id)
        .order_by(TelemetryMetadata.name)
    )
    rows = db.execute(stmt).scalars().all()
    subsystems = set()
    for meta in rows:
        subsystems.add(infer_subsystem(meta.name, meta))
    return {"subsystems": sorted(subsystems)}


@router.get("/units")
def list_units(
    source_id: str = "default",
    db: Session = Depends(get_db),
):
    """Get distinct units for filter dropdown."""
    logical_source_id = normalize_source_id(source_id)
    stmt = (
        select(TelemetryMetadata.units)
        .where(TelemetryMetadata.source_id == logical_source_id)
        .distinct()
        .order_by(TelemetryMetadata.units)
    )
    rows = db.execute(stmt).fetchall()
    return {"units": [r[0] for r in rows]}


@router.get("/search", response_model=SearchResponse)
def search(
    q: str = "",
    subsystem: Optional[str] = None,
    anomalous_only: bool = False,
    units: Optional[str] = None,
    recent_minutes: Optional[int] = None,
    limit: int = 10,
    source_id: str = "default",
    db: Session = Depends(get_db),
    embedding: SentenceTransformerEmbeddingProvider = Depends(get_embedding_provider),
    llm: object = Depends(get_llm_provider),
):
    """Semantic search over telemetry with optional filters. source_id scopes current value/stats."""
    service = TelemetryService(db, embedding, llm)
    results = service.semantic_search(
        q,
        limit=limit,
        subsystem=subsystem,
        anomalous_only=anomalous_only,
        units=units,
        recent_minutes=recent_minutes,
        source_id=source_id,
    )
    audit_log(
        "search",
        q=q,
        subsystem=subsystem,
        anomalous_only=anomalous_only,
        limit=limit,
        source_id=source_id,
        result_count=len(results),
    )
    return SearchResponse(results=results)


def _get_explanation_summary_db_only(db: Session, name: str, source_id: str = "default") -> ExplainResponse:
    """Build explain response using only DB—no embedding/LLM cold start."""
    data_source_id = normalize_source_id(source_id)
    meta = _get_channel_meta(db, source_id, name)
    if not meta:
        raise ValueError(f"Telemetry not found: {name}")

    stats_row = db.get(TelemetryStatistics, (data_source_id, meta.id))
    if not stats_row:
        # Compute stats on-the-fly when missing (e.g. new simulator source)
        stats_service = StatisticsService(db)
        stats_service._recompute_one(meta.id, source_id=data_source_id)
        db.flush()
        stats_row = db.get(TelemetryStatistics, (data_source_id, meta.id))
    if not stats_row:
        raise ValueError(f"Statistics not computed for: {name}")

    rows = _get_recent_values_db_only(db, name, limit=1, source_id=data_source_id)
    recent_value: Optional[float] = float(rows[0][1]) if rows else None
    last_timestamp: Optional[str] = rows[0][0].isoformat() if rows else None

    mean = float(stats_row.mean)
    std_dev = float(stats_row.std_dev)
    z_score: Optional[float] = None
    is_anomalous = False

    if recent_value is not None and std_dev > 0:
        z_score = (recent_value - mean) / std_dev
        is_anomalous = abs(z_score) > 2

    if recent_value is None:
        recent_value = mean

    red_low = float(meta.red_low) if meta.red_low is not None else None
    red_high = float(meta.red_high) if meta.red_high is not None else None
    state, state_reason = _compute_state(recent_value, z_score, red_low, red_high, std_dev)

    return ExplainResponse(
        name=meta.name,
        aliases=get_aliases_by_telemetry_ids(
            db,
            source_id=source_id,
            telemetry_ids=[meta.id],
        ).get(meta.id, []),
        description=meta.description,
        units=meta.units,
        channel_origin=meta.channel_origin or "catalog",
        discovery_namespace=meta.discovery_namespace,
        statistics=StatisticsResponse(
            mean=mean,
            std_dev=std_dev,
            min_value=float(stats_row.min_value),
            max_value=float(stats_row.max_value),
            p5=float(stats_row.p5),
            p50=float(stats_row.p50),
            p95=float(stats_row.p95),
            n_samples=getattr(stats_row, "n_samples", 0),
        ),
        recent_value=recent_value,
        z_score=z_score,
        is_anomalous=is_anomalous,
        state=state,
        state_reason=state_reason,
        last_timestamp=last_timestamp,
        red_low=red_low,
        red_high=red_high,
        what_this_means="",
        what_to_check_next=[],
        confidence_indicator=None,
        llm_explanation="",
    )


@router.get("/{name}/summary", response_model=ExplainResponse)
def get_summary(
    name: str,
    source_id: str = "default",
    db: Session = Depends(get_db),
):
    """Fast summary for initial page load—DB only, no embedding/LLM. source_id filters by stream source."""
    name = unquote(name)
    try:
        return _get_explanation_summary_db_only(db, name, source_id=source_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/sources/{source_id}/channels/{name}/summary", response_model=ExplainResponse)
def get_summary_for_source(
    source_id: str,
    name: str,
    stream_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    name = unquote(name)
    scoped_stream_id = (
        _resolve_scoped_stream_id(db, source_id, stream_id)
        if stream_id is not None
        else _resolve_latest_stream_id_for_channel(db, source_id, name)
    )
    return get_summary(name=name, source_id=scoped_stream_id, db=db)


@router.get("/{name}/explain", response_model=ExplainResponse)
def explain(
    name: str,
    skip_llm: bool = False,
    source_id: str = "default",
    db: Session = Depends(get_db),
    embedding: SentenceTransformerEmbeddingProvider = Depends(get_embedding_provider),
    llm: object = Depends(get_llm_provider),
):
    """Get explanation for a telemetry point. Use skip_llm=1 for fast initial load. source_id filters by stream source."""
    name = unquote(name)
    service = TelemetryService(db, embedding, llm)
    try:
        return service.get_explanation(name, skip_llm=skip_llm, source_id=source_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/sources/{source_id}/channels/{name}/explain", response_model=ExplainResponse)
def explain_for_source(
    source_id: str,
    name: str,
    stream_id: Optional[str] = None,
    skip_llm: bool = False,
    db: Session = Depends(get_db),
    embedding: SentenceTransformerEmbeddingProvider = Depends(get_embedding_provider),
    llm: object = Depends(get_llm_provider),
):
    name = unquote(name)
    scoped_stream_id = (
        _resolve_scoped_stream_id(db, source_id, stream_id)
        if stream_id is not None
        else _resolve_latest_stream_id_for_channel(db, source_id, name)
    )
    return explain(
        name=name,
        skip_llm=skip_llm,
        source_id=scoped_stream_id,
        db=db,
        embedding=embedding,
        llm=llm,
    )


def _format_source_label(source_id: str, registered_name: Optional[str] = None) -> str:
    """Human-readable label for a source or stream id."""
    if registered_name:
        return registered_name

    match = re.search(r"-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z?$", source_id)
    if match:
        date_part, h, m, s = match.groups()
        return f"Stream started at {date_part} {h}:{m} UTC"

    return source_id


@router.get("/{name}/streams", response_model=ChannelSourcesResponse)
def get_channel_streams(
    name: str,
    source_id: str,
    db: Session = Depends(get_db),
):
    """List streams for a source that have data for this channel.

    Works for simulators, vehicles, and any future source type.
    Returns stream ids with labels, newest first.
    """
    name = unquote(name)

    meta = _get_channel_meta(db, source_id, name)
    if not meta:
        raise HTTPException(status_code=404, detail="Telemetry not found")

    logical_source_id = normalize_source_id(source_id)
    rows = db.execute(
        select(
            TelemetryData.stream_id,
            func.max(TelemetryData.timestamp).label("last_seen_at"),
        )
        .join(TelemetryMetadata, TelemetryMetadata.id == TelemetryData.telemetry_id)
        .where(
            TelemetryMetadata.source_id == logical_source_id,
            TelemetryData.telemetry_id == meta.id,
        )
        .group_by(TelemetryData.stream_id)
        .order_by(
            desc(func.max(TelemetryData.timestamp)),
            TelemetryData.stream_id.desc(),
        )
    ).fetchall()
    return ChannelSourcesResponse(
        sources=[
            ChannelSourceItem(stream_id=row[0], label=_format_source_label(row[0]))
            for row in rows
        ]
    )


def _get_recent_values_db_only(
    db: Session,
    name: str,
    limit: int = 100,
    since=None,
    until=None,
    source_id: str = "default",
) -> list[tuple[datetime, float]]:
    """Get recent values using only DB—no embedding/LLM cold start. source_id filters when telemetry_data is source-aware."""
    data_source_id = resolve_active_stream_id(db, source_id)
    meta = _get_channel_meta(db, source_id, name)
    if not meta:
        raise ValueError(f"Telemetry not found: {name}")
    stmt = (
        select(TelemetryData.timestamp, TelemetryData.value)
        .where(
            TelemetryData.telemetry_id == meta.id,
            TelemetryData.stream_id == data_source_id,
        )
        .order_by(desc(TelemetryData.timestamp))
        .limit(limit)
    )
    if since is not None:
        stmt = stmt.where(TelemetryData.timestamp >= since)
    if until is not None:
        stmt = stmt.where(TelemetryData.timestamp <= until)
    rows = db.execute(stmt).fetchall()
    return [(r[0], float(r[1])) for r in rows]


@router.get("/{name}/recent", response_model=RecentDataResponse)
def get_recent(
    name: str,
    limit: int = 100,
    since: Optional[str] = None,
    until: Optional[str] = None,
    source_id: str = "default",
    db: Session = Depends(get_db),
):
    """Get most recent data points for charting. Use since/until (ISO8601) for time-range filter. source_id filters by stream source (default: default)."""
    name = unquote(name)
    since_dt: Optional[datetime] = None
    until_dt: Optional[datetime] = None
    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid since format, use ISO8601")
    if until:
        try:
            until_dt = datetime.fromisoformat(until.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid until format, use ISO8601")
    requested_time_filter = since_dt is not None or until_dt is not None
    try:
        rows = _get_recent_values_db_only(
            db,
            name,
            limit=limit,
            since=since_dt,
            until=until_dt,
            source_id=source_id,
        )
        fallback_to_recent = False
        if not rows and requested_time_filter:
            # Time filter yielded no data but the channel may still have history.
            # Fall back to most recent points and surface that explicitly via metadata.
            rows = _get_recent_values_db_only(db, name, limit=limit, source_id=source_id)
            fallback_to_recent = bool(rows)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    data_points = [
        RecentDataPoint(
            timestamp=r[0].isoformat(),
            value=r[1],
        )
        for r in reversed(rows)
    ]

    effective_since = data_points[0].timestamp if data_points else None
    effective_until = data_points[-1].timestamp if data_points else None

    # applied_time_filter indicates that a user-specified time window returned data
    # without falling back to the unfiltered "most recent" range.
    applied_time_filter = bool(data_points) and requested_time_filter and not fallback_to_recent

    return RecentDataResponse(
        data=data_points,
        requested_since=since if since else None,
        requested_until=until if until else None,
        effective_since=effective_since,
        effective_until=effective_until,
        applied_time_filter=applied_time_filter,
        fallback_to_recent=fallback_to_recent,
    )


@router.get("/sources/{source_id}/channels/{name}/recent", response_model=RecentDataResponse)
def get_recent_for_source(
    source_id: str,
    name: str,
    stream_id: Optional[str] = None,
    limit: int = 100,
    since: Optional[str] = None,
    until: Optional[str] = None,
    db: Session = Depends(get_db),
):
    name = unquote(name)
    scoped_stream_id = (
        _resolve_scoped_stream_id(db, source_id, stream_id)
        if stream_id is not None
        else _resolve_latest_stream_id_for_channel(db, source_id, name)
    )
    return get_recent(
        name=name,
        limit=limit,
        since=since,
        until=until,
        source_id=scoped_stream_id,
        db=db,
    )


@router.get("/sources/{source_id}/channels/{name}/streams", response_model=ChannelSourcesResponse)
def get_channel_streams_for_source(
    source_id: str,
    name: str,
    db: Session = Depends(get_db),
):
    name = unquote(name)
    return get_channel_streams(name=name, source_id=source_id, db=db)


@router.post("/sources/active-stream")
def set_active_stream(
    body: ActiveStreamUpdate,
    db: Session = Depends(get_db),
):
    """Set or clear the active stream for any logical source.

    External adapters (e.g. SatNOGS/FUNcube-1) use this to mark AOS/LOS
    without needing simulator-specific /status polling.
    """
    logical_source_id = normalize_source_id(body.source_id)

    if body.state == "active":
        if not body.stream_id:
            raise HTTPException(status_code=400, detail="stream_id is required when state=active")
        existing_owner = get_stream_source_id(db, body.stream_id)
        if existing_owner is not None and normalize_source_id(existing_owner) != logical_source_id:
            raise HTTPException(status_code=404, detail="stream_id does not belong to source")
        try:
            register_stream(db, source_id=logical_source_id, stream_id=body.stream_id)
        except StreamIdConflictError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except SourceNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        audit_log(
            "sources.active_stream.set",
            source_id=logical_source_id,
            stream_id=body.stream_id,
            state="active",
        )
        return {
            "status": "active",
            "source_id": logical_source_id,
            "stream_id": body.stream_id,
        }

    if body.state == "idle":
        clear_active_stream(logical_source_id, db=db)
        audit_log(
            "sources.active_stream.set",
            source_id=logical_source_id,
            state="idle",
        )
        return {
            "status": "idle",
            "source_id": logical_source_id,
        }

    raise HTTPException(status_code=400, detail="state must be 'active' or 'idle'")
