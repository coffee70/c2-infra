from __future__ import annotations

import json
from pathlib import Path

import httpx

from satnogs_adapter.checkpoints import FileCheckpointStore
from satnogs_adapter.config import load_config
from satnogs_adapter.connectors import SatnogsNetworkConnector
from satnogs_adapter.decoders import parse_aprs_payload, parse_ax25_frame
from satnogs_adapter.dlq import FilesystemDlq
from satnogs_adapter.mapper import TelemetryMapper
from satnogs_adapter.models import ObservationRecord
from satnogs_adapter.publisher import IngestPublisher
from satnogs_adapter.runner import AdapterRunner


def _encode_callsign(callsign: str, *, last: bool) -> bytes:
    base, _, ssid_raw = callsign.partition("-")
    padded = base.ljust(6)[:6]
    ssid = int(ssid_raw) if ssid_raw else 0
    body = bytes((ord(ch) << 1) for ch in padded)
    tail = ((ssid & 0x0F) << 1) | 0x60 | (0x01 if last else 0x00)
    return body + bytes([tail])


def _build_ax25_frame(*, dest: str, src: str, info: bytes) -> bytes:
    return b"".join([_encode_callsign(dest, last=False), _encode_callsign(src, last=True), bytes([0x03, 0xF0]), info])


def test_load_config_prefers_definition_stable_field_mappings() -> None:
    config = load_config("satnogs_adapter/config.example.yaml")

    assert config.resolve_stable_field_mappings()["latitude"] == "ISS_POS_LAT_DEG"


def test_extract_frames_collects_invalid_hex_without_aborting() -> None:
    connector = SatnogsNetworkConnector(load_config("satnogs_adapter/config.example.yaml").satnogs_network)
    observation = ObservationRecord(
        observation_id="123",
        satellite_norad_cat_id=25544,
        start_time="2026-04-01T00:00:00Z",
        end_time="2026-04-01T00:01:00Z",
        ground_station_id="42",
        demoddata=[{"payload_demod": "414243"}, {"payload_demod": "not-hex"}],
    )

    frames, invalid_lines = connector.extract_frames(observation)

    assert len(frames) == 1
    assert frames[0].frame_bytes == b"ABC"
    assert invalid_lines[0]["frame_index"] == 1


def test_list_recent_observations_accepts_list_payload() -> None:
    class FakeClient:
        def get(self, url, params=None, headers=None):
            class Response:
                def raise_for_status(self):
                    return None

                def json(self):
                    return [{"id": 1}, {"id": 2}]

            return Response()

    connector = SatnogsNetworkConnector(load_config("satnogs_adapter/config.example.yaml").satnogs_network, client=FakeClient())

    page = connector.list_recent_observations()

    assert [item["id"] for item in page["results"]] == [1, 2]
    assert page["next"] is None


def test_ax25_and_aprs_decode_position_payload() -> None:
    frame = _build_ax25_frame(dest="APRS", src="RS0ISS", info=b"!4903.50N/07201.75W>123/456/A=001234 temp=40")
    ax25 = parse_ax25_frame(frame)
    aprs = parse_aprs_payload(ax25.info_bytes)

    assert ax25.src_callsign == "RS0ISS"
    assert round(aprs.fields["latitude"], 4) == 49.0583
    assert round(aprs.fields["longitude"], 4) == -72.0292
    assert aprs.fields["course_deg"] == 123.0
    assert aprs.fields["temp"] == 40.0


def test_mapper_emits_stable_and_dynamic_events() -> None:
    mapper = TelemetryMapper(
        source_id="source-uuid",
        stable_field_mappings={"latitude": "ISS_POS_LAT_DEG"},
        allowed_source_callsigns=["RS0ISS"],
        vehicle_norad_cat_id=25544,
    )
    observation = ObservationRecord(
        observation_id="obs-1",
        satellite_norad_cat_id=25544,
        start_time="2026-04-01T00:00:00Z",
        end_time="2026-04-01T00:01:00Z",
        ground_station_id="42",
    )
    ax25 = parse_ax25_frame(_build_ax25_frame(dest="APRS", src="RS0ISS", info=b"!4903.50N/07201.75W> temp=40"))
    aprs = parse_aprs_payload(ax25.info_bytes)

    events = mapper.map_packet(
        observation=observation,
        frame=ax25,
        aprs_packet=aprs,
        reception_time="2026-04-01T00:01:00Z",
        sequence_seed=0,
    )

    stable = next(event for event in events if event.channel_name == "ISS_POS_LAT_DEG")
    dynamic = next(event for event in events if event.channel_name is None and event.tags and event.tags["field_name"] == "temp")
    assert stable.tags is not None
    assert "decoder" not in stable.tags
    assert dynamic.tags is not None
    assert dynamic.tags["decoder"] == "aprs"


