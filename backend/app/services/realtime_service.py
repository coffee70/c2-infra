"""Realtime snapshot and subscription helpers."""

import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import delete, desc, func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.interfaces.embedding_provider import EmbeddingProvider
from app.models.schemas import RealtimeChannelUpdate, RecentDataPoint, TelemetryAlertSchema
from app.models.telemetry import (
    PositionChannelMapping,
    TelemetryAlert,
    TelemetryChannelAlias,
    TelemetryCurrent,
    TelemetryData,
    TelemetryMetadata,
    TelemetrySource,
    TelemetryStream,
    WatchlistEntry,
)
from app.services.channel_alias_service import get_aliases_by_telemetry_ids
from app.services.source_run_service import get_stream_vehicle_id, normalize_source_id, run_id_to_source_id
from app.utils.subsystem import infer_subsystem
from telemetry_catalog.builtins import BUILT_IN_SOURCES
from telemetry_catalog.builtins import LEGACY_SOURCE_ID_ALIASES
from telemetry_catalog.definitions import (
    canonical_definition_path,
    load_definition_file,
    resolve_source_id_alias,
)

logger = logging.getLogger(__name__)

SPARKLINE_POINTS = 30
CHANNEL_ORIGIN_CATALOG = "catalog"
CHANNEL_ORIGIN_DISCOVERED = "discovered"


def _resolve_stream_vehicle_id(db: Session, source_id: str) -> str:
    """Resolve a stream-scoped request to the owning vehicle id."""
    return get_stream_vehicle_id(db, source_id) or run_id_to_source_id(source_id)


def _source_to_dict(src: TelemetrySource) -> dict:
    return {
        "id": src.id,
        "name": src.name,
        "description": src.description,
        "source_type": src.source_type,
        "base_url": src.base_url,
        "telemetry_definition_path": src.telemetry_definition_path,
    }


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def create_discovered_channel_metadata(
    db: Session,
    *,
    source_id: str,
    channel_name: str,
    discovery_namespace: str | None = None,
    observed_at: datetime | None = None,
) -> TelemetryMetadata:
    """Create or update metadata for a runtime-discovered channel."""
    seen_at = observed_at or _now_utc()
    meta = db.execute(
        select(TelemetryMetadata).where(
            TelemetryMetadata.source_id == source_id,
            TelemetryMetadata.name == channel_name,
        )
    ).scalars().first()
    if meta is None:
        meta = TelemetryMetadata(
            source_id=source_id,
            name=channel_name,
            units="",
            description=None,
            subsystem_tag="dynamic",
            channel_origin=CHANNEL_ORIGIN_DISCOVERED,
            discovery_namespace=discovery_namespace,
            discovered_at=seen_at,
            last_seen_at=seen_at,
        )
        db.add(meta)
        try:
            db.flush()
            return meta
        except IntegrityError:
            # Another ingest worker won the race to create the same discovered channel.
            db.rollback()
            meta = db.execute(
                select(TelemetryMetadata).where(
                    TelemetryMetadata.source_id == source_id,
                    TelemetryMetadata.name == channel_name,
                )
            ).scalars().first()
            if meta is None:
                raise

    if meta.channel_origin == CHANNEL_ORIGIN_DISCOVERED:
        meta.last_seen_at = seen_at
        if discovery_namespace and not meta.discovery_namespace:
            meta.discovery_namespace = discovery_namespace
    return meta


def _retarget_watchlist_entries(
    db: Session,
    *,
    source_id: str,
    old_name: str,
    new_name: str,
) -> None:
    if old_name == new_name:
        return
    params = {
        "source_id": source_id,
        "old_name": old_name,
        "new_name": new_name,
    }
    db.execute(
        text(
            """
            UPDATE watchlist
            SET telemetry_name = :new_name
            WHERE source_id = :source_id
              AND telemetry_name = :old_name
            """
        ),
        params,
    )
    db.execute(
        text(
            """
            DELETE FROM watchlist
            WHERE id IN (
              SELECT id
              FROM (
                SELECT
                  id,
                  row_number() OVER (
                    PARTITION BY source_id, telemetry_name
                    ORDER BY display_order, created_at, id
                  ) AS row_num
                FROM watchlist
                WHERE source_id = :source_id
                  AND telemetry_name = :new_name
              ) AS ranked
              WHERE row_num > 1
            )
            """
        ),
        params,
    )


def _create_stream_scope_table(db: Session, *, table_name: str, source_id: str) -> None:
    db.execute(text(f"DROP TABLE IF EXISTS {table_name}"))
    db.execute(
        text(
            f"""
            CREATE TEMP TABLE {table_name} ON COMMIT DROP AS
            SELECT :source_id AS stream_id
            UNION
            SELECT ts.id AS stream_id
            FROM telemetry_streams AS ts
            WHERE ts.vehicle_id = :source_id
            """
        ),
        {"source_id": source_id},
    )


