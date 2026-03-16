"""Add telemetry definition paths and migrate built-in sources to UUIDs.

Revision ID: 011
Revises: 010
Create Date: 2026-03-14
"""

import json
from pathlib import Path
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import yaml

revision: str = "011"
down_revision: Union[str, None] = "010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_DEFINITION_PATHS = (
    "vehicles/aegon-relay.yaml",
    "vehicles/balerion-surveyor.json",
    "simulators/drogonsat.yaml",
    "simulators/rhaegalsat.json",
)
_BUILT_IN_DEFAULT_PATHS = {
    "86a0057f-4733-4de6-af60-455cb3954f1d": "vehicles/aegon-relay.yaml",
    "9a157057-347a-46c2-8626-fd3d7245b5eb": "vehicles/balerion-surveyor.json",
    "27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6": "simulators/drogonsat.yaml",
    "63b0c0ab-8173-44ff-918f-2616ebb449b8": "simulators/rhaegalsat.json",
}
_SOURCE_TYPE_FALLBACK_PATHS = {
    "vehicle": "vehicles/aegon-relay.yaml",
    "simulator": "simulators/drogonsat.yaml",
}
_BUILT_IN_SPECS = (
    {
        "legacy_id": "default",
        "id": "86a0057f-4733-4de6-af60-455cb3954f1d",
        "name": "Aegon Relay",
        "description": "Baseline operator training vehicle",
        "source_type": "vehicle",
        "base_url": None,
        "telemetry_definition_path": "vehicles/aegon-relay.yaml",
    },
    {
        "legacy_id": "mock_vehicle",
        "id": "9a157057-347a-46c2-8626-fd3d7245b5eb",
        "name": "Balerion Surveyor",
        "description": "CLI mock vehicle stream for source-aware validation",
        "source_type": "vehicle",
        "base_url": None,
        "telemetry_definition_path": "vehicles/balerion-surveyor.json",
    },
    {
        "legacy_id": "simulator",
        "id": "27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6",
        "name": "DrogonSat",
        "description": "Agile tactical simulator with GPS LLA telemetry",
        "source_type": "simulator",
        "base_url": "http://simulator:8001",
        "telemetry_definition_path": "simulators/drogonsat.yaml",
    },
    {
        "legacy_id": "simulator2",
        "id": "63b0c0ab-8173-44ff-918f-2616ebb449b8",
        "name": "RhaegalSat",
        "description": "Heavy survey simulator with ECEF position telemetry",
        "source_type": "simulator",
        "base_url": "http://simulator2:8001",
        "telemetry_definition_path": "simulators/rhaegalsat.json",
    },
)


def _definitions_root() -> Path:
    return Path(__file__).resolve().parents[4] / "telemetry-definitions"


def _load_definition_channels(path_str: str) -> set[str]:
    resolved = _definitions_root() / path_str
    raw = resolved.read_text(encoding="utf-8")
    payload = json.loads(raw) if resolved.suffix.lower() == ".json" else yaml.safe_load(raw)
    return {channel["name"] for channel in payload.get("channels", [])}


def _source_channel_names(conn, source_id: str) -> set[str]:
    run_prefix = f"{source_id}-%"
    rows = conn.execute(
        sa.text(
            """
            SELECT DISTINCT name FROM (
              SELECT tm.name AS name
              FROM telemetry_metadata tm
              WHERE tm.source_id = :source_id
              UNION
              SELECT tm.name AS name
              FROM telemetry_data td
              JOIN telemetry_metadata tm ON tm.id = td.telemetry_id
              WHERE td.source_id = :source_id OR td.source_id LIKE :run_prefix
              UNION
              SELECT tm.name AS name
              FROM telemetry_current tc
              JOIN telemetry_metadata tm ON tm.id = tc.telemetry_id
              WHERE tc.source_id = :source_id OR tc.source_id LIKE :run_prefix
              UNION
              SELECT tm.name AS name
              FROM telemetry_statistics ts
              JOIN telemetry_metadata tm ON tm.id = ts.telemetry_id
              WHERE ts.source_id = :source_id OR ts.source_id LIKE :run_prefix
              UNION
              SELECT tm.name AS name
              FROM telemetry_alerts ta
              JOIN telemetry_metadata tm ON tm.id = ta.telemetry_id
              WHERE ta.source_id = :source_id OR ta.source_id LIKE :run_prefix
            ) names
            """
        ),
        {"source_id": source_id, "run_prefix": run_prefix},
    ).fetchall()
    return {row[0] for row in rows if row[0]}


