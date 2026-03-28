from __future__ import annotations

import sys
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import MagicMock

import pytest

sys.modules.setdefault(
    "app.services.embedding_service",
    SimpleNamespace(SentenceTransformerEmbeddingProvider=object),
)
sys.modules.setdefault(
    "app.services.llm_service",
    SimpleNamespace(
        MockLLMProvider=object,
        OpenAICompatibleLLMProvider=object,
    ),
)

from app.models.schemas import TelemetryDataIngest, TelemetrySchemaCreate, WatchlistAddRequest
from app.routes import ops as ops_routes
from app.routes import position as position_routes
from app.routes import telemetry as telemetry_routes
from app.services import telemetry_service as telemetry_service_module
from app.services.telemetry_service import TelemetryService
from app.services import realtime_service


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalars(self):
        return self

    def first(self):
        return self._value


class _FetchAllResult:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows


def test_telemetry_routes_use_renamed_request_fields(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeService:
        def __init__(self, *_args):
            pass

        def create_schema(self, **kwargs):
            captured["create_schema"] = kwargs
            return uuid4()

        def insert_data(
            self,
            stream_id: str,
            telemetry_name: str,
            data,
            *,
            vehicle_id: str | None = None,
            packet_source: str | None = None,
            receiver_id: str | None = None,
        ):
            captured["insert_data"] = {
                "stream_id": stream_id,
                "vehicle_id": vehicle_id,
                "telemetry_name": telemetry_name,
                "rows": len(data),
                "packet_source": packet_source,
                "receiver_id": receiver_id,
            }
            return len(data)

    monkeypatch.setattr(telemetry_routes, "TelemetryService", FakeService)
    monkeypatch.setattr(telemetry_routes, "audit_log", lambda *_args, **_kwargs: None)

    add_calls: list[tuple[str, str]] = []
    monkeypatch.setattr(
        telemetry_routes,
        "add_to_watchlist",
        lambda _db, vehicle_id, telemetry_name: add_calls.append((vehicle_id, telemetry_name)),
    )

    telemetry_routes.create_schema(
        body=TelemetrySchemaCreate(
            vehicle_id="vehicle-a",
            name="VBAT",
            units="V",
        ),
        db=MagicMock(),
        embedding=object(),
        llm=object(),
    )

    telemetry_routes.ingest_data(
        body=TelemetryDataIngest(
            telemetry_name="VBAT",
            data=[{"timestamp": "2026-03-28T12:00:00Z", "value": 4.2}],
            vehicle_id="vehicle-a",
            stream_id="vehicle-a-2026-03-28T12-00-00Z",
            packet_source="ground-station-a",
            receiver_id="rx-7",
        ),
        db=MagicMock(),
        embedding=object(),
        llm=object(),
    )

    telemetry_routes.add_watchlist(
        body=WatchlistAddRequest(vehicle_id="vehicle-a", telemetry_name="VBAT"),
        db=MagicMock(),
    )

    assert captured["create_schema"] == {
        "source_id": "vehicle-a",
        "name": "VBAT",
        "units": "V",
        "description": None,
        "subsystem_tag": None,
        "red_low": None,
        "red_high": None,
    }
    assert captured["insert_data"] == {
        "stream_id": "vehicle-a-2026-03-28T12-00-00Z",
        "vehicle_id": "vehicle-a",
        "telemetry_name": "VBAT",
        "rows": 1,
        "packet_source": "ground-station-a",
        "receiver_id": "rx-7",
    }
    assert add_calls == [("vehicle-a", "VBAT")]


def test_set_active_run_accepts_opaque_stream_ids(monkeypatch) -> None:
    captured: dict[str, object] = {}

    monkeypatch.setattr(telemetry_routes, "audit_log", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(telemetry_routes, "get_stream_vehicle_id", lambda _db, _stream_id: None)
    monkeypatch.setattr(
        telemetry_routes,
        "register_stream",
        lambda _db, *, vehicle_id, stream_id, packet_source=None, receiver_id=None, seen_at=None: captured.update(
            vehicle_id=vehicle_id,
            stream_id=stream_id,
            packet_source=packet_source,
            receiver_id=receiver_id,
            seen_at=seen_at,
        ),
    )

    response = telemetry_routes.set_active_run(
        body=telemetry_routes.ActiveRunUpdate(
            vehicle_id="vehicle-a",
            stream_id="2d2cc0c2-5a5a-4ac6-8f2d-7d04d6c35b0e",
            state="active",
        ),
        db=MagicMock(),
    )

    assert response == {
        "status": "active",
        "vehicle_id": "vehicle-a",
        "stream_id": "2d2cc0c2-5a5a-4ac6-8f2d-7d04d6c35b0e",
    }
    assert captured["vehicle_id"] == "vehicle-a"
    assert captured["stream_id"] == "2d2cc0c2-5a5a-4ac6-8f2d-7d04d6c35b0e"


def test_set_active_run_rejects_mismatched_registered_stream(monkeypatch) -> None:
    monkeypatch.setattr(telemetry_routes, "audit_log", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(telemetry_routes, "get_stream_vehicle_id", lambda _db, _stream_id: "vehicle-b")

    with pytest.raises(telemetry_routes.HTTPException) as exc_info:
        telemetry_routes.set_active_run(
            body=telemetry_routes.ActiveRunUpdate(
                vehicle_id="vehicle-a",
                stream_id="2d2cc0c2-5a5a-4ac6-8f2d-7d04d6c35b0e",
                state="active",
            ),
            db=MagicMock(),
        )

    assert exc_info.value.status_code == 400


def test_insert_data_rejects_stream_vehicle_mismatch(monkeypatch) -> None:
    service = TelemetryService(MagicMock(), object(), object())
    captured: dict[str, str] = {}

    def fake_ensure(_db, vehicle_id, stream_id):
        captured["vehicle_id"] = vehicle_id
        captured["stream_id"] = stream_id
        raise ValueError("Run not found for source")

    monkeypatch.setattr(telemetry_service_module, "ensure_stream_belongs_to_vehicle", fake_ensure)
    monkeypatch.setattr(service, "get_by_name", lambda _source_id, _name: SimpleNamespace(id=uuid4()))

    with pytest.raises(ValueError) as exc_info:
        service.insert_data(
            "vehicle-b-2026-03-28T12-00-00Z",
            "VBAT",
            [(datetime(2026, 3, 28, 12, 0, tzinfo=timezone.utc), 4.2)],
            vehicle_id="vehicle-a",
        )

    assert "Run not found for source" in str(exc_info.value)
    assert captured == {
        "vehicle_id": "vehicle-a",
        "stream_id": "vehicle-b-2026-03-28T12-00-00Z",
    }


def test_run_listing_routes_emit_stream_ids() -> None:
    source_db = MagicMock()
    source_db.execute.side_effect = [
        _ScalarResult(SimpleNamespace(id="vehicle-a", name="Vehicle A")),
        _FetchAllResult([("vehicle-a-2026-03-28T12-00-00Z",), ("vehicle-a",)]),
        _FetchAllResult([("vehicle-a", "Vehicle A")]),
    ]

    response = telemetry_routes.get_source_runs("vehicle-a", db=source_db)

    assert [item.stream_id for item in response.sources] == [
        "vehicle-a-2026-03-28T12-00-00Z",
        "vehicle-a",
    ]


def test_channel_run_listing_route_emits_stream_ids(monkeypatch) -> None:
    monkeypatch.setattr(
        telemetry_routes,
        "_get_channel_meta",
        lambda _db, _source_id, _name: SimpleNamespace(id=uuid4()),
    )

    db = MagicMock()
    db.execute.side_effect = [
        _ScalarResult(SimpleNamespace(id="vehicle-a", name="Vehicle A")),
        _FetchAllResult([("vehicle-a-2026-03-28T12-00-00Z",)]),
        _FetchAllResult([("vehicle-a", "Vehicle A")]),
    ]

    response = telemetry_routes.get_channel_runs("VBAT", "vehicle-a", db=db)

    assert [item.stream_id for item in response.sources] == [
        "vehicle-a-2026-03-28T12-00-00Z"
    ]


def test_realtime_and_ops_responses_emit_vehicle_and_stream_ids(monkeypatch) -> None:
    now = datetime(2026, 3, 28, 12, 0, tzinfo=timezone.utc)

    snapshot_db = MagicMock()
    snapshot_db.execute.side_effect = [
        _FetchAllResult(
            [
                (
                    SimpleNamespace(
                        id=uuid4(),
                        name="VBAT",
                        units="V",
                        description="Battery voltage",
                        vehicle_id="vehicle-a",
                        subsystem_tag="power",
                        channel_origin="catalog",
                        discovery_namespace=None,
                    ),
                    SimpleNamespace(
                        value=4.2,
                        generation_time=now,
                        reception_time=now,
                        state="normal",
                        state_reason=None,
                        z_score=None,
                        quality="valid",
                    ),
                )
            ]
        ),
        _FetchAllResult([(now, 4.2)]),
    ]

    snapshot = realtime_service.get_realtime_snapshot_for_channels(
        snapshot_db,
        ["VBAT"],
        source_id="vehicle-a-2026-03-28T12-00-00Z",
    )

    assert snapshot[0].vehicle_id == "vehicle-a"
    assert snapshot[0].stream_id == "vehicle-a-2026-03-28T12-00-00Z"

    alerts_db = MagicMock()
    alerts_db.execute.return_value = _FetchAllResult(
        [
            (
                SimpleNamespace(
                    id=uuid4(),
                    source_id="vehicle-a-2026-03-28T12-00-00Z",
                    severity="warning",
                    reason="out_of_limits",
                    status="new",
                    opened_at=now,
                    opened_reception_at=now,
                    last_update_at=now,
                    current_value_at_open=4.2,
                    acked_at=None,
                    acked_by=None,
                ),
                SimpleNamespace(
                    id=uuid4(),
                    name="VBAT",
                    units="V",
                    vehicle_id="vehicle-a",
                    subsystem_tag="power",
                    red_low=None,
                    red_high=4.8,
                ),
            )
        ]
    )

    alerts = realtime_service.get_active_alerts(
        alerts_db,
        source_id="vehicle-a-2026-03-28T12-00-00Z",
    )

    assert alerts[0].vehicle_id == "vehicle-a"
    assert alerts[0].stream_id == "vehicle-a-2026-03-28T12-00-00Z"

    event = SimpleNamespace(
        id=uuid4(),
        vehicle_id="vehicle-a",
        stream_id="vehicle-a-2026-03-28T12-00-00Z",
        event_time=now,
        event_type="alert.opened",
        severity="warning",
        summary="VBAT out of limits",
        entity_type="channel",
        entity_id="VBAT",
        payload={"alert_id": "a1"},
        created_at=now,
    )

    captured: dict[str, object] = {}

    def fake_query_events(*_args, **kwargs):
        captured.update(kwargs)
        return [event], 1

    monkeypatch.setattr(ops_routes, "query_events", fake_query_events)
    response = ops_routes.get_timeline_events(
        vehicle_id="vehicle-a",
        stream_id="vehicle-a-2026-03-28T12-00-00Z",
        db=MagicMock(),
    )

    assert response.events[0].vehicle_id == "vehicle-a"
    assert response.events[0].stream_id == "vehicle-a-2026-03-28T12-00-00Z"
    assert captured["vehicle_id"] == "vehicle-a"
    assert captured["stream_id"] == "vehicle-a-2026-03-28T12-00-00Z"


def test_feed_status_route_emits_vehicle_id(monkeypatch) -> None:
    monkeypatch.setattr(
        ops_routes,
        "get_feed_health_tracker",
        lambda: SimpleNamespace(
            get_status=lambda _vehicle_id: {
                "source_id": "vehicle-a",
                "connected": True,
                "state": "connected",
                "last_reception_time": None,
                "approx_rate_hz": 1.25,
            }
        ),
    )

    response = ops_routes.get_feed_status(vehicle_id="vehicle-a")

    assert response["vehicle_id"] == "vehicle-a"
    assert response["connected"] is True


def test_position_routes_use_vehicle_filters(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_list_mappings(_db, vehicle_id=None):
        captured["list_vehicle_id"] = vehicle_id
        return []

    def fake_get_latest_positions(_db, vehicle_ids=None):
        captured["latest_vehicle_ids"] = vehicle_ids
        return []

    monkeypatch.setattr(
        position_routes,
        "list_mappings",
        fake_list_mappings,
    )
    monkeypatch.setattr(
        position_routes,
        "get_latest_positions",
        fake_get_latest_positions,
    )

    position_routes.get_position_config(vehicle_id="vehicle-a", db=MagicMock())
    position_routes.latest_positions(vehicle_ids=["vehicle-a"], db=MagicMock())

    assert captured["list_vehicle_id"] == "vehicle-a"
    assert captured["latest_vehicle_ids"] == ["vehicle-a"]