def _merge_same_source_metadata(
    db: Session,
    *,
    source_id: str,
    old_meta: TelemetryMetadata,
    new_meta: TelemetryMetadata,
) -> None:
    if old_meta.id == new_meta.id:
        return

    params = {
        "source_id": source_id,
        "old_id": old_meta.id,
        "new_id": new_meta.id,
    }
    scope_table = "tmp_same_source_stream_scope"

    _create_stream_scope_table(db, table_name=scope_table, source_id=source_id)

    db.execute(
        text(
            """
            INSERT INTO telemetry_channel_aliases (
              source_id,
              alias_name,
              telemetry_id,
              created_at
            )
            SELECT
              :source_id,
              tca.alias_name,
              :new_id,
              tca.created_at
            FROM telemetry_channel_aliases AS tca
            WHERE tca.source_id = :source_id
              AND tca.telemetry_id = :old_id
            ON CONFLICT (source_id, alias_name) DO UPDATE
            SET telemetry_id = EXCLUDED.telemetry_id
            """
        ),
        params,
    )
    db.execute(
        text(
            """
            DELETE FROM telemetry_channel_aliases
            WHERE source_id = :source_id
              AND telemetry_id = :old_id
            """
        ),
        params,
    )
    db.execute(
        text(
            """
            INSERT INTO telemetry_data (
              source_id,
              telemetry_id,
              timestamp,
              value,
              packet_source,
              receiver_id
            )
            SELECT
              td.source_id,
              :new_id,
              td.timestamp,
              td.value,
              td.packet_source,
              td.receiver_id
            FROM telemetry_data AS td
            WHERE (
              td.source_id = :source_id
              OR td.source_id IN (SELECT stream_id FROM tmp_same_source_stream_scope)
            )
              AND td.telemetry_id = :old_id
            ON CONFLICT (source_id, telemetry_id, timestamp) DO NOTHING
            """
        ),
        params,
    )
    db.execute(
        text(
            """
            DELETE FROM telemetry_data
            WHERE (
              source_id = :source_id
              OR source_id IN (SELECT stream_id FROM tmp_same_source_stream_scope)
            )
              AND telemetry_id = :old_id
            """
        ),
        params,
    )
    db.execute(
        text(
            """
            INSERT INTO telemetry_current (
              source_id,
              telemetry_id,
              generation_time,
              reception_time,
              value,
              state,
              state_reason,
              z_score,
              quality,
              sequence,
              packet_source,
              receiver_id
            )
            SELECT
              tc.source_id,
              :new_id,
              tc.generation_time,
              tc.reception_time,
              tc.value,
              tc.state,
              tc.state_reason,
              tc.z_score,
              tc.quality,
              tc.sequence,
              tc.packet_source,
              tc.receiver_id
            FROM telemetry_current AS tc
            WHERE (
              tc.source_id = :source_id
              OR tc.source_id IN (SELECT stream_id FROM tmp_same_source_stream_scope)
            )
              AND tc.telemetry_id = :old_id
            ON CONFLICT (source_id, telemetry_id) DO UPDATE
            SET
              generation_time = CASE
                WHEN EXCLUDED.generation_time > telemetry_current.generation_time
                  THEN EXCLUDED.generation_time
                WHEN EXCLUDED.generation_time = telemetry_current.generation_time
                  AND EXCLUDED.reception_time >= telemetry_current.reception_time
                  THEN EXCLUDED.generation_time
                ELSE telemetry_current.generation_time
              END,
              reception_time = CASE
                WHEN EXCLUDED.generation_time > telemetry_current.generation_time
                  THEN EXCLUDED.reception_time
                WHEN EXCLUDED.generation_time = telemetry_current.generation_time
                  AND EXCLUDED.reception_time >= telemetry_current.reception_time
                  THEN EXCLUDED.reception_time
                ELSE telemetry_current.reception_time
              END,
              value = CASE
                WHEN EXCLUDED.generation_time > telemetry_current.generation_time
                  THEN EXCLUDED.value
                WHEN EXCLUDED.generation_time = telemetry_current.generation_time
                  AND EXCLUDED.reception_time >= telemetry_current.reception_time
                  THEN EXCLUDED.value
                ELSE telemetry_current.value
              END,
              state = CASE
                WHEN EXCLUDED.generation_time > telemetry_current.generation_time
                  THEN EXCLUDED.state
                WHEN EXCLUDED.generation_time = telemetry_current.generation_time
                  AND EXCLUDED.reception_time >= telemetry_current.reception_time
                  THEN EXCLUDED.state
                ELSE telemetry_current.state
              END,
              state_reason = CASE
                WHEN EXCLUDED.generation_time > telemetry_current.generation_time
                  THEN EXCLUDED.state_reason
                WHEN EXCLUDED.generation_time = telemetry_current.generation_time
                  AND EXCLUDED.reception_time >= telemetry_current.reception_time
                  THEN EXCLUDED.state_reason
                ELSE telemetry_current.state_reason
              END,
              z_score = CASE
                WHEN EXCLUDED.generation_time > telemetry_current.generation_time
                  THEN EXCLUDED.z_score
                WHEN EXCLUDED.generation_time = telemetry_current.generation_time
                  AND EXCLUDED.reception_time >= telemetry_current.reception_time
                  THEN EXCLUDED.z_score
                ELSE telemetry_current.z_score
              END,
              quality = CASE
                WHEN EXCLUDED.generation_time > telemetry_current.generation_time
                  THEN EXCLUDED.quality
                WHEN EXCLUDED.generation_time = telemetry_current.generation_time
                  AND EXCLUDED.reception_time >= telemetry_current.reception_time
                  THEN EXCLUDED.quality
                ELSE telemetry_current.quality
              END,
              sequence = CASE
                WHEN EXCLUDED.generation_time > telemetry_current.generation_time
                  THEN EXCLUDED.sequence
                WHEN EXCLUDED.generation_time = telemetry_current.generation_time
                  AND EXCLUDED.reception_time >= telemetry_current.reception_time
                  THEN EXCLUDED.sequence
                ELSE telemetry_current.sequence
              END,
              packet_source = CASE
                WHEN EXCLUDED.generation_time > telemetry_current.generation_time
                  THEN EXCLUDED.packet_source
                WHEN EXCLUDED.generation_time = telemetry_current.generation_time
                  AND EXCLUDED.reception_time >= telemetry_current.reception_time
                  THEN EXCLUDED.packet_source
                ELSE telemetry_current.packet_source
              END,
              receiver_id = CASE
                WHEN EXCLUDED.generation_time > telemetry_current.generation_time
                  THEN EXCLUDED.receiver_id
                WHEN EXCLUDED.generation_time = telemetry_current.generation_time
                  AND EXCLUDED.reception_time >= telemetry_current.reception_time
                  THEN EXCLUDED.receiver_id
                ELSE telemetry_current.receiver_id
              END
            """
        ),
        params,
    )
    db.execute(
        text(
            """
            DELETE FROM telemetry_current
            WHERE (
              source_id = :source_id
              OR source_id IN (SELECT stream_id FROM tmp_same_source_stream_scope)
            )
              AND telemetry_id = :old_id
            """
        ),
        params,
    )
    db.execute(
        text(
            """
            DELETE FROM telemetry_statistics
            WHERE (
              source_id = :source_id
              OR source_id IN (SELECT stream_id FROM tmp_same_source_stream_scope)
            )
              AND telemetry_id IN (:old_id, :new_id)
            """
        ),
        params,
    )
    db.execute(
        text(
            """
            INSERT INTO telemetry_statistics (
              source_id,
              telemetry_id,
              mean,
              std_dev,
              min_value,
              max_value,
              p5,
              p50,
              p95,
              n_samples,
              last_computed_at
            )
            SELECT
              td.source_id,
              :new_id,
              AVG(td.value),
              COALESCE(STDDEV_POP(td.value), 0),
              MIN(td.value),
              MAX(td.value),
              PERCENTILE_CONT(0.05) WITHIN GROUP (ORDER BY td.value),
              PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY td.value),
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY td.value),
              COUNT(*),
              NOW()
            FROM telemetry_data AS td
            WHERE (
              td.source_id = :source_id
              OR td.source_id IN (SELECT stream_id FROM tmp_same_source_stream_scope)
            )
              AND td.telemetry_id = :new_id
            GROUP BY td.source_id
            """
        ),
        params,
    )
    db.execute(
        text(
            """
            UPDATE telemetry_alerts
            SET telemetry_id = :new_id
            WHERE telemetry_id = :old_id
              AND (
                source_id = :source_id
                OR source_id IN (SELECT stream_id FROM tmp_same_source_stream_scope)
              )
            """
        ),
        params,
    )

    _retarget_watchlist_entries(
        db,
        source_id=source_id,
        old_name=old_meta.name,
        new_name=new_meta.name,
    )
    db.delete(old_meta)


