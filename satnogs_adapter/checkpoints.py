"""File-backed checkpoint storage."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class FileCheckpointStore:
    def __init__(self, path: str) -> None:
        self.path = Path(path)

    def load(self) -> dict[str, Any]:
        if not self.path.exists():
            return {}
        return json.loads(self.path.read_text(encoding="utf-8"))

    def save(self, data: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")

    def get(self, key: str, default: Any = None) -> Any:
        return self.load().get(key, default)

    def set(self, key: str, value: Any) -> None:
        data = self.load()
        data[key] = value
        self.save(data)

    def pop(self, key: str) -> None:
        data = self.load()
        if key in data:
            data.pop(key)
            self.save(data)

    def mark_processed_observation(self, observation_id: str, *, keep_last: int = 500) -> None:
        data = self.load()
        processed = [item for item in data.get("processed_observation_ids", []) if item != observation_id]
        processed.append(observation_id)
        data["processed_observation_ids"] = processed[-keep_last:]
        self.save(data)

    def is_processed_observation(self, observation_id: str) -> bool:
        return observation_id in set(self.get("processed_observation_ids", []))

