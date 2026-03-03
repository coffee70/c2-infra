"""Tests for realtime telemetry processing."""

import pytest

from app.services.telemetry_service import _compute_state


class TestComputeState:
    """Unit tests for _compute_state (alert transition logic)."""

    def test_normal_in_family(self) -> None:
        state, reason = _compute_state(28.0, 0.5, 26.0, 30.0, 0.5)
        assert state == "normal"
        assert reason is None

    def test_warning_out_of_limits_high(self) -> None:
        state, reason = _compute_state(31.0, 2.0, 26.0, 30.0, 0.5)
        assert state == "warning"
        assert reason == "out_of_limits"

    def test_warning_out_of_limits_low(self) -> None:
        state, reason = _compute_state(25.0, -2.0, 26.0, 30.0, 0.5)
        assert state == "warning"
        assert reason == "out_of_limits"

    def test_warning_out_of_family_z_score(self) -> None:
        state, reason = _compute_state(29.0, 2.5, None, None, 0.5)
        assert state == "warning"
        assert reason == "out_of_family"

    def test_caution_near_limits(self) -> None:
        # Within 1 sigma of red_high
        state, reason = _compute_state(29.6, 1.0, 26.0, 30.0, 0.5)
        assert state == "caution"
        assert reason is not None

    def test_caution_z_score_1_5_to_2(self) -> None:
        state, reason = _compute_state(28.9, 1.8, None, None, 0.5)
        assert state == "caution"
        assert reason == "out_of_family"

    def test_no_limits_normal(self) -> None:
        state, reason = _compute_state(28.0, 0.0, None, None, 0.5)
        assert state == "normal"
        assert reason is None

    def test_debounce_consecutive_warnings(self) -> None:
        """Two consecutive warning samples should trigger alert (logic in processor)."""
        v1, _ = _compute_state(31.0, 2.5, 26.0, 30.0, 0.5)
        v2, _ = _compute_state(31.0, 2.5, 26.0, 30.0, 0.5)
        assert v1 == "warning"
        assert v2 == "warning"