def _seed_metadata_for_source(
    db: Session,
    *,
    source_id: str,
    telemetry_definition_path: str,
    embedding_provider: EmbeddingProvider | None = None,
    prune_missing: bool = False,
    refresh_embeddings: bool = True,
    preserve_existing_embeddings: bool = False,
    overwrite_position_mapping: bool = True,
) -> bool:
    needs_embedding_backfill = False
    definition = load_definition_file(telemetry_definition_path)
    existing_rows = db.execute(
        select(TelemetryMetadata).where(TelemetryMetadata.source_id == source_id)
    ).scalars().all()
    existing_by_name = {row.name: row for row in existing_rows}
    existing_aliases = db.execute(
        select(TelemetryChannelAlias).where(TelemetryChannelAlias.source_id == source_id)
    ).scalars().all()
    existing_aliases_by_name = {row.alias_name: row for row in existing_aliases}
    expected_names = {channel.name for channel in definition.channels}
    expected_aliases = {alias for channel in definition.channels for alias in channel.aliases}
    preserved_alias_names = expected_aliases - expected_names
    removed_names: set[str] = set()

    db.execute(
        delete(TelemetryChannelAlias).where(
            TelemetryChannelAlias.source_id == source_id,
            TelemetryChannelAlias.alias_name.not_in(expected_aliases),
        )
    )

    if prune_missing:
        removed_names = {
            row.name
            for row in existing_rows
            if row.channel_origin != CHANNEL_ORIGIN_DISCOVERED
            and row.name not in expected_names
            and row.name not in preserved_alias_names
        }
        if removed_names:
            db.execute(
                delete(WatchlistEntry).where(
                    WatchlistEntry.source_id == source_id,
                    WatchlistEntry.telemetry_name.in_(removed_names),
                )
            )
        for row in existing_rows:
            if (
                row.channel_origin != CHANNEL_ORIGIN_DISCOVERED
                and row.name not in expected_names
                and row.name not in preserved_alias_names
            ):
                db.delete(row)
        if removed_names:
            existing_by_name = {
                name: row for name, row in existing_by_name.items() if name not in removed_names
            }

    for channel in definition.channels:
        meta = existing_by_name.get(channel.name)
        if meta is None:
            renamed_alias = next(
                (
                    existing_by_name[alias_name]
                    for alias_name in channel.aliases
                    if alias_name in existing_by_name
                    and existing_by_name[alias_name].channel_origin != CHANNEL_ORIGIN_DISCOVERED
                    and alias_name in preserved_alias_names
                ),
                None,
            )
            if renamed_alias is not None:
                old_name = renamed_alias.name
                existing_by_name.pop(renamed_alias.name, None)
                renamed_alias.name = channel.name
                existing_by_name[channel.name] = renamed_alias
                _retarget_watchlist_entries(
                    db,
                    source_id=source_id,
                    old_name=old_name,
                    new_name=channel.name,
                )
                meta = renamed_alias
        if meta is None:
            meta = TelemetryMetadata(
                id=uuid.uuid4(),
                source_id=source_id,
                name=channel.name,
                channel_origin=CHANNEL_ORIGIN_CATALOG,
            )
            db.add(meta)
        elif meta.channel_origin == CHANNEL_ORIGIN_DISCOVERED:
            meta.channel_origin = CHANNEL_ORIGIN_CATALOG
            if meta.embedding is None:
                needs_embedding_backfill = True
        if refresh_embeddings and not (preserve_existing_embeddings and meta.embedding is not None):
            if embedding_provider is None:
                raise ValueError("embedding_provider is required when refresh_embeddings=True")
            text_for_embedding = f"{channel.name} {channel.units} {channel.description}".strip()
            meta.embedding = embedding_provider.embed(text_for_embedding)
        meta.units = channel.units
        meta.description = channel.description
        meta.subsystem_tag = channel.subsystem
        meta.discovery_namespace = None
        meta.red_low = Decimal(str(channel.red_low)) if channel.red_low is not None else None
        meta.red_high = Decimal(str(channel.red_high)) if channel.red_high is not None else None
        for alias_name in channel.aliases:
            conflicting_meta = existing_by_name.get(alias_name)
            if conflicting_meta is not None and conflicting_meta.name != channel.name:
                if conflicting_meta.channel_origin == CHANNEL_ORIGIN_DISCOVERED:
                    _merge_same_source_metadata(
                        db,
                        source_id=source_id,
                        old_meta=conflicting_meta,
                        new_meta=meta,
                    )
                    existing_by_name.pop(alias_name, None)
                else:
                    raise ValueError(
                        f"channel alias {alias_name} conflicts with existing channel {conflicting_meta.name}"
                    )
            alias = existing_aliases_by_name.get(alias_name)
            if alias is None:
                alias = TelemetryChannelAlias(
                    source_id=source_id,
                    alias_name=alias_name,
                    telemetry_id=meta.id,
                )
                db.add(alias)
                existing_aliases_by_name[alias_name] = alias
            else:
                alias.telemetry_id = meta.id

    mapping = definition.position_mapping
    existing_mapping = db.execute(
        select(PositionChannelMapping).where(
            PositionChannelMapping.source_id == source_id,
            PositionChannelMapping.active.is_(True),
        )
    ).scalars().first()
    if not overwrite_position_mapping and existing_mapping is not None:
        return needs_embedding_backfill
    if mapping is None:
        if existing_mapping is not None:
            db.delete(existing_mapping)
        return needs_embedding_backfill

    if existing_mapping is None:
        existing_mapping = PositionChannelMapping(source_id=source_id)
        db.add(existing_mapping)

    existing_mapping.frame_type = mapping.frame_type
    existing_mapping.lat_channel_name = mapping.lat_channel_name
    existing_mapping.lon_channel_name = mapping.lon_channel_name
    existing_mapping.alt_channel_name = mapping.alt_channel_name
    existing_mapping.x_channel_name = mapping.x_channel_name
    existing_mapping.y_channel_name = mapping.y_channel_name
    existing_mapping.z_channel_name = mapping.z_channel_name
    existing_mapping.active = True
    return needs_embedding_backfill


