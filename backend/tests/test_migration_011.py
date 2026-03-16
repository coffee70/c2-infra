"""Tests for 011 source-definition migration helpers."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa


def _load_migration_module():
    path = Path(__file__).resolve().parents[1] / "app" / "migrations" / "versions" / "011_source_definition_catalog.py"
    spec = importlib.util.spec_from_file_location("migration_011_source_definition_catalog", path)
    module = importlib.util.module_from_spec(spec)
    assert spec is not None and spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_infer_definition_path_matches_vehicle_catalog_from_existing_channels() -> None:
    migration = _load_migration_module()

    inferred = migration._infer_definition_path_for_channels(
        {
            "PWR_MAIN_BUS_VOLT",
            "PWR_MAIN_BUS_CURR",
            "GPS_LAT",
            "GPS_LON",
            "GPS_ALT",
        },
        "vehicle",
    )

    assert inferred == "vehicles/aegon-relay.yaml"


def test_infer_definition_path_returns_none_for_ambiguous_or_empty_sources() -> None:
    migration = _load_migration_module()

    assert migration._infer_definition_path_for_channels(set(), "vehicle") is None


def test_idle_custom_sources_can_use_source_type_fallback() -> None:
    migration = _load_migration_module()

    assert migration._SOURCE_TYPE_FALLBACK_PATHS["vehicle"] == "vehicles/aegon-relay.yaml"
    assert migration._SOURCE_TYPE_FALLBACK_PATHS["simulator"] == "simulators/drogonsat.yaml"


def test_source_channel_names_includes_run_scoped_simulator_history() -> None:
    migration = _load_migration_module()
    engine = sa.create_engine("sqlite:///:memory:")

    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE telemetry_metadata (id INTEGER PRIMARY KEY, source_id TEXT, name TEXT)"))
        conn.execute(sa.text("CREATE TABLE telemetry_data (source_id TEXT, telemetry_id INTEGER)"))
        conn.execute(sa.text("CREATE TABLE telemetry_current (source_id TEXT, telemetry_id INTEGER)"))
        conn.execute(sa.text("CREATE TABLE telemetry_statistics (source_id TEXT, telemetry_id INTEGER)"))
        conn.execute(sa.text("CREATE TABLE telemetry_alerts (source_id TEXT, telemetry_id INTEGER)"))
        conn.execute(
            sa.text(
                "INSERT INTO telemetry_metadata (id, source_id, name) VALUES "
                "(1, '27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6', 'GPS_LAT'),"
                "(2, '27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6', 'GPS_LON')"
            )
        )
        conn.execute(
            sa.text(
                "INSERT INTO telemetry_data (source_id, telemetry_id) VALUES "
                "('27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6-2026-03-15T12-00-00Z', 1),"
                "('27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6-2026-03-15T12-00-00Z', 2)"
            )
        )

        names = migration._source_channel_names(
            conn, "27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6"
        )

    assert names == {"GPS_LAT", "GPS_LON"}


def test_stage_builtin_source_rows_preserves_operator_customizations() -> None:
    migration = _load_migration_module()
    engine = sa.create_engine("sqlite:///:memory:")

    with engine.begin() as conn:
        conn.execute(
            sa.text(
                """
                CREATE TABLE telemetry_sources (
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  description TEXT,
                  source_type TEXT NOT NULL,
                  base_url TEXT,
                  telemetry_definition_path TEXT,
                  created_at TEXT
                )
                """
            )
        )
        conn.execute(
            sa.text(
                """
                INSERT INTO telemetry_sources (
                  id, name, description, source_type, base_url, telemetry_definition_path, created_at
                ) VALUES (
                  'simulator',
                  'Custom Drogon',
                  'Remote simulator',
                  'simulator',
                  'http://remote-sim:9000',
                  NULL,
                  '2026-03-15T12:00:00Z'
                )
                """
            )
        )

        migration._stage_builtin_source_rows(conn)

        row = conn.execute(
            sa.text(
                """
                SELECT id, name, description, source_type, base_url, telemetry_definition_path
                FROM telemetry_sources
                WHERE id = '27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6'
                """
            )
        ).one()
        legacy_count_before_delete = conn.execute(
            sa.text("SELECT COUNT(*) FROM telemetry_sources WHERE id = 'simulator'")
        ).scalar_one()
        migration._delete_legacy_builtin_source_rows(conn)
        legacy_count_after_delete = conn.execute(
            sa.text("SELECT COUNT(*) FROM telemetry_sources WHERE id = 'simulator'")
        ).scalar_one()

    assert tuple(row) == (
        "27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6",
        "Custom Drogon",
        "Remote simulator",
        "simulator",
        "http://remote-sim:9000",
        "simulators/drogonsat.yaml",
    )
    assert legacy_count_before_delete == 1
    assert legacy_count_after_delete == 0


def test_legacy_simulator_run_rewrite_preserves_scenario_suffix() -> None:
    engine = sa.create_engine("sqlite:///:memory:")

    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE telemetry_data (source_id TEXT)"))
        conn.execute(
            sa.text(
                "INSERT INTO telemetry_data (source_id) VALUES "
                "('simulator-nominal-2026-03-15T12-00-00Z'),"
                "('simulator-power_sag-2026-03-15T12-00-00Z')"
            )
        )
        conn.execute(
            sa.text(
                """
                UPDATE telemetry_data
                SET source_id = replace(
                  source_id,
                  'simulator-',
                  '27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6-'
                )
                WHERE source_id LIKE 'simulator-%'
                """
            )
        )
        rows = conn.execute(
            sa.text("SELECT source_id FROM telemetry_data ORDER BY source_id")
        ).scalars().all()

    assert rows == [
        "27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6-nominal-2026-03-15T12-00-00Z",
        "27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6-power_sag-2026-03-15T12-00-00Z",
    ]
