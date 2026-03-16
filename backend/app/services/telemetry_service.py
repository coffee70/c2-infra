"""Telemetry business logic service."""

import logging
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from typing import Optional, Tuple
from uuid import UUID

from sqlalchemy import desc, or_, select
from sqlalchemy.orm import Session

from app.interfaces.embedding_provider import EmbeddingProvider
from app.interfaces.llm_provider import LLMProvider
from app.models.telemetry import TelemetryData, TelemetryMetadata, TelemetryStatistics
from app.models.schemas import (
    RelatedChannel,
    StatisticsResponse,
    ExplainResponse,
    SearchResult,
)
from app.services.source_run_service import normalize_source_id, run_id_to_source_id
from app.utils.subsystem import infer_subsystem

logger = logging.getLogger(__name__)


def _compute_state(
    value: float,
    z_score: Optional[float],
    red_low: Optional[float],
    red_high: Optional[float],
    std_dev: float,
) -> Tuple[str, Optional[str]]:
    """Compute state (normal/caution/warning) and reason (out_of_limits/out_of_family)."""
    out_of_limits = False
    if red_low is not None and value < float(red_low):
        out_of_limits = True
    if red_high is not None and value > float(red_high):
        out_of_limits = True

    abs_z = abs(z_score) if z_score is not None else 0.0
    out_of_family = abs_z > 2
    caution_z = 1.5 < abs_z <= 2

    # Near limits: within 1 sigma of a limit (but not out of limits)
    near_limits = False
    rl = float(red_low) if red_low is not None else None
    rh = float(red_high) if red_high is not None else None
    if rl is not None and std_dev > 0 and rl <= value < rl + std_dev:
        near_limits = True
    if rh is not None and std_dev > 0 and rh - std_dev < value <= rh:
        near_limits = True

    if out_of_limits or out_of_family:
        state = "warning"
        reason = "out_of_limits" if out_of_limits else "out_of_family"
    elif caution_z or near_limits:
        state = "caution"
        reason = "out_of_family" if caution_z else "out_of_limits"
    else:
        state = "normal"
        reason = None
    return state, reason