def _merge_builtin_duplicate_source(
    db: Session,
    *,
    old_source_id: str,
    new_source_id: str,
) -> None:
    """Merge an obsolete built-in source row into the canonical built-in source id."""
    params = {
        "old_source_id": old_source_id,
        "new_source_id": new_source_id,
    }
    scope_table = "tmp_builtin_stream_scope"

    _create_stream_scope_table(db, table_name=scope_table, source_id=old_source_id)

    db.execute(text("DROP TABLE IF EXISTS tmp_builtin_meta_map"))
    db.execute(
        text(
            """
            CREATE TEMP TABLE tmp_builtin_meta_map ON COMMIT DROP AS
            SELECT
              old_meta.id AS old_id,
              COALESCE(new_meta.id, old_meta.id) AS new_id,
              (new_meta.id IS NOT NULL) AS target_exists
            FROM telemetry_metadata old_meta
            LEFT JOIN telemetry_metadata new_meta
              ON new_meta.source_id = :new_source_id
             AND new_meta.name = old_meta.name
            WHERE old_meta.source_id = :old_source_id
            """
        ),
        params,
    )

    db.execute(
        text(
            """
            UPDATE telemetry_metadata AS new_meta
            SET
              units = COALESCE(NULLIF(new_meta.units, ''), old_meta.units),
              description = COALESCE(new_meta.description, old_meta.description),
              subsystem_tag = COALESCE(new_meta.subsystem_tag, old_meta.subsystem_tag),
              red_low = COALESCE(new_meta.red_low, old_meta.red_low),
              red_high = COALESCE(new_meta.red_high, old_meta.red_high),
              embedding = COALESCE(new_meta.embedding, old_meta.embedding)
            FROM telemetry_metadata AS old_meta
            JOIN tmp_builtin_meta_map AS map
              ON map.old_id = old_meta.id
             AND map.target_exists
            WHERE new_meta.id = map.new_id
            """
        ),
        params,
    )

    db.execute(
        text(
            """
            UPDATE telemetry_metadata AS old_meta
            SET source_id = :new_source_id
            FROM tmp_builtin_meta_map AS map
            WHERE old_meta.id = map.old_id
              AND map.target_exists = FALSE
            """
        ),
        params,
    )

    db.execute(
        text(
            """
            INSERT INTO telemetry_channel_aliases (
              source_id,
              alias_name,
              telemetry_id,
              created_at
            )
            SELECT
              :new_source_id,
              tca.alias_name,
              map.new_id,
              tca.created_at
            FROM telemetry_channel_aliases AS tca
            JOIN tmp_builtin_meta_map AS map
              ON map.old_id = tca.telemetry_id
            WHERE tca.source_id = :old_source_id
            ON CONFLICT (source_id, alias_name) DO UPDATE
            SET telemetry_id = EXCLUDED.telemetry_id
            """
        ),
        params,
    )
    db.execute(
        text(
            """
            DELETE FROM telemetry_channel_aliases
            WHERE source_id = :old_source_id
            """
        ),
        params,
    )

    db.execute(
        text(
            """
            INSERT INTO telemetry_data (
              source_id,
              telemetry_id,
              timestamp,
              value,
              packet_source,
              receiver_id
            )
            SELECT
              CASE WHEN td.source_id = :old_source_id THEN :new_source_id ELSE td.source_id END,
              map.new_id,
              td.timestamp,
              td.value,
              td.packet_source,
              td.receiver_id
            FROM telemetry_data AS td
            JOIN tmp_builtin_meta_map AS map
              ON map.old_id = td.telemetry_id
            WHERE (
              td.source_id = :old_source_id
              OR td.source_id IN (SELECT stream_id FROM tmp_builtin_stream_scope)
            )
            ON CONFLICT (source_id, telemetry_id, timestamp) DO NOTHING
            """
        ),
        params,
    )
    db.execute(
        text(
            """
            DELETE FROM telemetry_data
            WHERE (
              source_id = :old_source_id
              OR source_id IN (SELECT stream_id FROM tmp_builtin_stream_scope)
            )
              AND telemetry_id IN (SELECT old_id FROM tmp_builtin_meta_map)
            """
        ),
        params,
    )

    db.execute(
        text(
            """
            INSERT INTO telemetry_current (
              source_id,
              telemetry_id,
              generation_time,
              reception_time,
              value,
              state,
              state_reason,
              z_score,
              quality,
              sequence,
              packet_source,
              receiver_id
            )
            SELECT
              CASE WHEN tc.source_id = :old_source_id THEN :new_source_id ELSE tc.source_id END,
              map.new_id,
              tc.generation_time,
              tc.reception_time,
              tc.value,
              tc.state,
              tc.state_reason,
              tc.z_score,
              tc.quality,
              tc.sequence,
              tc.packet_source,
              tc.receiver_id
            FROM telemetry_current AS tc
            JOIN tmp_builtin_meta_map AS map
              ON map.old_id = tc.telemetry_id
            WHERE (
              tc.source_id = :old_source_id
              OR tc.source_id IN (SELECT stream_id FROM tmp_builtin_stream_scope)
            )
            ON CONFLICT (source_id, telemetry_id) DO UPDATE
            SET
              generation_time = CASE
                WHEN EXCLUDED.reception_time >= telemetry_current.reception_time
                  THEN EXCLUDED.generation_time
                ELSE telemetry_current.generation_time
              END,
              reception_time = GREATEST(telemetry_current.reception_time, EXCLUDED.reception_time),
              value = CASE
                WHEN EXCLUDED.reception_time >= telemetry_current.reception_time
                  THEN EXCLUDED.value
                ELSE telemetry_current.value
              END,
              state = CASE
                WHEN EXCLUDED.reception_time >= telemetry_current.reception_time
                  THEN EXCLUDED.state
                ELSE telemetry_current.state
              END,
              state_reason = CASE
                WHEN EXCLUDED.reception_time >= telemetry_current.reception_time
                  THEN EXCLUDED.state_reason
                ELSE telemetry_current.state_reason
              END,
              z_score = CASE
                WHEN EXCLUDED.reception_time >= telemetry_current.reception_time
                  THEN EXCLUDED.z_score
                ELSE telemetry_current.z_score
              END,
              quality = CASE
                WHEN EXCLUDED.reception_time >= telemetry_current.reception_time
                  THEN EXCLUDED.quality
                ELSE telemetry_current.quality
              END,
              sequence = CASE
                WHEN EXCLUDED.reception_time >= telemetry_current.reception_time
                  THEN EXCLUDED.sequence
                ELSE telemetry_current.sequence
              END,
              packet_source = CASE
                WHEN EXCLUDED.reception_time >= telemetry_current.reception_time
                  THEN EXCLUDED.packet_source
                ELSE telemetry_current.packet_source
              END,
              receiver_id = CASE
                WHEN EXCLUDED.reception_time >= telemetry_current.reception_time
                  THEN EXCLUDED.receiver_id
                ELSE telemetry_current.receiver_id
              END
            """
        ),
        params,
    )
    db.execute(
        text(
            """
            DELETE FROM telemetry_current
            WHERE (
              source_id = :old_source_id
              OR source_id IN (SELECT stream_id FROM tmp_builtin_stream_scope)
            )
              AND telemetry_id IN (SELECT old_id FROM tmp_builtin_meta_map)
            """
        ),
        params,
    )

    db.execute(
        text(
            """
            INSERT INTO telemetry_statistics (
              source_id,
              telemetry_id,
              mean,
              std_dev,
              min_value,
              max_value,
              p5,
              p50,
              p95,
              n_samples,
              last_computed_at
            )
            SELECT
              CASE WHEN ts.source_id = :old_source_id THEN :new_source_id ELSE ts.source_id END,
              map.new_id,
              ts.mean,
              ts.std_dev,
              ts.min_value,
              ts.max_value,
              ts.p5,
              ts.p50,
              ts.p95,
              ts.n_samples,
              ts.last_computed_at
            FROM telemetry_statistics AS ts
            JOIN tmp_builtin_meta_map AS map
              ON map.old_id = ts.telemetry_id
            WHERE (
              ts.source_id = :old_source_id
              OR ts.source_id IN (SELECT stream_id FROM tmp_builtin_stream_scope)
            )
            ON CONFLICT (source_id, telemetry_id) DO UPDATE
            SET
              mean = CASE
                WHEN EXCLUDED.last_computed_at >= telemetry_statistics.last_computed_at
                  THEN EXCLUDED.mean
                ELSE telemetry_statistics.mean
              END,
              std_dev = CASE
                WHEN EXCLUDED.last_computed_at >= telemetry_statistics.last_computed_at
                  THEN EXCLUDED.std_dev
                ELSE telemetry_statistics.std_dev
              END,
              min_value = LEAST(telemetry_statistics.min_value, EXCLUDED.min_value),
              max_value = GREATEST(telemetry_statistics.max_value, EXCLUDED.max_value),
              p5 = CASE
                WHEN EXCLUDED.last_computed_at >= telemetry_statistics.last_computed_at
                  THEN EXCLUDED.p5
                ELSE telemetry_statistics.p5
              END,
              p50 = CASE
                WHEN EXCLUDED.last_computed_at >= telemetry_statistics.last_computed_at
                  THEN EXCLUDED.p50
                ELSE telemetry_statistics.p50
              END,
              p95 = CASE
                WHEN EXCLUDED.last_computed_at >= telemetry_statistics.last_computed_at
                  THEN EXCLUDED.p95
                ELSE telemetry_statistics.p95
              END,
              n_samples = GREATEST(telemetry_statistics.n_samples, EXCLUDED.n_samples),
              last_computed_at = GREATEST(
                telemetry_statistics.last_computed_at,
                EXCLUDED.last_computed_at
              )
            """
        ),
        params,
    )
    db.execute(
        text(
            """
            DELETE FROM telemetry_statistics
            WHERE (
              source_id = :old_source_id
              OR source_id IN (SELECT stream_id FROM tmp_builtin_stream_scope)
            )
              AND telemetry_id IN (SELECT old_id FROM tmp_builtin_meta_map)
            """
        ),
        params,
    )

    db.execute(
        text(
            """
            UPDATE telemetry_alerts AS ta
            SET
              source_id = CASE WHEN ta.source_id = :old_source_id THEN :new_source_id ELSE ta.source_id END,
              telemetry_id = map.new_id
            FROM tmp_builtin_meta_map AS map
            WHERE ta.telemetry_id = map.old_id
              AND (
                ta.source_id = :old_source_id
                OR ta.source_id IN (SELECT stream_id FROM tmp_builtin_stream_scope)
              )
            """
        ),
        params,
    )

    db.execute(
        text(
            """
            UPDATE telemetry_streams
            SET vehicle_id = :new_source_id
            WHERE id IN (SELECT stream_id FROM tmp_builtin_stream_scope)
            """
        ),
        params,
    )

    db.execute(
        text("DELETE FROM position_channel_mappings WHERE source_id = :new_source_id"),
        params,
    )
    db.execute(
        text(
            """
            UPDATE position_channel_mappings
            SET source_id = :new_source_id
            WHERE source_id = :old_source_id
            """
        ),
        params,
    )

    db.execute(
        text(
            """
            UPDATE watchlist
            SET source_id = :new_source_id
            WHERE source_id = :old_source_id
            """
        ),
        params,
    )
    db.execute(
        text(
            """
            DELETE FROM watchlist
            WHERE id IN (
              SELECT id
              FROM (
                SELECT
                  id,
                  row_number() OVER (
                    PARTITION BY source_id, telemetry_name
                    ORDER BY display_order, created_at, id
                  ) AS row_num
                FROM watchlist
                WHERE source_id = :new_source_id
              ) AS ranked
              WHERE row_num > 1
            )
            """
        ),
        params,
    )

    db.execute(
        text(
            """
            UPDATE ops_events
            SET
              source_id = CASE WHEN source_id = :old_source_id THEN :new_source_id ELSE source_id END,
              entity_id = CASE WHEN entity_id = :old_source_id THEN :new_source_id ELSE entity_id END
            WHERE source_id = :old_source_id
               OR source_id IN (SELECT stream_id FROM tmp_builtin_stream_scope)
               OR entity_id = :old_source_id
               OR entity_id IN (SELECT stream_id FROM tmp_builtin_stream_scope)
            """
        ),
        params,
    )

    db.execute(
        text(
            """
            DELETE FROM telemetry_metadata
            WHERE source_id = :old_source_id
            """
        ),
        params,
    )
    db.execute(
        text("DELETE FROM telemetry_sources WHERE id = :old_source_id"),
        params,
    )


