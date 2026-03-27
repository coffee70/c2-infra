"""Tests for realtime telemetry processing."""

import asyncio
import time
from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.schemas import MeasurementEvent
from app.models.telemetry import TelemetryMetadata
from app.realtime.bus import InProcessEventBus
from app.realtime.processor import (
    RealtimeProcessor,
    _build_channel_name_from_tags,
    _resolve_measurement_channel,
)
from app.routes.realtime import _assign_reception_time
from app.services.telemetry_service import _compute_state


class TestComputeState:
    """Unit tests for _compute_state (alert transition logic)."""

    def test_normal_in_family(self) -> None:
        state, reason = _compute_state(28.0, 0.5, 26.0, 30.0, 0.5)
        assert state == "normal"
        assert reason is None

    def test_warning_out_of_limits_high(self) -> None:
        state, reason = _compute_state(31.0, 2.0, 26.0, 30.0, 0.5)
        assert state == "warning"
        assert reason == "out_of_limits"

    def test_warning_out_of_limits_low(self) -> None:
        state, reason = _compute_state(25.0, -2.0, 26.0, 30.0, 0.5)
        assert state == "warning"
        assert reason == "out_of_limits"

    def test_warning_out_of_family_z_score(self) -> None:
        state, reason = _compute_state(29.0, 2.5, None, None, 0.5)
        assert state == "warning"
        assert reason == "out_of_family"

    def test_caution_near_limits(self) -> None:
        # Within 1 sigma of red_high
        state, reason = _compute_state(29.6, 1.0, 26.0, 30.0, 0.5)
        assert state == "caution"
        assert reason is not None

    def test_caution_z_score_1_5_to_2(self) -> None:
        state, reason = _compute_state(28.9, 1.8, None, None, 0.5)
        assert state == "caution"
        assert reason == "out_of_family"

    def test_no_limits_normal(self) -> None:
        state, reason = _compute_state(28.0, 0.0, None, None, 0.5)
        assert state == "normal"
        assert reason is None

    def test_debounce_consecutive_warnings(self) -> None:
        """Two consecutive warning samples should trigger alert (logic in processor)."""
        v1, _ = _compute_state(31.0, 2.5, 26.0, 30.0, 0.5)
        v2, _ = _compute_state(31.0, 2.5, 26.0, 30.0, 0.5)
        assert v1 == "warning"
        assert v2 == "warning"


@pytest.mark.anyio
async def test_realtime_bus_processes_measurements_in_parallel() -> None:
    bus = InProcessEventBus()
    seen: list[str] = []

    def handler(event: MeasurementEvent) -> None:
        time.sleep(0.2)
        seen.append(event.channel_name)

    bus.subscribe_measurements(handler)
    bus.start()
    started = time.perf_counter()
    for idx in range(4):
        bus.publish_measurement(
            MeasurementEvent(
                source_id="test",
                channel_name=f"CHAN_{idx}",
                generation_time="2026-03-13T00:00:00+00:00",
                reception_time="2026-03-13T00:00:00+00:00",
                value=float(idx),
                quality="valid",
                sequence=idx,
            )
        )

    await asyncio.wait_for(bus._measurement_queue.join(), timeout=2.0)
    elapsed = time.perf_counter() - started
    bus.stop()

    assert sorted(seen) == ["CHAN_0", "CHAN_1", "CHAN_2", "CHAN_3"]
    assert elapsed < 0.5


def test_build_channel_name_from_tags_uses_decoder_namespace() -> None:
    channel_name, namespace = _build_channel_name_from_tags(
        {"decoder": "APRS", "field_name": "Payload Temp"}
    )

    assert channel_name == "decoder.aprs.payload_temp"
    assert namespace == "decoder.aprs"


def test_assign_reception_time_uses_ingest_time_when_missing(monkeypatch) -> None:
    fixed_now = datetime(2026, 3, 27, 16, 30, tzinfo=timezone.utc)

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed_now

    monkeypatch.setattr("app.routes.realtime.datetime", _FakeDatetime)

    events = _assign_reception_time(
        [
            MeasurementEvent(
                source_id="source-a",
                channel_name="PWR_MAIN_BUS_VOLT",
                generation_time="2026-03-20T12:00:00+00:00",
                value=28.0,
            )
        ]
    )

    assert events[0].reception_time == fixed_now.isoformat()
    assert events[0].reception_time != events[0].generation_time


def test_build_channel_name_from_tags_normalizes_explicit_dynamic_name() -> None:
    channel_name, namespace = _build_channel_name_from_tags(
        {"dynamic_channel_name": "Decoder/APRS/Payload Temp"}
    )

    assert channel_name == "decoder.aprs.payload_temp"
    assert namespace == "decoder.aprs"


def test_resolve_measurement_channel_prefers_dynamic_tags_over_raw_channel_name() -> None:
    channel_name, namespace, allow_dynamic = _resolve_measurement_channel(
        MeasurementEvent(
            source_id="source-a",
            channel_name="PayloadTemp",
            generation_time="2026-03-26T12:00:00+00:00",
            value=1.0,
            tags={"decoder": "APRS", "field_name": "Payload Temp"},
        )
    )

    assert channel_name == "decoder.aprs.payload_temp"
    assert namespace == "decoder.aprs"
    assert allow_dynamic is True


