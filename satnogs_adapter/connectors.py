"""SatNOGS transport connectors and frame extraction."""

from __future__ import annotations

import binascii
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urljoin

import httpx

from satnogs_adapter.config import BackfillConfig, SatnogsNetworkConfig
from satnogs_adapter.models import FrameRecord, ObservationRecord

HEX_RE = re.compile(r"[^0-9A-Fa-f]")


def _stringify(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)


class SatnogsNetworkConnector:
    def __init__(self, config: SatnogsNetworkConfig, *, client: httpx.Client | None = None) -> None:
        self.config = config
        self.client = client or httpx.Client(timeout=30.0)

    def _headers(self) -> dict[str, str]:
        if not self.config.api_token:
            return {}
        return {"Authorization": f"Token {self.config.api_token}"}

    def _get(self, path: str, *, params: dict[str, Any] | None = None) -> Any:
        response = self.client.get(
            path if path.startswith("http://") or path.startswith("https://") else urljoin(self.config.base_url.rstrip("/") + "/", path.lstrip("/")),
            params=params,
            headers=self._headers(),
        )
        response.raise_for_status()
        return response.json()

    def list_recent_observations(self, *, cursor: str | None = None, now: datetime | None = None) -> dict[str, Any]:
        end_time = now or datetime.now(timezone.utc)
        start_time = end_time - timedelta(minutes=self.config.lookback_window_minutes)
        params: dict[str, Any] = {
            "satellite__norad_cat_id": self.config.filters.satellite_norad_cat_id,
            "start": start_time.isoformat(),
            "end": end_time.isoformat(),
        }
        if self.config.filters.status_allowlist:
            params["status"] = ",".join(self.config.filters.status_allowlist)
        if cursor:
            params["cursor"] = cursor
        payload = self._get("/api/observations/", params=params)
        if isinstance(payload, list):
            return {"results": payload, "next": None}
        if isinstance(payload, dict):
            return payload
        raise ValueError("SatNOGS observations response must be a list or object")

    def get_observation_detail(self, observation_id: str) -> dict[str, Any]:
        payload = self._get(f"/api/observations/{observation_id}/")
        if not isinstance(payload, dict):
            raise ValueError("SatNOGS observation detail response must be an object")
        return payload

    def is_eligible_observation(self, payload: dict[str, Any]) -> bool:
        station_id = self._extract_ground_station_id(payload)
        allowlist = set(self.config.filters.ground_station_allowlist)
        if allowlist and (station_id is None or station_id not in allowlist):
            return False

        if self.config.filters.status_allowlist:
            status = _stringify(payload.get("status"))
            return status in set(self.config.filters.status_allowlist)
        return True

    def normalize_observation(self, payload: dict[str, Any]) -> ObservationRecord:
        return ObservationRecord(
            observation_id=str(payload["id"]),
            satellite_norad_cat_id=int(
                payload.get("satellite__norad_cat_id")
                or payload.get("norad_cat_id")
                or payload.get("satellite", {}).get("norad_cat_id")
            ),
            transmitter_uuid=_stringify(payload.get("transmitter_uuid") or payload.get("transmitter")),
            start_time=_stringify(payload.get("start") or payload.get("start_time")),
            end_time=_stringify(payload.get("end") or payload.get("end_time")),
            ground_station_id=self._extract_ground_station_id(payload),
            observer=_stringify(payload.get("observer")),
            station_callsign=_stringify(payload.get("station_callsign") or payload.get("ground_station_callsign")),
            station_lat=payload.get("station_lat"),
            station_lng=payload.get("station_lng"),
            station_alt=payload.get("station_alt"),
            status=payload.get("status"),
            demoddata=payload.get("demoddata"),
            artifact_refs=self._extract_artifact_refs(payload),
            raw_json=payload,
        )

    def _extract_ground_station_id(self, payload: dict[str, Any]) -> str | None:
        value = payload.get("ground_station_id")
        if value is None and isinstance(payload.get("ground_station"), dict):
            value = payload["ground_station"].get("id")
        if value is None:
            value = payload.get("ground_station")
        return _stringify(value)

    def _extract_artifact_refs(self, payload: dict[str, Any]) -> list[str]:
        refs: list[str] = []
        for candidate in payload.get("artifact_refs", []) or []:
            if isinstance(candidate, str):
                refs.append(candidate)
        for key in ("demoddata_url", "payload_demod_url"):
            if isinstance(payload.get(key), str):
                refs.append(payload[key])
        return refs

    def _download_artifact_text(self, url: str) -> str:
        response = self.client.get(url, headers=self._headers())
        response.raise_for_status()
        return response.text

    def extract_frames(
        self,
        observation: ObservationRecord,
        *,
        source: str = "satnogs_network",
    ) -> tuple[list[FrameRecord], list[dict[str, Any]]]:
        lines: list[tuple[str, str | None]] = []
        demoddata = observation.demoddata

        if isinstance(demoddata, str):
            for raw_line in demoddata.splitlines():
                if raw_line.strip():
                    lines.append((raw_line, None))
        elif isinstance(demoddata, list):
            for item in demoddata:
                if isinstance(item, str):
                    lines.append((item, None))
                    continue
                if isinstance(item, dict):
                    raw_line = (
                        item.get("payload_demod")
                        or item.get("payload")
                        or item.get("frame")
                        or item.get("hex")
                    )
                    if isinstance(raw_line, str) and raw_line.strip():
                        lines.append((raw_line, _stringify(item.get("timestamp") or item.get("time"))))
        elif demoddata is None and observation.artifact_refs:
            for ref in observation.artifact_refs:
                for raw_line in self._download_artifact_text(ref).splitlines():
                    if raw_line.strip():
                        lines.append((raw_line, None))

        frames: list[FrameRecord] = []
        invalid_lines: list[dict[str, Any]] = []
        for index, (raw_line, explicit_time) in enumerate(lines):
            clean_hex = HEX_RE.sub("", raw_line)
            if not clean_hex:
                continue
            try:
                frame_bytes = binascii.unhexlify(clean_hex)
            except binascii.Error as exc:
                invalid_lines.append({"frame_index": index, "raw_line": raw_line, "error": repr(exc)})
                continue
            frames.append(
                FrameRecord(
                    frame_bytes=frame_bytes,
                    reception_time=explicit_time or observation.end_time or observation.start_time,
                    observation_id=observation.observation_id,
                    ground_station_id=observation.ground_station_id,
                    source=source,
                    frame_index=index,
                    raw_line=raw_line,
                )
            )
        return frames, invalid_lines


