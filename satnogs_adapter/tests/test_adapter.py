from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest

from satnogs_adapter.checkpoints import FileCheckpointStore
from satnogs_adapter.config import RetryConfig, load_config
from satnogs_adapter.connectors import ObservationPage, SatnogsNetworkConnector, SatnogsRateLimitError
from satnogs_adapter.decoders import parse_aprs_payload, parse_ax25_frame
from satnogs_adapter.dlq import FilesystemDlq
from satnogs_adapter.main import build_runner
from satnogs_adapter.mapper import TelemetryMapper
from satnogs_adapter.models import ObservationRecord
from satnogs_adapter.publisher import IngestPublisher, ObservationsPublisher
from satnogs_adapter.runner import AdapterRunner
from satnogs_adapter.source_resolver import BackendSourceResolver, SourceResolutionError


class FakeObservationsPublisher:
    def publish(self, observations, *, provider, replace_future_scheduled=True, context):
        class Result:
            success = True
            status_code = 200
            response_body = ""

        return Result()


def _encode_callsign(callsign: str, *, last: bool) -> bytes:
    base, _, ssid_raw = callsign.partition("-")
    padded = base.ljust(6)[:6]
    ssid = int(ssid_raw) if ssid_raw else 0
    body = bytes((ord(ch) << 1) for ch in padded)
    tail = ((ssid & 0x0F) << 1) | 0x60 | (0x01 if last else 0x00)
    return body + bytes([tail])


def _build_ax25_frame(*, dest: str, src: str, info: bytes) -> bytes:
    return b"".join([_encode_callsign(dest, last=False), _encode_callsign(src, last=True), bytes([0x03, 0xF0]), info])


def _config_yaml(*, source_id: str | None = None, source_resolve_url: str | None = None) -> str:
    platform_lines = [
        "platform:",
        '  ingest_url: "http://backend:8000/telemetry/realtime/ingest"',
        '  observations_batch_upsert_url: "http://backend:8000/telemetry/sources/{source_id}/observations:batch-upsert"',
    ]
    if source_id is not None:
        platform_lines.append(f'  source_id: "{source_id}"')
    if source_resolve_url is not None:
        platform_lines.append(f'  source_resolve_url: "{source_resolve_url}"')
    return "\n".join(
        [
            *platform_lines,
            "",
            "vehicle:",
            '  slug: "iss"',
            '  name: "International Space Station"',
            "  norad_id: 25544",
            "  allowed_source_callsigns:",
            '    - "NA1SS"',
            '    - "RS0ISS"',
            '  vehicle_config_path: "vehicles/iss.yaml"',
            "",
            "satnogs:",
            '  base_url: "https://network.satnogs.org"',
            '  api_token: ""',
            '  transmitter_uuid: "tx-uuid"',
            '  status: "good"',
            "",
        ]
    )


def test_load_config_prefers_definition_stable_field_mappings(tmp_path: Path) -> None:
    path = tmp_path / "config.yaml"
    path.write_text(_config_yaml(source_id="source-uuid"), encoding="utf-8")
    config = load_config(str(path))

    assert config.resolve_stable_field_mappings()["latitude"] == "ISS_POS_LAT_DEG"


def test_config_allows_source_id_without_resolve_url(tmp_path: Path) -> None:
    path = tmp_path / "config.yaml"
    path.write_text(_config_yaml(source_id="source-uuid"), encoding="utf-8")

    config = load_config(str(path))

    assert config.platform.source_id == "source-uuid"
    assert config.platform.source_resolve_url is None


def test_config_allows_resolve_url_without_source_id(tmp_path: Path) -> None:
    path = tmp_path / "config.yaml"
    path.write_text(_config_yaml(source_resolve_url="http://backend:8000/telemetry/sources/resolve"), encoding="utf-8")

    config = load_config(str(path))

    assert config.platform.source_id is None
    assert config.platform.source_resolve_url == "http://backend:8000/telemetry/sources/resolve"


def test_config_requires_source_id_or_resolve_url(tmp_path: Path) -> None:
    path = tmp_path / "config.yaml"
    path.write_text(_config_yaml(), encoding="utf-8")

    with pytest.raises(ValueError, match="platform.source_id or platform.source_resolve_url is required"):
        load_config(str(path))