def test_resolve_measurement_channel_keeps_strict_explicit_name_without_dynamic_context() -> None:
    channel_name, namespace, allow_dynamic = _resolve_measurement_channel(
        MeasurementEvent(
            source_id="source-a",
            channel_name="PWR_MAIN_BUS_VOLT",
            generation_time="2026-03-26T12:00:00+00:00",
            value=1.0,
        )
    )

    assert channel_name == "PWR_MAIN_BUS_VOLT"
    assert namespace is None
    assert allow_dynamic is False


def test_process_measurement_creates_discovered_channel_for_unknown_input(monkeypatch) -> None:
    monkeypatch.setattr("app.realtime.processor.get_realtime_bus", lambda: MagicMock())
    processor = RealtimeProcessor()
    db = MagicMock()
    added: list[object] = []
    updates = []
    orbit_submissions = []

    class _ScalarResult:
        def __init__(self, row):
            self._row = row

        def scalars(self):
            return self

        def first(self):
            return self._row

    meta = TelemetryMetadata(
        id=uuid4(),
        source_id="source-a",
        name="decoder.aprs.payload_temp",
        units="",
        description=None,
        subsystem_tag="dynamic",
        channel_origin="discovered",
        discovery_namespace="decoder.aprs",
        discovered_at=datetime(2026, 3, 26, 12, 0, tzinfo=timezone.utc),
        last_seen_at=datetime(2026, 3, 26, 12, 0, tzinfo=timezone.utc),
    )

    db.execute.return_value = _ScalarResult(None)
    db.get.return_value = None
    db.add.side_effect = added.append

    monkeypatch.setattr(
        "app.realtime.processor.create_discovered_channel_metadata",
        lambda *args, **kwargs: meta,
    )
    monkeypatch.setattr(processor, "_broadcast_telemetry_update", updates.append)
    monkeypatch.setattr(
        processor,
        "_maybe_submit_orbit_sample",
        lambda *args, **kwargs: orbit_submissions.append(kwargs or args),
    )

    processor._process_measurement(
        db,
        MeasurementEvent(
            source_id="source-a",
            channel_name=None,
            generation_time="2026-03-26T12:00:00+00:00",
            reception_time="2026-03-26T12:00:01+00:00",
            value=42.5,
            tags={"decoder": "APRS", "field_name": "Payload Temp"},
        ),
    )

    assert any(getattr(obj, "telemetry_id", None) == meta.id for obj in added)
    assert any(getattr(obj, "state", None) == "normal" for obj in added)
    assert len(updates) == 1
    assert updates[0].name == "decoder.aprs.payload_temp"
    assert updates[0].channel_origin == "discovered"
    assert updates[0].discovery_namespace == "decoder.aprs"
    assert orbit_submissions


def test_process_measurement_skips_unknown_explicit_channel_without_dynamic_context(monkeypatch) -> None:
    monkeypatch.setattr("app.realtime.processor.get_realtime_bus", lambda: MagicMock())
    processor = RealtimeProcessor()
    db = MagicMock()
    updates = []

    class _ScalarResult:
        def __init__(self, row):
            self._row = row

        def scalars(self):
            return self

        def first(self):
            return self._row

    db.execute.return_value = _ScalarResult(None)
    db.get.return_value = None

    create_mock = MagicMock()
    monkeypatch.setattr(
        "app.realtime.processor.create_discovered_channel_metadata",
        create_mock,
    )
    monkeypatch.setattr(processor, "_broadcast_telemetry_update", updates.append)

    processor._process_measurement(
        db,
        MeasurementEvent(
            source_id="source-a",
            channel_name="PAYLOAD_TEMP_TYPO",
            generation_time="2026-03-26T12:00:00+00:00",
            reception_time="2026-03-26T12:00:01+00:00",
            value=42.5,
        ),
    )

    create_mock.assert_not_called()
    db.add.assert_not_called()
    assert updates == []


def test_process_measurement_resolves_explicit_channel_alias_to_canonical(monkeypatch) -> None:
    monkeypatch.setattr("app.realtime.processor.get_realtime_bus", lambda: MagicMock())
    monkeypatch.setattr(
        "app.realtime.processor.resolve_channel_name",
        lambda *_args, **_kwargs: "PWR_MAIN_BUS_VOLT",
    )
    processor = RealtimeProcessor()
    db = MagicMock()
    updates = []

    class _ScalarResult:
        def __init__(self, row):
            self._row = row

        def scalars(self):
            return self

        def first(self):
            return self._row

    meta = TelemetryMetadata(
        id=uuid4(),
        source_id="source-a",
        name="PWR_MAIN_BUS_VOLT",
        units="V",
        description="Main bus voltage",
        subsystem_tag="power",
        channel_origin="catalog",
    )
    db.execute.return_value = _ScalarResult(meta)
    db.get.return_value = None
    monkeypatch.setattr(processor, "_broadcast_telemetry_update", updates.append)
    monkeypatch.setattr(processor, "_maybe_submit_orbit_sample", lambda *args, **kwargs: None)

    processor._process_measurement(
        db,
        MeasurementEvent(
            source_id="source-a",
            channel_name="VBAT",
            generation_time="2026-03-26T12:00:00+00:00",
            reception_time="2026-03-26T12:00:01+00:00",
            value=28.1,
        ),
    )

    assert len(updates) == 1
    assert updates[0].name == "PWR_MAIN_BUS_VOLT"


