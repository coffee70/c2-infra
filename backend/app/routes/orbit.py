"""Orbit validation status API."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter

from app.orbit import get_status
from app.services.source_run_service import run_id_to_source_id

router = APIRouter()


@router.get("/orbit/status")
def orbit_status(source_id: Optional[str] = None):
    """Return latest orbit status per source. Optional source_id to filter."""
    logical_source_id = run_id_to_source_id(source_id) if source_id else None
    data = get_status(source_id=logical_source_id)
    return data