def reconcile_builtin_source_duplicates(db: Session) -> None:
    """Collapse duplicate built-in source rows onto their canonical ids."""
    legacy_duplicate_ids = tuple(LEGACY_SOURCE_ID_ALIASES.keys())
    for spec in BUILT_IN_SOURCES:
        canonical = db.get(TelemetrySource, spec.id)
        if canonical is None:
            continue
        duplicates = db.execute(
            select(TelemetrySource)
            .where(TelemetrySource.id.in_(legacy_duplicate_ids))
            .where(TelemetrySource.id != spec.id)
            .order_by(TelemetrySource.created_at, TelemetrySource.id)
        ).scalars().all()
        for duplicate in duplicates:
            if duplicate.id not in legacy_duplicate_ids:
                continue
            if duplicate.telemetry_definition_path != spec.telemetry_definition_path:
                continue
            if duplicate.source_type != spec.source_type:
                continue
            if canonical.name == spec.name and duplicate.name:
                canonical.name = duplicate.name
            if canonical.description in (None, spec.description) and duplicate.description:
                canonical.description = duplicate.description
            if canonical.base_url in (None, spec.base_url) and duplicate.base_url:
                canonical.base_url = duplicate.base_url
            _merge_builtin_duplicate_source(
                db,
                old_source_id=duplicate.id,
                new_source_id=spec.id,
            )


