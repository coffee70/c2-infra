"""Tests for the stream identity split migration backfill logic."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from datetime import datetime, timezone
from types import SimpleNamespace

from telemetry_catalog.builtins import DROGONSAT_SOURCE_ID


def _load_migration_module():
    migration_path = Path(__file__).resolve().parents[1] / "app" / "migrations" / "versions" / "015_stream_identity_split.py"
    spec = importlib.util.spec_from_file_location("migration_015_stream_identity_split", migration_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_split_ops_event_source_id_backfills_run_ids() -> None:
    migration = _load_migration_module()

    vehicle_id, stream_id = migration._split_ops_event_source_id(f"{DROGONSAT_SOURCE_ID}-2026-03-13T17-12-34Z")

    assert vehicle_id == DROGONSAT_SOURCE_ID
    assert stream_id == f"{DROGONSAT_SOURCE_ID}-2026-03-13T17-12-34Z"


def test_split_ops_event_source_id_leaves_vehicle_level_events_alone() -> None:
    migration = _load_migration_module()

    vehicle_id, stream_id = migration._split_ops_event_source_id(DROGONSAT_SOURCE_ID)

    assert vehicle_id == DROGONSAT_SOURCE_ID
    assert stream_id is None


def test_collect_telemetry_stream_rows_merges_current_and_history() -> None:
    migration = _load_migration_module()

    current_rows = [
        SimpleNamespace(
            source_id="stream-a",
            vehicle_id="vehicle-a",
            observed_at=datetime(2026, 3, 28, 12, 5, tzinfo=timezone.utc),
            packet_source="packet-a",
            receiver_id="rx-a",
        ),
        SimpleNamespace(
            source_id="stream-a",
            vehicle_id="vehicle-a",
            observed_at=datetime(2026, 3, 28, 12, 7, tzinfo=timezone.utc),
            packet_source="packet-b",
            receiver_id="rx-b",
        ),
    ]
    data_rows = [
        SimpleNamespace(
            source_id="stream-b",
            vehicle_id="vehicle-b",
            observed_at=datetime(2026, 3, 28, 12, 1, tzinfo=timezone.utc),
            packet_source=None,
            receiver_id=None,
        )
    ]

    rows = migration._collect_telemetry_stream_rows(current_rows, data_rows)
    rows_by_id = {row["id"]: row for row in rows}

    assert rows_by_id["stream-a"]["vehicle_id"] == "vehicle-a"
    assert rows_by_id["stream-a"]["started_at"] == datetime(2026, 3, 28, 12, 5, tzinfo=timezone.utc)
    assert rows_by_id["stream-a"]["last_seen_at"] == datetime(2026, 3, 28, 12, 7, tzinfo=timezone.utc)
    assert rows_by_id["stream-a"]["packet_source"] == "packet-b"
    assert rows_by_id["stream-a"]["receiver_id"] == "rx-b"
    assert rows_by_id["stream-a"]["status"] == "idle"
    assert rows_by_id["stream-b"]["vehicle_id"] == "vehicle-b"
    assert rows_by_id["stream-b"]["status"] == "idle"
