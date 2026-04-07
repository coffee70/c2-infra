"""Backend vehicle source resolution for adapter startup."""

from __future__ import annotations

from dataclasses import dataclass
from time import sleep
from typing import Any

import httpx

from satnogs_adapter.config import RetryConfig, VehicleConfig


class SourceResolutionError(RuntimeError):
    """Raised when the adapter cannot resolve its backend source."""


@dataclass(frozen=True, slots=True)
class ResolvedSource:
    id: str
    name: str
    source_type: str
    vehicle_config_path: str
    created: bool
    description: str | None = None


class BackendSourceResolver:
    """Resolve a canonical backend vehicle source id."""

    def __init__(
        self,
        *,
        resolve_url: str,
        retry: RetryConfig,
        timeout_seconds: float,
        client: httpx.Client | None = None,
    ) -> None:
        self.resolve_url = resolve_url
        self.retry = retry
        self.client = client or httpx.Client(timeout=timeout_seconds)

    def resolve_vehicle_source(self, vehicle: VehicleConfig) -> ResolvedSource:
        payload = {
            "source_type": "vehicle",
            "name": vehicle.name,
            "description": f"Auto-resolved from vehicle configuration: {vehicle.vehicle_config_path}",
            "vehicle_config_path": vehicle.vehicle_config_path,
        }
        attempts = 0
        backoff = self.retry.backoff_seconds
        retryable = set(self.retry.retryable_status_codes)

        while attempts < self.retry.max_attempts:
            attempts += 1
            try:
                response = self.client.post(self.resolve_url, json=payload)
            except httpx.RequestError as exc:
                if attempts >= self.retry.max_attempts:
                    raise SourceResolutionError(
                        f"Failed to resolve backend source for vehicle_config_path={vehicle.vehicle_config_path}: {exc!r}"
                    ) from exc
                sleep(min(backoff, 5.0))
                backoff *= self.retry.backoff_multiplier
                continue

            if 200 <= response.status_code < 300:
                try:
                    response_payload = response.json()
                except ValueError as exc:
                    raise SourceResolutionError(
                        "Malformed source resolve response for "
                        f"vehicle_config_path={vehicle.vehicle_config_path}: invalid JSON"
                    ) from exc
                return _parse_resolved_source(response_payload, vehicle_config_path=vehicle.vehicle_config_path)

            if response.status_code < 500 and response.status_code not in retryable:
                raise SourceResolutionError(
                    "Failed to resolve backend source for "
                    f"vehicle_config_path={vehicle.vehicle_config_path}: "
                    f"status={response.status_code} body={response.text}"
                )

            if attempts >= self.retry.max_attempts:
                raise SourceResolutionError(
                    "Failed to resolve backend source for "
                    f"vehicle_config_path={vehicle.vehicle_config_path}: "
                    f"status={response.status_code} body={response.text}"
                )

            sleep(min(backoff, 5.0))
            backoff *= self.retry.backoff_multiplier

        raise SourceResolutionError(f"Failed to resolve backend source for vehicle_config_path={vehicle.vehicle_config_path}")


def _parse_resolved_source(payload: Any, *, vehicle_config_path: str) -> ResolvedSource:
    if not isinstance(payload, dict):
        raise SourceResolutionError(
            f"Malformed source resolve response for vehicle_config_path={vehicle_config_path}: expected object"
        )
    source_id = payload.get("id")
    name = payload.get("name")
    source_type = payload.get("source_type")
    resolved_path = payload.get("vehicle_config_path")
    created = payload.get("created")
    if (
        not isinstance(source_id, str)
        or not source_id
        or not isinstance(name, str)
        or source_type != "vehicle"
        or not isinstance(resolved_path, str)
        or not isinstance(created, bool)
    ):
        raise SourceResolutionError(
            f"Malformed source resolve response for vehicle_config_path={vehicle_config_path}: missing source fields"
        )
    description = payload.get("description")
    if description is not None and not isinstance(description, str):
        raise SourceResolutionError(
            f"Malformed source resolve response for vehicle_config_path={vehicle_config_path}: invalid description"
        )
    return ResolvedSource(
        id=source_id,
        name=name,
        source_type=source_type,
        vehicle_config_path=resolved_path,
        created=created,
        description=description,
    )
