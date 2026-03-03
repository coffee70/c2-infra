"""FastAPI application entry point."""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import realtime, simulator, telemetry

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    logger.info("Starting Telemetry Operations Platform")
    from app.realtime import get_realtime_processor
    from app.realtime.ws_hub import get_ws_hub
    hub = get_ws_hub()
    hub.set_loop(asyncio.get_running_loop())
    proc = get_realtime_processor()
    proc.register_telemetry_update_handler(hub.schedule_telemetry_update)
    bus = proc._bus
    def on_alert(ev: dict):
        hub.schedule_alert_event(ev.get("type", ""), ev.get("alert", {}))
    bus.subscribe_alerts(on_alert)
    yield
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

app.include_router(telemetry.router, prefix="/telemetry", tags=["telemetry"])
app.include_router(realtime.router, prefix="/telemetry/realtime", tags=["realtime"])
app.include_router(simulator.router, prefix="/simulator", tags=["simulator"])


@app.get("/health")
def health():
    """Health check endpoint."""
    return {"status": "ok"}
