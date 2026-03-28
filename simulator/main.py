"""FastAPI simulator service with start/pause/resume/stop."""

import os
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from simulator.lib.audit import audit_log
from simulator.telemetry_definitions import SCENARIOS
from simulator.streamer import TelemetryStreamer

app = FastAPI(title="Telemetry Simulator", version="1.0.0")

_streamer: TelemetryStreamer | None = None

# Default vehicle_id sent by callers when they want a unique stream; we replace it with a per-run stream ID.
DEFAULT_VEHICLE_ID = os.environ.get("SIMULATOR_SOURCE_ID") or "simulator"


def _supported_scenarios_payload() -> list[dict[str, str]]:
    """Serialize runtime-supported scenarios for API responses."""
    return [
        {
            "name": scenario_name,
            "description": str(scenario.get("description", "")),
        }
        for scenario_name, scenario in SCENARIOS.items()
    ]


def _generate_stream_id(vehicle_id: str | None) -> str:
    """Generate a unique stream_id for this simulation run (<vehicle_id>-YYYY-MM-DDTHH-MM-SSZ)."""
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    prefix = vehicle_id or DEFAULT_VEHICLE_ID or str(uuid.uuid4())
    return f"{prefix}-{ts}"


class StartConfig(BaseModel):
    scenario: str = Field(
        default="nominal",
        description=f"Scenario from runtime definition: {', '.join(sorted(SCENARIOS))}",
    )
    duration: float = Field(default=300, ge=0, description="Duration in seconds (0 = infinite)")
    speed: float = Field(default=1.0, ge=0.1, description="Time speed factor")
    drop_prob: float = Field(default=0.0, ge=0, le=1, description="Link dropout probability")
    jitter: float = Field(default=0.1, ge=0, le=1, description="Inter-sample jitter")
    vehicle_id: str = Field(default=DEFAULT_VEHICLE_ID, description="Logical vehicle ID for ingest")
    base_url: str | None = Field(default=None, description="Backend ingest URL (default: BACKEND_URL env)")
    telemetry_definition_path: str | None = Field(default=None, description="Catalog file to load for this run")
    packet_source: str | None = Field(default="simulator-link", description="Packet origin identifier")
    receiver_id: str | None = Field(default=None, description="Receiving endpoint identifier")


def _get_streamer() -> TelemetryStreamer:
    if _streamer is None:
        raise HTTPException(status_code=409, detail="Simulator not started")
    return _streamer


@app.get("/status")
def get_status() -> dict[str, Any]:
    """Return current state and config."""
    if _streamer is None:
        return {
            "state": "idle",
            "config": None,
            "sim_elapsed": 0,
            "supported_scenarios": _supported_scenarios_payload(),
        }
    payload = {
        "state": _streamer.state,
        "config": {
            "scenario": _streamer.scenario_name,
            "duration": _streamer.duration,
            "speed": _streamer.speed,
            "drop_prob": _streamer.drop_prob,
            "jitter": _streamer.jitter,
            "vehicle_id": _streamer.vehicle_id,
            "stream_id": _streamer.stream_id,
            "packet_source": _streamer.packet_source,
            "receiver_id": _streamer.receiver_id,
            "base_url": _streamer.base_url,
        },
        "sim_elapsed": round(_streamer.sim_elapsed, 1),
        "supported_scenarios": _supported_scenarios_payload(),
    }
    return payload


@app.post("/start")
def start(config: StartConfig) -> dict[str, Any]:
    """Start the simulator with given config. Returns resolved stream_id."""
    if config.scenario not in SCENARIOS:
        raise HTTPException(status_code=400, detail=f"Unknown scenario: {config.scenario}")
    audit_log(
        "simulator.start.received",
        origin="backend",
        scenario=config.scenario,
        duration=config.duration,
        speed=config.speed,
        vehicle_id=config.vehicle_id,
    )
    global _streamer
    if _streamer is not None and _streamer.state != "idle":
        raise HTTPException(status_code=409, detail=f"Simulator already {_streamer.state}")
    base_url = config.base_url or os.environ.get("BACKEND_URL", "http://localhost:8000")
    if _streamer is not None:
        _streamer.stop()
        _streamer = None
    resolved_stream_id = _generate_stream_id(config.vehicle_id)
    _streamer = TelemetryStreamer(
        base_url=base_url,
        scenario=config.scenario,
        duration=config.duration,
        speed=config.speed,
        drop_prob=config.drop_prob,
        jitter=config.jitter,
        vehicle_id=config.vehicle_id,
        stream_id=resolved_stream_id,
        packet_source=config.packet_source,
        receiver_id=config.receiver_id,
        telemetry_definition_path=config.telemetry_definition_path,
    )
    if not _streamer.start():
        audit_log("simulator.start.failed", reason="TelemetryStreamer.start() returned False", level="error")
        raise HTTPException(status_code=500, detail="Failed to start")
    audit_log(
        "simulator.start.handled",
        origin="backend",
        scenario=config.scenario,
        duration=config.duration,
        speed=config.speed,
        vehicle_id=config.vehicle_id,
        stream_id=resolved_stream_id,
        base_url=base_url,
    )
    return {
        "status": "started",
        "state": _streamer.state,
        "vehicle_id": config.vehicle_id,
        "stream_id": resolved_stream_id,
        "run_label": f"{config.scenario} ({resolved_stream_id.split('-')[-1]})",
    }


@app.post("/pause")
def pause() -> dict[str, Any]:
    """Pause streaming (keep sim time)."""
    s = _get_streamer()
    if not s.pause():
        raise HTTPException(status_code=409, detail=f"Cannot pause: state={s.state}")
    audit_log("simulator.pause")
    return {"status": "paused", "state": s.state}


@app.post("/resume")
def resume() -> dict[str, Any]:
    """Resume from pause."""
    s = _get_streamer()
    if not s.resume():
        raise HTTPException(status_code=409, detail=f"Cannot resume: state={s.state}")
    audit_log("simulator.resume")
    return {"status": "resumed", "state": s.state}


@app.post("/stop")
def stop() -> dict[str, Any]:
    """Stop and reset to idle."""
    global _streamer
    if _streamer is None:
        return {"status": "stopped", "state": "idle"}
    _streamer.stop()
    _streamer = None
    audit_log("simulator.stop")
    return {"status": "stopped", "state": "idle"}
