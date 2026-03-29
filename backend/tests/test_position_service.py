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
from telemetry_catalog.builtins import (
    DEFAULT_SOURCE_ID,
    DROGONSAT_SOURCE_ID,
    RHAEGALSAT_SOURCE_ID,
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
    assert run_id_to_source_id(f"{DROGONSAT_SOURCE_ID}-2026-03-13T17-12-34Z") == DROGONSAT_SOURCE_ID
    assert (
        run_id_to_source_id(f"{DROGONSAT_SOURCE_ID}-nominal-2026-03-13T17-12-34Z")
        == DROGONSAT_SOURCE_ID
    )
    assert run_id_to_source_id(f"{RHAEGALSAT_SOURCE_ID}-2026-03-13T17-12-34Z") == RHAEGALSAT_SOURCE_ID
    assert (
        run_id_to_source_id(f"{RHAEGALSAT_SOURCE_ID}-orbit_decay-2026-03-13T17-12-34Z")
        == RHAEGALSAT_SOURCE_ID
    )
    assert run_id_to_source_id("default") == DEFAULT_SOURCE_ID


def test_resolve_active_run_id_uses_simulator_status(monkeypatch) -> None:
    clear_active_run(DROGONSAT_SOURCE_ID)
    db = MagicMock()
    stream_id = f"{DROGONSAT_SOURCE_ID}-2026-03-13T17-12-34Z"
    stream = SimpleNamespace(
        id=stream_id,
        vehicle_id=DROGONSAT_SOURCE_ID,
        status="idle",
        packet_source=None,
        receiver_id=None,
        last_seen_at=None,
    )
    source = TelemetrySource(
        id=DROGONSAT_SOURCE_ID,
        name="DrogonSat",
        source_type="simulator",
        base_url="http://simulator:8001",
    )

    def fake_get(model, key):
        if model is TelemetrySource and key == DROGONSAT_SOURCE_ID:
            return source
        if key == stream_id:
            return stream
        return None

    class _EmptyResult:
        def scalars(self):
            return self

        def first(self):
            return None

    db.get.side_effect = fake_get
    db.execute.side_effect = [_EmptyResult(), _EmptyResult()]

    monkeypatch.setattr(
        "app.services.source_run_service.httpx.Client",
        lambda timeout=2.0: _FakeHttpxClient(
            _FakeHttpxResponse(
                {
                    "state": "running",
                    "config": {
                        "stream_id": f"{DROGONSAT_SOURCE_ID}-2026-03-13T17-12-34Z",
                    },
                }
            )
        ),
    )

    assert (
        resolve_active_run_id(db, DROGONSAT_SOURCE_ID)
        == stream_id
    )
    clear_active_run(DROGONSAT_SOURCE_ID)


def test_resolve_active_run_id_prefers_simulator_status_over_stale_current_rows(
    monkeypatch,
) -> None:
    clear_active_run(DROGONSAT_SOURCE_ID)
    db = MagicMock()
    stale_stream_id = f"{DROGONSAT_SOURCE_ID}-2026-03-13T17-12-34Z"
    db.get.side_effect = lambda model, source_id: (
        TelemetrySource(
            id=DROGONSAT_SOURCE_ID,
            name="DrogonSat",
            source_type="simulator",
            base_url="http://simulator:8001",
        )
        if source_id == DROGONSAT_SOURCE_ID
        else None
    )

    class _EmptyResult:
        def scalars(self):
            return self

        def first(self):
            return None

    db.execute.side_effect = [_EmptyResult(), _EmptyResult(), AssertionError("current row fallback should not run")]

    cleared: list[str] = []

    def fake_clear_active_stream(vehicle_id: str, *, db=None):
        cleared.append(vehicle_id)

    monkeypatch.setattr(
        "app.services.source_run_service.httpx.Client",
        lambda timeout=2.0: _FakeHttpxClient(
            _FakeHttpxResponse(
                {
                    "state": "idle",
                    "config": {
                        "stream_id": stale_stream_id,
                    },
                }
            )
        ),
    )
    monkeypatch.setattr("app.services.source_run_service.clear_active_stream", fake_clear_active_stream)

    assert resolve_active_run_id(db, DROGONSAT_SOURCE_ID) == DROGONSAT_SOURCE_ID
    assert cleared == [DROGONSAT_SOURCE_ID]
    db.add.assert_not_called()


def test_resolve_active_run_id_recovers_simulator_stream_even_when_latest_row_is_idle(
    monkeypatch,
) -> None:
    clear_active_run(DROGONSAT_SOURCE_ID)
    db = MagicMock()
    stream_id = f"{DROGONSAT_SOURCE_ID}-2026-03-13T17-12-34Z"
    idle_stream = SimpleNamespace(
        id=stream_id,
        vehicle_id=DROGONSAT_SOURCE_ID,
        status="idle",
        packet_source=None,
        receiver_id=None,
        last_seen_at=None,
    )
    active_stream = SimpleNamespace(
        id=stream_id,
        vehicle_id=DROGONSAT_SOURCE_ID,
        status="active",
        packet_source="ground-station-a",
        receiver_id="rx-7",
        last_seen_at=datetime(2026, 3, 13, 17, 12, 40, tzinfo=timezone.utc),
    )
    source = TelemetrySource(
        id=DROGONSAT_SOURCE_ID,
        name="DrogonSat",
        source_type="simulator",
        base_url="http://simulator:8001",
    )

    def fake_get(model, key):
        if model is TelemetrySource and key == DROGONSAT_SOURCE_ID:
            return source
        if key == stream_id:
            return active_stream
        return None

    class _EmptyResult:
        def scalars(self):
            return self

        def first(self):
            return None

    db.get.side_effect = fake_get
    db.execute.side_effect = [_EmptyResult(), AssertionError("idle row guard should not short-circuit simulator recovery")]

    monkeypatch.setattr(
        "app.services.source_run_service.httpx.Client",
        lambda timeout=2.0: _FakeHttpxClient(
            _FakeHttpxResponse(
                {
                    "state": "running",
                    "config": {
                        "stream_id": stream_id,
                        "packet_source": "ground-station-a",
                        "receiver_id": "rx-7",
                    },
                }
            )
        ),
    )

    assert resolve_active_run_id(db, DROGONSAT_SOURCE_ID) == stream_id
    assert active_stream.status == "active"
    assert active_stream.last_seen_at is not None
    clear_active_run(DROGONSAT_SOURCE_ID)


def test_resolve_active_run_id_falls_back_when_simulator_status_fails(monkeypatch) -> None:
    clear_active_run(DROGONSAT_SOURCE_ID)
    db = MagicMock()
    stream_id = f"{DROGONSAT_SOURCE_ID}-2026-03-13T17-12-34Z"
    stream = SimpleNamespace(
        id=stream_id,
        vehicle_id=DROGONSAT_SOURCE_ID,
        status="idle",
        packet_source=None,
        receiver_id=None,
        last_seen_at=None,
    )
    source = TelemetrySource(
        id=DROGONSAT_SOURCE_ID,
        name="DrogonSat",
        source_type="simulator",
        base_url="http://simulator:8001",
    )
    current = SimpleNamespace(
        stream_id=stream_id,
        reception_time=datetime(2026, 3, 13, 17, 12, 40, tzinfo=timezone.utc),
        generation_time=datetime(2026, 3, 13, 17, 12, 39, tzinfo=timezone.utc),
        packet_source="ground-station-a",
        receiver_id="rx-7",
    )

    def fake_get(model, key):
        if model is TelemetrySource and key == DROGONSAT_SOURCE_ID:
            return source
        if key == stream_id:
            return stream
        return None

    class _EmptyResult:
        def scalars(self):
            return self

        def first(self):
            return None

    class _CurrentResult:
        def scalars(self):
            return self

        def first(self):
            return current

    db.get.side_effect = fake_get
    db.execute.side_effect = [_EmptyResult(), _EmptyResult(), _CurrentResult()]

    cleared: list[str] = []

    def fake_clear_active_stream(vehicle_id: str, *, db=None):
        cleared.append(vehicle_id)

    monkeypatch.setattr(
        "app.services.source_run_service.httpx.Client",
        lambda timeout=2.0: (_ for _ in ()).throw(TimeoutError("simulator status timeout")),
    )
    monkeypatch.setattr("app.services.source_run_service.clear_active_stream", fake_clear_active_stream)

    assert resolve_active_run_id(db, DROGONSAT_SOURCE_ID) == stream_id
    assert cleared == []
    assert stream.status == "active"
    assert stream.last_seen_at == current.reception_time
    clear_active_run(DROGONSAT_SOURCE_ID)


def test_resolve_active_run_id_prefers_recent_cached_run(monkeypatch) -> None:
    clear_active_run(DROGONSAT_SOURCE_ID)
    db = MagicMock()
    db.get.side_effect = lambda model, source_id: (
        TelemetrySource(
            id=DROGONSAT_SOURCE_ID,
            name="DrogonSat",
            source_type="simulator",
            base_url="http://simulator:8001",
        )
        if source_id == DROGONSAT_SOURCE_ID
        else None
    )

    register_active_run(f"{DROGONSAT_SOURCE_ID}-2026-03-13T19-17-52Z")

    def fail_client(timeout=2.0):
        raise AssertionError("status poll should not run")

    monkeypatch.setattr(
        "app.services.source_run_service.httpx.Client",
        fail_client,
    )

    assert (
        resolve_active_run_id(db, DROGONSAT_SOURCE_ID)
        == f"{DROGONSAT_SOURCE_ID}-2026-03-13T19-17-52Z"
    )
    clear_active_run(DROGONSAT_SOURCE_ID)


def test_resolve_active_run_id_only_queries_active_stream_rows() -> None:
    clear_active_run(DROGONSAT_SOURCE_ID)
    db = MagicMock()
    seen: list[str] = []

    class _EmptyResult:
        def scalars(self):
            return self

        def first(self):
            return None

    def fake_execute(statement):
        seen.append(str(statement))
        return _EmptyResult()

    db.execute.side_effect = fake_execute
    db.get.return_value = None

    assert resolve_active_run_id(db, DROGONSAT_SOURCE_ID) == DROGONSAT_SOURCE_ID
    assert any("telemetry_streams.status" in sql for sql in seen)
    assert any("JOIN telemetry_metadata" in sql and "telemetry_metadata.source_id" in sql for sql in seen)


def test_resolve_active_run_id_recovers_stream_from_current_rows() -> None:
    clear_active_run(DROGONSAT_SOURCE_ID)
    db = MagicMock()
    stream_id = f"{DROGONSAT_SOURCE_ID}-2026-03-13T17-12-34Z"
    stream = SimpleNamespace(
        id=stream_id,
        vehicle_id=DROGONSAT_SOURCE_ID,
        status="idle",
        packet_source=None,
        receiver_id=None,
        last_seen_at=None,
    )
    current = SimpleNamespace(
        stream_id=stream_id,
        reception_time=datetime(2026, 3, 13, 17, 12, 40, tzinfo=timezone.utc),
        generation_time=datetime(2026, 3, 13, 17, 12, 39, tzinfo=timezone.utc),
        packet_source="ground-station-a",
        receiver_id="rx-7",
    )

    class _EmptyResult:
        def scalars(self):
            return self

        def first(self):
            return None

    class _CurrentResult:
        def scalars(self):
            return self

        def first(self):
            return current

    db.execute.side_effect = [_EmptyResult(), _EmptyResult(), _CurrentResult(), _EmptyResult()]
    db.get.side_effect = [None, None, stream]

    assert resolve_active_run_id(db, DROGONSAT_SOURCE_ID) == stream_id
    assert stream.status == "active"
    assert stream.last_seen_at == current.reception_time
    assert stream.packet_source == "ground-station-a"
    db.add.assert_not_called()
    clear_active_run(DROGONSAT_SOURCE_ID)


def test_resolve_active_run_id_recovers_opaque_stream_from_current_rows() -> None:
    clear_active_run(DROGONSAT_SOURCE_ID)
    db = MagicMock()
    stream_id = "c3bb4cf5-21dd-4b84-bc91-1e3a3a944f78"
    stream = SimpleNamespace(
        id=stream_id,
        vehicle_id=DROGONSAT_SOURCE_ID,
        status="idle",
        packet_source=None,
        receiver_id=None,
        last_seen_at=None,
    )
    current = SimpleNamespace(
        stream_id=stream_id,
        reception_time=datetime(2026, 3, 13, 17, 12, 40, tzinfo=timezone.utc),
        generation_time=datetime(2026, 3, 13, 17, 12, 39, tzinfo=timezone.utc),
        packet_source="ground-station-a",
        receiver_id="rx-7",
    )

    class _EmptyResult:
        def scalars(self):
            return self

        def first(self):
            return None

    class _CurrentResult:
        def scalars(self):
            return self

        def first(self):
            return current

    db.execute.side_effect = [_EmptyResult(), _EmptyResult(), _CurrentResult(), _EmptyResult()]
    db.get.side_effect = [None, None, stream]

    assert resolve_active_run_id(db, DROGONSAT_SOURCE_ID) == stream_id
    assert stream.status == "active"
    assert stream.last_seen_at == current.reception_time
    assert stream.packet_source == "ground-station-a"
    db.add.assert_not_called()
    clear_active_run(DROGONSAT_SOURCE_ID)


def test_resolve_active_run_id_respects_explicit_idle_stream_state() -> None:
    source_id = "vehicle-a"
    clear_active_run(source_id)
    db = MagicMock()

    class _EmptyResult:
        def scalars(self):
            return self

        def first(self):
            return None

    class _IdleResult:
        def scalars(self):
            return self

        def first(self):
            return SimpleNamespace(status="idle")

    db.execute.side_effect = [_EmptyResult(), _IdleResult(), AssertionError("current row fallback should not run")]
    db.get.return_value = None

    assert resolve_active_run_id(db, source_id) == source_id
    db.add.assert_not_called()
    clear_active_run(source_id)


def test_clear_active_run_marks_persisted_active_streams_idle() -> None:
    clear_active_run(DROGONSAT_SOURCE_ID)
    db = MagicMock()
    stream = SimpleNamespace(status="active")

    class _ActiveResult:
        def scalars(self):
            return self

        def all(self):
            return [stream]

    db.execute.return_value = _ActiveResult()

    register_active_run(f"{DROGONSAT_SOURCE_ID}-2026-03-13T19-17-52Z")
    clear_active_run(DROGONSAT_SOURCE_ID, db=db)

    assert stream.status == "idle"


def test_upsert_mapping_resolves_aliases_to_canonical_names(monkeypatch) -> None:
    db = MagicMock()
    body = SimpleNamespace(
        vehicle_id="source-a",
        frame_type="gps_lla",
        lat_channel_name="LATITUDE",
        lon_channel_name="LONGITUDE",
        alt_channel_name="ALTITUDE",
        x_channel_name=None,
        y_channel_name=None,
        z_channel_name=None,
        active=True,
    )
    source = TelemetrySource(id="source-a", name="Source A", source_type="vehicle")

    class _RowResult:
        def scalars(self):
            return self

        def first(self):
            return source

    class _EmptyResult:
        def scalars(self):
            return self

        def first(self):
            return None

    db.execute.side_effect = [_RowResult(), _EmptyResult()]
    monkeypatch.setattr(
        position_service,
        "resolve_channel_name",
        lambda _db, vehicle_id, channel_name: {
            "LATITUDE": "GPS_LAT",
            "LONGITUDE": "GPS_LON",
            "ALTITUDE": "GPS_ALT",
        }.get(channel_name),
    )

    mapping = position_service.upsert_mapping(db, body)

    assert mapping.lat_channel_name == "GPS_LAT"
    assert mapping.lon_channel_name == "GPS_LON"
    assert mapping.alt_channel_name == "GPS_ALT"


def test_register_active_run_does_not_roll_back_to_older_run() -> None:
    clear_active_run(DROGONSAT_SOURCE_ID)
    register_active_run(f"{DROGONSAT_SOURCE_ID}-2026-03-13T19-23-07Z")
    register_active_run(f"{DROGONSAT_SOURCE_ID}-2026-03-13T19-22-43Z")

    db = MagicMock()
    db.get.side_effect = lambda model, source_id: (
        TelemetrySource(
            id=DROGONSAT_SOURCE_ID,
            name="DrogonSat",
            source_type="simulator",
            base_url="http://simulator:8001",
        )
        if source_id == DROGONSAT_SOURCE_ID
        else None
    )

    assert (
        resolve_active_run_id(db, DROGONSAT_SOURCE_ID)
        == f"{DROGONSAT_SOURCE_ID}-2026-03-13T19-23-07Z"
    )
    clear_active_run(DROGONSAT_SOURCE_ID)


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
        source_id=DROGONSAT_SOURCE_ID,
        frame_type="gps_lla",
        lat_channel_name="GPS_LAT",
        lon_channel_name="GPS_LON",
        alt_channel_name="GPS_ALT",
        x_channel_name=None,
        y_channel_name=None,
        z_channel_name=None,
    )
    source = SimpleNamespace(
        id=DROGONSAT_SOURCE_ID,
        name="DrogonSat",
        source_type="simulator",
    )

    sample = position_service._build_sample_for_mapping(
        MagicMock(),
        mapping,
        source,
        data_source_id=f"{DROGONSAT_SOURCE_ID}-2026-03-13T17-12-34Z",
        now=now,
        staleness=position_service.timedelta(seconds=300),
    )

    assert requested_source_ids == [
        f"{DROGONSAT_SOURCE_ID}-2026-03-13T17-12-34Z",
        f"{DROGONSAT_SOURCE_ID}-2026-03-13T17-12-34Z",
        f"{DROGONSAT_SOURCE_ID}-2026-03-13T17-12-34Z",
    ]
    assert sample.source_id == DROGONSAT_SOURCE_ID
    assert sample.source_name == "DrogonSat"
    assert sample.valid is True


def test_get_latest_positions_resolves_active_run_for_mapped_source(
    monkeypatch,
) -> None:
    db = MagicMock()
    mapping = SimpleNamespace(source_id=DROGONSAT_SOURCE_ID)
    source = SimpleNamespace(
        id=DROGONSAT_SOURCE_ID,
        name="DrogonSat",
        source_type="simulator",
    )
    db.execute.side_effect = [
        _FakeScalarResult([mapping]),
        _FakeScalarResult([source]),
    ]

    monkeypatch.setattr(
        position_service,
        "resolve_active_run_id",
        lambda db_session, source_id: f"{DROGONSAT_SOURCE_ID}-2026-03-13T17-12-34Z",
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

    samples = position_service.get_latest_positions(db, vehicle_ids=[DROGONSAT_SOURCE_ID])

    assert len(samples) == 1
    assert samples[0].source_id == DROGONSAT_SOURCE_ID
    assert seen["data_source_id"] == f"{DROGONSAT_SOURCE_ID}-2026-03-13T17-12-34Z"