def test_runner_skips_missing_ground_station_and_writes_observation_dlq(tmp_path: Path) -> None:
    config = load_config("satnogs_adapter/config.example.yaml")
    config.checkpoints.path = str(tmp_path / "checkpoints.json")
    config.dlq.root_dir = str(tmp_path / "dlq")
    checkpoint_store = FileCheckpointStore(config.checkpoints.path)
    dlq = FilesystemDlq(config.dlq.root_dir)

    class FakeNetworkConnector:
        def list_recent_observations(self, *, cursor=None, now=None):
            return {"results": [{"id": 123, "status": "good", "demoddata": "414243"}], "next": None}

        def is_eligible_observation(self, payload):
            return True

        def get_observation_detail(self, observation_id):
            raise AssertionError("detail should not be requested")

        def normalize_observation(self, payload):
            return ObservationRecord(
                observation_id=str(payload["id"]),
                satellite_norad_cat_id=25544,
                start_time="2026-04-01T00:00:00Z",
                end_time="2026-04-01T00:01:00Z",
                ground_station_id=None,
                demoddata=payload["demoddata"],
                raw_json=payload,
            )

        def extract_frames(self, observation, *, source="satnogs_network"):
            raise AssertionError("frames should not be extracted without ground_station_id")

    class FakeBackfillConnector:
        def iter_frames(self, *, norad_cat_id):
            return []

    class FakePublisher:
        def publish(self, events, *, context):
            raise AssertionError("publisher should not be called")

    runner = AdapterRunner(
        config,
        network_connector=FakeNetworkConnector(),
        backfill_connector=FakeBackfillConnector(),
        publisher=FakePublisher(),
        checkpoint_store=checkpoint_store,
        dlq=dlq,
    )

    runner.run_live_once()

    observation_dlq = dlq.iter_kind("observation")
    assert len(observation_dlq) == 1
    payload = json.loads(observation_dlq[0].read_text(encoding="utf-8"))
    assert payload["reason"] == "missing_ground_station_id"


def test_publisher_retries_timeout_then_succeeds(tmp_path: Path) -> None:
    attempts = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise httpx.TimeoutException("timed out")
        return httpx.Response(200, json={"accepted": 1})

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport)
    config = load_config("satnogs_adapter/config.example.yaml")
    config.publisher.retry.max_attempts = 2
    config.publisher.retry.backoff_seconds = 0
    publisher = IngestPublisher(
        ingest_url="http://backend:8000/telemetry/realtime/ingest",
        config=config.publisher,
        dlq=FilesystemDlq(str(tmp_path / "dlq")),
        client=client,
    )
    event = TelemetryMapper(
        source_id="source-uuid",
        stable_field_mappings={"latitude": "ISS_POS_LAT_DEG"},
        allowed_source_callsigns=["RS0ISS"],
        vehicle_norad_cat_id=25544,
    ).map_packet(
        observation=ObservationRecord(
            observation_id="obs-1",
            satellite_norad_cat_id=25544,
            start_time="2026-04-01T00:00:00Z",
            end_time="2026-04-01T00:01:00Z",
            ground_station_id="42",
        ),
        frame=parse_ax25_frame(_build_ax25_frame(dest="APRS", src="RS0ISS", info=b"!4903.50N/07201.75W>")),
        aprs_packet=parse_aprs_payload(b"!4903.50N/07201.75W>"),
        reception_time="2026-04-01T00:01:00Z",
        sequence_seed=0,
    )[0]

    result = publisher.publish([event], context={"observation_id": "obs-1"})

    assert result.success is True
    assert attempts["count"] == 2
