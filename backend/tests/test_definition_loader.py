"""Tests for shared telemetry definition loading."""

from __future__ import annotations

from pathlib import Path

import pytest

from telemetry_catalog.definitions import (
    canonical_definition_path,
    load_definition_file,
    resolve_source_id_alias,
)


def test_load_builtin_yaml_definition() -> None:
    definition = load_definition_file("simulators/drogonsat.yaml")

    assert definition.name == "DrogonSat"
    assert definition.position_mapping is not None
    assert definition.position_mapping.frame_type == "gps_lla"
    assert any(channel.name == "PROP_MAIN_TANK_PRESS" for channel in definition.channels)


def test_load_builtin_json_definition() -> None:
    definition = load_definition_file("simulators/rhaegalsat.json")

    assert definition.name == "RhaegalSat"
    assert definition.position_mapping is not None
    assert definition.position_mapping.frame_type == "ecef"
    assert any(channel.name == "PROP_TANK_B_PRESS" for channel in definition.channels)
    assert any(channel.name == "OBC_C_CPU_LOAD" for channel in definition.channels)


def test_load_definition_with_channel_aliases(tmp_path: Path) -> None:
    path = tmp_path / "with-aliases.yaml"
    path.write_text(
        "\n".join(
            [
                "version: 1",
                "channels:",
                "  - name: PWR_MAIN_BUS_VOLT",
                "    aliases: [BAT_V, BATTERY_VOLT, VBAT]",
                '    units: "V"',
                '    description: "Main bus voltage"',
                '    subsystem: "power"',
                "    mean: 28.0",
                "    std_dev: 0.2",
            ]
        ),
        encoding="utf-8",
    )

    definition = load_definition_file(str(path), root=tmp_path)

    assert definition.channels[0].aliases == ["BAT_V", "BATTERY_VOLT", "VBAT"]


def test_load_definition_rejects_alias_colliding_with_other_canonical_name(tmp_path: Path) -> None:
    path = tmp_path / "bad-alias.yaml"
    path.write_text(
        "\n".join(
            [
                "version: 1",
                "channels:",
                "  - name: PWR_MAIN_BUS_VOLT",
                "    aliases: [GPS_LAT]",
                '    units: "V"',
                '    description: "Main bus voltage"',
                '    subsystem: "power"',
                "    mean: 28.0",
                "    std_dev: 0.2",
                "  - name: GPS_LAT",
                '    units: "deg"',
                '    description: "Latitude"',
                '    subsystem: "nav"',
                "    mean: 0.0",
                "    std_dev: 1.0",
            ]
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="collides with canonical name"):
        load_definition_file(str(path), root=tmp_path)


def test_canonical_definition_path_rejects_traversal(tmp_path: Path) -> None:
    root = tmp_path / "defs"
    root.mkdir()
    (root / "ok.yaml").write_text("version: 1\nchannels: []\n", encoding="utf-8")

    assert canonical_definition_path("ok.yaml", root=root) == "ok.yaml"

    with pytest.raises(ValueError):
        canonical_definition_path("../outside.yaml", root=root)


def test_resolve_source_id_alias_maps_legacy_ids() -> None:
    assert resolve_source_id_alias("default") == "86a0057f-4733-4de6-af60-455cb3954f1d"
    assert resolve_source_id_alias("simulator") == "27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6"
    assert resolve_source_id_alias("custom-source") == "custom-source"
