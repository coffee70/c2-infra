"""FastAPI simulator service with start/pause/resume/stop."""

import os
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from simulator.lib.audit import audit_log
from simulator.streamer import TelemetryStreamer

app = FastAPI(title="Telemetry Simulator", version="1.0.0")

_streamer: TelemetryStreamer | None = None


class StartConfig(BaseModel):
    scenario: str = Field(default="nominal", description="Scenario: nominal, power_sag, thermal_runaway, comm_dropout, safe_mode")
    duration: float = Field(default=300, ge=0, description="Duration in seconds (0 = infinite)")
    speed: float = Field(default=1.0, ge=0.1, description="Time speed factor")
    drop_prob: float = Field(default=0.0, ge=0, le=1, description="Link dropout probability")
    jitter: float = Field(default=0.1, ge=0, le=1, description="Inter-sample jitter")
    source_id: str = Field(default="simulator", description="Source ID for ingest")
    base_url: str | None = Field(default=None, description="Backend ingest URL (default: BACKEND_URL env)")


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
        }
    payload = {
        "state": _streamer.state,
        "config": {
            "scenario": _streamer.scenario_name,
            "duration": _streamer.duration,
            "speed": _streamer.speed,
            "drop_prob": _streamer.drop_prob,
            "jitter": _streamer.jitter,
            "source_id": _streamer.source_id,
            "base_url": _streamer.base_url,
        },
        "sim_elapsed": round(_streamer.sim_elapsed, 1),
    }
    return payload


@app.post("/start")
def start(config: StartConfig) -> dict[str, Any]:
    """Start the simulator with given config."""
    audit_log(
        "simulator.start.received",
        origin="backend",
        scenario=config.scenario,
        duration=config.duration,
        speed=config.speed,
        source_id=config.source_id,
    )
    global _streamer
    if _streamer is not None and _streamer.state != "idle":
        raise HTTPException(status_code=409, detail=f"Simulator already {_streamer.state}")
    base_url = config.base_url or os.environ.get("BACKEND_URL", "http://localhost:8000")
    if _streamer is not None:
        _streamer.stop()
        _streamer = None
    _streamer = TelemetryStreamer(
        base_url=base_url,
        scenario=config.scenario,
        duration=config.duration,
        speed=config.speed,
        drop_prob=config.drop_prob,
        jitter=config.jitter,
        source_id=config.source_id,
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
        source_id=config.source_id,
        base_url=base_url,
    )
    return {"status": "started", "state": _streamer.state}


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
