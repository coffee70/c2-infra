"""Telemetry definitions loaded from shared source definition files."""

from __future__ import annotations

import os

from telemetry_catalog.definitions import (
    TelemetryChannelDefinition,
    TelemetryDefinitionFile,
    channel_rate_hz,
    load_definition_file,
)

DEFAULT_DEFINITION_PATH = "simulators/drogonsat.yaml"


def _load_runtime_definition() -> TelemetryDefinitionFile:
    path = os.environ.get("TELEMETRY_DEFINITION_PATH", DEFAULT_DEFINITION_PATH)
    return load_definition_file(path)


DEFINITION = _load_runtime_definition()
CHANNEL_DEFINITIONS = DEFINITION.channels
CHANNEL_BY_NAME = {channel.name: channel for channel in CHANNEL_DEFINITIONS}
TELEMETRY_DEFINITIONS = [
    (
        channel.name,
        channel.units,
        channel.description,
        channel.mean,
        channel.std_dev,
        channel.subsystem,
        channel.red_low,
        channel.red_high,
    )
    for channel in CHANNEL_DEFINITIONS
]
RATES_HZ = {channel.name: channel_rate_hz(channel) for channel in CHANNEL_DEFINITIONS}
SCENARIOS = {
    name: scenario.model_dump()
    for name, scenario in DEFINITION.scenarios.items()
}
POSITION_MAPPING = DEFINITION.position_mapping


def load_definition(path: str | None = None) -> TelemetryDefinitionFile:
    if path:
        return load_definition_file(path)
    return DEFINITION


def get_channel(name: str) -> TelemetryChannelDefinition:
    return CHANNEL_BY_NAME[name]
