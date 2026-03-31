"""Tests for websocket realtime fanout."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.schemas import RealtimeChannelUpdate, TelemetryAlertSchema
from app.realtime.ws_hub import RealtimeWsHub


def _make_ws(active_source_id: str) -> MagicMock:
    ws = MagicMock()
    ws.send_text = AsyncMock()
    return ws


@pytest.mark.anyio
async def test_broadcast_telemetry_update_matches_vehicle_and_stream_scope() -> None:
    hub = RealtimeWsHub()
    vehicle_ws = _make_ws("vehicle-a")
    base_ws = _make_ws("vehicle-a")
    stream_ws = _make_ws("stream-1")
    other_ws = _make_ws("vehicle-b")
    hub._connections = {
        vehicle_ws: {
            "active_vehicle_id": "vehicle-a",
            "active_stream_id": None,
            "watchlist_channels": {"VBAT"},
            "channel_detail": set(),
            "alerts_subscribed": True,
        },
        base_ws: {
            "active_vehicle_id": "vehicle-a",
            "active_stream_id": "vehicle-a",
            "watchlist_channels": {"VBAT"},
            "channel_detail": set(),
            "alerts_subscribed": True,
        },
        stream_ws: {
            "active_vehicle_id": "vehicle-a",
            "active_stream_id": "stream-1",
            "watchlist_channels": {"VBAT"},
            "channel_detail": set(),
            "alerts_subscribed": True,
        },
        other_ws: {
            "active_vehicle_id": "vehicle-b",
            "active_stream_id": None,
            "watchlist_channels": {"VBAT"},
            "channel_detail": set(),
            "alerts_subscribed": True,
        },
    }

    await hub._do_broadcast_telemetry_update(
        RealtimeChannelUpdate(
            vehicle_id="vehicle-a",
            stream_id="stream-1",
            name="VBAT",
            subsystem_tag="power",
            current_value=4.2,
            generation_time="2026-03-26T12:00:00+00:00",
            reception_time="2026-03-26T12:00:01+00:00",
            state="normal",
        )
    )

    assert vehicle_ws.send_text.await_count == 1
    assert base_ws.send_text.await_count == 1
    assert stream_ws.send_text.await_count == 1
    assert other_ws.send_text.await_count == 0


@pytest.mark.anyio
async def test_historical_stream_scoped_subscription_stays_pinned() -> None:
    hub = RealtimeWsHub()
    vehicle_ws = _make_ws("vehicle-a")
    stream_ws = _make_ws("stream-1")
    hub._connections = {
        vehicle_ws: {
            "active_vehicle_id": "vehicle-a",
            "active_stream_id": None,
            "watchlist_channels": {"VBAT"},
            "channel_detail": set(),
            "alerts_subscribed": True,
        },
        stream_ws: {
            "active_vehicle_id": "vehicle-a",
            "active_stream_id": "stream-1",
            "watchlist_channels": {"VBAT"},
            "channel_detail": set(),
            "alerts_subscribed": True,
        },
    }

    await hub._do_broadcast_telemetry_update(
        RealtimeChannelUpdate(
            vehicle_id="vehicle-a",
            stream_id="vehicle-a-2026-03-26T12-00-00Z",
            name="VBAT",
            subsystem_tag="power",
            current_value=4.2,
            generation_time="2026-03-26T12:00:00+00:00",
            reception_time="2026-03-26T12:00:01+00:00",
            state="normal",
        )
    )

    assert vehicle_ws.send_text.await_count == 1
    assert stream_ws.send_text.await_count == 0


@pytest.mark.anyio
async def test_broadcast_alert_event_matches_vehicle_and_stream_scope() -> None:
    hub = RealtimeWsHub()
    vehicle_ws = _make_ws("vehicle-a")
    base_ws = _make_ws("vehicle-a")
    stream_ws = _make_ws("stream-1")
    other_ws = _make_ws("vehicle-b")
    hub._connections = {
        vehicle_ws: {
            "active_vehicle_id": "vehicle-a",
            "active_stream_id": None,
            "watchlist_channels": set(),
            "channel_detail": set(),
            "alerts_subscribed": True,
        },
        base_ws: {
            "active_vehicle_id": "vehicle-a",
            "active_stream_id": "vehicle-a",
            "watchlist_channels": set(),
            "channel_detail": set(),
            "alerts_subscribed": True,
        },
        stream_ws: {
            "active_vehicle_id": "vehicle-a",
            "active_stream_id": "stream-1",
            "watchlist_channels": set(),
            "channel_detail": set(),
            "alerts_subscribed": True,
        },
        other_ws: {
            "active_vehicle_id": "vehicle-b",
            "active_stream_id": None,
            "watchlist_channels": set(),
            "channel_detail": set(),
            "alerts_subscribed": True,
        },
    }

    await hub.broadcast_alert_event(
        "opened",
        TelemetryAlertSchema(
            id="00000000-0000-0000-0000-000000000001",
            vehicle_id="vehicle-a",
            stream_id="stream-1",
            channel_name="VBAT",
            telemetry_id="00000000-0000-0000-0000-000000000010",
            subsystem="power",
            severity="warning",
            status="new",
            opened_at="2026-03-26T12:00:00+00:00",
            opened_reception_at="2026-03-26T12:00:01+00:00",
            last_update_at="2026-03-26T12:00:01+00:00",
            current_value=4.2,
        ),
    )

    assert vehicle_ws.send_text.await_count == 1
    assert base_ws.send_text.await_count == 1
    assert stream_ws.send_text.await_count == 1
    assert other_ws.send_text.await_count == 0
