"""Tests for telemetry source registration and bootstrap flows."""

from __future__ import annotations

import pytest
import uuid
from unittest.mock import MagicMock

from telemetry_catalog.builtins import DROGONSAT_SOURCE_ID
from telemetry_catalog.builtins import MOCK_VEHICLE_SOURCE_ID
from telemetry_catalog.builtins import BUILT_IN_SOURCES

from app.services.realtime_service import _seed_metadata_for_source
from app.services.realtime_service import create_source
from app.services.realtime_service import bootstrap_builtin_sources
from app.services.realtime_service import refresh_source_embeddings
from app.services.realtime_service import source_has_telemetry_history
from app.services.realtime_service import update_source


def test_create_source_flushes_before_seeding_metadata(monkeypatch) -> None:
    """New sources must exist in-session before FK-backed metadata/mappings are seeded."""

    db = MagicMock()
    embedding_provider = MagicMock()
    call_order: list[str] = []

    def flush() -> None:
        call_order.append("flush")

    def add(_obj) -> None:
        call_order.append("add")

    def commit() -> None:
        call_order.append("commit")

    def refresh(_obj) -> None:
        call_order.append("refresh")

    def fake_seed_metadata_for_source(*args, **kwargs) -> None:
        assert "flush" in call_order
        call_order.append("seed")

    db.add.side_effect = add
    db.flush.side_effect = flush
    db.commit.side_effect = commit
    db.refresh.side_effect = refresh

    monkeypatch.setattr(
        "app.services.realtime_service._seed_metadata_for_source",
        fake_seed_metadata_for_source,
    )
    monkeypatch.setattr(
        "app.services.realtime_service.uuid.uuid4",
        lambda: uuid.UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    )

    create_source(
        db,
        embedding_provider=embedding_provider,
        source_type="vehicle",
        name="Test Vehicle",
        telemetry_definition_path="vehicles/aegon-relay.yaml",
    )

    assert call_order == ["add", "flush", "seed", "commit", "refresh"]


def test_bootstrap_builtin_sources_preserves_existing_operator_edits(monkeypatch) -> None:
    """Existing built-in sources should keep operator-edited fields across restarts."""

    db = MagicMock()
    existing = MagicMock()
    existing.id = DROGONSAT_SOURCE_ID
    existing.name = "Mission Drogon"
    existing.description = "Operator override"
    existing.source_type = "simulator"
    existing.base_url = "http://custom-simulator:8010"
    existing.telemetry_definition_path = "simulators/rhaegalsat.json"
    db.get.side_effect = lambda model, source_id: existing if source_id == DROGONSAT_SOURCE_ID else None

    seeded_calls: list[dict] = []

    class ScalarResult:
        def __init__(self, rows):
            self._rows = rows

        def scalars(self):
            return self

        def all(self):
            return self._rows

    def fake_seed_metadata_for_source(*args, **kwargs) -> None:
        seeded_calls.append(kwargs)

    monkeypatch.setattr(
        "app.services.realtime_service._seed_metadata_for_source",
        fake_seed_metadata_for_source,
    )
    db.execute.return_value = ScalarResult([existing])

    bootstrap_builtin_sources(
        db,
    )

    assert existing.name == "Mission Drogon"
    assert existing.description == "Operator override"
    assert existing.base_url == "http://custom-simulator:8010"
    assert existing.telemetry_definition_path == "simulators/rhaegalsat.json"
    assert any(
        call["source_id"] == DROGONSAT_SOURCE_ID
        and call["telemetry_definition_path"] == "simulators/rhaegalsat.json"
        and call["refresh_embeddings"] is False
        and call["overwrite_position_mapping"] is False
        for call in seeded_calls
    )
    assert all("prune_missing" not in call for call in seeded_calls)
    assert all(call.get("refresh_embeddings") is False for call in seeded_calls)


def test_bootstrap_builtin_sources_flushes_before_seeding_new_sources(monkeypatch) -> None:
    """Built-in bootstrap must flush new source rows before seeding FK-backed metadata."""

    db = MagicMock()
    call_order: list[str] = []
    db.get.return_value = None

    class ScalarResult:
        def __init__(self, rows):
            self._rows = rows

        def scalars(self):
            return self

        def all(self):
            return self._rows

    def add(_obj) -> None:
        call_order.append("add")

    def flush() -> None:
        call_order.append("flush")

    def fake_seed_metadata_for_source(*args, **kwargs) -> None:
        assert "flush" in call_order
        call_order.append("seed")

    db.add.side_effect = add
    db.flush.side_effect = flush

    monkeypatch.setattr(
        "app.services.realtime_service._seed_metadata_for_source",
        fake_seed_metadata_for_source,
    )
    built_in_rows = [MagicMock(id=DROGONSAT_SOURCE_ID, telemetry_definition_path="simulators/drogonsat.yaml")]
    db.execute.return_value = ScalarResult(built_in_rows)

    bootstrap_builtin_sources(
        db,
    )

    assert "add" in call_order
    assert "flush" in call_order
    assert "seed" in call_order


