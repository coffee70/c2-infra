"""Ops events (timeline) and feed health API routes."""

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.database import get_db
from app.realtime.feed_health import get_feed_health_tracker
from app.models.schemas import OpsEventSchema, OpsEventsResponse
from app.services.ops_events_service import query_events

router = APIRouter()


@router.get("/feed-status")
def get_feed_status(source_id: str = Query(...)):
    """Get feed health status for a source."""
    status = get_feed_health_tracker().get_status(source_id)
    return {
        "source_id": status.get("source_id", source_id),
        "connected": status.get("connected", False),
        "state": status.get("state", "disconnected"),
        "last_reception_time": status.get("last_reception_time"),
        "approx_rate_hz": status.get("approx_rate_hz"),
        "drop_count": status.get("drop_count"),
    }


@router.get("/events", response_model=OpsEventsResponse)
def get_timeline_events(
    source_id: str = Query(...),
    stream_id: Optional[str] = None,
    since_minutes: int = 60,
    until_minutes: Optional[int] = None,
    event_types: Optional[str] = None,
    entity_type: Optional[str] = None,
    channel_name: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    db=Depends(get_db),
):
    """Query ops events (timeline). since_minutes: lookback from now. until_minutes: optional end (minutes ago); default now."""
    now = datetime.now(timezone.utc)
    since = now - timedelta(minutes=since_minutes)
    until = (
        (now - timedelta(minutes=until_minutes)) if until_minutes is not None else now
    )
    if until <= since:
        raise HTTPException(status_code=400, detail="until must be after since")

    types_list = [t.strip() for t in event_types.split(",") if t.strip()] if event_types else None

    events, total = query_events(
        db,
        source_id=source_id,
        stream_id=stream_id,
        since=since,
        until=until,
        event_types=types_list,
        entity_type=entity_type,
        channel_name=channel_name,
        limit=limit,
        offset=offset,
    )

    return OpsEventsResponse(
        events=[
            OpsEventSchema(
                id=str(e.id),
                source_id=e.source_id,
                stream_id=e.stream_id,
                event_time=e.event_time.isoformat(),
                event_type=e.event_type,
                severity=e.severity,
                summary=e.summary,
                entity_type=e.entity_type,
                entity_id=e.entity_id,
                payload=e.payload,
                created_at=e.created_at.isoformat(),
            )
            for e in events
        ],
        total=total,
    )