def _stage_builtin_source_rows(conn) -> None:
    for spec in _BUILT_IN_SPECS:
        conn.execute(
            sa.text(
                """
                INSERT INTO telemetry_sources (
                  id,
                  name,
                  description,
                  source_type,
                  base_url,
                  telemetry_definition_path,
                  created_at
                )
                SELECT
                  :id,
                  COALESCE(legacy.name, :name),
                  COALESCE(legacy.description, :description),
                  COALESCE(legacy.source_type, :source_type),
                  COALESCE(legacy.base_url, :base_url),
                  COALESCE(
                    legacy.telemetry_definition_path,
                    :telemetry_definition_path
                  ),
                  legacy.created_at
                FROM telemetry_sources AS legacy
                WHERE legacy.id = :legacy_id
                  AND NOT EXISTS (
                    SELECT 1 FROM telemetry_sources WHERE id = :id
                  )
                """
            ),
            spec,
        )
        conn.execute(
            sa.text(
                """
                INSERT INTO telemetry_sources (
                  id,
                  name,
                  description,
                  source_type,
                  base_url,
                  telemetry_definition_path,
                  created_at
                )
                SELECT
                  :id,
                  :name,
                  :description,
                  :source_type,
                  :base_url,
                  :telemetry_definition_path,
                  CURRENT_TIMESTAMP
                WHERE NOT EXISTS (
                  SELECT 1 FROM telemetry_sources WHERE id = :id
                )
                """
            ),
            spec,
        )


def _delete_legacy_builtin_source_rows(conn) -> None:
    conn.execute(
        sa.text(
            """
            DELETE FROM telemetry_sources
            WHERE id IN ('default', 'mock_vehicle', 'simulator', 'simulator2')
            """
        )
    )


def _infer_definition_path_for_channels(
    channel_names: set[str],
    source_type: str | None,
) -> str | None:
    if not channel_names:
        return None

    candidates: list[tuple[float, str]] = []
    for path_str in _DEFINITION_PATHS:
        if source_type == "simulator" and not path_str.startswith("simulators/"):
            continue
        if source_type == "vehicle" and not path_str.startswith("vehicles/"):
            continue
        definition_channels = _load_definition_channels(path_str)
        overlap = len(channel_names & definition_channels)
        if overlap == 0:
            continue
        score = overlap / len(definition_channels | channel_names)
        candidates.append((score, path_str))

    if not candidates:
        return None

    candidates.sort(reverse=True)
    top_score, top_path = candidates[0]
    if len(candidates) > 1 and candidates[1][0] == top_score:
        return None
    return top_path


def upgrade() -> None:
    conn = op.get_bind()
    op.add_column(
        "telemetry_sources",
        sa.Column("telemetry_definition_path", sa.Text(), nullable=True),
    )
    _stage_builtin_source_rows(conn)

    for table_name in ("telemetry_metadata", "watchlist", "position_channel_mappings"):
        op.execute(
            f"UPDATE {table_name} SET source_id = '86a0057f-4733-4de6-af60-455cb3954f1d' WHERE source_id = 'default'"
        )
        op.execute(
            f"UPDATE {table_name} SET source_id = '9a157057-347a-46c2-8626-fd3d7245b5eb' WHERE source_id = 'mock_vehicle'"
        )
        op.execute(
            f"UPDATE {table_name} SET source_id = '27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6' WHERE source_id = 'simulator'"
        )
        op.execute(
            f"UPDATE {table_name} SET source_id = '63b0c0ab-8173-44ff-918f-2616ebb449b8' WHERE source_id = 'simulator2'"
        )

    for table_name in (
        "telemetry_current",
        "telemetry_alerts",
        "telemetry_data",
        "telemetry_statistics",
        "ops_events",
    ):
        op.execute(
            f"UPDATE {table_name} SET source_id = '86a0057f-4733-4de6-af60-455cb3954f1d' WHERE source_id = 'default'"
        )
        op.execute(
            f"UPDATE {table_name} SET source_id = '9a157057-347a-46c2-8626-fd3d7245b5eb' WHERE source_id = 'mock_vehicle'"
        )
        op.execute(
            f"UPDATE {table_name} SET source_id = '27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6' WHERE source_id = 'simulator'"
        )
        op.execute(
            f"UPDATE {table_name} SET source_id = '63b0c0ab-8173-44ff-918f-2616ebb449b8' WHERE source_id = 'simulator2'"
        )
        op.execute(
            f"""
            UPDATE {table_name}
            SET source_id = replace(
              source_id,
              'simulator-',
              '27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6-'
            )
            WHERE source_id LIKE 'simulator-%'
            """
        )
        op.execute(
            f"""
            UPDATE {table_name}
            SET source_id = replace(
              source_id,
              'simulator2-',
              '63b0c0ab-8173-44ff-918f-2616ebb449b8-'
            )
            WHERE source_id LIKE 'simulator2-%'
            """
        )
    _delete_legacy_builtin_source_rows(conn)
    unresolved_rows = conn.execute(
        sa.text(
            """
            SELECT id, source_type, telemetry_definition_path
            FROM telemetry_sources
            ORDER BY id
            """
        )
    ).fetchall()
    unresolved_ids: list[str] = []
    for source_id, source_type, telemetry_definition_path in unresolved_rows:
        if telemetry_definition_path is not None:
            continue
        channel_names = _source_channel_names(conn, source_id)
        inferred = _infer_definition_path_for_channels(channel_names, source_type)
        if inferred is None and not channel_names:
            inferred = _BUILT_IN_DEFAULT_PATHS.get(source_id)
        if inferred is None and not channel_names:
            inferred = _SOURCE_TYPE_FALLBACK_PATHS.get(source_type or "")
        if inferred is None:
            unresolved_ids.append(source_id)
            continue
        conn.execute(
            sa.text(
                """
                UPDATE telemetry_sources
                SET telemetry_definition_path = :telemetry_definition_path
                WHERE id = :source_id
                """
            ),
            {
                "source_id": source_id,
                "telemetry_definition_path": inferred,
            },
        )

    if unresolved_ids:
        raise RuntimeError(
            "Could not infer telemetry_definition_path for existing sources: "
            + ", ".join(unresolved_ids)
        )

    op.alter_column(
        "telemetry_sources",
        "telemetry_definition_path",
        nullable=False,
    )