def test_process_measurement_uses_dynamic_tags_even_when_raw_channel_name_is_present(monkeypatch) -> None:
    monkeypatch.setattr("app.realtime.processor.get_realtime_bus", lambda: MagicMock())
    processor = RealtimeProcessor()
    db = MagicMock()
    added: list[object] = []
    updates = []

    class _ScalarResult:
        def __init__(self, row):
            self._row = row

        def scalars(self):
            return self

        def first(self):
            return self._row

    meta = TelemetryMetadata(
        id=uuid4(),
        source_id="source-a",
        name="decoder.aprs.payload_temp",
        units="",
        description=None,
        subsystem_tag="dynamic",
        channel_origin="discovered",
        discovery_namespace="decoder.aprs",
        discovered_at=datetime(2026, 3, 26, 12, 0, tzinfo=timezone.utc),
        last_seen_at=datetime(2026, 3, 26, 12, 0, tzinfo=timezone.utc),
    )
    db.execute.return_value = _ScalarResult(None)
    db.get.return_value = None
    db.add.side_effect = added.append

    create_mock = MagicMock(return_value=meta)
    monkeypatch.setattr(
        "app.realtime.processor.create_discovered_channel_metadata",
        create_mock,
    )
    monkeypatch.setattr(processor, "_broadcast_telemetry_update", updates.append)
    monkeypatch.setattr(processor, "_maybe_submit_orbit_sample", lambda *args, **kwargs: None)

    processor._process_measurement(
        db,
        MeasurementEvent(
            source_id="source-a",
            channel_name="PayloadTemp",
            generation_time="2026-03-26T12:00:00+00:00",
            reception_time="2026-03-26T12:00:01+00:00",
            value=42.5,
            tags={"decoder": "APRS", "field_name": "Payload Temp"},
        ),
    )

    create_mock.assert_called_once()
    assert create_mock.call_args.kwargs["channel_name"] == "decoder.aprs.payload_temp"
    assert create_mock.call_args.kwargs["discovery_namespace"] == "decoder.aprs"
    assert len(updates) == 1
    assert updates[0].name == "decoder.aprs.payload_temp"


def test_process_measurement_duplicate_first_dynamic_sample_keeps_discovered_metadata(monkeypatch) -> None:
    monkeypatch.setattr("app.realtime.processor.get_realtime_bus", lambda: MagicMock())
    processor = RealtimeProcessor()
    db = MagicMock()
    added: list[object] = []
    updates = []
    orbit_submissions = []

    class _ScalarResult:
        def __init__(self, row):
            self._row = row

        def scalars(self):
            return self

        def first(self):
            return self._row

    meta = TelemetryMetadata(
        id=uuid4(),
        source_id="source-a",
        name="decoder.aprs.payload_temp",
        units="",
        description=None,
        subsystem_tag="dynamic",
        channel_origin="discovered",
        discovery_namespace="decoder.aprs",
        discovered_at=datetime(2026, 3, 26, 12, 0, tzinfo=timezone.utc),
        last_seen_at=datetime(2026, 3, 26, 12, 0, tzinfo=timezone.utc),
    )
    savepoint = MagicMock()

    db.execute.return_value = _ScalarResult(None)
    db.get.return_value = None
    db.add.side_effect = added.append
    db.begin_nested.return_value = savepoint
    db.flush.side_effect = IntegrityError("insert", {}, Exception("duplicate key"))

    monkeypatch.setattr(
        "app.realtime.processor.create_discovered_channel_metadata",
        lambda *args, **kwargs: meta,
    )
    monkeypatch.setattr(processor, "_broadcast_telemetry_update", updates.append)
    monkeypatch.setattr(
        processor,
        "_maybe_submit_orbit_sample",
        lambda *args, **kwargs: orbit_submissions.append(kwargs or args),
    )

    processor._process_measurement(
        db,
        MeasurementEvent(
            source_id="source-a",
            channel_name=None,
            generation_time="2026-03-26T12:00:00+00:00",
            reception_time="2026-03-26T12:00:01+00:00",
            value=42.5,
            tags={"decoder": "APRS", "field_name": "Payload Temp"},
        ),
    )

    savepoint.rollback.assert_called_once()
    db.rollback.assert_not_called()
    assert any(getattr(obj, "state", None) == "normal" for obj in added)
    assert len(updates) == 1
    assert updates[0].name == "decoder.aprs.payload_temp"
    assert orbit_submissions
