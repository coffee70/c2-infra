"""Regression tests for stream-registry-backed vehicle resolution."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import uuid4

from app.models.telemetry import TelemetryMetadata, TelemetryStream
from app.services.source_run_service import (
    clear_active_run,
    get_cached_active_run_id,
    get_stream_vehicle_id,
    register_active_run,
)
from app.services.channel_alias_service import (
    get_aliases_by_telemetry_ids,
    resolve_channel_metadata,
)


class _ScalarResult:
    def __init__(self, row):
        self._row = row

    def scalars(self):
        return self

    def first(self):
        return self._row


def test_resolve_channel_metadata_uses_registered_stream_owner() -> None:
    vehicle_id = "source-a"
    stream_id = "stream-uuid-owned"
    meta = TelemetryMetadata(
        id=uuid4(),
        vehicle_id=vehicle_id,
        name="battery.voltage",
        units="V",
        description=None,
        subsystem_tag="power",
        channel_origin="catalog",
        discovery_namespace=None,
        discovered_at=datetime(2026, 3, 28, 12, 0, tzinfo=timezone.utc),
        last_seen_at=datetime(2026, 3, 28, 12, 0, tzinfo=timezone.utc),
    )
    db = MagicMock()
    db.get.side_effect = lambda model, key: (
        TelemetryStream(id=stream_id, vehicle_id=vehicle_id, status="active")
        if model is TelemetryStream and key == stream_id
        else None
    )
    db.execute.side_effect = [
        _ScalarResult(meta),
    ]

    resolved = resolve_channel_metadata(db, vehicle_id=stream_id, channel_name="battery.voltage")

    assert resolved is meta
    statement = db.execute.call_args.args[0]
    assert vehicle_id in statement.compile().params.values()


def test_resolve_channel_metadata_keeps_vehicle_lookup_for_non_stream_ids(monkeypatch) -> None:
    vehicle_id = "source-a"
    meta = TelemetryMetadata(
        id=uuid4(),
        vehicle_id=vehicle_id,
        name="battery.voltage",
        units="V",
        description=None,
        subsystem_tag="power",
        channel_origin="catalog",
        discovery_namespace=None,
        discovered_at=datetime(2026, 3, 28, 12, 0, tzinfo=timezone.utc),
        last_seen_at=datetime(2026, 3, 28, 12, 0, tzinfo=timezone.utc),
    )
    monkeypatch.setattr("app.services.channel_alias_service.get_stream_vehicle_id", lambda _db, _vehicle_id: None)
    db = MagicMock()
    db.get.side_effect = lambda model, key: None
    db.execute.side_effect = [
        _ScalarResult(meta),
    ]

    resolved = resolve_channel_metadata(db, vehicle_id=vehicle_id, channel_name="battery.voltage")

    assert resolved is meta
    statement = db.execute.call_args.args[0]
    assert vehicle_id in statement.compile().params.values()


def test_resolve_channel_metadata_uses_persisted_stream_owner_without_registry() -> None:
    vehicle_id = "source-a"
    stream_id = "source-a-2026-03-28T12-00-00Z"
    meta = TelemetryMetadata(
        id=uuid4(),
        vehicle_id=vehicle_id,
        name="battery.voltage",
        units="V",
        description=None,
        subsystem_tag="power",
        channel_origin="catalog",
        discovery_namespace=None,
        discovered_at=datetime(2026, 3, 28, 12, 0, tzinfo=timezone.utc),
        last_seen_at=datetime(2026, 3, 28, 12, 0, tzinfo=timezone.utc),
    )
    db = MagicMock()
    db.get.return_value = None
    db.execute.side_effect = [
        _ScalarResult(vehicle_id),
        _ScalarResult(meta),
    ]

    resolved = resolve_channel_metadata(db, vehicle_id=stream_id, channel_name="battery.voltage")

    assert resolved is meta


def test_get_stream_vehicle_id_uses_current_rows_after_restart() -> None:
    vehicle_id = "source-a"
    stream_id = "stream-uuid-restart"
    db = MagicMock()
    db.get.return_value = None
    db.execute.return_value = _ScalarResult(vehicle_id)

    resolved = get_stream_vehicle_id(db, stream_id)

    assert resolved == vehicle_id
    statement = db.execute.call_args.args[0]
    assert "telemetry_current" in str(statement.compile())
    assert stream_id in statement.compile().params.values()


def test_get_stream_vehicle_id_does_not_overwrite_active_cache() -> None:
    vehicle_id = "source-a"
    active_stream_id = "source-a-2026-03-28T12-00-00Z"
    historical_stream_id = "source-a-2026-03-28T10-00-00Z"
    db = MagicMock()
    db.get.return_value = TelemetryStream(
        id=historical_stream_id,
        vehicle_id=vehicle_id,
        status="idle",
    )

    clear_active_run(vehicle_id)
    register_active_run(active_stream_id)
    try:
        resolved = get_stream_vehicle_id(db, historical_stream_id)

        assert resolved == vehicle_id
        assert get_cached_active_run_id(vehicle_id) == active_stream_id
        db.execute.assert_not_called()
    finally:
        clear_active_run(vehicle_id)


def test_get_aliases_by_telemetry_ids_uses_registered_stream_owner() -> None:
    vehicle_id = "source-a"
    stream_id = "stream-uuid-alias"
    telemetry_id = uuid4()
    db = MagicMock()
    db.get.side_effect = lambda model, key: (
        TelemetryStream(id=stream_id, vehicle_id=vehicle_id, status="active")
        if model is TelemetryStream and key == stream_id
        else None
    )
    db.execute.return_value.fetchall.return_value = [(telemetry_id, "VBAT")]

    aliases = get_aliases_by_telemetry_ids(
        db,
        vehicle_id=stream_id,
        telemetry_ids=[telemetry_id],
    )

    assert aliases == {telemetry_id: ["VBAT"]}
    statement = db.execute.call_args.args[0]
    assert vehicle_id in statement.compile().params.values()
