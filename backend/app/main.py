"""FastAPI application entry point."""

import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.lib.audit import audit_log
from app.lib.logging_setup import configure_logging
from app.routes import ops, realtime, simulator, telemetry

configure_logging()
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    logger.info("Starting Telemetry Operations Platform")
    from datetime import datetime, timezone

    from app.database import get_session_factory
    from app.realtime import get_realtime_processor
    from app.realtime.feed_health import get_feed_health_tracker
    from app.realtime.ws_hub import get_ws_hub
    from app.services.ops_events_service import write_event as write_ops_event

    hub = get_ws_hub()
    hub.set_loop(asyncio.get_running_loop())
    proc = get_realtime_processor()
    proc.register_telemetry_update_handler(hub.schedule_telemetry_update)
    bus = proc._bus

    def on_alert(ev: dict):
        hub.schedule_alert_event(ev.get("type", ""), ev.get("alert", {}))

    def on_feed_transition(source_id: str, old_state: str, new_state: str):
        session_factory = get_session_factory()
        session = session_factory()
        try:
            write_ops_event(
                session,
                source_id=source_id,
                event_time=datetime.now(timezone.utc),
                event_type="system.feed_status",
                severity="info" if new_state == "connected" else "warning",
                summary=f"Feed {source_id}: {old_state} -> {new_state}",
                entity_type="system",
                entity_id=source_id,
                payload={"old_state": old_state, "new_state": new_state},
            )
            session.commit()
        except Exception as e:
            logger.exception("Failed to write feed transition ops_event: %s", e)
            session.rollback()
        finally:
            session.close()
        status = get_feed_health_tracker().get_status(source_id)
        hub.schedule_feed_status(status)

    get_feed_health_tracker().set_on_transition(on_feed_transition)
    bus.subscribe_alerts(on_alert)

    async def broadcast_feed_status_periodically():
        while True:
            await asyncio.sleep(5)
            tracker = get_feed_health_tracker()
            for st in tracker.get_all_statuses():
                if st:
                    hub.schedule_feed_status(st)

    feed_task = asyncio.create_task(broadcast_feed_status_periodically())

    yield

    feed_task.cancel()
    try:
        await feed_task
    except asyncio.CancelledError:
        pass
    await hub.stop()
    bus.unsubscribe_alerts(on_alert)
    proc.unregister_telemetry_update_handler(hub.schedule_telemetry_update)
    proc.stop()
    logger.info("Shutting down")


app = FastAPI(
    title="Telemetry Operations Platform",
    description="Ingest telemetry, compute stats, semantic search, and LLM explanations",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def audit_request_middleware(request: Request, call_next):
    """Log HTTP requests for audit and debugging."""
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.request_id = request_id
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    audit_log(
        "http.request",
        method=request.method,
        path=request.url.path,
        status_code=response.status_code,
        duration_ms=round(duration_ms, 2),
        request_id=request_id,
    )
    try:
        response.headers["X-Request-ID"] = request_id
    except (TypeError, ValueError):
        pass
    return response


app.include_router(telemetry.router, prefix="/telemetry", tags=["telemetry"])
app.include_router(ops.router, prefix="/ops", tags=["ops"])
app.include_router(realtime.router, prefix="/telemetry/realtime", tags=["realtime"])
app.include_router(simulator.router, prefix="/simulator", tags=["simulator"])


@app.get("/health")
def health():
    """Health check endpoint."""
    return {"status": "ok"}
