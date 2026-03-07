"""Tests for ops_events service and feed health."""

import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock

from app.realtime.feed_health import FeedHealthTracker, SourceHealth


class TestSourceHealth:
    """Unit tests for SourceHealth."""

    def test_record_reception(self) -> None:
        sh = SourceHealth(source_id="test")
        sh.record_reception()
        assert sh.last_reception_time > 0

    def test_current_state_connected(self) -> None:
        sh = SourceHealth(source_id="test")
        sh.record_reception()
        assert sh.current_state() == "connected"

    def test_approx_rate_hz(self) -> None:
        sh = SourceHealth(source_id="test")
        for _ in range(5):
            sh.record_reception()
        rate = sh.approx_rate_hz()
        assert rate is None or rate >= 0


class TestFeedHealthTracker:
    """Unit tests for FeedHealthTracker."""

    def test_record_reception(self) -> None:
        tracker = FeedHealthTracker()
        tracker.record_reception("source_a")
        status = tracker.get_status("source_a")
        assert status["source_id"] == "source_a"
        assert status["connected"] is True

    def test_unknown_source_returns_disconnected(self) -> None:
        tracker = FeedHealthTracker()
        status = tracker.get_status("unknown")
        assert status["source_id"] == "unknown"
        assert status["connected"] is False
