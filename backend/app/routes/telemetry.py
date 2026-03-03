"""Telemetry API routes."""

import logging
from datetime import datetime
from typing import Optional
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.telemetry import TelemetryData, TelemetryMetadata, TelemetryStatistics
from app.models.schemas import (
    AnomaliesResponse,
    DataPoint,
    ExplainResponse,
    RecentDataPoint,
    RelatedChannel,
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
from app.services.realtime_service import get_telemetry_sources
from app.utils.subsystem import infer_subsystem
from app.services.statistics_service import StatisticsService
from app.services.telemetry_service import TelemetryService, _compute_state
from app.config import get_settings

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
    """Ingest batch of telemetry data."""
    service = TelemetryService(db, embedding, llm)
    try:
        data = []
        for pt in body.data:
            ts = datetime.fromisoformat(pt.timestamp.replace("Z", "+00:00"))
            data.append((ts, pt.value))
        rows = service.insert_data(body.telemetry_name, data)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return TelemetryDataResponse(rows_inserted=rows)


@router.post("/recompute-stats", response_model=RecomputeStatsResponse)
def recompute_stats(db: Session = Depends(get_db)):
    """Recompute statistics for all telemetry points."""
    stats_service = StatisticsService(db)
    count = stats_service.recompute_all()
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
    db: Session = Depends(get_db),
    embedding: SentenceTransformerEmbeddingProvider = Depends(get_embedding_provider),
    llm: object = Depends(get_llm_provider),
):
    """Semantic search over telemetry with optional filters."""
    service = TelemetryService(db, embedding, llm)
    results = service.semantic_search(
        q,
        limit=limit,
        subsystem=subsystem,
        anomalous_only=anomalous_only,
        units=units,
        recent_minutes=recent_minutes,
    )
    return SearchResponse(results=results)


def _get_explanation_summary_db_only(db: Session, name: str) -> ExplainResponse:
    """Build explain response using only DB—no embedding/LLM cold start."""
    meta = db.execute(select(TelemetryMetadata).where(TelemetryMetadata.name == name)).scalars().first()
    if not meta:
        raise ValueError(f"Telemetry not found: {name}")

    stats_row = db.get(TelemetryStatistics, meta.id)
    if not stats_row:
        raise ValueError(f"Statistics not computed for: {name}")

    rows = _get_recent_values_db_only(db, name, limit=1)
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
    db: Session = Depends(get_db),
):
    """Fast summary for initial page load—DB only, no embedding/LLM."""
    name = unquote(name)
    try:
        return _get_explanation_summary_db_only(db, name)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{name}/explain", response_model=ExplainResponse)
def explain(
    name: str,
    skip_llm: bool = False,
    db: Session = Depends(get_db),
    embedding: SentenceTransformerEmbeddingProvider = Depends(get_embedding_provider),
    llm: object = Depends(get_llm_provider),
):
    """Get explanation for a telemetry point. Use skip_llm=1 for fast initial load."""
    name = unquote(name)
    service = TelemetryService(db, embedding, llm)
    try:
        return service.get_explanation(name, skip_llm=skip_llm)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


def _get_recent_values_db_only(
    db: Session, name: str, limit: int = 100, since=None, until=None
) -> list[tuple[datetime, float]]:
    """Get recent values using only DB—no embedding/LLM cold start."""
    meta = db.execute(select(TelemetryMetadata).where(TelemetryMetadata.name == name)).scalars().first()
    if not meta:
        raise ValueError(f"Telemetry not found: {name}")
    stmt = (
        select(TelemetryData.timestamp, TelemetryData.value)
        .where(TelemetryData.telemetry_id == meta.id)
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
    db: Session = Depends(get_db),
):
    """Get most recent data points for charting. Use since/until (ISO8601) for time-range filter."""
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
    try:
        rows = _get_recent_values_db_only(db, name, limit=limit, since=since_dt, until=until_dt)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return RecentDataResponse(
        data=[
            RecentDataPoint(
                timestamp=r[0].isoformat(),
                value=r[1],
            )
            for r in reversed(rows)
        ]
    )
