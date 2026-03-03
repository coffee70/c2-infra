"""WebSocket hub: manages connections, subscriptions, and broadcasts."""

import asyncio
import logging
from typing import Any

from fastapi import WebSocket

from app.models.schemas import (
    RealtimeChannelUpdate,
    TelemetryAlertSchema,
    WsSnapshotAlerts,
    WsSnapshotWatchlist,
    WsTelemetryUpdate,
    WsAlertEvent,
)

logger = logging.getLogger(__name__)


class RealtimeWsHub:
    """Manages WebSocket connections and broadcasts."""

    def __init__(self) -> None:
        self._connections: dict[WebSocket, dict[str, Any]] = {}
        self._lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Set event loop for scheduling broadcasts from sync threads."""
        self._loop = loop

    async def connect(self, ws: WebSocket) -> None:
        """Accept connection and register."""
        await ws.accept()
        async with self._lock:
            self._connections[ws] = {
                "active_source_id": "default",
                "watchlist_channels": set(),
                "channel_detail": set(),
                "alerts_subscribed": True,
            }
        logger.info(
            "WebSocket client connected, total=%d",
            len(self._connections),
            extra={"ws_clients": len(self._connections)},
        )

    async def disconnect(self, ws: WebSocket) -> None:
        """Remove connection."""
        async with self._lock:
            self._connections.pop(ws, None)
        logger.info("WebSocket client disconnected, total=%d", len(self._connections))

    def _get_subscribed_connections(
        self,
        channel_name: str | None = None,
        for_alerts: bool = False,
        source_id: str | None = None,
        alert_source_id: str | None = None,
    ) -> list[WebSocket]:
        """Get connections that should receive this update."""
        result = []
        for ws, subs in self._connections.items():
            conn_source = subs.get("active_source_id", "default")
            if for_alerts and subs.get("alerts_subscribed"):
                if alert_source_id is None or conn_source == alert_source_id:
                    result.append(ws)
            elif channel_name and channel_name in subs.get("watchlist_channels", set()):
                if source_id is None or conn_source == source_id:
                    result.append(ws)
            elif channel_name and channel_name in subs.get("channel_detail", set()):
                if source_id is None or conn_source == source_id:
                    result.append(ws)
        return result

    def schedule_telemetry_update(self, update: RealtimeChannelUpdate) -> None:
        """Schedule broadcast from sync context (e.g. processor thread)."""
        if self._loop is None:
            return
        asyncio.run_coroutine_threadsafe(
            self.broadcast_telemetry_update(update),
            self._loop,
        )

    def schedule_alert_event(
        self,
        event_type: str,
        alert: TelemetryAlertSchema | dict,
    ) -> None:
        """Schedule alert broadcast from sync context."""
        if self._loop is None:
            return
        asyncio.run_coroutine_threadsafe(
            self.broadcast_alert_event(event_type, alert),
            self._loop,
        )

    async def broadcast_telemetry_update(self, update: RealtimeChannelUpdate) -> None:
        """Broadcast to clients subscribed to this channel and source."""
        targets = self._get_subscribed_connections(
            channel_name=update.name,
            source_id=update.source_id,
        )
        if not targets:
            return
        msg = WsTelemetryUpdate(channel=update).model_dump_json()
        dead = []
        for ws in targets:
            try:
                await ws.send_text(msg)
            except Exception as e:
                logger.warning("Broadcast failed to client: %s", e)
                dead.append(ws)
        for ws in dead:
            await self.disconnect(ws)

    async def broadcast_alert_event(
        self,
        event_type: str,
        alert: TelemetryAlertSchema | dict,
    ) -> None:
        """Broadcast alert event to subscribed clients for the alert's source."""
        if isinstance(alert, dict):
            alert_obj = TelemetryAlertSchema(**alert)
        else:
            alert_obj = alert
        targets = self._get_subscribed_connections(
            for_alerts=True,
            alert_source_id=alert_obj.source_id,
        )
        if not targets:
            return
        msg = WsAlertEvent(event_type=event_type, alert=alert_obj).model_dump_json()
        dead = []
        for ws in targets:
            try:
                await ws.send_text(msg)
            except Exception as e:
                logger.warning("Alert broadcast failed to client: %s", e)
                dead.append(ws)
        for ws in dead:
            await self.disconnect(ws)

    async def subscribe_watchlist(
        self,
        ws: WebSocket,
        channels: list[str],
        source_id: str = "default",
    ) -> None:
        """Subscribe client to watchlist channels for a source."""
        async with self._lock:
            if ws in self._connections:
                self._connections[ws]["active_source_id"] = source_id
                self._connections[ws]["watchlist_channels"] = set(channels)

    async def subscribe_alerts(
        self,
        ws: WebSocket,
        source_id: str = "default",
    ) -> None:
        """Subscribe client to alert stream for a source."""
        async with self._lock:
            if ws in self._connections:
                self._connections[ws]["active_source_id"] = source_id
                self._connections[ws]["alerts_subscribed"] = True

    async def subscribe_channel(
        self,
        ws: WebSocket,
        name: str,
        source_id: str = "default",
    ) -> None:
        """Subscribe client to single channel detail for a source."""
        async with self._lock:
            if ws in self._connections:
                self._connections[ws]["active_source_id"] = source_id
                self._connections[ws]["channel_detail"].add(name)

    async def unsubscribe_channel(self, ws: WebSocket, name: str) -> None:
        """Unsubscribe from channel detail."""
        async with self._lock:
            if ws in self._connections:
                self._connections[ws]["channel_detail"].discard(name)

    def connection_count(self) -> int:
        """Return number of connected clients."""
        return len(self._connections)


_hub: RealtimeWsHub | None = None


def get_ws_hub() -> RealtimeWsHub:
    """Get singleton WebSocket hub."""
    global _hub
    if _hub is None:
        _hub = RealtimeWsHub()
    return _hub
