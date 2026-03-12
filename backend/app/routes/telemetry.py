"""Telemetry API routes."""

import logging
import re
from datetime import datetime
from typing import Optional
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.telemetry import TelemetryData, TelemetryMetadata, TelemetrySource, TelemetryStatistics
from app.models.schemas import (
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
from app.services.overview_service import (
    add_to_watchlist,
    get_all_telemetry_names,
    get_anomalies,
    get_overview,
    get_watchlist,
    remove_from_watchlist,
)
from app.services.realtime_service import (
    create_source,
    get_telemetry_sources,
    update_source,
)
from app.utils.subsystem import infer_subsystem
from app.services.statistics_service import StatisticsService
from app.services.telemetry_service import TelemetryService, _compute_state
from app.config import get_settings
from app.lib.audit import audit_log

logger = logging.getLogger(__name__)

router = APIRouter()

# Lazy-load providers (embedding model is heavy)
_embedding_provider = None
_llm_provider = None


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
            name=body.name,
            units=body.units,
            description=body.description,
            subsystem_tag=body.subsystem_tag,
            red_low=body.red_low,
            red_high=body.red_high,
        )
    except IntegrityError:
        raise HTTPException(status_code=409, detail="Telemetry name already exists")
    audit_log("schema.create", name=body.name, telemetry_id=str(telemetry_id))
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
        rows = service.insert_data(body.telemetry_name, data, source_id=body.source_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    audit_log(
        "ingest.batch",
        telemetry_name=body.telemetry_name,
        count=rows,
        source_id=body.source_id,
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
):
    """Create a new telemetry source (simulator only for now)."""
    if body.source_type != "simulator":
        raise HTTPException(
            status_code=400,
            detail="Only simulator sources can be created via this endpoint",
        )
    try:
        result = create_source(
            db,
            source_type=body.source_type,
            name=body.name,
            description=body.description,
            base_url=body.base_url,
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
):
    """Update a telemetry source (name, description, base_url for simulators)."""
    updates = body.model_dump(exclude_unset=True)
    result = update_source(
        db,
        source_id=source_id,
        name=updates.get("name"),
        description=updates.get("description"),
        base_url=updates.get("base_url"),
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Source not found")
    audit_log("sources.update", source_id=source_id)
    return result


@router.get("/sources/{source_id}/runs", response_model=ChannelSourcesResponse)
def get_source_runs(
    source_id: str,
    db: Session = Depends(get_db),
):
    """List run ids for a source (any channel). Used e.g. by Overview to resolve current run. Newest first."""
    reg = db.execute(select(TelemetrySource).where(TelemetrySource.id == source_id)).scalars().first()
    source_type = reg.source_type if reg else None
    if source_type == "vehicle" or (reg is None and source_id == "default"):
        return ChannelSourcesResponse(sources=[ChannelSourceItem(source_id=source_id, label=reg.name if reg else source_id)])
    prefix = f"{source_id}-"
    stmt = (
        select(TelemetryData.source_id)
        .where(
            or_(
                TelemetryData.source_id == source_id,
                TelemetryData.source_id.like(f"{prefix}%"),
            )
        )
        .distinct()
    )
    rows = db.execute(stmt).fetchall()
    run_ids = [r[0] for r in rows]
    reg_rows = db.execute(select(TelemetrySource.id, TelemetrySource.name)).fetchall()
    registered = {r[0]: r[1] for r in reg_rows}
    items = []
    for rid in run_ids:
        if rid == source_id:
            label = "Current run"
        else:
            label = _format_source_label(rid, registered.get(rid))
        items.append(ChannelSourceItem(source_id=rid, label=label))
    items.sort(key=lambda x: x.source_id, reverse=True)
    return ChannelSourcesResponse(sources=items)


@router.get("/watchlist", response_model=WatchlistResponse)
def list_watchlist(db: Session = Depends(get_db)):
    """List watchlist entries."""
    entries = get_watchlist(db)
    return WatchlistResponse(
        entries=[{"name": e["name"], "display_order": e["display_order"]} for e in entries]
    )


@router.post("/watchlist")
def add_watchlist(
    body: WatchlistAddRequest,
    db: Session = Depends(get_db),
):
    """Add a channel to the watchlist."""
    try:
        add_to_watchlist(db, body.telemetry_name)
        audit_log("watchlist.add", telemetry_name=body.telemetry_name)
        return {"status": "added"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/watchlist/{name}")
def delete_watchlist(
    name: str,
    db: Session = Depends(get_db),
):
    """Remove a channel from the watchlist."""
    name = unquote(name)
    remove_from_watchlist(db, name)
    audit_log("watchlist.remove", name=name)
    return {"status": "removed"}


@router.get("/list", response_model=TelemetryListResponse)
def list_telemetry(db: Session = Depends(get_db)):
    """List all telemetry names for watchlist config."""
    names = get_all_telemetry_names(db)
    return TelemetryListResponse(names=names)


@router.get("/subsystems")
def list_subsystems(db: Session = Depends(get_db)):
    """Get distinct subsystem tags for filter dropdown."""
    stmt = select(TelemetryMetadata).order_by(TelemetryMetadata.name)
    rows = db.execute(stmt).scalars().all()
    subsystems = set()
    for meta in rows:
        subsystems.add(infer_subsystem(meta.name, meta))
    return {"subsystems": sorted(subsystems)}


@router.get("/units")
def list_units(db: Session = Depends(get_db)):
    """Get distinct units for filter dropdown."""
    stmt = select(TelemetryMetadata.units).distinct().order_by(TelemetryMetadata.units)
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
    meta = db.execute(select(TelemetryMetadata).where(TelemetryMetadata.name == name)).scalars().first()
    if not meta:
        raise ValueError(f"Telemetry not found: {name}")

    stats_row = db.get(TelemetryStatistics, (source_id, meta.id))
    if not stats_row:
        # Compute stats on-the-fly when missing (e.g. new simulator source)
        stats_service = StatisticsService(db)
        stats_service._recompute_one(meta.id, source_id=source_id)
        db.flush()
        stats_row = db.get(TelemetryStatistics, (source_id, meta.id))
    if not stats_row:
        raise ValueError(f"Statistics not computed for: {name}")

    rows = _get_recent_values_db_only(db, name, limit=1, source_id=source_id)
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
        description=meta.description,
        units=meta.units,
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


def _format_source_label(source_id: str, registered_name: Optional[str] = None) -> str:
    """Human-readable label for a source. Simulator runs: 'Run started at YYYY-MM-DD HH:MM UTC'."""
    if registered_name:
        return registered_name
    # Run id format: simulator-{scenario}-{ts} or {source_id}-{ts} (e.g. sim_abc12345-2026-03-11T19-03-00Z)
    match = re.search(r"-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z?$", source_id)
    if match:
        date_part, h, m, s = match.groups()
        return f"Run started at {date_part} {h}:{m} UTC"
    return source_id


@router.get("/{name}/runs", response_model=ChannelSourcesResponse)
def get_channel_runs(
    name: str,
    source_id: str,
    db: Session = Depends(get_db),
):
    """List runs for a source that have data for this channel. source_id is from telemetry_sources (vehicle or simulator). Returns run ids with labels (e.g. 'Run started at 2026-03-11 19:03 UTC'). Newest first."""
    name = unquote(name)
    meta = db.execute(select(TelemetryMetadata).where(TelemetryMetadata.name == name)).scalars().first()
    if not meta:
        raise HTTPException(status_code=404, detail="Telemetry not found")
    reg = db.execute(select(TelemetrySource).where(TelemetrySource.id == source_id)).scalars().first()
    source_type = reg.source_type if reg else None
    if source_type == "vehicle" or (reg is None and source_id == "default"):
        # Single "run" = the source id itself; include only if channel has data.
        stmt = (
            select(TelemetryData.source_id)
            .where(
                TelemetryData.telemetry_id == meta.id,
                TelemetryData.source_id == source_id,
            )
            .limit(1)
        )
        if db.execute(stmt).first():
            label = reg.name if reg else source_id
            return ChannelSourcesResponse(sources=[ChannelSourceItem(source_id=source_id, label=label)])
        return ChannelSourcesResponse(sources=[])
    # Simulator or unknown: runs are source_id or source_id-*
    prefix = f"{source_id}-"
    stmt = (
        select(TelemetryData.source_id)
        .where(
            TelemetryData.telemetry_id == meta.id,
            or_(
                TelemetryData.source_id == source_id,
                TelemetryData.source_id.like(f"{prefix}%"),
            ),
        )
        .distinct()
    )
    rows = db.execute(stmt).fetchall()
    run_ids = [r[0] for r in rows]
    registered = {r[0]: r[1] for r in db.execute(select(TelemetrySource.id, TelemetrySource.name)).fetchall()}
    items = []
    for rid in run_ids:
        # Use run-style label: when run id equals source id (e.g. legacy "simulator"), show "Current run" not the source name.
        if rid == source_id:
            label = "Current run"
        else:
            label = _format_source_label(rid, registered.get(rid))
        items.append(ChannelSourceItem(source_id=rid, label=label))
    # Newest first: run ids ending with timestamp sort desc
    items.sort(key=lambda x: x.source_id, reverse=True)
    return ChannelSourcesResponse(sources=items)


@router.get("/{name}/sources", response_model=ChannelSourcesResponse)
def get_channel_sources(
    name: str,
    db: Session = Depends(get_db),
):
    """List source_ids that have data for this channel, with display labels (e.g. 'Run started at 2026-03-11 19:03 UTC' for simulator runs)."""
    name = unquote(name)
    meta = db.execute(select(TelemetryMetadata).where(TelemetryMetadata.name == name)).scalars().first()
    if not meta:
        raise HTTPException(status_code=404, detail="Telemetry not found")
    stmt = (
        select(TelemetryData.source_id)
        .where(TelemetryData.telemetry_id == meta.id)
        .distinct()
    )
    rows = db.execute(stmt).fetchall()
    source_ids = [r[0] for r in rows]
    reg_rows = db.execute(select(TelemetrySource.id, TelemetrySource.name)).fetchall()
    registered = {r[0]: r[1] for r in reg_rows}
    items = [
        ChannelSourceItem(
            source_id=sid,
            label=_format_source_label(sid, registered.get(sid)),
        )
        for sid in source_ids
    ]
    # Only treat as simulator run if id contains the run timestamp pattern (avoids misclassifying
    # registered sources with hyphens or plain "simulator-*" without a run suffix).
    sim_runs = [x for x in items if re.search(r"\d{4}-\d{2}-\d{2}T", x.source_id)]
    other = [x for x in items if x not in sim_runs]
    sim_runs.sort(key=lambda x: x.source_id, reverse=True)
    other.sort(key=lambda x: x.label)
    return ChannelSourcesResponse(sources=sim_runs + other)


def _get_recent_values_db_only(
    db: Session,
    name: str,
    limit: int = 100,
    since=None,
    until=None,
    source_id: str = "default",
) -> list[tuple[datetime, float]]:
    """Get recent values using only DB—no embedding/LLM cold start. source_id filters when telemetry_data is source-aware."""
    meta = db.execute(select(TelemetryMetadata).where(TelemetryMetadata.name == name)).scalars().first()
    if not meta:
        raise ValueError(f"Telemetry not found: {name}")
    stmt = (
        select(TelemetryData.timestamp, TelemetryData.value)
        .where(
            TelemetryData.telemetry_id == meta.id,
            TelemetryData.source_id == source_id,
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