class TelemetryService:
    """Service for telemetry CRUD, search, and explanation."""

    def __init__(
        self,
        db: Session,
        embedding_provider: EmbeddingProvider,
        llm_provider: LLMProvider,
    ) -> None:
        self._db = db
        self._embedding = embedding_provider
        self._llm = llm_provider

    def create_schema(
        self,
        source_id: str,
        name: str,
        units: str,
        description: Optional[str] = None,
        subsystem_tag: Optional[str] = None,
        red_low: Optional[float] = None,
        red_high: Optional[float] = None,
    ) -> UUID:
        """Create telemetry metadata with embedding."""
        logical_source_id = run_id_to_source_id(source_id)
        text_for_embedding = f"{name} {units} {description or ''}".strip()
        embedding = self._embedding.embed(text_for_embedding)

        meta = TelemetryMetadata(
            source_id=logical_source_id,
            name=name,
            units=units,
            description=description,
            subsystem_tag=subsystem_tag,
            red_low=Decimal(str(red_low)) if red_low is not None else None,
            red_high=Decimal(str(red_high)) if red_high is not None else None,
            embedding=embedding,
        )
        self._db.add(meta)
        self._db.flush()
        self._db.refresh(meta)
        logger.info("Created telemetry schema: %s", name)
        return meta.id

    def get_by_name(self, source_id: str, name: str) -> Optional[TelemetryMetadata]:
        """Fetch metadata by source and name."""
        logical_source_id = run_id_to_source_id(source_id)
        stmt = select(TelemetryMetadata).where(
            TelemetryMetadata.source_id == logical_source_id,
            TelemetryMetadata.name == name,
        )
        return self._db.execute(stmt).scalar_one_or_none()

    def get_by_id(self, telemetry_id: UUID) -> Optional[TelemetryMetadata]:
        """Fetch metadata by ID."""
        return self._db.get(TelemetryMetadata, telemetry_id)

    def insert_data(
        self,
        source_id: str,
        telemetry_name: str,
        data: list[tuple[datetime, float]],
    ) -> int:
        """Insert batch of time-series data. source_id scopes data when telemetry_data is source-aware."""
        data_source_id = normalize_source_id(source_id)
        meta = self.get_by_name(source_id, telemetry_name)
        if not meta:
            raise ValueError(f"Telemetry not found: {telemetry_name}")

        rows = [
            TelemetryData(
                source_id=data_source_id,
                telemetry_id=meta.id,
                timestamp=ts,
                value=Decimal(str(v)),
            )
            for ts, v in data
        ]
        self._db.add_all(rows)
        return len(rows)

    def semantic_search(
        self,
        query: str,
        limit: int = 10,
        subsystem: Optional[str] = None,
        anomalous_only: bool = False,
        units: Optional[str] = None,
        recent_minutes: Optional[int] = None,
        source_id: str = "default",
    ) -> list[SearchResult]:
        """Vector similarity search with enriched metadata and optional filters."""
        if not query or not query.strip():
            return []
        data_source_id = normalize_source_id(source_id)

        # Fetch more candidates when filters are applied
        fetch_limit = limit * 5 if any([subsystem, anomalous_only, units, recent_minutes]) else limit

        logical_source_id = run_id_to_source_id(source_id)
        query_embedding = self._embedding.embed(query)
        distance_expr = TelemetryMetadata.embedding.cosine_distance(query_embedding)

        stmt = (
            select(TelemetryMetadata, distance_expr)
            .where(TelemetryMetadata.source_id == logical_source_id)
            .where(TelemetryMetadata.embedding.isnot(None))
            .order_by(distance_expr)
            .limit(fetch_limit)
        )
        result = self._db.execute(stmt)
        rows = result.fetchall()

        results: list[SearchResult] = []
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=recent_minutes) if recent_minutes else None

        seen_names: set[str] = set()

        def append_result(meta: TelemetryMetadata, match_confidence: float) -> bool:
            subsys = infer_subsystem(meta.name, meta)

            # Filter by subsystem
            if subsystem and subsys != subsystem:
                return False

            # Filter by units
            if units and meta.units != units:
                return False

            stats = self._db.get(TelemetryStatistics, (data_source_id, meta.id))
            latest = self.get_recent_value_with_timestamp(meta.name, source_id=source_id)

            # Filter by recent data
            if recent_minutes and cutoff:
                if not latest or latest[1] < cutoff:
                    return False

            current_value: Optional[float] = None
            current_status: Optional[str] = None
            last_timestamp: Optional[str] = None

            if latest and stats:
                val, ts = latest  # (value, timestamp)
                current_value = val
                last_timestamp = ts.isoformat()
                std_dev = float(stats.std_dev)
                mean = float(stats.mean)
                z_score = (val - mean) / std_dev if std_dev > 0 else None
                red_low = float(meta.red_low) if meta.red_low is not None else None
                red_high = float(meta.red_high) if meta.red_high is not None else None
                state, _ = _compute_state(val, z_score, red_low, red_high, std_dev)
                current_status = state

                if anomalous_only and state != "warning":
                    return False
            elif anomalous_only:
                # Need state for anomalous filter but we don't have stats/latest
                return False

            results.append(
                SearchResult(
                    name=meta.name,
                    match_confidence=match_confidence,
                    description=meta.description,
                    subsystem_tag=subsys,
                    units=meta.units,
                    current_value=current_value,
                    current_status=current_status,
                    last_timestamp=last_timestamp,
                )
            )
            seen_names.add(meta.name)
            return True

        for meta, dist in rows:
            if append_result(meta, 1.0 - float(dist)) and len(results) >= limit:
                break

        if len(results) < limit:
            raw_query = query.strip()
            terms = [term for term in raw_query.lower().split() if term]
            lexical_patterns = [f"%{term}%" for term in terms] or [f"%{raw_query.lower()}%"]
            lexical_clauses = [
                or_(
                    TelemetryMetadata.name.ilike(pattern),
                    TelemetryMetadata.description.ilike(pattern),
                    TelemetryMetadata.subsystem_tag.ilike(pattern),
                )
                for pattern in lexical_patterns
            ]
            lexical_stmt = (
                select(TelemetryMetadata)
                .where(TelemetryMetadata.source_id == logical_source_id)
                .where(TelemetryMetadata.name.not_in(seen_names) if seen_names else True)
                .where(or_(*lexical_clauses))
                .limit(fetch_limit)
            )
            lexical_rows = self._db.execute(lexical_stmt).scalars().all()

            for meta in lexical_rows:
                haystack = " ".join(
                    filter(None, [meta.name.lower(), (meta.description or "").lower(), (meta.subsystem_tag or "").lower()])
                )
                term_hits = sum(term in haystack for term in terms) if terms else int(raw_query.lower() in haystack)
                lexical_confidence = min(0.89, 0.5 + 0.15 * max(term_hits, 1))
                if append_result(meta, lexical_confidence) and len(results) >= limit:
                    break

        return results

    def get_recent_values(
        self,
        name: str,
        limit: int = 100,
        since: Optional[datetime] = None,
        until: Optional[datetime] = None,
        source_id: str = "default",
    ) -> list[tuple[datetime, float]]:
        """Get most recent values for a telemetry point, optionally filtered by time range and source."""
        data_source_id = normalize_source_id(source_id)
        meta = self.get_by_name(source_id, name)
        if not meta:
            raise ValueError(f"Telemetry not found: {name}")

        stmt = (
            select(TelemetryData.timestamp, TelemetryData.value)
            .where(
                TelemetryData.telemetry_id == meta.id,
                TelemetryData.source_id == data_source_id,
            )
            .order_by(desc(TelemetryData.timestamp))
            .limit(limit)
        )
        if since is not None:
            stmt = stmt.where(TelemetryData.timestamp >= since)
        if until is not None:
            stmt = stmt.where(TelemetryData.timestamp <= until)
        rows = self._db.execute(stmt).fetchall()
        return [(r[0], float(r[1])) for r in rows]

    def get_recent_value(
        self, name: str, source_id: str = "default"
    ) -> Optional[float]:
        """Get the most recent single value."""
        rows = self.get_recent_values(name, limit=1, source_id=source_id)
        return rows[0][1] if rows else None

    def get_recent_value_with_timestamp(
        self, name: str, source_id: str = "default"
    ) -> Optional[Tuple[float, datetime]]:
        """Get the most recent value and its timestamp."""
        rows = self.get_recent_values(name, limit=1, source_id=source_id)
        return (rows[0][1], rows[0][0]) if rows else None

    def get_related_channels(
        self, name: str, limit: int = 5, source_id: str = "default"
    ) -> list[RelatedChannel]:
        """Get channels linked by subsystem/physics for 'What to check next'."""
        data_source_id = normalize_source_id(source_id)
        meta = self.get_by_name(source_id, name)
        if not meta:
            return []

        subsys = infer_subsystem(meta.name, meta)
        units = meta.units or ""

        # Fetch all metadata except self
        stmt = select(TelemetryMetadata).where(
            TelemetryMetadata.source_id == run_id_to_source_id(source_id),
            TelemetryMetadata.name != name,
        )
        all_meta = self._db.execute(stmt).scalars().all()

        same_subsys_same_units: list[tuple[TelemetryMetadata, str]] = []
        same_subsys: list[tuple[TelemetryMetadata, str]] = []

        for m in all_meta:
            m_subsys = infer_subsystem(m.name, m)
            m_units = m.units or ""
            if m_subsys != subsys:
                continue
            if m_units == units and units:
                same_subsys_same_units.append((m, f"same subsystem and units ({subsys})"))
            elif m_units == units:
                same_subsys_same_units.append((m, f"same subsystem ({subsys})"))
            else:
                same_subsys.append((m, f"same subsystem ({subsys})"))

        # Build ordered list: same subsystem + same units first, then same subsystem
        ordered: list[tuple[TelemetryMetadata, str]] = same_subsys_same_units + same_subsys

        # If fewer than limit, add semantic search within same subsystem
        if len(ordered) < limit:
            semantic_results = self.semantic_search(
                meta.name, limit=limit, subsystem=subsys, source_id=source_id
            )
            seen = {m.name for m, _ in ordered}
            for r in semantic_results:
                if r.name not in seen:
                    m = self.get_by_name(source_id, r.name)
                    if m:
                        ordered.append((m, f"related in {subsys}"))
                        seen.add(r.name)
                if len(ordered) >= limit:
                    break

        result: list[RelatedChannel] = []
        for m, reason in ordered[:limit]:
            current_value: Optional[float] = None
            current_status: Optional[str] = None
            last_timestamp: Optional[str] = None
            latest = self.get_recent_value_with_timestamp(m.name, source_id=source_id)
            stats = self._db.get(TelemetryStatistics, (data_source_id, m.id))
            if latest and stats:
                val, ts = latest
                current_value = val
                last_timestamp = ts.isoformat()
                std_dev = float(stats.std_dev)
                mean = float(stats.mean)
                z_score = (val - mean) / std_dev if std_dev > 0 else None
                red_low = float(m.red_low) if m.red_low is not None else None
                red_high = float(m.red_high) if m.red_high is not None else None
                state, _ = _compute_state(val, z_score, red_low, red_high, std_dev)
                current_status = state
            result.append(
                RelatedChannel(
                    name=m.name,
                    subsystem_tag=infer_subsystem(m.name, m),
                    link_reason=reason,
                    current_value=current_value,
                    current_status=current_status,
                    last_timestamp=last_timestamp,
                    units=m.units,
                )
            )
        return result

    def _compute_confidence_indicator(
        self,
        n_samples: int,
        last_timestamp: Optional[str],
    ) -> Optional[str]:
        """Compute confidence/quality indicator for the explanation."""
        if n_samples < 100:
            return "based on limited history"
        if not last_timestamp:
            return "no recent data"
        try:
            ts = datetime.fromisoformat(last_timestamp.replace("Z", "+00:00"))
            age = datetime.now(timezone.utc) - ts
            if age > timedelta(hours=1):
                return "no recent data"
        except (ValueError, TypeError):
            return "no recent data"
        return None

    def get_explanation(
        self, name: str, skip_llm: bool = False, source_id: str = "default"
    ) -> ExplainResponse:
        """Build full explanation with stats, z-score, and LLM response."""
        data_source_id = normalize_source_id(source_id)
        meta = self.get_by_name(source_id, name)
        if not meta:
            raise ValueError(f"Telemetry not found: {name}")

        stats_row = self._db.get(TelemetryStatistics, (data_source_id, meta.id))
        if not stats_row:
            from app.services.statistics_service import StatisticsService

            stats_service = StatisticsService(self._db)
            stats_service._recompute_one(meta.id, source_id=data_source_id)
            self._db.flush()
            stats_row = self._db.get(TelemetryStatistics, (data_source_id, meta.id))
        recent_row = self.get_recent_value_with_timestamp(name, source_id=source_id)
        recent_value = recent_row[0] if recent_row else None  # (value, timestamp)
        last_timestamp = recent_row[1].isoformat() if recent_row else None

        if not stats_row:
            raise ValueError(f"Statistics not computed for: {name}")

        mean = float(stats_row.mean)
        std_dev = float(stats_row.std_dev)
        z_score: Optional[float] = None
        is_anomalous = False

        if recent_value is not None and std_dev > 0:
            z_score = (recent_value - mean) / std_dev
            is_anomalous = abs(z_score) > 2

        if recent_value is None:
            recent_value = mean

        red_low = float(meta.red_low) if meta.red_low is not None else None
        red_high = float(meta.red_high) if meta.red_high is not None else None
        state, state_reason = _compute_state(
            recent_value, z_score, red_low, red_high, std_dev
        )

        if skip_llm:
            llm_explanation = ""
            what_this_means = ""
            related: list = []
        else:
            prompt = (
                f"Telemetry Name: {meta.name}\n"
                f"Units: {meta.units}\n"
                f"Description: {meta.description or 'N/A'}\n"
                f"Recent Value: {recent_value}\n"
                f"Mean: {mean}\n"
                f"Std Dev: {std_dev}\n"
                f"P5: {float(stats_row.p5)}\n"
                f"P95: {float(stats_row.p95)}\n"
                f"Z-Score: {z_score if z_score is not None else 'N/A'}\n"
                f"Is Anomalous: {is_anomalous}\n\n"
                "Provide a concise explanation in two parts:\n"
                "1. WHAT THIS MEANS: Start with 1-2 sentences summarizing what this telemetry represents and whether the current value is concerning. Be direct and actionable for ops.\n"
                "2. Then add any additional context or detail if helpful."
            )

            llm_explanation = self._llm.generate(prompt)

            # Extract "What this means" as first 1-2 sentences (before first double newline or first 2 sentences)
            what_this_means = llm_explanation
            if "\n\n" in llm_explanation:
                what_this_means = llm_explanation.split("\n\n")[0].strip()
            else:
                sentences = [s.strip() for s in llm_explanation.replace("\n", " ").split(". ") if s.strip()]
                if len(sentences) >= 2:
                    s = ". ".join(sentences[:2])
                    what_this_means = s if s.endswith(".") else s + "."
                elif sentences:
                    s = sentences[0]
                    what_this_means = s if s.endswith(".") else s + "."

            related = self.get_related_channels(name, limit=5, source_id=source_id)
        n_samples = getattr(stats_row, "n_samples", 0)
        confidence = self._compute_confidence_indicator(n_samples, last_timestamp)

        return ExplainResponse(
            name=meta.name,
            description=meta.description,
            units=meta.units,
            statistics=StatisticsResponse(
                mean=mean,
                std_dev=std_dev,
                min_value=float(stats_row.min_value),
                max_value=float(stats_row.max_value),
                p5=float(stats_row.p5),
                p50=float(stats_row.p50),
                p95=float(stats_row.p95),
                n_samples=getattr(stats_row, "n_samples", 0),
            ),
            recent_value=recent_value,
            z_score=z_score,
            is_anomalous=is_anomalous,
            state=state,
            state_reason=state_reason,
            last_timestamp=last_timestamp,
            red_low=red_low,
            red_high=red_high,
            what_this_means=what_this_means,
            what_to_check_next=related,
            confidence_indicator=confidence,
            llm_explanation=llm_explanation,
        )
