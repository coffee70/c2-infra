"""Tests for the stream identity split migration backfill logic."""

from __future__ import annotations

import importlib.util
from pathlib import Path

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
