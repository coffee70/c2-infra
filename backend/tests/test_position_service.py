"""Tests for source-aware position resolution."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.models.schemas import PositionSample
from app.models.telemetry import TelemetrySource
from app.services import position_service
from app.services.source_run_service import (
    clear_active_run,
    register_active_run,
    resolve_active_run_id,
    run_id_to_source_id,
)


class _FakeScalarResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _FakeHttpxResponse:
    def __init__(self, payload: dict, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def json(self) -> dict:
        return self._payload


class _FakeHttpxClient:
    def __init__(self, response: _FakeHttpxResponse):
        self._response = response

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def get(self, url: str):
        return self._response


def test_run_id_to_source_id_collapses_simulator_run() -> None:
    assert run_id_to_source_id("simulator-nominal-2026-03-13T17-12-34Z") == "simulator"
    assert run_id_to_source_id("simulator2-2026-03-13T17-12-34Z") == "simulator2"
    assert run_id_to_source_id("default") == "default"


def test_resolve_active_run_id_uses_simulator_status(monkeypatch) -> None:
    db = MagicMock()
    db.get.side_effect = lambda model, source_id: (
        TelemetrySource(
            id="simulator",
            name="Simulator",
            source_type="simulator",
            base_url="http://simulator:8001",
        )
        if source_id == "simulator"
        else None
    )

    monkeypatch.setattr(
        "app.services.source_run_service.httpx.Client",
        lambda timeout=2.0: _FakeHttpxClient(
            _FakeHttpxResponse(
                {
                    "state": "running",
                    "config": {
                        "source_id": "simulator-nominal-2026-03-13T17-12-34Z",
                    },
                }
            )
        ),
    )

    assert (
        resolve_active_run_id(db, "simulator")
        == "simulator-nominal-2026-03-13T17-12-34Z"
    )
    clear_active_run("simulator")


def test_resolve_active_run_id_prefers_recent_cached_run(monkeypatch) -> None:
    db = MagicMock()
    db.get.side_effect = lambda model, source_id: (
        TelemetrySource(
            id="simulator",
            name="Simulator",
            source_type="simulator",
            base_url="http://simulator:8001",
        )
        if source_id == "simulator"
        else None
    )

    register_active_run("simulator-orbit_decay-2026-03-13T19-17-52Z")

    def fail_client(timeout=2.0):
        raise AssertionError("status poll should not run")

    monkeypatch.setattr(
        "app.services.source_run_service.httpx.Client",
        fail_client,
    )

    assert (
        resolve_active_run_id(db, "simulator")
        == "simulator-orbit_decay-2026-03-13T19-17-52Z"
    )
    clear_active_run("simulator")


def test_register_active_run_does_not_roll_back_to_older_run() -> None:
    clear_active_run("simulator")
    register_active_run("simulator-orbit_highly_elliptical-2026-03-13T19-23-07Z")
    register_active_run("simulator-orbit_decay-2026-03-13T19-22-43Z")

    db = MagicMock()
    db.get.side_effect = lambda model, source_id: (
        TelemetrySource(
            id="simulator",
            name="Simulator",
            source_type="simulator",
            base_url="http://simulator:8001",
        )
        if source_id == "simulator"
        else None
    )

    assert (
        resolve_active_run_id(db, "simulator")
        == "simulator-orbit_highly_elliptical-2026-03-13T19-23-07Z"
    )
    clear_active_run("simulator")


def test_build_sample_for_mapping_reads_from_run_but_labels_logical_source(
    monkeypatch,
) -> None:
    requested_source_ids: list[str] = []
    now = datetime(2026, 3, 13, 17, 12, 40, tzinfo=timezone.utc)

    def fake_get_latest_for_channel(db, *, source_id: str, channel_name: str):
        requested_source_ids.append(source_id)
        values = {
            "GPS_LAT": 1.5,
            "GPS_LON": 2.5,
            "GPS_ALT": 400_000.0,
        }
        return values[channel_name], now

    monkeypatch.setattr(position_service, "_get_latest_for_channel", fake_get_latest_for_channel)

    mapping = SimpleNamespace(
        source_id="simulator",
        frame_type="gps_lla",
        lat_channel_name="GPS_LAT",
        lon_channel_name="GPS_LON",
        alt_channel_name="GPS_ALT",
        x_channel_name=None,
        y_channel_name=None,
        z_channel_name=None,
    )
    source = SimpleNamespace(
        id="simulator",
        name="Simulator",
        source_type="simulator",
    )

    sample = position_service._build_sample_for_mapping(
        MagicMock(),
        mapping,
        source,
        data_source_id="simulator-nominal-2026-03-13T17-12-34Z",
        now=now,
        staleness=position_service.timedelta(seconds=300),
    )

    assert requested_source_ids == [
        "simulator-nominal-2026-03-13T17-12-34Z",
        "simulator-nominal-2026-03-13T17-12-34Z",
        "simulator-nominal-2026-03-13T17-12-34Z",
    ]
    assert sample.source_id == "simulator"
    assert sample.source_name == "Simulator"
    assert sample.valid is True


def test_get_latest_positions_resolves_active_run_for_mapped_source(
    monkeypatch,
) -> None:
    db = MagicMock()
    mapping = SimpleNamespace(source_id="simulator")
    source = SimpleNamespace(
        id="simulator",
        name="Simulator",
        source_type="simulator",
    )
    db.execute.side_effect = [
        _FakeScalarResult([mapping]),
        _FakeScalarResult([source]),
    ]

    monkeypatch.setattr(
        position_service,
        "resolve_active_run_id",
        lambda db_session, source_id: "simulator-nominal-2026-03-13T17-12-34Z",
    )

    seen: dict[str, str] = {}

    def fake_build_sample(db_session, mapping_obj, source_obj, *, data_source_id, now, staleness):
        seen["data_source_id"] = data_source_id
        return PositionSample(
            source_id=source_obj.id,
            source_name=source_obj.name,
            source_type=source_obj.source_type,
            lat_deg=1.0,
            lon_deg=2.0,
            alt_m=3.0,
            timestamp=now.isoformat(),
            valid=True,
            frame_type="gps_lla",
        )

    monkeypatch.setattr(position_service, "_build_sample_for_mapping", fake_build_sample)

    samples = position_service.get_latest_positions(db, source_ids=["simulator"])

    assert len(samples) == 1
    assert samples[0].source_id == "simulator"
    assert seen["data_source_id"] == "simulator-nominal-2026-03-13T17-12-34Z"
