"""Realtime ingest publishing with retry and DLQ support."""

from __future__ import annotations

from dataclasses import dataclass
from time import sleep
from typing import Any

import httpx

from satnogs_adapter.config import PublisherConfig
from satnogs_adapter.dlq import FilesystemDlq
from satnogs_adapter.models import TelemetryEvent


@dataclass(slots=True)
class PublishResult:
    success: bool
    attempts: int
    status_code: int | None = None
    response_body: str | None = None


class IngestPublisher:
    def __init__(
        self,
        *,
        ingest_url: str,
        config: PublisherConfig,
        dlq: FilesystemDlq,
        client: httpx.Client | None = None,
    ) -> None:
        self.ingest_url = ingest_url
        self.config = config
        self.dlq = dlq
        self.client = client or httpx.Client(timeout=config.timeout_seconds)

    def publish(self, events: list[TelemetryEvent], *, context: dict[str, Any]) -> PublishResult:
        payload = {"events": [event.to_payload() for event in events]}
        attempts = 0
        backoff = self.config.retry.backoff_seconds
        retryable = set(self.config.retry.retryable_status_codes)

        while attempts < self.config.retry.max_attempts:
            attempts += 1
            try:
                response = self.client.post(self.ingest_url, json=payload)
            except httpx.TimeoutException as exc:
                if attempts >= self.config.retry.max_attempts:
                    self.dlq.write("batch", {"request": payload, "context": context, "error": repr(exc), "attempts": attempts})
                    return PublishResult(success=False, attempts=attempts, response_body=repr(exc))
                sleep(backoff)
                backoff *= self.config.retry.backoff_multiplier
                continue

            if 200 <= response.status_code < 300:
                return PublishResult(success=True, attempts=attempts, status_code=response.status_code, response_body=response.text)

            if response.status_code < 500 and response.status_code not in retryable:
                self.dlq.write(
                    "batch",
                    {
                        "request": payload,
                        "context": context,
                        "status_code": response.status_code,
                        "response_body": response.text,
                        "attempts": attempts,
                    },
                )
                return PublishResult(
                    success=False,
                    attempts=attempts,
                    status_code=response.status_code,
                    response_body=response.text,
                )

            if attempts >= self.config.retry.max_attempts:
                self.dlq.write(
                    "batch",
                    {
                        "request": payload,
                        "context": context,
                        "status_code": response.status_code,
                        "response_body": response.text,
                        "attempts": attempts,
                    },
                )
                return PublishResult(
                    success=False,
                    attempts=attempts,
                    status_code=response.status_code,
                    response_body=response.text,
                )

            sleep(backoff)
            backoff *= self.config.retry.backoff_multiplier

        return PublishResult(success=False, attempts=attempts)

