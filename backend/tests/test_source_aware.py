"""Tests for source-aware telemetry (multi-source correctness)."""

import pytest

from app.services.overview_service import get_overview, get_anomalies


class TestSourceAwareOverview:
    """Verify overview/anomalies accept and use source_id."""

    def test_get_overview_accepts_source_id(self) -> None:
        """get_overview accepts source_id parameter (default: default)."""
        from unittest.mock import MagicMock

        db = MagicMock()
        db.execute = MagicMock(return_value=MagicMock(fetchall=MagicMock(return_value=[])))
        result = get_overview(db, source_id="simulator")
        assert result == []

    def test_get_anomalies_accepts_source_id(self) -> None:
        """get_anomalies accepts source_id parameter."""
        from unittest.mock import MagicMock

        db = MagicMock()
        db.execute = MagicMock(return_value=MagicMock(fetchall=MagicMock(return_value=[])))
        result = get_anomalies(db, source_id="mock_vehicle")
        assert "power" in result
        assert "thermal" in result
        assert "adcs" in result
        assert "comms" in result
        assert "other" in result
