from __future__ import annotations

from pathlib import Path

from app.services.vehicle_config_service import (
    VehicleConfigServiceError,
    create_vehicle_config,
    list_vehicle_configs,
    load_vehicle_config,
    update_vehicle_config,
    validate_vehicle_config_content,
)


def _sample_yaml(name: str = "ISS") -> str:
    return "\n".join(
        [
            "version: 1",
            f"name: {name}",
            "channels:",
            "  - name: GPS_LAT",
            '    units: "deg"',
            '    description: "Latitude"',
            '    subsystem: "nav"',
            "    mean: 0.0",
            "    std_dev: 1.0",
            "position_mapping:",
            "  frame_type: gps_lla",
            "  lat_channel_name: GPS_LAT",
            "  lon_channel_name: GPS_LAT",
            "",
        ]
    )


def test_list_vehicle_configs_reads_metadata(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "vehicle-configurations"
    (root / "vehicles").mkdir(parents=True)
    (root / "simulators").mkdir(parents=True)
    (root / "vehicles" / "iss.yaml").write_text(_sample_yaml("Station"), encoding="utf-8")
    (root / "simulators" / "demo.json").write_text('{"version":1,"name":"Demo","channels":[]}', encoding="utf-8")
    monkeypatch.setenv("VEHICLE_CONFIG_ROOT", str(root))

    items = list_vehicle_configs()

    assert [item.path for item in items] == ["simulators/demo.json", "vehicles/iss.yaml"]
    assert items[0].category == "simulators"
    assert items[1].name == "Station"
    assert items[1].format == "yaml"


def test_load_vehicle_config_by_relative_path(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "vehicle-configurations"
    (root / "vehicles").mkdir(parents=True)
    (root / "vehicles" / "iss.yaml").write_text(_sample_yaml(), encoding="utf-8")
    monkeypatch.setenv("VEHICLE_CONFIG_ROOT", str(root))

    result = load_vehicle_config("vehicles/iss.yaml")

    assert result.path == "vehicles/iss.yaml"
    assert result.format == "yaml"
    assert result.parsed is not None
    assert result.parsed.channel_count == 1
    assert result.validation_errors == []


def test_validate_vehicle_config_content_handles_valid_yaml() -> None:
    result = validate_vehicle_config_content(_sample_yaml(), path="vehicles/iss.yaml")

    assert result.valid is True
    assert result.parsed is not None
    assert result.parsed.name == "ISS"
    assert result.errors == []


def test_validate_vehicle_config_content_returns_structured_errors() -> None:
    result = validate_vehicle_config_content(
        "version: 1\nchannels:\n  - name: GPS_LAT\n",
        path="vehicles/iss.yaml",
    )

    assert result.valid is False
    assert result.parsed is None
    assert result.errors
    assert result.errors[0].message


def test_create_vehicle_config_writes_normalized_yaml(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "vehicle-configurations"
    root.mkdir()
    monkeypatch.setenv("VEHICLE_CONFIG_ROOT", str(root))

    result = create_vehicle_config("vehicles/new.yaml", _sample_yaml("New Vehicle"))

    saved = (root / "vehicles" / "new.yaml").read_text(encoding="utf-8")
    assert result.path == "vehicles/new.yaml"
    assert result.saved is True
    assert "name: New Vehicle" in saved


def test_update_vehicle_config_overwrites_existing_file(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "vehicle-configurations"
    (root / "vehicles").mkdir(parents=True)
    target = root / "vehicles" / "iss.yaml"
    target.write_text(_sample_yaml("Old Name"), encoding="utf-8")
    monkeypatch.setenv("VEHICLE_CONFIG_ROOT", str(root))

    result = update_vehicle_config("vehicles/iss.yaml", _sample_yaml("Updated Name"))

    assert result.parsed.name == "Updated Name"
    assert "Updated Name" in target.read_text(encoding="utf-8")


def test_vehicle_config_service_rejects_traversal(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "vehicle-configurations"
    root.mkdir()
    monkeypatch.setenv("VEHICLE_CONFIG_ROOT", str(root))

    try:
        create_vehicle_config("../outside.yaml", _sample_yaml())
    except VehicleConfigServiceError as exc:
        assert exc.status_code == 400
        assert "stay under" in str(exc)
    else:
        raise AssertionError("Expected traversal error")


def test_vehicle_config_service_rejects_unsupported_extension(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "vehicle-configurations"
    root.mkdir()
    monkeypatch.setenv("VEHICLE_CONFIG_ROOT", str(root))

    try:
        create_vehicle_config("vehicles/bad.txt", _sample_yaml())
    except VehicleConfigServiceError as exc:
        assert exc.status_code == 400
        assert ".json, .yaml, or .yml" in str(exc)
    else:
        raise AssertionError("Expected unsupported extension error")
