"""Regression tests for route-level source and simulator guards."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.models.telemetry import TelemetryStream
from app.routes.simulator import simulator_start, simulator_status
from app.services.source_stream_service import (
    clear_active_stream,
    ensure_stream_belongs_to_source,
    register_stream,
)


def test_ensure_stream_belongs_to_source_accepts_matching_stream() -> None:
    source_id = "27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6"
    stream_id = f"{source_id}-2026-03-15T14-00-00Z"
    db = MagicMock()
    db.get.side_effect = lambda model, key: (
        TelemetryStream(id=stream_id, source_id=source_id, status="active")
        if model is TelemetryStream and key == stream_id
        else None
    )

    assert ensure_stream_belongs_to_source(db, source_id, stream_id) == stream_id


def test_ensure_stream_belongs_to_source_rejects_mismatched_stream() -> None:
    source_id = "27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6"
    other_stream_id = "63b0c0ab-8173-44ff-918f-2616ebb449b8-2026-03-15T14-00-00Z"
    db = MagicMock()

    with pytest.raises(ValueError) as exc_info:
        ensure_stream_belongs_to_source(db, source_id, other_stream_id)

    assert "Stream not found for source" in str(exc_info.value)


def test_ensure_stream_belongs_to_source_accepts_persisted_stream_without_registry() -> None:
    source_id = "27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6"
    stream_id = f"{source_id}-2026-03-15T14-00-00Z"
    db = MagicMock()
    db.get.return_value = None

    class _ScalarResult:
        def __init__(self, row):
            self._row = row

        def scalars(self):
            return self

        def first(self):
            return self._row

    db.execute.return_value = _ScalarResult(source_id)

    assert ensure_stream_belongs_to_source(db, source_id, stream_id) == stream_id


def test_ensure_stream_belongs_to_source_rejects_unknown_explicit_stream() -> None:
    source_id = "27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6"
    db = MagicMock()
    db.get.return_value = None

    class _ScalarResult:
        def scalars(self):
            return self

        def first(self):
            return None

    db.execute.return_value = _ScalarResult()

    with pytest.raises(ValueError):
        ensure_stream_belongs_to_source(db, source_id, source_id)


def test_register_stream_supports_cache_backed_validation() -> None:
    source_id = "27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6"
    stream_id = f"{source_id}-2026-03-15T14-00-00Z"
    db = MagicMock()
    db.get.side_effect = lambda model, key: (
        MagicMock(id=source_id)
        if key == source_id
        else TelemetryStream(id=stream_id, source_id=source_id, status="active")
        if model is TelemetryStream and key == stream_id
        else None
    )

    clear_active_stream(source_id)
    try:
        register_stream(db, source_id=source_id, stream_id=stream_id)
        assert ensure_stream_belongs_to_source(db, source_id, stream_id) == stream_id
    finally:
        clear_active_stream(source_id)


@pytest.mark.anyio
async def test_simulator_start_preserves_runtime_validation_errors(monkeypatch) -> None:
    db = MagicMock()
    config = MagicMock()
    config.vehicle_id = "27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6"
    config.scenario = "dual_tank_imbalance"
    config.duration = 300
    config.speed = 1.0

    mock_src = MagicMock()
    mock_src.telemetry_definition_path = "simulators/drogonsat.yaml"
    monkeypatch.setattr(
        "app.routes.simulator._resolve_simulator_source",
        lambda _db, _source_id: mock_src,
    )
    monkeypatch.setattr(
        "app.routes.simulator._resolve_with_audit",
        lambda _db, _source_id, _action: "http://simulator:8010",
    )

    async def fake_proxy_post(_base_url, _path, _body):
        raise HTTPException(status_code=400, detail="Unknown scenario: dual_tank_imbalance")

    monkeypatch.setattr("app.routes.simulator._proxy_post", fake_proxy_post)

    with pytest.raises(HTTPException) as exc_info:
        await simulator_start(config=config, db=db)

    assert exc_info.value.status_code == 400
    assert "Unknown scenario" in str(exc_info.value.detail)


@pytest.mark.anyio
async def test_simulator_status_uses_runtime_supported_scenarios(monkeypatch) -> None:
    db = MagicMock()
    scenarios = [
        {"name": "nominal", "description": "Nominal operations"},
        {"name": "dual_tank_imbalance", "description": "Fuel imbalance"},
    ]

    monkeypatch.setattr(
        "app.routes.simulator._resolve_with_audit",
        lambda _db, _source_id, _action: "http://simulator:8010",
    )

    async def fake_proxy_get(_base_url, _path):
        return {
            "state": "idle",
            "config": None,
            "sim_elapsed": 0,
            "supported_scenarios": scenarios,
        }

    monkeypatch.setattr("app.routes.simulator._proxy_get", fake_proxy_get)

    payload = await simulator_status(vehicle_id="27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6", db=db)

    assert payload == {
        "connected": True,
        "state": "idle",
        "config": None,
        "sim_elapsed": 0,
        "supported_scenarios": scenarios,
    }


@pytest.mark.anyio
async def test_simulator_status_returns_disconnected_on_missing_source(monkeypatch) -> None:
    db = MagicMock()

    monkeypatch.setattr(
        "app.routes.simulator._resolve_with_audit",
        lambda _db, _source_id, _action: (_ for _ in ()).throw(
            HTTPException(status_code=404, detail="Source not found")
        ),
    )

    payload = await simulator_status(vehicle_id="does-not-exist", db=db)

    assert payload == {"connected": False, "supported_scenarios": []}


@pytest.mark.anyio
async def test_simulator_status_normalizes_legacy_source_alias(monkeypatch) -> None:
    db = MagicMock()
    seen: dict[str, str] = {}

    def fake_resolve(_db, source_id, _action):
        seen["source_id"] = source_id
        return "http://simulator:8010"

    async def fake_proxy_get(_base_url, _path):
        return {
            "state": "idle",
            "config": None,
            "sim_elapsed": 0,
            "supported_scenarios": [],
        }

    monkeypatch.setattr("app.routes.simulator._resolve_with_audit", fake_resolve)
    monkeypatch.setattr("app.routes.simulator._proxy_get", fake_proxy_get)

    payload = await simulator_status(vehicle_id="simulator", db=db)

    assert seen["source_id"] == "27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6"
    assert payload["connected"] is True