def source_has_telemetry_history(db: Session, source_id: str) -> bool:
    resolved_source_id = resolve_source_id_alias(source_id) or source_id
    owned_stream_ids = select(TelemetryStream.id).where(
        TelemetryStream.vehicle_id == resolved_source_id
    )
    history_count = db.execute(
        select(func.count())
        .select_from(TelemetryData)
        .where(
            or_(
                TelemetryData.source_id == resolved_source_id,
                TelemetryData.source_id.in_(owned_stream_ids),
            )
        )
    ).scalar_one()
    return history_count > 0


def get_realtime_snapshot_for_channels(
    db: Session,
    channel_names: list[str],
    source_id: str = "default",
) -> list[RealtimeChannelUpdate]:
    """Get current values from telemetry_current for given channels and source."""
    if not channel_names:
        return []
    data_source_id = normalize_source_id(source_id)
    logical_source_id = _resolve_stream_vehicle_id(db, source_id)

    stmt = (
        select(TelemetryMetadata, TelemetryCurrent)
        .join(TelemetryCurrent, TelemetryMetadata.id == TelemetryCurrent.telemetry_id)
        .where(TelemetryCurrent.source_id == data_source_id)
        .where(TelemetryMetadata.source_id == logical_source_id)
        .where(TelemetryMetadata.name.in_(channel_names))
    )
    rows = db.execute(stmt).fetchall()
    result = []

    for meta, curr in rows:
        # Sparkline from telemetry_data
        spark_stmt = (
            select(TelemetryData.timestamp, TelemetryData.value)
            .where(
                TelemetryData.telemetry_id == meta.id,
                TelemetryData.source_id == data_source_id,
            )
            .order_by(desc(TelemetryData.timestamp))
            .limit(SPARKLINE_POINTS)
        )
        spark_rows = db.execute(spark_stmt).fetchall()
        sparkline_data = [
            RecentDataPoint(timestamp=r[0].isoformat(), value=float(r[1]))
            for r in reversed(spark_rows)
        ]

        result.append(
            RealtimeChannelUpdate(
                vehicle_id=logical_source_id,
                stream_id=data_source_id,
                name=meta.name,
                units=meta.units,
                description=meta.description,
                subsystem_tag=infer_subsystem(meta.name, meta),
                channel_origin=meta.channel_origin or CHANNEL_ORIGIN_CATALOG,
                discovery_namespace=meta.discovery_namespace,
                current_value=float(curr.value),
                generation_time=curr.generation_time.isoformat(),
                reception_time=curr.reception_time.isoformat(),
                state=curr.state,
                state_reason=curr.state_reason,
                z_score=float(curr.z_score) if curr.z_score is not None else None,
                quality=curr.quality,
                sparkline_data=sparkline_data,
            )
        )
    return result


