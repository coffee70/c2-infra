from __future__ import annotations

import sys
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

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

from app.models.schemas import (
    MeasurementEventBatch,
    TelemetryDataIngest,
    TelemetrySchemaCreate,
    WatchlistAddRequest,
)
from app.routes import ops as ops_routes
from app.routes import realtime as realtime_routes
from app.routes import simulator as simulator_routes
from app.routes import position as position_routes
from app.routes import telemetry as telemetry_routes
from app.services import telemetry_service as telemetry_service_module
from app.services import overview_service as overview_service_module
from app.services.telemetry_service import TelemetryService
from app.services.source_run_service import (
    StreamIdConflictError,
    ensure_stream_belongs_to_vehicle,
    register_stream,
)
from app.services import realtime_service
from app.models.telemetry import TelemetrySource


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


def test_set_active_run_registers_new_stream_ids(monkeypatch) -> None:
    captured: dict[str, object] = {}

    monkeypatch.setattr(telemetry_routes, "audit_log", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        telemetry_routes,
        "resolve_logical_vehicle_id",
        lambda _db, _source_id: "vehicle-a",
    )
    monkeypatch.setattr(telemetry_routes, "get_stream_vehicle_id", lambda *_args: None)
    monkeypatch.setattr(
        telemetry_routes,
        "register_stream",
        lambda _db, *, vehicle_id, stream_id, packet_source=None, receiver_id=None, started_at=None, seen_at=None: captured.update(
            vehicle_id=vehicle_id,
            stream_id=stream_id,
            packet_source=packet_source,
            receiver_id=receiver_id,
            started_at=started_at,
            seen_at=seen_at,
        ),
    )

    response = telemetry_routes.set_active_run(
        body=telemetry_routes.ActiveRunUpdate(
            vehicle_id="opaque-stream-id",
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


def test_overview_service_resolves_stream_inputs_to_logical_vehicle(monkeypatch) -> None:
    from app.services.overview_service import get_all_telemetry_channels_for_source, get_watchlist

    logical_vehicle_id = "vehicle-a"
    opaque_source_id = "opaque-stream-id"
    telemetry_id = uuid4()
    db = MagicMock()
    captured_sql: list[str] = []
    alias_vehicle_ids: list[str] = []

    class _FetchAllResult:
        def __init__(self, rows):
            self._rows = rows

        def fetchall(self):
            return self._rows

    first_rows = [(telemetry_id, "VBAT", "catalog", None)]
    second_rows = [(logical_vehicle_id, "VBAT", 0, telemetry_id, "catalog", None)]

    def fake_execute(statement):
        captured_sql.append(str(statement.compile(compile_kwargs={"literal_binds": True})))
        if len(captured_sql) == 1:
            return _FetchAllResult(first_rows)
        return _FetchAllResult(second_rows)

    db.execute.side_effect = fake_execute
    monkeypatch.setattr(
        overview_service_module,
        "resolve_logical_vehicle_id",
        lambda _db, _source_id: logical_vehicle_id,
    )
    monkeypatch.setattr(
        overview_service_module,
        "get_aliases_by_telemetry_ids",
        lambda _db, *, vehicle_id, telemetry_ids: (
            alias_vehicle_ids.append(vehicle_id)
            or ({telemetry_ids[0]: ["BAT"]} if telemetry_ids else {})
        ),
    )

    channels = get_all_telemetry_channels_for_source(db, opaque_source_id)
    watchlist_rows = get_watchlist(
        db,
        opaque_source_id,
    )

    assert channels == [
        {
            "name": "VBAT",
            "aliases": ["BAT"],
            "channel_origin": "catalog",
            "discovery_namespace": None,
        }
    ]
    assert watchlist_rows == [
        {
            "source_id": logical_vehicle_id,
            "name": "VBAT",
            "aliases": ["BAT"],
            "display_order": 0,
            "channel_origin": "catalog",
            "discovery_namespace": None,
        }
    ]
    assert alias_vehicle_ids == [logical_vehicle_id, logical_vehicle_id]
    assert any(f"telemetry_metadata.source_id = '{logical_vehicle_id}'" in sql for sql in captured_sql)
    assert any(f"watchlist.source_id = '{logical_vehicle_id}'" in sql for sql in captured_sql)


def test_telemetry_filter_routes_resolve_stream_inputs_to_logical_vehicle(monkeypatch) -> None:
    logical_vehicle_id = "vehicle-a"
    opaque_source_id = "opaque-stream-id"
    db = MagicMock()
    captured_sql: list[str] = []

    class _Result:
        def __init__(self, rows):
            self._rows = rows

        def scalars(self):
            return self

        def all(self):
            return self._rows

        def fetchall(self):
            return self._rows

    subsystem_meta = SimpleNamespace(name="BATTERY_VOLT", units="V")

    def fake_execute(statement):
        captured_sql.append(str(statement.compile(compile_kwargs={"literal_binds": True})))
        if len(captured_sql) == 1:
            return _Result([subsystem_meta])
        if len(captured_sql) == 2:
            return _Result([("V",)])
        return _Result([("stream-1", datetime(2026, 3, 28, 12, 0, tzinfo=timezone.utc))])

    db.execute.side_effect = fake_execute
    monkeypatch.setattr(
        telemetry_routes,
        "resolve_logical_vehicle_id",
        lambda _db, _source_id: logical_vehicle_id,
    )
    monkeypatch.setattr(telemetry_routes, "infer_subsystem", lambda _name, _meta: "power")

    subsystems = telemetry_routes.list_subsystems(source_id=opaque_source_id, db=db)
    units = telemetry_routes.list_units(source_id=opaque_source_id, db=db)
    sources = telemetry_routes.get_source_runs(source_id=opaque_source_id, db=db)

    assert subsystems == {"subsystems": ["power"]}
    assert units == {"units": ["V"]}
    assert sources.sources[0].stream_id == "stream-1"
    assert any(f"telemetry_metadata.source_id = '{logical_vehicle_id}'" in sql for sql in captured_sql)


def test_overview_summary_routes_resolve_stream_inputs_to_logical_vehicle(monkeypatch) -> None:
    from app.services.overview_service import get_anomalies, get_overview

    logical_vehicle_id = "vehicle-a"
    opaque_source_id = "opaque-stream-id"
    telemetry_id = uuid4()
    meta = SimpleNamespace(
        id=telemetry_id,
        name="VBAT",
        units="V",
        description=None,
        channel_origin=None,
        discovery_namespace=None,
        red_low=None,
        red_high=4.5,
    )
    stats = SimpleNamespace(std_dev=1.0, mean=4.0)
    current = SimpleNamespace(value=5.0, generation_time=datetime(2026, 3, 28, 12, 0, tzinfo=timezone.utc))
    db = MagicMock()
    captured_sql: list[str] = []

    class _Result:
        def __init__(self, first_value, rows):
            self._first_value = first_value
            self._rows = rows

        def scalars(self):
            return self

        def first(self):
            return self._first_value

        def fetchall(self):
            return self._rows

    def fake_execute(statement):
        captured_sql.append(str(statement.compile(compile_kwargs={"literal_binds": True})))
        return _Result(meta, [(meta, stats)])

    db.execute.side_effect = fake_execute
    db.get.side_effect = lambda model, key: current if model is overview_service_module.TelemetryCurrent and key == (opaque_source_id, telemetry_id) else stats if model is overview_service_module.TelemetryStatistics and key == (opaque_source_id, telemetry_id) else None

    monkeypatch.setattr(
        overview_service_module,
        "resolve_logical_vehicle_id",
        lambda _db, _source_id: logical_vehicle_id,
    )
    monkeypatch.setattr(
        overview_service_module,
        "get_watchlist",
        lambda _db, _source_id: [
            {
                "source_id": logical_vehicle_id,
                "name": meta.name,
                "aliases": ["BAT"],
                "display_order": 0,
                "channel_origin": "catalog",
                "discovery_namespace": None,
            }
        ],
    )
    monkeypatch.setattr(
        overview_service_module,
        "get_all_telemetry_channels_for_source",
        lambda _db, _source_id: [
            {
                "name": meta.name,
                "aliases": ["BAT"],
                "channel_origin": "catalog",
                "discovery_namespace": None,
            }
        ],
    )
    monkeypatch.setattr(overview_service_module, "infer_subsystem", lambda _name, _meta: "power")
    monkeypatch.setattr(overview_service_module, "_get_recent_for_sparkline", lambda *_args, **_kwargs: [])

    overview = get_overview(db, opaque_source_id)
    anomalies = get_anomalies(db, opaque_source_id)

    assert overview[0]["name"] == "VBAT"
    assert overview[0]["aliases"] == ["BAT"]
    assert anomalies["power"][0]["name"] == "VBAT"
    assert any(f"telemetry_metadata.source_id = '{logical_vehicle_id}'" in sql for sql in captured_sql)


def test_set_active_run_rejects_stream_vehicle_mismatch(monkeypatch) -> None:
    monkeypatch.setattr(telemetry_routes, "audit_log", lambda *_args, **_kwargs: None)
    calls: list[str] = []
    monkeypatch.setattr(
        telemetry_routes,
        "get_stream_vehicle_id",
        lambda _db, _stream_id: "vehicle-b",
    )
    monkeypatch.setattr(
        telemetry_routes,
        "register_stream",
        lambda _db, *, vehicle_id, stream_id, packet_source=None, receiver_id=None, started_at=None, seen_at=None: calls.append(
            f"register:{vehicle_id}:{stream_id}"
        ),
    )

    with pytest.raises(telemetry_routes.HTTPException) as exc_info:
        telemetry_routes.set_active_run(
            body=telemetry_routes.ActiveRunUpdate(
                vehicle_id="vehicle-a",
                stream_id="vehicle-b-2026-03-28T12-00-00Z",
                state="active",
            ),
            db=MagicMock(),
        )

    assert exc_info.value.status_code == 400
    assert calls == []


def test_set_active_run_idle_clears_active_stream(monkeypatch) -> None:
    captured: dict[str, object] = {}

    monkeypatch.setattr(telemetry_routes, "audit_log", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        telemetry_routes,
        "resolve_logical_vehicle_id",
        lambda _db, source_id: source_id,
    )
    monkeypatch.setattr(
        telemetry_routes,
        "clear_active_stream",
        lambda source_id, *, db=None: captured.update(source_id=source_id, db=db),
    )

    response = telemetry_routes.set_active_run(
        body=telemetry_routes.ActiveRunUpdate(
            vehicle_id="vehicle-a",
            state="idle",
        ),
        db=MagicMock(),
    )

    assert response == {"status": "idle", "vehicle_id": "vehicle-a"}
    assert captured["source_id"] == "vehicle-a"
    assert isinstance(captured["db"], MagicMock)


def test_resolve_scoped_run_id_defaults_to_active_stream(monkeypatch) -> None:
    db = MagicMock()

    monkeypatch.setattr(
        telemetry_routes,
        "ensure_run_belongs_to_source",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("unexpected explicit run lookup")),
    )
    monkeypatch.setattr(
        telemetry_routes,
        "resolve_active_stream_id",
        lambda _db, source_id: f"{source_id}-active-stream",
    )

    assert telemetry_routes._resolve_scoped_run_id(db, "vehicle-a") == "vehicle-a-active-stream"


def test_realtime_stream_vehicle_resolution_prefers_registry(monkeypatch) -> None:
    opaque_stream_id = "c3bb4cf5-21dd-4b84-bc91-1e3a3a944f78"
    legacy_stream_id = "vehicle-a-2026-03-28T12-00-00Z"

    monkeypatch.setattr(
        realtime_routes,
        "get_stream_vehicle_id",
        lambda _db, _stream_id: "vehicle-a",
    )
    monkeypatch.setattr(
        realtime_routes,
        "run_id_to_source_id",
        lambda stream_id: f"legacy:{stream_id}",
    )

    assert (
        realtime_routes._resolve_stream_vehicle_id(MagicMock(), opaque_stream_id)
        == "vehicle-a"
    )

    monkeypatch.setattr(
        realtime_routes,
        "get_stream_vehicle_id",
        lambda _db, _stream_id: None,
    )

    expected_legacy_vehicle_id = f"legacy:{legacy_stream_id}"
    assert (
        realtime_routes._resolve_stream_vehicle_id(MagicMock(), legacy_stream_id)
        == expected_legacy_vehicle_id
    )


def test_realtime_helpers_use_registry_for_opaque_stream_ids(monkeypatch) -> None:
    vehicle_id = "vehicle-a"
    opaque_stream_id = "c3bb4cf5-21dd-4b84-bc91-1e3a3a944f78"
    now = datetime(2026, 3, 28, 12, 0, tzinfo=timezone.utc)

    monkeypatch.setattr(realtime_service, "get_stream_vehicle_id", lambda _db, _stream_id: vehicle_id)
    monkeypatch.setattr(
        realtime_service,
        "run_id_to_source_id",
        lambda stream_id: f"legacy:{stream_id}",
    )

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
                        vehicle_id=vehicle_id,
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
        source_id=opaque_stream_id,
    )

    assert snapshot[0].vehicle_id == vehicle_id
    assert snapshot[0].stream_id == opaque_stream_id
    snapshot_params = snapshot_db.execute.call_args_list[0].args[0].compile().params.values()
    assert vehicle_id in snapshot_params
    assert f"legacy:{opaque_stream_id}" not in snapshot_params

    watchlist_db = MagicMock()
    watchlist_db.execute.return_value = _FetchAllResult([("VBAT",)])

    channels = realtime_service.get_watchlist_channel_names(watchlist_db, opaque_stream_id)

    assert channels == ["VBAT"]
    watchlist_params = watchlist_db.execute.call_args.args[0].compile().params.values()
    assert vehicle_id in watchlist_params
    assert f"legacy:{opaque_stream_id}" not in watchlist_params

    alerts_db = MagicMock()
    alerts_db.execute.return_value = _FetchAllResult(
        [
            (
                SimpleNamespace(
                    id=uuid4(),
                    source_id=opaque_stream_id,
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
                    vehicle_id=vehicle_id,
                    subsystem_tag="power",
                    red_low=None,
                    red_high=4.8,
                ),
            )
        ]
    )

    alerts = realtime_service.get_active_alerts(alerts_db, source_id=opaque_stream_id)

    assert alerts[0].vehicle_id == vehicle_id
    assert alerts[0].stream_id == opaque_stream_id
    alert_params = alerts_db.execute.call_args.args[0].compile().params.values()
    assert vehicle_id in alert_params
    assert f"legacy:{opaque_stream_id}" not in alert_params