def test_config_requires_satnogs_pair_fields(tmp_path: Path) -> None:
    path = tmp_path / "config.yaml"
    path.write_text(
        _config_yaml(source_id="source-uuid").replace('  transmitter_uuid: "tx-uuid"\n', ""),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="transmitter_uuid"):
        load_config(str(path))


def test_config_rejects_old_satellite_only_shape(tmp_path: Path) -> None:
    path = tmp_path / "config.yaml"
    path.write_text(
        "\n".join(
            [
                "platform:",
                '  ingest_url: "http://backend:8000/telemetry/realtime/ingest"',
                '  source_id: "source-uuid"',
                "",
                "vehicle:",
                '  slug: "iss"',
                '  name: "International Space Station"',
                "  norad_cat_id: 25544",
                '  vehicle_config_path: "vehicles/iss.yaml"',
                "",
                "satnogs_network:",
                '  base_url: "https://network.satnogs.org"',
                "  filters:",
                "    satellite_norad_cat_id: 25544",
                "",
            ]
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValueError):
        load_config(str(path))


def test_parse_lasarsat_csv_payload() -> None:
    packet = parse_aprs_payload(b"\x00PSU,4,22104888,40839616,8106,2389,2030,1,133,7e,1,84\x00")

    assert packet.packet_type == "csv:psu"
    assert packet.fields["psu_01"] == 4.0
    assert packet.fields["psu_02"] == 22104888.0
    assert packet.fields["psu_08"] == 133.0
    assert "psu_09" not in packet.fields


def test_extract_frames_collects_invalid_hex_without_aborting() -> None:
    class FakeClient:
        def get(self, url, params=None, headers=None):
            class Response:
                def raise_for_status(self):
                    return None

                @property
                def text(self):
                    if url.endswith("/good.txt"):
                        return "414243"
                    return "not-hex"

            return Response()

    config = load_config("satnogs_adapter/config.example.yaml")
    connector = SatnogsNetworkConnector(config.satnogs, norad_id=config.vehicle.norad_id, client=FakeClient())
    observation = ObservationRecord(
        observation_id="123",
        satellite_norad_cat_id=25544,
        start_time="2026-04-01T00:00:00Z",
        end_time="2026-04-01T00:01:00Z",
        ground_station_id="42",
        demoddata=[{"payload_demod": "/good.txt"}, {"payload_demod": "/bad.txt"}],
    )

    frames, invalid_lines = connector.extract_frames(observation)

    assert len(frames) == 1
    assert frames[0].frame_bytes == b"ABC"
    assert invalid_lines[0]["frame_index"] == 1


def test_list_recent_observations_uses_status_filter_and_link_header() -> None:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["params"] = dict(request.url.params)
        return httpx.Response(
            200,
            json=[{"id": 1}, {"id": 2}],
            headers={
                "Link": '<https://network.satnogs.org/api/observations/?cursor=abc&status=good>; rel="next"',
            },
        )

    config = load_config("satnogs_adapter/config.example.yaml")
    connector = SatnogsNetworkConnector(
        config.satnogs,
        norad_id=config.vehicle.norad_id,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    observation_page = connector.list_recent_observations()

    assert [item["id"] for item in observation_page.results] == [1, 2]
    assert observation_page.next_url == "https://network.satnogs.org/api/observations/?cursor=abc&status=good"
    assert seen["params"]["satellite__norad_cat_id"] == "62391"
    assert seen["params"]["transmitter_uuid"] == "C3RnLSSuaKzWhHrtJCqUgu"
    assert seen["params"]["status"] == "good"
    assert "page" not in seen["params"]
    assert "cursor" not in seen["params"]
    assert "vetted_status" not in seen["params"]
    assert "start" not in seen["params"]
    assert "end" not in seen["params"]


def test_list_recent_observations_follows_next_link_without_reapplying_params() -> None:
    seen_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_urls.append(str(request.url))
        return httpx.Response(200, json=[{"id": 3}])

    config = load_config("satnogs_adapter/config.example.yaml")
    connector = SatnogsNetworkConnector(
        config.satnogs,
        norad_id=config.vehicle.norad_id,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    observation_page = connector.list_recent_observations(next_url="https://network.satnogs.org/api/observations/?cursor=abc&status=good")

    assert [item["id"] for item in observation_page.results] == [3]
    assert seen_urls == ["https://network.satnogs.org/api/observations/?cursor=abc&status=good"]


def test_list_upcoming_observations_uses_upcoming_status_and_time_bounds() -> None:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["params"] = dict(request.url.params)
        return httpx.Response(200, json=[])

    config = load_config("satnogs_adapter/config.example.yaml")
    connector = SatnogsNetworkConnector(
        config.satnogs,
        norad_id=config.vehicle.norad_id,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    connector.list_upcoming_observations(now=datetime(2026, 4, 7, 12, 0, tzinfo=timezone.utc))

    assert seen["params"]["status"] == "future"
    assert seen["params"]["start"].startswith("2026-04-07T12:00:00")
    assert seen["params"]["end"].startswith("2026-04-08T12:00:00")


def test_satnogs_connector_honors_retry_after_on_rate_limit() -> None:
    requests_seen = {"count": 0}

    def handler(_request: httpx.Request) -> httpx.Response:
        requests_seen["count"] += 1
        return httpx.Response(429, json={"detail": "throttled"}, headers={"Retry-After": "120"})

    config = load_config("satnogs_adapter/config.example.yaml")
    connector = SatnogsNetworkConnector(
        config.satnogs,
        norad_id=config.vehicle.norad_id,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    with pytest.raises(SatnogsRateLimitError) as first:
        connector.list_recent_observations()

    with pytest.raises(SatnogsRateLimitError) as second:
        connector.list_recent_observations()

    assert first.value.retry_after_seconds == 120
    assert 1 <= second.value.retry_after_seconds <= 120
    assert requests_seen["count"] == 1


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
        transmitter_uuid="tx-uuid",
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
    assert "satnogs.transmitter_uuid" not in stable.tags
    assert dynamic.tags is not None
    assert dynamic.tags["decoder"] == "aprs"
    assert "satnogs.transmitter_uuid" not in dynamic.tags


def test_runner_skips_missing_ground_station_and_writes_observation_dlq(tmp_path: Path) -> None:
    config = load_config("satnogs_adapter/config.example.yaml")
    config.checkpoints.path = str(tmp_path / "checkpoints.json")
    config.dlq.root_dir = str(tmp_path / "dlq")
    checkpoint_store = FileCheckpointStore(config.checkpoints.path)
    dlq = FilesystemDlq(config.dlq.root_dir)

    class FakeNetworkConnector:
        def list_recent_observations(self, *, next_url=None, start_time=None, end_time=None, now=None):
            if next_url is None:
                return ObservationPage(
                    results=[
                        {
                            "id": 123,
                            "status": "good",
                            "satellite__norad_cat_id": 62391,
                            "transmitter_uuid": "C3RnLSSuaKzWhHrtJCqUgu",
                            "demoddata": "414243",
                        }
                    ]
                )
            return ObservationPage(results=[])

        def is_eligible_observation(self, payload):
            return True

        def get_observation_detail(self, observation_id):
            raise AssertionError("detail should not be requested")

        def normalize_observation(self, payload):
            return ObservationRecord(
                observation_id=str(payload["id"]),
                satellite_norad_cat_id=62391,
                transmitter_uuid="C3RnLSSuaKzWhHrtJCqUgu",
                start_time="2026-04-01T00:00:00Z",
                end_time="2026-04-01T00:01:00Z",
                ground_station_id=None,
                demoddata=payload["demoddata"],
                raw_json=payload,
            )

        def extract_frames(self, observation, *, source="satnogs_network"):
            raise AssertionError("frames should not be extracted without ground_station_id")

    class FakePublisher:
        def publish(self, events, *, context):
            raise AssertionError("publisher should not be called")

    runner = AdapterRunner(
        config,
        network_connector=FakeNetworkConnector(),
        publisher=FakePublisher(),
        observations_publisher=FakeObservationsPublisher(),
        checkpoint_store=checkpoint_store,
        dlq=dlq,
        source_id="source-uuid",
    )

    runner.run_live_once()

    observation_dlq = dlq.iter_kind("observation")
    assert len(observation_dlq) == 1
    payload = json.loads(observation_dlq[0].read_text(encoding="utf-8"))
    assert payload["reason"] == "missing_ground_station_id"


def test_runner_uses_link_pagination_and_observation_id_dedupe(tmp_path: Path) -> None:
    config = load_config("satnogs_adapter/config.example.yaml")
    config.checkpoints.path = str(tmp_path / "checkpoints.json")
    config.dlq.root_dir = str(tmp_path / "dlq")
    checkpoint_store = FileCheckpointStore(config.checkpoints.path)
    checkpoint_store.mark_processed_observation("obs-1")
    dlq = FilesystemDlq(config.dlq.root_dir)
    next_urls_seen: list[str | None] = []

    class FakeNetworkConnector:
        def list_recent_observations(self, *, next_url=None, start_time=None, end_time=None, now=None):
            next_urls_seen.append(next_url)
            if next_url is None:
                return ObservationPage(
                    results=[
                        {
                            "id": "obs-1",
                            "status": "good",
                            "satellite__norad_cat_id": 62391,
                            "transmitter_uuid": "C3RnLSSuaKzWhHrtJCqUgu",
                            "demoddata": [{"payload_demod": "/frame.txt"}],
                            "ground_station_id": "42",
                        }
                    ],
                    next_url="https://network.satnogs.org/api/observations/?cursor=abc",
                )
            if next_url == "https://network.satnogs.org/api/observations/?cursor=abc":
                return ObservationPage(
                    results=[
                        {
                            "id": "obs-1",
                            "status": "good",
                            "satellite__norad_cat_id": 62391,
                            "transmitter_uuid": "C3RnLSSuaKzWhHrtJCqUgu",
                            "demoddata": [{"payload_demod": "/frame.txt"}],
                            "ground_station_id": "42",
                        }
                    ]
                )
            raise AssertionError(f"unexpected next_url={next_url}")

        def is_eligible_observation(self, payload):
            raise AssertionError("processed observations should be deduped before eligibility checks")

    class FakePublisher:
        def publish(self, events, *, context):
            raise AssertionError("publisher should not be called for processed observations")

    runner = AdapterRunner(
        config,
        network_connector=FakeNetworkConnector(),
        publisher=FakePublisher(),
        observations_publisher=FakeObservationsPublisher(),
        checkpoint_store=checkpoint_store,
        dlq=dlq,
        source_id="source-uuid",
    )

    runner.run_live_once()

    assert next_urls_seen == [None, "https://network.satnogs.org/api/observations/?cursor=abc"]
    assert checkpoint_store.is_processed_observation("obs-1")


def test_runner_syncs_upcoming_observations_with_replacement_payload(tmp_path: Path) -> None:
    config = load_config("satnogs_adapter/config.example.yaml")
    config.checkpoints.path = str(tmp_path / "checkpoints.json")
    config.dlq.root_dir = str(tmp_path / "dlq")
    captured: dict[str, object] = {}

    class FakeNetworkConnector:
        def list_upcoming_observations(self):
            return ObservationPage(
                results=[
                    {
                        "id": "future-1",
                        "status": "future",
                        "satellite__norad_cat_id": 62391,
                        "transmitter_uuid": "C3RnLSSuaKzWhHrtJCqUgu",
                        "start": "2026-04-07T12:00:00Z",
                        "end": "2026-04-07T12:10:00Z",
                        "ground_station_id": "42",
                        "station_callsign": "GS42",
                        "max_elevation": 51.5,
                    }
                ]
            )

        def is_eligible_observation(self, payload, *, status=None, require_status=True):
            return status == "future" and require_status is False

        def normalize_observation(self, payload):
            return ObservationRecord(
                observation_id=str(payload["id"]),
                satellite_norad_cat_id=62391,
                transmitter_uuid="C3RnLSSuaKzWhHrtJCqUgu",
                start_time=payload["start"],
                end_time=payload["end"],
                ground_station_id=payload["ground_station_id"],
                station_callsign=payload["station_callsign"],
                status=payload["status"],
                raw_json=payload,
            )

        def list_recent_observations(self, *, next_url=None, start_time=None, end_time=None, now=None):
            return ObservationPage(results=[])

    class CapturingObservationsPublisher:
        def publish(self, observations, *, provider, replace_future_scheduled=True, context):
            captured["observations"] = observations
            captured["provider"] = provider
            captured["replace_future_scheduled"] = replace_future_scheduled

            class Result:
                success = True
                status_code = 200
                response_body = ""

            return Result()

    class FakePublisher:
        def publish(self, events, *, context):
            raise AssertionError("telemetry publisher should not be called")

    runner = AdapterRunner(
        config,
        network_connector=FakeNetworkConnector(),
        publisher=FakePublisher(),
        observations_publisher=CapturingObservationsPublisher(),
        checkpoint_store=FileCheckpointStore(config.checkpoints.path),
        dlq=FilesystemDlq(config.dlq.root_dir),
        source_id="source-uuid",
    )

    runner.run_live_once()

    assert captured["provider"] == "satnogs"
    assert captured["replace_future_scheduled"] is True
    assert captured["observations"] == [
        {
            "external_id": "future-1",
            "status": "scheduled",
            "start_time": "2026-04-07T12:00:00Z",
            "end_time": "2026-04-07T12:10:00Z",
            "station_name": "GS42",
            "station_id": "42",
            "receiver_id": "satnogs-station-42",
            "details": {
                "satnogs_status": "future",
                "satellite_norad_cat_id": 62391,
                "transmitter_uuid": "C3RnLSSuaKzWhHrtJCqUgu",
            },
            "max_elevation_deg": 51.5,
        }
    ]


def test_backfill_uses_linked_observations_with_configured_bounds(tmp_path: Path) -> None:
    config = load_config("satnogs_adapter/config.example.yaml")
    config.backfill.enabled = True
    config.backfill.start_time = "2026-04-01T00:00:00Z"
    config.backfill.end_time = "2026-04-02T00:00:00Z"
    config.checkpoints.path = str(tmp_path / "checkpoints.json")
    config.dlq.root_dir = str(tmp_path / "dlq")
    seen: list[tuple[str | None, str | None, str | None]] = []

    class FakeNetworkConnector:
        def list_recent_observations(self, *, next_url=None, start_time=None, end_time=None, now=None):
            seen.append((next_url, start_time, end_time))
            if next_url is None:
                return ObservationPage(results=[], next_url=None)
            raise AssertionError("backfill should stop on the empty first page")

    class FakePublisher:
        def publish(self, events, *, context):
            raise AssertionError("publisher should not be called")

    runner = AdapterRunner(
        config,
        network_connector=FakeNetworkConnector(),
        publisher=FakePublisher(),
        observations_publisher=FakeObservationsPublisher(),
        checkpoint_store=FileCheckpointStore(config.checkpoints.path),
        dlq=FilesystemDlq(config.dlq.root_dir),
        source_id="source-uuid",
    )

    runner.run_backfill_once()

    assert seen == [(None, "2026-04-01T00:00:00Z", "2026-04-02T00:00:00Z")]


def test_satnogs_connector_rejects_mismatched_status() -> None:
    config = load_config("satnogs_adapter/config.example.yaml")
    connector = SatnogsNetworkConnector(config.satnogs, norad_id=config.vehicle.norad_id)

    assert connector.is_eligible_observation(
        {
            "id": "obs-1",
            "satellite__norad_cat_id": 62391,
            "transmitter_uuid": "C3RnLSSuaKzWhHrtJCqUgu",
            "status": "bad",
        }
    ) is False


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


def test_observations_publisher_posts_batch_upsert_payload(tmp_path: Path) -> None:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["json"] = json.loads(request.content.decode("utf-8"))
        return httpx.Response(200, json={"inserted": 1, "deleted": 0})

    config = load_config("satnogs_adapter/config.example.yaml")
    publisher = ObservationsPublisher(
        batch_upsert_url="http://backend:8000/telemetry/sources/source-uuid/observations:batch-upsert",
        config=config.publisher,
        dlq=FilesystemDlq(str(tmp_path / "dlq")),
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    result = publisher.publish(
        [{"external_id": "future-1", "status": "scheduled", "start_time": "2026-04-07T12:00:00Z", "end_time": "2026-04-07T12:10:00Z"}],
        provider="satnogs",
        replace_future_scheduled=True,
        context={"source_id": "source-uuid"},
    )

    assert result.success is True
    assert seen["json"] == {
        "provider": "satnogs",
        "replace_future_scheduled": True,
        "observations": [
            {
                "external_id": "future-1",
                "status": "scheduled",
                "start_time": "2026-04-07T12:00:00Z",
                "end_time": "2026-04-07T12:10:00Z",
            }
        ],
    }


def test_source_resolver_posts_vehicle_request_and_parses_response() -> None:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["json"] = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            json={
                "id": "resolved-source",
                "name": "LASARSAT",
                "description": None,
                "source_type": "vehicle",
                "base_url": None,
                "vehicle_config_path": "vehicles/lasarsat.yaml",
                "created": False,
            },
        )

    config = load_config("satnogs_adapter/config.example.yaml")
    resolver = BackendSourceResolver(
        resolve_url="http://backend:8000/telemetry/sources/resolve",
        retry=RetryConfig(max_attempts=1, backoff_seconds=0),
        timeout_seconds=1,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    source = resolver.resolve_vehicle_source(config.vehicle)

    assert source.id == "resolved-source"
    assert source.created is False
    assert seen["json"] == {
        "source_type": "vehicle",
        "name": "LASARSAT",
        "description": "Auto-resolved from vehicle configuration: vehicles/lasarsat.yaml",
        "vehicle_config_path": "vehicles/lasarsat.yaml",
    }


def test_source_resolver_fails_on_non_success_response() -> None:
    config = load_config("satnogs_adapter/config.example.yaml")
    resolver = BackendSourceResolver(
        resolve_url="http://backend:8000/telemetry/sources/resolve",
        retry=RetryConfig(max_attempts=1, backoff_seconds=0),
        timeout_seconds=1,
        client=httpx.Client(transport=httpx.MockTransport(lambda _request: httpx.Response(400, text="bad path"))),
    )

    with pytest.raises(SourceResolutionError, match="status=400"):
        resolver.resolve_vehicle_source(config.vehicle)


def test_source_resolver_fails_on_malformed_response() -> None:
    config = load_config("satnogs_adapter/config.example.yaml")
    resolver = BackendSourceResolver(
        resolve_url="http://backend:8000/telemetry/sources/resolve",
        retry=RetryConfig(max_attempts=1, backoff_seconds=0),
        timeout_seconds=1,
        client=httpx.Client(transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={"id": "missing"}))),
    )

    with pytest.raises(SourceResolutionError, match="Malformed source resolve response"):
        resolver.resolve_vehicle_source(config.vehicle)


def test_build_runner_uses_source_id_override_without_resolving(tmp_path: Path, monkeypatch) -> None:
    path = tmp_path / "config.yaml"
    path.write_text(_config_yaml(source_id="override-source"), encoding="utf-8")

    class FailResolver:
        def __init__(self, **_kwargs):
            raise AssertionError("resolver should not be constructed")

    monkeypatch.setattr("satnogs_adapter.main.BackendSourceResolver", FailResolver)

    runner = build_runner(str(path))

    assert runner.mapper.source_id == "override-source"


def test_build_runner_resolves_source_id_when_override_absent(tmp_path: Path, monkeypatch) -> None:
    path = tmp_path / "config.yaml"
    path.write_text(_config_yaml(source_resolve_url="http://backend:8000/telemetry/sources/resolve"), encoding="utf-8")
    calls = {"count": 0}

    class FakeResolver:
        def __init__(self, **kwargs):
            assert kwargs["resolve_url"] == "http://backend:8000/telemetry/sources/resolve"

        def resolve_vehicle_source(self, vehicle):
            calls["count"] += 1

            class Source:
                id = "resolved-source"
                created = False
                vehicle_config_path = vehicle.vehicle_config_path

            return Source()

    monkeypatch.setattr("satnogs_adapter.main.BackendSourceResolver", FakeResolver)

    runner = build_runner(str(path))

    assert runner.mapper.source_id == "resolved-source"
    assert calls["count"] == 1
