"""Configuration loading for the SatNOGS adapter."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field, model_validator

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


class SatnogsFilterConfig(BaseModel):
    satellite_norad_cat_id: int
    ground_station_allowlist: list[str] = Field(default_factory=list)
    status_allowlist: list[str] = Field(default_factory=list)


class PaginationConfig(BaseModel):
    cursor_persistence_enabled: bool = True
    max_pages_per_cycle: int = 5


class DownloadConfig(BaseModel):
    max_concurrent_observation_fetches: int = 2
    max_concurrent_artifact_downloads: int = 2


class SatnogsNetworkConfig(BaseModel):
    base_url: str
    api_token: str = ""
    poll_interval_seconds: int = 60
    lookback_window_minutes: int = 180
    filters: SatnogsFilterConfig
    pagination: PaginationConfig = Field(default_factory=PaginationConfig)
    download: DownloadConfig = Field(default_factory=DownloadConfig)


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
    slug: str = "iss"
    name: str = "International Space Station"
    norad_cat_id: int = 25544
    allowed_source_callsigns: list[str] = Field(default_factory=lambda: ["NA1SS", "RS0ISS"])
    vehicle_config_path: str = "vehicles/iss.yaml"
    stable_field_mappings: dict[str, str] = Field(default_factory=dict)


class AdapterConfig(BaseModel):
    platform: PlatformConfig
    vehicle: VehicleConfig
    satnogs_network: SatnogsNetworkConfig
    backfill: BackfillConfig = Field(default_factory=BackfillConfig)
    publisher: PublisherConfig = Field(default_factory=PublisherConfig)
    checkpoints: CheckpointConfig = Field(default_factory=CheckpointConfig)
    dlq: DlqConfig = Field(default_factory=DlqConfig)

    @model_validator(mode="after")
    def validate_norad_match(self) -> "AdapterConfig":
        if self.vehicle.norad_cat_id != self.satnogs_network.filters.satellite_norad_cat_id:
            raise ValueError("vehicle.norad_cat_id must match satnogs_network.filters.satellite_norad_cat_id")
        return self

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

    network = payload.get("satnogs_network")
    if isinstance(network, dict) and not network.get("api_token"):
        env_token = os.environ.get("SATNOGS_API_TOKEN")
        if env_token:
            network["api_token"] = env_token
    return AdapterConfig.model_validate(payload)
