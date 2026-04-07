"""Configuration loading for the SatNOGS adapter."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

from telemetry_catalog.definitions import VehicleConfigurationFile, load_vehicle_config_file


class PlatformConfig(BaseModel):
    ingest_url: str
    source_id: str | None = None
    source_resolve_url: str | None = None

    @model_validator(mode="after")
    def validate_source_identity(self) -> "PlatformConfig":
        if self.source_id == "":
            self.source_id = None
        if self.source_resolve_url == "":
            self.source_resolve_url = None
        if not self.source_id and not self.source_resolve_url:
            raise ValueError("platform.source_id or platform.source_resolve_url is required")
        return self


class DownloadConfig(BaseModel):
    max_concurrent_observation_fetches: int = 2
    max_concurrent_artifact_downloads: int = 2


class SatnogsConfig(BaseModel):
    base_url: str = "https://network.satnogs.org"
    api_token: str = ""
    transmitter_uuid: str
    status: str
    poll_interval_seconds: int = 60
    download: DownloadConfig = Field(default_factory=DownloadConfig)

    @model_validator(mode="after")
    def validate_pair_fields(self) -> "SatnogsConfig":
        if not self.transmitter_uuid.strip():
            raise ValueError("satnogs.transmitter_uuid is required")
        if not self.status.strip():
            raise ValueError("satnogs.status is required")
        return self


class BackfillConfig(BaseModel):
    enabled: bool = False
    mode: Literal["seed", "bounded_range"] = "bounded_range"
    start_time: str | None = None
    end_time: str | None = None
    max_observations_per_run: int = 250
    requests_per_minute: int = 20
    checkpoint_store_path: str = "tmp/satnogs-adapter/checkpoints.json"


class RetryConfig(BaseModel):
    max_attempts: int = 3
    backoff_seconds: float = 1.0
    backoff_multiplier: float = 2.0
    retryable_status_codes: list[int] = Field(default_factory=lambda: [408, 425, 429, 500, 502, 503, 504])


class PublisherConfig(BaseModel):
    batch_size_events: int = 50
    timeout_seconds: float = 10.0
    retry: RetryConfig = Field(default_factory=RetryConfig)


class DlqConfig(BaseModel):
    root_dir: str = "tmp/satnogs-adapter/dlq"
    write_observation_dlq: bool = True


class CheckpointConfig(BaseModel):
    path: str = "tmp/satnogs-adapter/checkpoints.json"


class VehicleConfig(BaseModel):
    slug: str = "lasarsat"
    name: str = "LASARSAT"
    norad_id: int
    allowed_source_callsigns: list[str] = Field(default_factory=lambda: ["OK0LSR"])
    vehicle_config_path: str = "vehicles/lasarsat.yaml"
    stable_field_mappings: dict[str, str] = Field(default_factory=dict)


class AdapterConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    platform: PlatformConfig
    vehicle: VehicleConfig
    satnogs: SatnogsConfig
    backfill: BackfillConfig = Field(default_factory=BackfillConfig)
    publisher: PublisherConfig = Field(default_factory=PublisherConfig)
    checkpoints: CheckpointConfig = Field(default_factory=CheckpointConfig)
    dlq: DlqConfig = Field(default_factory=DlqConfig)

    def load_definition(self) -> VehicleConfigurationFile:
        return load_vehicle_config_file(self.vehicle.vehicle_config_path)

    def resolve_stable_field_mappings(self) -> dict[str, str]:
        definition = self.load_definition()
        if definition.ingestion and definition.ingestion.stable_field_mappings:
            return dict(definition.ingestion.stable_field_mappings)
        return dict(self.vehicle.stable_field_mappings)


def load_config(path: str) -> AdapterConfig:
    raw = Path(path).read_text(encoding="utf-8")
    payload = yaml.safe_load(raw) or {}
    if not isinstance(payload, dict):
        raise ValueError("adapter config must contain a top-level object")

    satnogs = payload.get("satnogs")
    if isinstance(satnogs, dict) and not satnogs.get("api_token"):
        env_token = os.environ.get("SATNOGS_API_TOKEN")
        if env_token:
            satnogs["api_token"] = env_token
    return AdapterConfig.model_validate(payload)
