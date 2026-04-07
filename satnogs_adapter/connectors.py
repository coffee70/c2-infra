"""SatNOGS transport connectors and frame extraction."""

from __future__ import annotations

import binascii
import re
from datetime import datetime
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin

import httpx

from satnogs_adapter.config import SatnogsConfig
from satnogs_adapter.models import FrameRecord, ObservationRecord

HEX_RE = re.compile(r"[^0-9A-Fa-f]")


@dataclass(frozen=True, slots=True)
class ObservationPage:
    results: list[dict[str, Any]]
    next_url: str | None = None


def _stringify(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)


class SatnogsNetworkConnector:
    def __init__(self, config: SatnogsConfig, *, norad_id: int, client: httpx.Client | None = None) -> None:
        self.config = config
        self.norad_id = norad_id
        self.client = client or httpx.Client(timeout=30.0)

    def _headers(self) -> dict[str, str]:
        if not self.config.api_token:
            return {}
        return {"Authorization": f"Token {self.config.api_token}"}

    def _build_url(self, path: str) -> str:
        return path if path.startswith("http://") or path.startswith("https://") else urljoin(self.config.base_url.rstrip("/") + "/", path.lstrip("/"))

    def _get_response(self, path: str, *, params: dict[str, Any] | None = None) -> httpx.Response:
        response = self.client.get(
            self._build_url(path),
            params=params,
            headers=self._headers(),
        )
        response.raise_for_status()
        return response

    def _get(self, path: str, *, params: dict[str, Any] | None = None) -> Any:
        response = self._get_response(path, params=params)
        return response.json()

    def list_recent_observations(
        self,
        *,
        now: datetime | None = None,
        start_time: str | None = None,
        end_time: str | None = None,
        next_url: str | None = None,
    ) -> ObservationPage:
        if next_url is not None:
            response = self._get_response(next_url)
            payload = response.json()
            if isinstance(payload, list):
                return ObservationPage(
                    results=[item for item in payload if isinstance(item, dict)],
                    next_url=self._extract_next_url(response),
                )
            raise ValueError("SatNOGS observations response must be an array")

        params: dict[str, Any] = {
            "satellite__norad_cat_id": self.norad_id,
            "transmitter_uuid": self.config.transmitter_uuid,
            "status": self.config.status,
        }
        if start_time is not None:
            params["start"] = start_time
        if end_time is not None:
            params["end"] = end_time
        response = self._get_response("/api/observations/", params=params)
        payload = response.json()
        if isinstance(payload, list):
            return ObservationPage(
                results=[item for item in payload if isinstance(item, dict)],
                next_url=self._extract_next_url(response),
            )
        raise ValueError("SatNOGS observations response must be an array")

    def _extract_next_url(self, response: httpx.Response) -> str | None:
        next_link = response.links.get("next")
        if next_link:
            url = next_link.get("url")
            if isinstance(url, str) and url:
                return url
        return None

    def get_observation_detail(self, observation_id: str) -> dict[str, Any]:
        payload = self._get(f"/api/observations/{observation_id}/")
        if not isinstance(payload, dict):
            raise ValueError("SatNOGS observation detail response must be an object")
        return payload

    def is_eligible_observation(self, payload: dict[str, Any]) -> bool:
        try:
            observation = self.normalize_observation(payload)
        except (KeyError, TypeError, ValueError):
            return False
        return (
            observation.satellite_norad_cat_id == self.norad_id
            and observation.transmitter_uuid == self.config.transmitter_uuid
            and _stringify(observation.status) == self.config.status
        )

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
        artifact_url = url if url.startswith("http://") or url.startswith("https://") else urljoin(self.config.base_url.rstrip("/") + "/", url.lstrip("/"))
        response = self.client.get(artifact_url, headers=self._headers())
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
                    raw_line = item.get("payload") or item.get("frame") or item.get("hex")
                    if isinstance(raw_line, str) and raw_line.strip():
                        lines.append((raw_line, _stringify(item.get("timestamp") or item.get("time"))))
                        continue
                    payload_demod = item.get("payload_demod")
                    if isinstance(payload_demod, str) and payload_demod.strip():
                        for downloaded_line in self._download_artifact_text(payload_demod).splitlines():
                            if downloaded_line.strip():
                                lines.append((downloaded_line, _stringify(item.get("timestamp") or item.get("time"))))
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
