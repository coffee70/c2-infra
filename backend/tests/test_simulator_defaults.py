from __future__ import annotations

import importlib
import sys


def _reload_simulator_main():
    sys.modules.pop("simulator.main", None)
    return importlib.import_module("simulator.main")


def test_simulator_default_source_id_falls_back_to_stable_alias(monkeypatch) -> None:
    monkeypatch.delenv("SIMULATOR_SOURCE_ID", raising=False)

    module = _reload_simulator_main()

    assert module.DEFAULT_SOURCE_ID == "simulator"
    assert module._generate_run_source_id(None).startswith("simulator-")


def test_simulator_default_source_id_honors_env_override(monkeypatch) -> None:
    monkeypatch.setenv("SIMULATOR_SOURCE_ID", "custom-simulator")

    module = _reload_simulator_main()

    assert module.DEFAULT_SOURCE_ID == "custom-simulator"
    assert module._generate_run_source_id(None).startswith("custom-simulator-")