def test_bootstrap_builtin_sources_does_not_prune_existing_metadata(monkeypatch) -> None:
    """Startup bootstrap must not delete historical telemetry via metadata pruning."""

    db = MagicMock()
    db.get.return_value = None
    seed_calls: list[dict] = []

    class ScalarResult:
        def __init__(self, rows):
            self._rows = rows

        def scalars(self):
            return self

        def all(self):
            return self._rows

    def fake_seed_metadata_for_source(*args, **kwargs) -> None:
        seed_calls.append(kwargs)

    monkeypatch.setattr(
        "app.services.realtime_service._seed_metadata_for_source",
        fake_seed_metadata_for_source,
    )
    db.execute.return_value = ScalarResult(
        [MagicMock(id=MOCK_VEHICLE_SOURCE_ID, telemetry_definition_path="vehicles/balerion-surveyor.json")]
    )

    bootstrap_builtin_sources(
        db,
    )

    assert seed_calls
    assert all("prune_missing" not in call for call in seed_calls)
    assert all(call.get("refresh_embeddings") is False for call in seed_calls)
    assert all(call.get("overwrite_position_mapping") is False for call in seed_calls)


def test_bootstrap_builtin_sources_preserves_existing_position_mappings(monkeypatch) -> None:
    """Startup bootstrap must not overwrite operator-managed active position mappings."""

    db = MagicMock()
    existing_source = MagicMock()
    existing_source.id = DROGONSAT_SOURCE_ID
    existing_source.telemetry_definition_path = "simulators/drogonsat.yaml"
    db.get.side_effect = lambda model, source_id: existing_source if source_id == DROGONSAT_SOURCE_ID else None
    seed_calls: list[dict] = []

    class ScalarResult:
        def __init__(self, rows):
            self._rows = rows

        def scalars(self):
            return self

        def all(self):
            return self._rows

    monkeypatch.setattr(
        "app.services.realtime_service._seed_metadata_for_source",
        lambda *args, **kwargs: seed_calls.append(kwargs),
    )
    db.execute.return_value = ScalarResult([existing_source])

    bootstrap_builtin_sources(db)

    assert any(call.get("overwrite_position_mapping") is False for call in seed_calls)


def test_bootstrap_builtin_sources_seeds_existing_custom_sources(monkeypatch) -> None:
    """Startup bootstrap must repair metadata for persisted custom sources, not just built-ins."""

    db = MagicMock()
    custom = MagicMock()
    custom.id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    custom.telemetry_definition_path = "vehicles/aegon-relay.yaml"
    db.get.return_value = None
    seed_calls: list[dict] = []

    class ScalarResult:
        def __init__(self, rows):
            self._rows = rows

        def scalars(self):
            return self

        def all(self):
            return self._rows

    monkeypatch.setattr(
        "app.services.realtime_service._seed_metadata_for_source",
        lambda *args, **kwargs: seed_calls.append(kwargs),
    )
    db.execute.return_value = ScalarResult([custom])

    bootstrap_builtin_sources(db)

    assert any(call["source_id"] == custom.id for call in seed_calls)
    assert any(
        call["source_id"] == custom.id and call["refresh_embeddings"] is False
        for call in seed_calls
    )


def test_bootstrap_builtin_sources_returns_repaired_sources_for_embedding_backfill(monkeypatch) -> None:
    """Startup bootstrap should backfill embeddings for every source it repaired."""

    db = MagicMock()
    built_in = MagicMock()
    built_in.id = DROGONSAT_SOURCE_ID
    built_in.telemetry_definition_path = "simulators/drogonsat.yaml"
    custom = MagicMock()
    custom.id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    custom.telemetry_definition_path = "vehicles/aegon-relay.yaml"
    db.get.side_effect = lambda model, source_id: built_in if source_id == DROGONSAT_SOURCE_ID else None

    class ScalarResult:
        def __init__(self, rows):
            self._rows = rows

        def scalars(self):
            return self

        def all(self):
            return self._rows

    monkeypatch.setattr(
        "app.services.realtime_service._seed_metadata_for_source",
        lambda *args, **kwargs: None,
    )
    db.execute.return_value = ScalarResult([built_in, custom])

    repaired_source_ids = bootstrap_builtin_sources(db)

    expected_ids = {custom.id, *(spec.id for spec in BUILT_IN_SOURCES)}

    assert set(repaired_source_ids) == expected_ids


