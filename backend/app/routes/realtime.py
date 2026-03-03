"""Realtime telemetry ingest and WebSocket routes."""

import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.schemas import (
    MeasurementEvent,
    MeasurementEventBatch,
    RealtimeChannelUpdate,
    TelemetryAlertSchema,
    WsSnapshotAlerts,
    WsSnapshotWatchlist,
)
from app.models.telemetry import TelemetryAlert
from app.realtime.bus import get_realtime_bus
from app.realtime.ws_hub import get_ws_hub
from app.services.realtime_service import (
    get_active_alerts,
    get_realtime_snapshot_for_channels,
    get_watchlist_channel_names,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _assign_reception_time(events: list[MeasurementEvent]) -> list[MeasurementEvent]:
    """Assign reception_time to events that don't have it."""
    now = datetime.now(timezone.utc).isoformat()
    return [
        MeasurementEvent(
            source_id=e.source_id,
            channel_name=e.channel_name,
            generation_time=e.generation_time,
            reception_time=e.reception_time or now,
            value=e.value,
            quality=e.quality,
            sequence=e.sequence,
            tags=e.tags,
        )
        for e in events
    ]


@router.post("/ingest")
def ingest_realtime(
    body: MeasurementEventBatch,
) -> dict[str, Any]:
    """Ingest batch of realtime measurement events."""
    bus = get_realtime_bus()
    events = _assign_reception_time(body.events)
    for e in events:
        bus.publish_measurement(e)
    logger.info("Realtime ingest: accepted=%d events", len(events))
    return {"accepted": len(events)}


@router.websocket("/ws")
async def websocket_realtime(websocket: WebSocket) -> None:
    """WebSocket endpoint for realtime subscriptions and ack/resolve."""
    hub = get_ws_hub()
    await hub.connect(websocket)

    # Get DB session factory for snapshot/ack/resolve
    from app.database import get_session_factory
    session_factory = get_session_factory()

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({"error": "invalid json"}))
                continue

            msg_type = msg.get("type", "")

            if msg_type == "hello":
                # Optional: validate client_version, requested_features
                await websocket.send_text(
                    json.dumps({"type": "hello_ack", "server_version": "1.0"})
                )

            elif msg_type == "subscribe_watchlist":
                channels = msg.get("channels", [])
                source_id = msg.get("source_id", "default")
                if not channels:
                    # Default to watchlist
                    session = session_factory()
                    try:
                        channels = get_watchlist_channel_names(session)
                    finally:
                        session.close()
                await hub.subscribe_watchlist(websocket, channels, source_id=source_id)

                # Send snapshot
                session = session_factory()
                try:
                    snapshot = get_realtime_snapshot_for_channels(
                        session, channels, source_id=source_id
                    )
                    # Fallback: if telemetry_current is empty, channels may be empty
                    # Use overview-style fallback from telemetry_data
                    if len(snapshot) < len(channels):
                        from app.services.overview_service import get_overview
                        overview = get_overview(session, source_id=source_id)
                        overview_by_name = {c["name"]: c for c in overview}
                        for name in channels:
                            if name not in [s.name for s in snapshot] and name in overview_by_name:
                                o = overview_by_name[name]
                                from app.models.schemas import RecentDataPoint
                                snapshot.append(
                                    RealtimeChannelUpdate(
                                        source_id=source_id,
                                        name=o["name"],
                                        units=o.get("units"),
                                        description=o.get("description"),
                                        subsystem_tag=o["subsystem_tag"],
                                        current_value=o["current_value"],
                                        generation_time=o["last_timestamp"],
                                        reception_time=o["last_timestamp"],
                                        state=o["state"],
                                        state_reason=o.get("state_reason"),
                                        z_score=o.get("z_score"),
                                        sparkline_data=[
                                            RecentDataPoint(timestamp=p["timestamp"], value=p["value"])
                                            for p in o.get("sparkline_data", [])
                                        ],
                                    )
                                )
                    payload = WsSnapshotWatchlist(channels=snapshot).model_dump_json()
                    await websocket.send_text(payload)
                finally:
                    session.close()

            elif msg_type == "subscribe_channel":
                name = msg.get("name", "")
                source_id = msg.get("source_id", "default")
                if name:
                    await hub.subscribe_channel(websocket, name, source_id=source_id)
                    session = session_factory()
                    try:
                        snapshot = get_realtime_snapshot_for_channels(
                            session, [name], source_id=source_id
                        )
                        if snapshot:
                            from app.models.schemas import WsTelemetryUpdate
                            await websocket.send_text(
                                WsTelemetryUpdate(channel=snapshot[0]).model_dump_json()
                            )
                    finally:
                        session.close()

            elif msg_type == "subscribe_alerts":
                source_id = msg.get("source_id", "default")
                await hub.subscribe_alerts(websocket, source_id=source_id)
                session = session_factory()
                try:
                    active = get_active_alerts(
                        session,
                        source_id=source_id,
                        subsystems=msg.get("subsystems"),
                        severities=msg.get("severities"),
                    )
                    payload = WsSnapshotAlerts(active=active).model_dump_json()
                    await websocket.send_text(payload)
                finally:
                    session.close()

            elif msg_type == "ack_alert":
                alert_id = msg.get("alert_id", "")
                session = session_factory()
                try:
                    from uuid import UUID
                    aid = UUID(alert_id)
                    alert = session.get(TelemetryAlert, aid)
                    if alert and alert.cleared_at is None and alert.resolved_at is None:
                        alert.acked_at = datetime.now(timezone.utc)
                        alert.acked_by = "operator"
                        alert.status = "acked"
                        alert.last_update_at = alert.acked_at
                        session.commit()
                        from app.models.telemetry import TelemetryMetadata
                        meta = session.get(TelemetryMetadata, alert.telemetry_id)
                        from app.utils.subsystem import infer_subsystem
                        subsys = infer_subsystem(meta.name, meta) if meta else "other"
                        schema = TelemetryAlertSchema(
                            id=str(alert.id),
                            source_id=alert.source_id,
                            channel_name=meta.name if meta else "",
                            telemetry_id=str(alert.telemetry_id),
                            subsystem=subsys,
                            units=meta.units if meta else None,
                            severity=alert.severity,
                            reason=alert.reason,
                            status=alert.status,
                            opened_at=alert.opened_at.isoformat(),
                            opened_reception_at=alert.opened_reception_at.isoformat(),
                            last_update_at=alert.last_update_at.isoformat(),
                            current_value=float(alert.current_value_at_open),
                            acked_at=alert.acked_at.isoformat(),
                            acked_by=alert.acked_by,
                        )
                        await hub.broadcast_alert_event("acked", schema)
                finally:
                    session.close()

            elif msg_type == "resolve_alert":
                alert_id = msg.get("alert_id", "")
                resolution_text = msg.get("resolution_text", "")
                resolution_code = msg.get("resolution_code")
                session = session_factory()
                try:
                    from uuid import UUID
                    aid = UUID(alert_id)
                    alert = session.get(TelemetryAlert, aid)
                    if alert:
                        alert.resolved_at = datetime.now(timezone.utc)
                        alert.resolved_by = "operator"
                        alert.resolution_text = resolution_text
                        alert.resolution_code = resolution_code
                        alert.status = "resolved"
                        alert.last_update_at = alert.resolved_at
                        session.commit()
                        from app.models.telemetry import TelemetryMetadata
                        meta = session.get(TelemetryMetadata, alert.telemetry_id)
                        from app.utils.subsystem import infer_subsystem
                        subsys = infer_subsystem(meta.name, meta) if meta else "other"
                        schema = TelemetryAlertSchema(
                            id=str(alert.id),
                            source_id=alert.source_id,
                            channel_name=meta.name if meta else "",
                            telemetry_id=str(alert.telemetry_id),
                            subsystem=subsys,
                            units=meta.units if meta else None,
                            severity=alert.severity,
                            reason=alert.reason,
                            status=alert.status,
                            opened_at=alert.opened_at.isoformat(),
                            opened_reception_at=alert.opened_reception_at.isoformat(),
                            last_update_at=alert.last_update_at.isoformat(),
                            current_value=float(alert.current_value_at_open),
                            resolved_at=alert.resolved_at.isoformat(),
                            resolved_by=alert.resolved_by,
                            resolution_text=alert.resolution_text,
                            resolution_code=alert.resolution_code,
                        )
                        await hub.broadcast_alert_event("resolved", schema)
                finally:
                    session.close()

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.exception("WebSocket error: %s", e)
    finally:
        await hub.disconnect(websocket)