def get_watchlist_channel_names(db: Session, source_id: str) -> list[str]:
    """Get watchlist channel names in display order."""
    logical_source_id = _resolve_stream_vehicle_id(db, source_id)
    stmt = (
        select(WatchlistEntry.telemetry_name)
        .where(WatchlistEntry.source_id == logical_source_id)
        .order_by(WatchlistEntry.display_order)
    )
    return [r[0] for r in db.execute(stmt).fetchall()]


def get_active_alerts(
    db: Session,
    source_id: str = "default",
    subsystems: list[str] | None = None,
    severities: list[str] | None = None,
) -> list[TelemetryAlertSchema]:
    """Get active (non-resolved, non-cleared) alerts for a source."""
    data_source_id = normalize_source_id(source_id)
    logical_source_id = _resolve_stream_vehicle_id(db, source_id)
    stmt = (
        select(TelemetryAlert, TelemetryMetadata)
        .join(TelemetryMetadata, TelemetryAlert.telemetry_id == TelemetryMetadata.id)
        .where(TelemetryAlert.source_id == data_source_id)
        .where(TelemetryMetadata.source_id == logical_source_id)
        .where(TelemetryAlert.cleared_at.is_(None))
        .where(TelemetryAlert.resolved_at.is_(None))
        .order_by(desc(TelemetryAlert.opened_at))
    )
    rows = db.execute(stmt).fetchall()
    result = []

    for alert, meta in rows:
        subsys = infer_subsystem(meta.name, meta)
        if subsystems and subsys not in subsystems:
            continue
        if severities and alert.severity not in severities:
            continue

        result.append(
            TelemetryAlertSchema(
                id=str(alert.id),
                vehicle_id=logical_source_id,
                stream_id=alert.source_id,
                channel_name=meta.name,
                telemetry_id=str(meta.id),
                subsystem=subsys,
                units=meta.units,
                severity=alert.severity,
                reason=alert.reason,
                status=alert.status,
                opened_at=alert.opened_at.isoformat(),
                opened_reception_at=alert.opened_reception_at.isoformat(),
                last_update_at=alert.last_update_at.isoformat(),
                current_value=float(alert.current_value_at_open),
                red_low=float(meta.red_low) if meta.red_low else None,
                red_high=float(meta.red_high) if meta.red_high else None,
                z_score=None,
                acked_at=alert.acked_at.isoformat() if alert.acked_at else None,
                acked_by=alert.acked_by,
                cleared_at=None,
                resolved_at=None,
                resolved_by=None,
                resolution_text=None,
                resolution_code=None,
            )
        )
    return result


def get_telemetry_sources(db: Session) -> list[dict]:
    """Get list of registered telemetry sources."""
    stmt = select(TelemetrySource).order_by(TelemetrySource.id)
    rows = db.execute(stmt).scalars().all()
    return [_source_to_dict(r) for r in rows]


