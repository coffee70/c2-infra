"""In-process event bus for realtime telemetry and alerts.

Explicit interface allows swapping to Redis/NATS/Kafka later without
changing business logic.
"""

import asyncio
import logging
from collections.abc import AsyncIterator, Callable
from typing import Any

from app.models.schemas import MeasurementEvent

logger = logging.getLogger(__name__)

# Type aliases for handlers
MeasurementHandler = Callable[[MeasurementEvent], None]
AlertHandler = Callable[[dict[str, Any]], None]


class InProcessEventBus:
    """In-memory async pub/sub for measurements and alerts."""

    def __init__(self) -> None:
        self._measurement_handlers: list[MeasurementHandler] = []
        self._alert_handlers: list[AlertHandler] = []
        self._measurement_queue: asyncio.Queue[MeasurementEvent] = asyncio.Queue()
        self._alert_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._consumer_task: asyncio.Task[None] | None = None

    def publish_measurement(self, event: MeasurementEvent) -> None:
        """Publish a measurement event (non-blocking)."""
        try:
            self._measurement_queue.put_nowait(event)
        except asyncio.QueueFull:
            logger.warning("Measurement queue full, dropping event for %s", event.channel_name)

    def subscribe_measurements(self, handler: MeasurementHandler) -> None:
        """Register a handler for measurement events."""
        self._measurement_handlers.append(handler)

    def unsubscribe_measurements(self, handler: MeasurementHandler) -> None:
        """Remove a measurement handler."""
        if handler in self._measurement_handlers:
            self._measurement_handlers.remove(handler)

    def publish_alert(self, event: dict[str, Any]) -> None:
        """Publish an alert lifecycle event."""
        try:
            self._alert_queue.put_nowait(event)
        except asyncio.QueueFull:
            logger.warning("Alert queue full, dropping alert event")

    def subscribe_alerts(self, handler: AlertHandler) -> None:
        """Register a handler for alert events."""
        self._alert_handlers.append(handler)

    def unsubscribe_alerts(self, handler: AlertHandler) -> None:
        """Remove an alert handler."""
        if handler in self._alert_handlers:
            self._alert_handlers.remove(handler)

    async def _process_measurements(self) -> None:
        """Process measurement queue and fan out to handlers (handlers run in thread pool)."""
        loop = asyncio.get_event_loop()
        while True:
            try:
                event = await self._measurement_queue.get()
                for h in self._measurement_handlers:
                    try:
                        await loop.run_in_executor(None, lambda e=event: h(e))
                    except Exception as e:
                        logger.exception("Measurement handler error: %s", e)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.exception("Measurement processing error: %s", e)

    async def _process_alerts(self) -> None:
        """Process alert queue and fan out to handlers."""
        while True:
            try:
                event = await self._alert_queue.get()
                for h in self._alert_handlers:
                    try:
                        h(event)
                    except Exception as e:
                        logger.exception("Alert handler error: %s", e)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.exception("Alert processing error: %s", e)

    def start(self) -> None:
        """Start background consumers."""
        if self._consumer_task is not None:
            return
        self._consumer_task = asyncio.create_task(self._run_consumers())
        logger.info("Realtime event bus started")

    async def _run_consumers(self) -> None:
        """Run both consumers concurrently."""
        await asyncio.gather(
            self._process_measurements(),
            self._process_alerts(),
        )

    def stop(self) -> None:
        """Stop background consumers."""
        if self._consumer_task is not None:
            self._consumer_task.cancel()
            self._consumer_task = None
            logger.info("Realtime event bus stopped")


_bus: InProcessEventBus | None = None


def get_realtime_bus() -> InProcessEventBus:
    """Get or create the singleton event bus."""
    global _bus
    if _bus is None:
        _bus = InProcessEventBus()
        _bus.start()
    return _bus