def downgrade() -> None:
    op.execute(
        """
        INSERT INTO telemetry_sources (id, name, description, source_type, base_url, telemetry_definition_path, created_at)
        VALUES
          ('default', 'Default', 'Default telemetry source', 'vehicle', NULL, 'vehicles/aegon-relay.yaml', now()),
          ('mock_vehicle', 'Mock Vehicle', 'CLI mock streamer', 'vehicle', NULL, 'vehicles/balerion-surveyor.json', now()),
          ('simulator', 'Simulator', 'Mock vehicle simulator', 'simulator', 'http://simulator:8001', 'simulators/drogonsat.yaml', now()),
          ('simulator2', 'Simulator 2', 'Second simulator instance', 'simulator', 'http://simulator2:8001', 'simulators/rhaegalsat.json', now())
        ON CONFLICT (id) DO NOTHING
        """
    )

    for table_name in ("telemetry_metadata", "watchlist", "position_channel_mappings"):
        op.execute(f"UPDATE {table_name} SET source_id = 'default' WHERE source_id = '86a0057f-4733-4de6-af60-455cb3954f1d'")
        op.execute(f"UPDATE {table_name} SET source_id = 'mock_vehicle' WHERE source_id = '9a157057-347a-46c2-8626-fd3d7245b5eb'")
        op.execute(f"UPDATE {table_name} SET source_id = 'simulator' WHERE source_id = '27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6'")
        op.execute(f"UPDATE {table_name} SET source_id = 'simulator2' WHERE source_id = '63b0c0ab-8173-44ff-918f-2616ebb449b8'")

    for table_name in ("telemetry_current", "telemetry_alerts", "telemetry_data", "telemetry_statistics", "ops_events"):
        op.execute(f"UPDATE {table_name} SET source_id = 'default' WHERE source_id = '86a0057f-4733-4de6-af60-455cb3954f1d'")
        op.execute(f"UPDATE {table_name} SET source_id = 'mock_vehicle' WHERE source_id = '9a157057-347a-46c2-8626-fd3d7245b5eb'")
        op.execute(f"UPDATE {table_name} SET source_id = 'simulator' WHERE source_id = '27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6'")
        op.execute(f"UPDATE {table_name} SET source_id = 'simulator2' WHERE source_id = '63b0c0ab-8173-44ff-918f-2616ebb449b8'")
        op.execute(
            f"""
            UPDATE {table_name}
            SET source_id = replace(
              source_id,
              '27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6-',
              'simulator-'
            )
            WHERE source_id LIKE '27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6-%'
            """
        )
        op.execute(
            f"""
            UPDATE {table_name}
            SET source_id = replace(
              source_id,
              '63b0c0ab-8173-44ff-918f-2616ebb449b8-',
              'simulator2-'
            )
            WHERE source_id LIKE '63b0c0ab-8173-44ff-918f-2616ebb449b8-%'
            """
        )

    op.execute(
        "DELETE FROM telemetry_sources WHERE id IN ('86a0057f-4733-4de6-af60-455cb3954f1d', '9a157057-347a-46c2-8626-fd3d7245b5eb', '27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6', '63b0c0ab-8173-44ff-918f-2616ebb449b8')"
    )
    op.drop_column("telemetry_sources", "telemetry_definition_path")