def create_source(
    db: Session,
    embedding_provider: EmbeddingProvider,
    source_type: str,
    name: str,
    *,
    description: str | None = None,
    base_url: str | None = None,
    telemetry_definition_path: str,
) -> dict:
    """Create a new telemetry source. Returns the created source dict."""
    if source_type not in ("vehicle", "simulator"):
        raise ValueError("source_type must be 'vehicle' or 'simulator'")
    if source_type == "simulator" and not base_url:
        raise ValueError("base_url is required for simulator sources")
    resolved_definition_path = canonical_definition_path(telemetry_definition_path)
    source_id = str(uuid.uuid4())
    src = TelemetrySource(
        id=source_id,
        name=name,
        description=description,
        source_type=source_type,
        base_url=base_url if source_type == "simulator" else None,
        telemetry_definition_path=resolved_definition_path,
    )
    db.add(src)
    db.flush()
    _seed_metadata_for_source(
        db,
        source_id=source_id,
        telemetry_definition_path=resolved_definition_path,
        embedding_provider=embedding_provider,
    )
    db.commit()
    db.refresh(src)
    return _source_to_dict(src)


def update_source(
    db: Session,
    embedding_provider: EmbeddingProvider,
    source_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    base_url: str | None = None,
    telemetry_definition_path: str | None = None,
) -> dict | None:
    """Update a telemetry source. Returns updated source dict or None if not found."""
    resolved_source_id = resolve_source_id_alias(source_id)
    src = db.get(TelemetrySource, resolved_source_id)
    if not src:
        return None
    if name is not None:
        src.name = name
    if description is not None:
        src.description = description
    if base_url is not None and src.source_type == "simulator":
        src.base_url = base_url
    if telemetry_definition_path is not None:
        next_path = canonical_definition_path(telemetry_definition_path)
        if src.source_type == "simulator" and next_path != src.telemetry_definition_path:
            raise ValueError("Cannot change telemetry_definition_path for simulator sources")
        if next_path != src.telemetry_definition_path and source_has_telemetry_history(db, src.id):
            raise ValueError("Cannot change telemetry_definition_path after telemetry has been ingested")
        src.telemetry_definition_path = next_path
        _seed_metadata_for_source(
            db,
            source_id=src.id,
            telemetry_definition_path=src.telemetry_definition_path,
            embedding_provider=embedding_provider,
            prune_missing=True,
        )
    db.commit()
    db.refresh(src)
    return _source_to_dict(src)


def get_source_by_id(db: Session, source_id: str) -> dict | None:
    """Get a single source by id."""
    resolved_source_id = resolve_source_id_alias(source_id)
    src = db.get(TelemetrySource, resolved_source_id)
    if not src:
        return None
    return _source_to_dict(src)


def refresh_source_embeddings(
    db: Session,
    *,
    source_ids: list[str],
    embedding_provider: EmbeddingProvider,
) -> None:
    """Backfill real embeddings for the given sources without touching mappings."""
    for source_id in source_ids:
        src = db.get(TelemetrySource, source_id)
        if src is None:
            continue
        _seed_metadata_for_source(
            db,
            source_id=src.id,
            telemetry_definition_path=src.telemetry_definition_path,
            embedding_provider=embedding_provider,
            refresh_embeddings=True,
            preserve_existing_embeddings=True,
            overwrite_position_mapping=False,
        )
    db.commit()


def bootstrap_builtin_sources(
    db: Session,
) -> list[str]:
    """Ensure all registered sources and built-in local-stack sources have seeded metadata."""
    repaired_source_ids: set[str] = set()
    sources_needing_embedding_backfill: set[str] = set()
    for spec in BUILT_IN_SOURCES:
        src = db.get(TelemetrySource, spec.id)
        if src is None:
            src = TelemetrySource(
                id=spec.id,
                name=spec.name,
                description=spec.description,
                source_type=spec.source_type,
                base_url=spec.base_url,
                telemetry_definition_path=spec.telemetry_definition_path,
            )
            db.add(src)
            db.flush()
            repaired_source_ids.add(spec.id)

    reconcile_builtin_source_duplicates(db)

    all_sources = db.execute(select(TelemetrySource).order_by(TelemetrySource.id)).scalars().all()

    for src in all_sources:
        try:
            needs_embedding_backfill = _seed_metadata_for_source(
                db,
                source_id=src.id,
                telemetry_definition_path=src.telemetry_definition_path,
                refresh_embeddings=False,
                overwrite_position_mapping=False,
            )
            repaired_source_ids.add(src.id)
            if needs_embedding_backfill:
                sources_needing_embedding_backfill.add(src.id)
        except Exception:
            logger.exception(
                "Skipping bootstrap metadata repair for source %s due to invalid definition path %s",
                src.id,
                src.telemetry_definition_path,
            )

    if sources_needing_embedding_backfill:
        try:
            from app.services.embedding_service import SentenceTransformerEmbeddingProvider

            provider = SentenceTransformerEmbeddingProvider()
        except Exception:
            logger.exception(
                "Skipping bootstrap embedding backfill for promoted channels due to provider initialization failure"
            )
        else:
            for source_id in sorted(sources_needing_embedding_backfill):
                src = db.get(TelemetrySource, source_id)
                if src is None:
                    continue
                try:
                    _seed_metadata_for_source(
                        db,
                        source_id=src.id,
                        telemetry_definition_path=src.telemetry_definition_path,
                        embedding_provider=provider,
                        refresh_embeddings=True,
                        preserve_existing_embeddings=True,
                        overwrite_position_mapping=False,
                    )
                except Exception:
                    logger.exception(
                        "Skipping bootstrap embedding backfill for source %s",
                        src.id,
                    )
    db.commit()
    return sorted(repaired_source_ids)