def test_realtime_helpers_resolve_active_stream_for_vehicle_scope(monkeypatch) -> None:
    vehicle_id = "vehicle-a"
    active_stream_id = "vehicle-a-2026-03-28T12-00-00Z"
    now = datetime(2026, 3, 28, 12, 0, tzinfo=timezone.utc)

    monkeypatch.setattr(realtime_service, "get_stream_vehicle_id", lambda _db, _stream_id: None)
    monkeypatch.setattr(realtime_service, "run_id_to_source_id", lambda source_id: source_id)
    monkeypatch.setattr(
        realtime_service,
        "resolve_active_stream_id",
        lambda _db, logical_source_id: active_stream_id if logical_source_id == vehicle_id else logical_source_id,
    )

    snapshot_db = MagicMock()
    snapshot_db.get.side_effect = lambda model, key: None if model.__name__ == "TelemetryStream" and key == vehicle_id else None
    snapshot_db.execute.side_effect = [
        _FetchAllResult(
            [
                (
                    SimpleNamespace(
                        id=uuid4(),
                        name="VBAT",
                        units="V",
                        description="Battery voltage",
                        vehicle_id=vehicle_id,
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
        source_id=vehicle_id,
    )

    assert snapshot[0].vehicle_id == vehicle_id
    assert snapshot[0].stream_id == active_stream_id
    snapshot_params = snapshot_db.execute.call_args_list[0].args[0].compile().params.values()
    assert active_stream_id in snapshot_params


@pytest.mark.anyio
async def test_realtime_ingest_allows_same_vehicle_stream_ids_before_queueing(monkeypatch) -> None:
    db = MagicMock()
    source = TelemetrySource(
        id="vehicle-a",
        name="Vehicle A",
        source_type="vehicle",
        telemetry_definition_path="defs/vehicle-a.yaml",
    )
    db.get.side_effect = lambda model, key: source if model is TelemetrySource and key == "vehicle-a" else None

    class FakeBus:
        def publish_measurement(self, *_args, **_kwargs):
            return True

        def measurement_queue_size(self):
            return 0

        def measurement_queue_maxsize(self):
            return 1

    request = SimpleNamespace(
        state=SimpleNamespace(request_id="req-1"),
        headers={"X-Request-ID": "req-1"},
        method="POST",
        url=SimpleNamespace(path="/realtime/ingest"),
    )

    monkeypatch.setattr(realtime_routes, "get_session_factory", lambda: lambda: db)
    monkeypatch.setattr(realtime_routes, "get_realtime_bus", lambda: FakeBus())
    monkeypatch.setattr(realtime_routes, "get_stream_vehicle_id", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(realtime_routes, "audit_log", lambda *_args, **_kwargs: None)

    response = await realtime_routes.ingest_realtime(
        body=MeasurementEventBatch.model_validate(
            {
                "events": [
                    {
                        "vehicle_id": "vehicle-a",
                        "stream_id": "vehicle-a",
                        "channel_name": "VBAT",
                        "value": 4.2,
                        "reception_time": "2026-03-28T12:00:00Z",
                    }
                ]
            }
        ),
        request=request,
    )

    assert response == {"accepted": 1}
    db.get.assert_called_once()


def test_register_stream_rejects_vehicle_reassignment() -> None:
    stream = SimpleNamespace(
        id="vehicle-b-2026-03-28T12-00-00Z",
        vehicle_id="vehicle-b",
        status="idle",
        last_seen_at=None,
        packet_source=None,
        receiver_id=None,
    )
    db = MagicMock()
    db.get.side_effect = lambda model, key: stream if model.__name__ == "TelemetryStream" and key == stream.id else None

    with pytest.raises(ValueError) as exc_info:
        register_stream(db, vehicle_id="vehicle-a", stream_id=stream.id)

    assert "Run not found for source" in str(exc_info.value)
    assert stream.vehicle_id == "vehicle-b"
    db.add.assert_not_called()


def test_register_stream_rejects_reserved_vehicle_id() -> None:
    db = MagicMock()
    db.get.side_effect = lambda model, key: (
        TelemetrySource(
            id="vehicle-a",
            name="Vehicle A",
            source_type="vehicle",
            telemetry_definition_path="defs/vehicle-a.yaml",
        )
        if model is TelemetrySource and key == "vehicle-a"
        else None
    )

    with pytest.raises(StreamIdConflictError) as exc_info:
        register_stream(db, vehicle_id="vehicle-b", stream_id="vehicle-a")

    assert "conflicts" in str(exc_info.value)
    db.execute.assert_not_called()


def test_register_stream_allows_reserved_vehicle_id_for_same_vehicle() -> None:
    db = MagicMock()
    source = TelemetrySource(
        id="vehicle-a",
        name="Vehicle A",
        source_type="vehicle",
        telemetry_definition_path="defs/vehicle-a.yaml",
    )
    stream = SimpleNamespace(
        id="vehicle-a",
        vehicle_id="vehicle-a",
        status="idle",
        last_seen_at=None,
        packet_source=None,
        receiver_id=None,
        started_at=None,
    )
    db.get.side_effect = [source, None, stream]
    db.execute.return_value = None

    observed_at = datetime(2026, 3, 28, 12, 0, tzinfo=timezone.utc)
    registered = register_stream(
        db,
        vehicle_id="vehicle-a",
        stream_id="vehicle-a",
        started_at=observed_at,
        seen_at=observed_at,
    )

    assert registered is stream
    assert stream.vehicle_id == "vehicle-a"
    assert stream.status == "active"
    assert stream.started_at == observed_at
    assert stream.last_seen_at == observed_at
    db.execute.assert_called_once()


def test_ensure_stream_belongs_to_vehicle_rejects_vehicle_id_as_explicit_run(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "app.services.source_run_service.get_stream_vehicle_id",
        lambda _db, _stream_id: None,
    )

    with pytest.raises(ValueError) as exc_info:
        ensure_stream_belongs_to_vehicle(
            MagicMock(),
            vehicle_id="vehicle-a",
            stream_id="vehicle-a",
        )

    assert "Run not found for source" in str(exc_info.value)


def test_register_stream_uses_idempotent_missing_row_path() -> None:
    stream_id = "vehicle-a-2026-03-28T12-00-00Z"
    observed_at = datetime(2026, 3, 28, 12, 0, tzinfo=timezone.utc)
    stream = SimpleNamespace(
        id=stream_id,
        vehicle_id="vehicle-a",
        status="idle",
        last_seen_at=None,
        packet_source=None,
        receiver_id=None,
    )
    db = MagicMock()
    db.get.side_effect = [None, None, stream]

    captured: dict[str, object] = {}

    def fake_execute(statement):
        captured["statement"] = statement
        return None

    db.execute.side_effect = fake_execute

    registered = register_stream(
        db,
        vehicle_id="vehicle-a",
        stream_id=stream_id,
        packet_source="ground-station-a",
        receiver_id="rx-7",
        started_at=datetime(2026, 3, 28, 11, 59, tzinfo=timezone.utc),
        seen_at=observed_at,
    )

    assert captured["statement"] is not None
    db.add.assert_not_called()
    assert registered is stream
    assert stream.vehicle_id == "vehicle-a"
    assert stream.status == "active"
    assert stream.started_at == datetime(2026, 3, 28, 11, 59, tzinfo=timezone.utc)
    assert stream.last_seen_at == observed_at
    assert stream.packet_source == "ground-station-a"
    assert stream.receiver_id == "rx-7"


def test_set_active_run_rejects_vehicle_id_collision(monkeypatch) -> None:
    monkeypatch.setattr(telemetry_routes, "audit_log", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(telemetry_routes, "get_stream_vehicle_id", lambda *_args: None)
    monkeypatch.setattr(
        telemetry_routes,
        "register_stream",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            StreamIdConflictError("stream_id conflicts with an existing vehicle id")
        ),
    )

    with pytest.raises(telemetry_routes.HTTPException) as exc_info:
        telemetry_routes.set_active_run(
            body=telemetry_routes.ActiveRunUpdate(
                vehicle_id="vehicle-b",
                stream_id="vehicle-a",
                state="active",
            ),
            db=MagicMock(),
        )

    assert exc_info.value.status_code == 400


def test_ingest_data_rejects_vehicle_id_collision(monkeypatch) -> None:
    class FakeService:
        def __init__(self, *_args):
            pass

        def insert_data(self, *_args, **_kwargs):
            raise StreamIdConflictError("stream_id conflicts with an existing vehicle id")

    monkeypatch.setattr(telemetry_routes, "TelemetryService", FakeService)
    monkeypatch.setattr(telemetry_routes, "audit_log", lambda *_args, **_kwargs: None)

    with pytest.raises(telemetry_routes.HTTPException) as exc_info:
        telemetry_routes.ingest_data(
            body=TelemetryDataIngest(
                telemetry_name="VBAT",
                data=[{"timestamp": "2026-03-28T12:00:00Z", "value": 4.2}],
                vehicle_id="vehicle-b",
                stream_id="vehicle-a",
                packet_source="ground-station-a",
                receiver_id="rx-7",
            ),
            db=MagicMock(),
            embedding=object(),
            llm=object(),
        )

    assert exc_info.value.status_code == 400


def test_insert_data_rejects_stream_vehicle_mismatch(monkeypatch) -> None:
    service = TelemetryService(MagicMock(), object(), object())
    calls: list[str] = []

    monkeypatch.setattr(
        telemetry_service_module,
        "get_stream_vehicle_id",
        lambda _db, _stream_id: "vehicle-b",
    )
    monkeypatch.setattr(
        telemetry_service_module,
        "register_stream",
        lambda _db, *, vehicle_id, stream_id, packet_source=None, receiver_id=None, started_at=None, seen_at=None: calls.append(
            f"register:{vehicle_id}:{stream_id}"
        ),
    )
    monkeypatch.setattr(service, "get_by_name", lambda _source_id, _name: SimpleNamespace(id=uuid4()))

    with pytest.raises(ValueError) as exc_info:
        service.insert_data(
            "vehicle-b-2026-03-28T12-00-00Z",
            "VBAT",
            [(datetime(2026, 3, 28, 12, 0, tzinfo=timezone.utc), 4.2)],
            vehicle_id="vehicle-a",
        )

    assert "Run not found for source" in str(exc_info.value)
    assert calls == []


def test_insert_data_registers_new_stream_without_prior_persistence(monkeypatch) -> None:
    service = TelemetryService(MagicMock(), object(), object())
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        telemetry_service_module,
        "get_stream_vehicle_id",
        lambda _db, _stream_id: None,
    )
    monkeypatch.setattr(
        telemetry_service_module,
        "register_stream",
        lambda _db, *, vehicle_id, stream_id, packet_source=None, receiver_id=None, started_at=None, seen_at=None: captured.update(
            {
                "vehicle_id": vehicle_id,
                "stream_id": stream_id,
                "packet_source": packet_source,
                "receiver_id": receiver_id,
                "started_at": started_at,
                "seen_at": seen_at,
            }
        ),
    )
    monkeypatch.setattr(service, "get_by_name", lambda _source_id, _name: SimpleNamespace(id=uuid4()))

    rows = service.insert_data(
        "vehicle-a-2026-03-28T12-00-00Z",
        "VBAT",
        [
            (datetime(2026, 3, 28, 12, 3, tzinfo=timezone.utc), 4.2),
            (datetime(2026, 3, 28, 12, 0, tzinfo=timezone.utc), 4.1),
            (datetime(2026, 3, 28, 12, 5, tzinfo=timezone.utc), 4.3),
        ],
        vehicle_id="vehicle-a",
    )

    assert rows == 3
    assert captured == {
        "vehicle_id": "vehicle-a",
        "stream_id": "vehicle-a-2026-03-28T12-00-00Z",
        "packet_source": None,
        "receiver_id": None,
        "started_at": datetime(2026, 3, 28, 12, 0, tzinfo=timezone.utc),
        "seen_at": datetime(2026, 3, 28, 12, 5, tzinfo=timezone.utc),
    }


def test_insert_data_does_not_register_stream_when_telemetry_missing(monkeypatch) -> None:
    service = TelemetryService(MagicMock(), object(), object())
    calls: list[str] = []

    monkeypatch.setattr(
        telemetry_service_module,
        "get_stream_vehicle_id",
        lambda _db, _stream_id: None,
    )
    monkeypatch.setattr(
        telemetry_service_module,
        "register_stream",
        lambda _db, *, vehicle_id, stream_id, packet_source=None, receiver_id=None, started_at=None, seen_at=None: calls.append(
            f"register:{vehicle_id}:{stream_id}"
        ),
    )
    monkeypatch.setattr(service, "get_by_name", lambda _source_id, _name: None)

    with pytest.raises(ValueError) as exc_info:
        service.insert_data(
            "vehicle-a-2026-03-28T12-00-00Z",
            "VBAT",
            [(datetime(2026, 3, 28, 12, 0, tzinfo=timezone.utc), 4.2)],
            vehicle_id="vehicle-a",
        )

    assert "Telemetry not found" in str(exc_info.value)
    assert calls == []


def test_run_listing_routes_emit_stream_ids() -> None:
    source_db = MagicMock()

    def fake_execute(statement):
        sql = str(statement).lower()
        assert "telemetry_streams" in sql
        assert "telemetry_data" not in sql
        return _FetchAllResult(
            [
                ("a6107734-80af-4f61-8c69-d53ab64dd13a", datetime(2026, 3, 28, 12, 5, tzinfo=timezone.utc)),
                ("7bc0f5c6-2f47-4e88-9f1e-0ce5d73d0b2b", datetime(2026, 3, 28, 12, 0, tzinfo=timezone.utc)),
            ]
        )

    source_db.execute.side_effect = fake_execute

    response = telemetry_routes.get_source_runs("vehicle-a", db=source_db)

    assert [item.stream_id for item in response.sources] == [
        "a6107734-80af-4f61-8c69-d53ab64dd13a",
        "7bc0f5c6-2f47-4e88-9f1e-0ce5d73d0b2b",
    ]


@pytest.mark.anyio
async def test_simulator_status_registers_stream_id_from_config(monkeypatch) -> None:
    db = MagicMock()
    registered: dict[str, object] = {}

    def fake_resolve_with_audit(_db, source_id, _action):
        registered["source_id"] = source_id
        return "http://simulator:8010"

    monkeypatch.setattr(
        simulator_routes,
        "_resolve_with_audit",
        fake_resolve_with_audit,
    )

    async def fake_proxy_get(_base_url, _path):
        return {
            "state": "active",
            "config": {
                "stream_id": "vehicle-a-2026-03-28T12-00-00Z",
                "packet_source": "simulator-link",
                "receiver_id": "rx-1",
            },
            "supported_scenarios": [],
        }

    monkeypatch.setattr(simulator_routes, "_proxy_get", fake_proxy_get)

    monkeypatch.setattr(
        simulator_routes,
        "register_stream",
        lambda db_arg, *, vehicle_id, stream_id, packet_source=None, receiver_id=None, started_at=None, seen_at=None: registered.update(
            {
                "db": db_arg,
                "vehicle_id": vehicle_id,
                "stream_id": stream_id,
                "packet_source": packet_source,
                "receiver_id": receiver_id,
                "started_at": started_at,
                "seen_at": seen_at,
            }
        ),
    )

    response = await simulator_routes.simulator_status(vehicle_id="vehicle-a", db=db)

    assert response["connected"] is True
    assert registered == {
        "source_id": "vehicle-a",
        "db": db,
        "vehicle_id": "vehicle-a",
        "stream_id": "vehicle-a-2026-03-28T12-00-00Z",
        "packet_source": "simulator-link",
        "receiver_id": "rx-1",
        "started_at": None,
        "seen_at": None,
    }


@pytest.mark.anyio
async def test_simulator_start_registers_stream_id_from_response(monkeypatch) -> None:
    db = MagicMock()
    registered: dict[str, object] = {}

    mock_src = SimpleNamespace(telemetry_definition_path=None)

    monkeypatch.setattr(
        simulator_routes,
        "_resolve_simulator_source",
        lambda _db, _source_id: mock_src,
    )
    monkeypatch.setattr(
        simulator_routes,
        "_resolve_with_audit",
        lambda _db, _source_id, _action: "http://simulator:8010",
    )

    async def fake_proxy_post(_base_url, _path, body):
        registered["body"] = body
        return {"stream_id": "a6107734-80af-4f61-8c69-d53ab64dd13a"}

    monkeypatch.setattr(simulator_routes, "_proxy_post", fake_proxy_post)
    monkeypatch.setattr(simulator_routes, "clear_active_run", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(simulator_routes, "reset_orbit_source", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        simulator_routes,
        "register_stream",
        lambda db_arg, *, vehicle_id, stream_id, packet_source=None, receiver_id=None, started_at=None, seen_at=None: registered.update(
            {
                "db": db_arg,
                "vehicle_id": vehicle_id,
                "stream_id": stream_id,
                "packet_source": packet_source,
                "receiver_id": receiver_id,
                "started_at": started_at,
                "seen_at": seen_at,
            }
        ),
    )

    response = await simulator_routes.simulator_start(
        config=simulator_routes.StartConfig(vehicle_id="vehicle-a"),
        db=db,
    )

    assert response["stream_id"] == "a6107734-80af-4f61-8c69-d53ab64dd13a"
    assert registered["body"]["vehicle_id"] == "vehicle-a"
    assert registered["body"]["packet_source"] == "simulator-link"
    assert registered == {
        "body": registered["body"],
        "db": db,
        "vehicle_id": "vehicle-a",
        "stream_id": "a6107734-80af-4f61-8c69-d53ab64dd13a",
        "packet_source": "simulator-link",
        "receiver_id": None,
        "started_at": None,
        "seen_at": None,
    }


def test_channel_run_listing_route_emits_stream_ids(monkeypatch) -> None:
    monkeypatch.setattr(
        telemetry_routes,
        "_get_channel_meta",
        lambda _db, _source_id, _name: SimpleNamespace(id=uuid4()),
    )

    db = MagicMock()

    def fake_execute(statement):
        sql = str(statement).lower()
        assert "telemetry_streams" in sql
        assert "left outer join" not in sql
        assert " join " in sql
        return _FetchAllResult(
            [("a6107734-80af-4f61-8c69-d53ab64dd13a", datetime(2026, 3, 28, 12, 5, tzinfo=timezone.utc))]
        )

    db.execute.side_effect = fake_execute

    response = telemetry_routes.get_channel_runs("VBAT", "vehicle-a", db=db)

    assert [item.stream_id for item in response.sources] == [
        "a6107734-80af-4f61-8c69-d53ab64dd13a"
    ]


def test_realtime_and_ops_responses_emit_vehicle_and_stream_ids(monkeypatch) -> None:
    now = datetime(2026, 3, 28, 12, 0, tzinfo=timezone.utc)

    monkeypatch.setattr(realtime_service, "get_stream_vehicle_id", lambda _db, _stream_id: "vehicle-a")
    monkeypatch.setattr(
        realtime_service,
        "run_id_to_source_id",
        lambda stream_id: f"legacy:{stream_id}",
    )

    snapshot_db = MagicMock()
    snapshot_db.get.return_value = None
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
