"""Proxy routes for the telemetry simulator service."""

import os
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.lib.audit import audit_log

router = APIRouter()

SIMULATOR_URL = os.environ.get("SIMULATOR_URL", "http://simulator:8001")


class StartConfig(BaseModel):
    scenario: str = Field(default="nominal", description="Scenario name")
    duration: float = Field(default=300, ge=0, description="Duration in seconds (0 = infinite)")
    speed: float = Field(default=1.0, ge=0.1, description="Time speed factor")
    drop_prob: float = Field(default=0.0, ge=0, le=1, description="Link dropout probability")
    jitter: float = Field(default=0.1, ge=0, le=1, description="Inter-sample jitter")
    source_id: str = Field(default="simulator", description="Source ID for ingest")
    base_url: str | None = Field(default=None, description="Backend ingest URL")


async def _proxy_get(path: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(f"{SIMULATOR_URL}{path}")
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)
        return r.json()


async def _proxy_post(path: str, json: dict[str, Any] | None = None) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(f"{SIMULATOR_URL}{path}", json=json)
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)
        return r.json()


@router.get("/status")
async def simulator_status() -> dict[str, Any]:
    """Get simulator state and config."""
    try:
        return await _proxy_get("/status")
    except httpx.ConnectError as e:
        audit_log(
            "simulator.status.proxy_failed",
            origin="frontend",
            destination="simulator",
            error=str(e),
            level="error",
        )
        raise HTTPException(status_code=503, detail=f"Simulator unavailable: {e}")


@router.post("/start")
async def simulator_start(config: StartConfig) -> dict[str, Any]:
    """Start the simulator with given config."""
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
        result = await _proxy_post("/start", body)
        audit_log(
            "simulator.start.proxied",
            origin="frontend",
            destination="simulator",
            scenario=config.scenario,
            duration=config.duration,
            speed=config.speed,
            source_id=config.source_id,
            base_url=config.base_url,
        )
        return result
    except httpx.ConnectError as e:
        audit_log(
            "simulator.start.proxy_failed",
            origin="frontend",
            destination="simulator",
            error=str(e),
            level="error",
        )
        raise HTTPException(status_code=503, detail=f"Simulator unavailable: {e}")


@router.post("/pause")
async def simulator_pause() -> dict[str, Any]:
    """Pause the simulator."""
    try:
        result = await _proxy_post("/pause")
        audit_log("simulator.pause")
        return result
    except httpx.ConnectError as e:
        raise HTTPException(status_code=503, detail=f"Simulator unavailable: {e}")


@router.post("/resume")
async def simulator_resume() -> dict[str, Any]:
    """Resume the simulator."""
    try:
        result = await _proxy_post("/resume")
        audit_log("simulator.resume")
        return result
    except httpx.ConnectError as e:
        raise HTTPException(status_code=503, detail=f"Simulator unavailable: {e}")


@router.post("/stop")
async def simulator_stop() -> dict[str, Any]:
    """Stop the simulator."""
    try:
        result = await _proxy_post("/stop")
        audit_log("simulator.stop")
        return result
    except httpx.ConnectError as e:
        raise HTTPException(status_code=503, detail=f"Simulator unavailable: {e}")