class SatnogsDbBackfillConnector:
    def __init__(self, config: BackfillConfig, *, base_url: str, client: httpx.Client | None = None) -> None:
        self.config = config
        self.base_url = base_url
        self.client = client or httpx.Client(timeout=30.0)

    def iter_frames(self, *, norad_cat_id: int) -> list[FrameRecord]:
        if not self.config.enabled:
            return []
        params = {
            "satellite": norad_cat_id,
            "start": self.config.start_time,
            "end": self.config.end_time,
        }
        response = self.client.get(urljoin(self.base_url.rstrip("/") + "/", "/api/telemetry/"), params=params)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            return []
        results = payload.get("results", [])
        frames: list[FrameRecord] = []
        for index, item in enumerate(results[: self.config.max_observations_per_run]):
            if not isinstance(item, dict):
                continue
            frame = item.get("frame")
            if not isinstance(frame, str):
                continue
            clean_hex = HEX_RE.sub("", frame)
            if not clean_hex:
                continue
            frames.append(
                FrameRecord(
                    frame_bytes=binascii.unhexlify(clean_hex),
                    reception_time=_stringify(item.get("timestamp")),
                    observation_id=_stringify(item.get("observation_id") or f"dbwin-{index}") or f"dbwin-{index}",
                    ground_station_id=_stringify(item.get("ground_station_id")),
                    source="satnogs_db",
                    frame_index=index,
                    raw_line=frame,
                )
            )
        return frames
