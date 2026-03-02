"""Telemetry API routes."""

import logging
from datetime import datetime
from typing import Optional
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.telemetry import TelemetryMetadata
from app.models.schemas import (
    AnomaliesResponse,
    DataPoint,
    ExplainResponse,
    OverviewChannel,
    OverviewResponse,
    RecentDataPoint,
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
from app.utils.subsystem import infer_subsystem
from app.services.statistics_service import StatisticsService
from app.services.telemetry_service import TelemetryService
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
def overview(db: Session = Depends(get_db)):
    """Get overview data for watchlist channels."""
    channels = get_overview(db)
    return OverviewResponse(channels=[OverviewChannel(**c) for c in channels])


@router.get("/anomalies", response_model=AnomaliesResponse)
def anomalies(db: Session = Depends(get_db)):
    """Get all anomalous channels grouped by subsystem."""
    data = get_anomalies(db)
    return AnomaliesResponse(**data)


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


@router.get("/{name}/explain", response_model=ExplainResponse)
def explain(
    name: str,
    db: Session = Depends(get_db),
    embedding: SentenceTransformerEmbeddingProvider = Depends(get_embedding_provider),
    llm: object = Depends(get_llm_provider),
):
    """Get explanation for a telemetry point."""
    name = unquote(name)
    service = TelemetryService(db, embedding, llm)
    try:
        return service.get_explanation(name)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{name}/recent", response_model=RecentDataResponse)
def get_recent(
    name: str,
    limit: int = 100,
    since: Optional[str] = None,
    until: Optional[str] = None,
    db: Session = Depends(get_db),
    embedding: SentenceTransformerEmbeddingProvider = Depends(get_embedding_provider),
    llm: object = Depends(get_llm_provider),
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
    service = TelemetryService(db, embedding, llm)
    try:
        rows = service.get_recent_values(name, limit=limit, since=since_dt, until=until_dt)
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
