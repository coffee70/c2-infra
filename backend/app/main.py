"""FastAPI application entry point."""

import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import get_settings
from app.lib.audit import audit_log
from app.lib.logging_setup import configure_logging
from app.routes import ops, orbit as orbit_routes, position, realtime, simulator, telemetry, vehicle_configs

configure_logging()
logger = logging.getLogger(__name__)

# CORS origins: from CORS_ORIGINS env (comma-separated). Default includes localhost for local dev.
CORS_ORIGINS = get_settings().get_cors_origins_list()
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
    from app.services.realtime_service import (
        auto_register_sources_from_configs,
        repair_registered_sources_on_startup,
        refresh_source_embeddings,
    )

    hub = get_ws_hub()
    hub.set_loop(asyncio.get_running_loop())
    proc = get_realtime_processor()
    proc.register_telemetry_update_handler(hub.schedule_telemetry_update)
    bus = proc._bus

    from app.orbit import register_on_status_change
    register_on_status_change(hub.schedule_orbit_status)

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

    bootstrap_session = get_session_factory()()
    try:
        repaired_source_ids = repair_registered_sources_on_startup(bootstrap_session)
        try:
            from app.services.embedding_service import SentenceTransformerEmbeddingProvider

            auto_register_sources_from_configs(
                bootstrap_session,
                embedding_provider=SentenceTransformerEmbeddingProvider(),
            )
        except Exception as e:
            logger.exception("Skipping startup auto-registration due to embedding provider failure: %s", e)
    finally:
        bootstrap_session.close()

    async def backfill_repaired_source_embeddings():
        if not repaired_source_ids:
            return
        def run_backfill_sync() -> None:
            session = get_session_factory()()
            try:
                from app.services.embedding_service import SentenceTransformerEmbeddingProvider

                refresh_source_embeddings(
                    session,
                    source_ids=repaired_source_ids,
                    embedding_provider=SentenceTransformerEmbeddingProvider(),
                )
            except Exception as e:
                logger.exception("Failed to backfill repaired source embeddings after startup: %s", e)
                session.rollback()
            finally:
                session.close()

        await asyncio.to_thread(run_backfill_sync)

    embedding_backfill_task = asyncio.create_task(backfill_repaired_source_embeddings())

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
    if not embedding_backfill_task.done():
        embedding_backfill_task.cancel()
        try:
            await embedding_backfill_task
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
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


def _cors_headers(request: Request) -> dict:
    origin = request.headers.get("origin")
    if origin not in CORS_ORIGINS:
        origin = CORS_ORIGINS[0] if CORS_ORIGINS else ""
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "*",
        "Access-Control-Allow-Headers": "*",
    }


@app.exception_handler(StarletteHTTPException)
async def http_exception_with_cors(request: Request, exc: StarletteHTTPException):
    """Add CORS headers to HTTPException responses."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=_cors_headers(request),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_with_cors(request: Request, exc: RequestValidationError):
    """Add CORS headers to validation error responses."""
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()},
        headers=_cors_headers(request),
    )


@app.exception_handler(Exception)
async def add_cors_to_exception_response(request: Request, exc: Exception):
    """Ensure CORS headers are present on exception responses so the client can read the error."""
    logger.exception("Unhandled exception: %s", exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
        headers=_cors_headers(request),
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
app.include_router(position.router, prefix="/telemetry", tags=["position"])
app.include_router(orbit_routes.router, prefix="/telemetry", tags=["orbit"])
app.include_router(ops.router, prefix="/ops", tags=["ops"])
app.include_router(realtime.router, prefix="/telemetry/realtime", tags=["realtime"])
app.include_router(simulator.router, prefix="/simulator", tags=["simulator"])
app.include_router(vehicle_configs.router, prefix="/vehicle-configs", tags=["vehicle-configs"])


@app.get("/health")
def health():
    """Health check endpoint."""
    return {"status": "ok"}