def test_refresh_source_embeddings_backfills_real_embeddings(monkeypatch) -> None:
    """Post-startup embedding refresh should use the real provider for specified sources."""

    db = MagicMock()
    source = MagicMock()
    source.id = DROGONSAT_SOURCE_ID
    source.telemetry_definition_path = "simulators/drogonsat.yaml"
    provider = MagicMock()
    seed_calls: list[dict] = []

    db.get.side_effect = lambda model, source_id: source if source_id == DROGONSAT_SOURCE_ID else None

    monkeypatch.setattr(
        "app.services.realtime_service._seed_metadata_for_source",
        lambda *args, **kwargs: seed_calls.append(kwargs),
    )

    refresh_source_embeddings(
        db,
        source_ids=[DROGONSAT_SOURCE_ID],
        embedding_provider=provider,
    )

    assert seed_calls == [
        {
            "source_id": DROGONSAT_SOURCE_ID,
            "telemetry_definition_path": "simulators/drogonsat.yaml",
            "embedding_provider": provider,
            "refresh_embeddings": True,
            "preserve_existing_embeddings": True,
            "overwrite_position_mapping": False,
        }
    ]
    db.commit.assert_called_once()


def test_bootstrap_builtin_sources_reconciles_duplicates_before_seeding(monkeypatch) -> None:
    """Startup bootstrap should collapse duplicate built-ins before metadata repair runs."""

    db = MagicMock()
    source = MagicMock()
    source.id = DROGONSAT_SOURCE_ID
    source.telemetry_definition_path = "simulators/drogonsat.yaml"
    call_order: list[str] = []

    class ScalarResult:
        def __init__(self, rows):
            self._rows = rows

        def scalars(self):
            return self

        def all(self):
            return self._rows

    db.get.return_value = source
    db.execute.return_value = ScalarResult([source])

    monkeypatch.setattr(
        "app.services.realtime_service.reconcile_builtin_source_duplicates",
        lambda _db: call_order.append("reconcile"),
    )
    monkeypatch.setattr(
        "app.services.realtime_service._seed_metadata_for_source",
        lambda *args, **kwargs: call_order.append("seed"),
    )

    bootstrap_builtin_sources(db)

    assert call_order == ["reconcile", "seed"]


def test_reconcile_builtin_source_duplicates_ignores_custom_sources(monkeypatch) -> None:
    """Custom sources that reuse built-in catalogs must not be collapsed at startup."""

    from app.services.realtime_service import reconcile_builtin_source_duplicates

    db = MagicMock()
    canonical = MagicMock()
    canonical.id = DROGONSAT_SOURCE_ID
    canonical.name = "DrogonSat"
    canonical.description = "Agile tactical simulator with GPS LLA telemetry"
    canonical.base_url = "http://simulator:8001"
    canonical.source_type = "simulator"
    canonical.telemetry_definition_path = "simulators/drogonsat.yaml"
    custom = MagicMock()
    custom.id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    custom.source_type = "simulator"
    custom.telemetry_definition_path = "simulators/drogonsat.yaml"
    custom.name = "Custom Drogon"
    custom.description = "Independent simulator"
    custom.base_url = "http://remote-sim:9000"

    class ScalarResult:
        def __init__(self, rows):
            self._rows = rows

        def scalars(self):
            return self

        def all(self):
            return self._rows

    db.get.side_effect = lambda model, source_id: canonical if source_id == DROGONSAT_SOURCE_ID else None
    db.execute.return_value = ScalarResult([custom])
    merge_calls: list[tuple[str, str]] = []

    monkeypatch.setattr(
        "app.services.realtime_service._merge_builtin_duplicate_source",
        lambda _db, *, old_source_id, new_source_id: merge_calls.append((old_source_id, new_source_id)),
    )

    reconcile_builtin_source_duplicates(db)

    assert merge_calls == []


def test_bootstrap_builtin_sources_skips_invalid_catalogs_without_aborting(monkeypatch) -> None:
    """One stale definition path should not prevent startup repair for other sources."""

    db = MagicMock()
    bad = MagicMock()
    bad.id = "bad-source"
    bad.telemetry_definition_path = "vehicles/missing.yaml"
    good = MagicMock()
    good.id = DROGONSAT_SOURCE_ID
    good.telemetry_definition_path = "simulators/drogonsat.yaml"
    seed_calls: list[str] = []

    class ScalarResult:
        def __init__(self, rows):
            self._rows = rows

        def scalars(self):
            return self

        def all(self):
            return self._rows

    def fake_seed_metadata_for_source(*args, **kwargs):
        if kwargs["source_id"] == bad.id:
            raise ValueError("missing definition")
        seed_calls.append(kwargs["source_id"])

    monkeypatch.setattr(
        "app.services.realtime_service._seed_metadata_for_source",
        fake_seed_metadata_for_source,
    )
    db.execute.return_value = ScalarResult([bad, good])

    bootstrap_builtin_sources(db)

    assert good.id in seed_calls
    db.commit.assert_called_once()


