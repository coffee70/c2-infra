"""Tests for semantic-search fallback behavior."""

from __future__ import annotations

from unittest.mock import MagicMock

from app.models.telemetry import TelemetryMetadata
from app.services.telemetry_service import TelemetryService


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


def test_semantic_search_falls_back_to_lexical_matches_when_embeddings_missing(monkeypatch) -> None:
    db = MagicMock()
    embedding_provider = MagicMock()
    llm_provider = MagicMock()
    service = TelemetryService(db, embedding_provider, llm_provider)
    embedding_provider.embed.return_value = [0.1, 0.2, 0.3]

    lexical_meta = TelemetryMetadata(
        source_id="source-a",
        name="PROP_TANK_B_PRESS",
        units="psi",
        description="Tank B pressure channel",
        subsystem_tag="prop",
        embedding=None,
    )
    db.execute.side_effect = [
        _FakeResult([]),
        _FakeResult([lexical_meta]),
    ]
    monkeypatch.setattr(
        service,
        "get_recent_value_with_timestamp",
        lambda *args, **kwargs: None,
    )

    results = service.semantic_search("tank b pressure", source_id="source-a")

    assert len(results) == 1
    assert results[0].name == "PROP_TANK_B_PRESS"
    assert 0.0 < results[0].match_confidence < 1.0
