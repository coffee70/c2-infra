"""Proxy routes for the telemetry simulator service."""

from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.lib.audit import audit_log
from app.models.telemetry import TelemetrySource
from app.orbit import reset_source as reset_orbit_source
from app.services.source_run_service import clear_active_run, register_active_run

router = APIRouter()


def _resolve_simulator_url(db: Session, source_id: str) -> str:
    """Resolve simulator base URL from DB. Raises 404 if not found or not a simulator."""
    src = db.get(TelemetrySource, source_id)
    if not src:
        raise HTTPException(status_code=404, detail="Source not found")
    if src.source_type != "simulator":
        raise HTTPException(status_code=400, detail="Source is not a simulator")
    if not src.base_url:
        raise HTTPException(status_code=400, detail="Simulator has no base_url configured")
    return src.base_url.rstrip("/")


class StartConfig(BaseModel):
    scenario: str = Field(default="nominal", description="Scenario name")
    duration: float = Field(default=300, ge=0, description="Duration in seconds (0 = infinite)")
    speed: float = Field(default=1.0, ge=0.1, description="Time speed factor")
    drop_prob: float = Field(default=0.0, ge=0, le=1, description="Link dropout probability")
    jitter: float = Field(default=0.1, ge=0, le=1, description="Inter-sample jitter")
    source_id: str = Field(..., description="Source ID for ingest (must be simulator)")
    base_url: str | None = Field(default=None, description="Backend ingest URL")


async def _proxy_get(base_url: str, path: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(f"{base_url}{path}")
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)
        return r.json()


async def _proxy_post(base_url: str, path: str, json: dict[str, Any] | None = None) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(f"{base_url}{path}", json=json)
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)
        return r.json()


def _resolve_with_audit(db: Session, source_id: str, action: str) -> str:
    """Resolve simulator URL, audit-log on failure, then re-raise."""
    try:
        return _resolve_simulator_url(db, source_id)
    except HTTPException as e:
        audit_log(
            "simulator.source_resolve_failed",
            origin="frontend",
            destination=source_id,
            action=action,
            status_code=e.status_code,
            detail=str(e.detail),
            level="error",
        )
        raise


@router.get("/status")
async def simulator_status(
    source_id: str = Query(..., description="Simulator source ID"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Get simulator state and config. Always returns 200; use 'connected' to detect reachability."""
    try:
        base_url = _resolve_with_audit(db, source_id, "status")
        payload = await _proxy_get(base_url, "/status")
        state = payload.get("state")
        config = payload.get("config") or {}
        active_run_id = config.get("source_id")
        if state and state != "idle" and isinstance(active_run_id, str) and active_run_id:
            register_active_run(active_run_id)
        elif state == "idle":
            clear_active_run(source_id)
        return {"connected": True, **payload}
    except (httpx.ConnectError, httpx.TimeoutException, HTTPException) as e:
        audit_log(
            "simulator.status.proxy_failed",
            origin="frontend",
            destination=source_id,
            error=str(e),
            level="error",
        )
        return {"connected": False}


@router.post("/start")
async def simulator_start(
    config: StartConfig,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Start the simulator with given config."""
    base_url = _resolve_with_audit(db, config.source_id, "start")
    audit_log(
        "simulator.start.received",
        origin="frontend",
        scenario=config.scenario,
        duration=config.duration,
        speed=config.speed,
        source_id=config.source_id,
    )
    try:
        body = config.model_dump(exclude_none=True)
        result = await _proxy_post(base_url, "/start", body)
        clear_active_run(config.source_id)
        reset_orbit_source(config.source_id)
        if isinstance(result.get("source_id"), str):
            register_active_run(result["source_id"])
        audit_log(
            "simulator.start.proxied",
            origin="frontend",
            destination=config.source_id,
            scenario=config.scenario,
            duration=config.duration,
            speed=config.speed,
            source_id=config.source_id,
            base_url=config.base_url,
        )
        return result
    except (httpx.ConnectError, httpx.TimeoutException, HTTPException) as e:
        audit_log(
            "simulator.start.proxy_failed",
            origin="frontend",
            destination=config.source_id,
            error=str(e),
            level="error",
        )
        raise HTTPException(status_code=503, detail=f"Simulator unavailable: {e}")


@router.post("/pause")
async def simulator_pause(
    source_id: str = Query(..., description="Simulator source ID"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Pause the simulator."""
    base_url = _resolve_with_audit(db, source_id, "pause")
    try:
        result = await _proxy_post(base_url, "/pause")
        audit_log("simulator.pause", destination=source_id)
        return result
    except (httpx.ConnectError, httpx.TimeoutException, HTTPException) as e:
        audit_log(
            "simulator.pause.proxy_failed",
            origin="frontend",
            destination=source_id,
            error=str(e),
            level="error",
        )
        raise HTTPException(status_code=503, detail=f"Simulator unavailable: {e}")


@router.post("/resume")
async def simulator_resume(
    source_id: str = Query(..., description="Simulator source ID"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Resume the simulator."""
    base_url = _resolve_with_audit(db, source_id, "resume")
    try:
        result = await _proxy_post(base_url, "/resume")
        audit_log("simulator.resume", destination=source_id)
        return result
    except (httpx.ConnectError, httpx.TimeoutException, HTTPException) as e:
        audit_log(
            "simulator.resume.proxy_failed",
            origin="frontend",
            destination=source_id,
            error=str(e),
            level="error",
        )
        raise HTTPException(status_code=503, detail=f"Simulator unavailable: {e}")


@router.post("/stop")
async def simulator_stop(
    source_id: str = Query(..., description="Simulator source ID"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Stop the simulator."""
    base_url = _resolve_with_audit(db, source_id, "stop")
    try:
        result = await _proxy_post(base_url, "/stop")
        clear_active_run(source_id)
        reset_orbit_source(source_id)
        audit_log("simulator.stop", destination=source_id)
        return result
    except (httpx.ConnectError, httpx.TimeoutException, HTTPException) as e:
        audit_log(
            "simulator.stop.proxy_failed",
            origin="frontend",
            destination=source_id,
            error=str(e),
            level="error",
        )
        raise HTTPException(status_code=503, detail=f"Simulator unavailable: {e}")