def test_seed_metadata_prunes_watchlist_entries_for_removed_channels(monkeypatch) -> None:
    """Pruning metadata should also prune watchlist entries for removed channels."""

    db = MagicMock()
    embedding_provider = MagicMock()
    obsolete_meta = MagicMock()
    obsolete_meta.name = "obsolete_channel"
    stale_watchlist_delete = []

    retained_channel = MagicMock()
    retained_channel.name = "retained_channel"
    retained_channel.units = "V"
    retained_channel.description = "Retained"
    retained_channel.subsystem = "power"
    retained_channel.red_low = None
    retained_channel.red_high = None
    definition = MagicMock()
    definition.channels = [retained_channel]
    definition.position_mapping = None

    class ScalarResult:
        def __init__(self, rows):
            self._rows = rows

        def all(self):
            return self._rows

        def first(self):
            return self._rows[0] if self._rows else None

    def fake_execute(statement):
        statement_sql = str(statement)
        if "DELETE FROM watchlist" in statement_sql:
            stale_watchlist_delete.append(statement_sql)
            return MagicMock()
        if "FROM telemetry_metadata" in statement_sql:
            return MagicMock(scalars=lambda: ScalarResult([obsolete_meta]))
        if "FROM position_channel_mappings" in statement_sql:
            return MagicMock(scalars=lambda: ScalarResult([]))
        raise AssertionError(f"Unexpected statement: {statement_sql}")

    db.execute.side_effect = fake_execute

    monkeypatch.setattr(
        "app.services.realtime_service.load_definition_file",
        lambda _path: definition,
    )

    _seed_metadata_for_source(
        db,
        source_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        telemetry_definition_path="vehicles/balerion-surveyor.json",
        embedding_provider=embedding_provider,
        prune_missing=True,
    )

    assert stale_watchlist_delete
    db.delete.assert_called_once_with(obsolete_meta)


def test_update_source_prunes_missing_channels_when_vehicle_definition_changes(monkeypatch) -> None:
    """Changing a vehicle definition before ingest should drop channels not in the new catalog."""

    db = MagicMock()
    embedding_provider = MagicMock()
    existing = MagicMock()
    existing.id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    existing.telemetry_definition_path = "vehicles/aegon-relay.yaml"
    existing.source_type = "vehicle"
    db.get.return_value = existing

    seed_calls: list[tuple[tuple, dict]] = []

    monkeypatch.setattr(
        "app.services.realtime_service.source_has_telemetry_history",
        lambda _db, _source_id: False,
    )

    def fake_seed_metadata_for_source(*args, **kwargs) -> None:
        seed_calls.append((args, kwargs))

    monkeypatch.setattr(
        "app.services.realtime_service._seed_metadata_for_source",
        fake_seed_metadata_for_source,
    )

    update_source(
        db,
        embedding_provider=embedding_provider,
        source_id=existing.id,
        telemetry_definition_path="vehicles/balerion-surveyor.json",
    )

    assert existing.telemetry_definition_path == "vehicles/balerion-surveyor.json"
    assert seed_calls == [
        (
            (db,),
            {
                "source_id": existing.id,
                "telemetry_definition_path": "vehicles/balerion-surveyor.json",
                "embedding_provider": embedding_provider,
                "prune_missing": True,
            },
        )
    ]


def test_source_has_telemetry_history_checks_custom_source_ids() -> None:
    """Custom source ids should be checked directly for historical telemetry rows."""

    db = MagicMock()
    counts = iter([1, 0])

    class ScalarOneResult:
        def scalar_one(self):
            return next(counts)

    db.execute.side_effect = lambda _statement: ScalarOneResult()

    assert source_has_telemetry_history(db, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") is True


def test_update_source_rejects_simulator_definition_path_changes() -> None:
    """Simulator definitions are fixed by the runtime deployment and cannot drift in DB."""

    db = MagicMock()
    embedding_provider = MagicMock()
    existing = MagicMock()
    existing.id = "27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6"
    existing.telemetry_definition_path = "simulators/drogonsat.yaml"
    existing.source_type = "simulator"
    db.get.return_value = existing

    with pytest.raises(ValueError) as exc_info:
        update_source(
            db,
            embedding_provider=embedding_provider,
            source_id=existing.id,
            telemetry_definition_path="simulators/rhaegalsat.json",
        )

    assert "Cannot change telemetry_definition_path for simulator sources" in str(exc_info.value)
