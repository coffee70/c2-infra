"""Runtime orchestration for the SatNOGS adapter."""

from __future__ import annotations

import binascii
import json
import logging
import time
from datetime import datetime, timezone

from satnogs_adapter.checkpoints import FileCheckpointStore
from satnogs_adapter.config import AdapterConfig
from satnogs_adapter.connectors import SatnogsNetworkConnector
from satnogs_adapter.decoders import parse_aprs_payload, parse_ax25_frame
from satnogs_adapter.dlq import FilesystemDlq
from satnogs_adapter.mapper import TelemetryMapper
from satnogs_adapter.models import FrameRecord, ObservationRecord, TelemetryEvent
from satnogs_adapter.publisher import IngestPublisher

logger = logging.getLogger(__name__)


class AdapterRunner:
    def __init__(
        self,
        config: AdapterConfig,
        *,
        network_connector: SatnogsNetworkConnector,
        publisher: IngestPublisher,
        checkpoint_store: FileCheckpointStore,
        dlq: FilesystemDlq,
        source_id: str | None = None,
    ) -> None:
        self.config = config
        self.network_connector = network_connector
        self.publisher = publisher
        self.checkpoint_store = checkpoint_store
        self.dlq = dlq
        resolved_source_id = source_id or config.platform.source_id
        if not resolved_source_id:
            raise ValueError("AdapterRunner requires a resolved source_id")
        self.mapper = TelemetryMapper(
            source_id=resolved_source_id,
            stable_field_mappings=config.resolve_stable_field_mappings(),
            allowed_source_callsigns=config.vehicle.allowed_source_callsigns,
            vehicle_norad_cat_id=config.vehicle.norad_id,
        )

    def run_forever(self) -> None:
        while True:
            try:
                self.run_live_once()
            except Exception:
                logger.exception("SatNOGS live poll failed")
            time.sleep(self.config.satnogs.poll_interval_seconds)

    def run_live_once(self) -> None:
        self._run_observation_pages()

    def run_backfill_once(self) -> None:
        if not self.config.backfill.enabled:
            return
        self._run_observation_pages(
            start_time=self.config.backfill.start_time,
            end_time=self.config.backfill.end_time,
            max_observations=self.config.backfill.max_observations_per_run,
        )

    def _run_observation_pages(
        self,
        *,
        start_time: str | None = None,
        end_time: str | None = None,
        max_observations: int | None = None,
    ) -> None:
        next_url: str | None = None
        observations_seen = 0
        while True:
            observation_page = self.network_connector.list_recent_observations(
                next_url=next_url,
                start_time=None if next_url else start_time,
                end_time=None if next_url else end_time,
            )
            results = observation_page.results
            if not results:
                return
            for raw_observation in results:
                if max_observations is not None and observations_seen >= max_observations:
                    return
                observations_seen += 1
                self._process_observation_payload(raw_observation)
            if not observation_page.next_url:
                return
            next_url = observation_page.next_url

    def replay_batch_dlq(self, *, max_age_seconds: int | None = None) -> int:
        replayed = 0
        now = datetime.now(timezone.utc).timestamp()
        for path in self.dlq.iter_kind("batch"):
            if max_age_seconds is not None and now - path.stat().st_mtime > max_age_seconds:
                continue
            payload = json.loads(path.read_text(encoding="utf-8"))
            request = payload.get("request") or {}
            events = request.get("events") or []
            result = self.publisher.client.post(self.config.platform.ingest_url, json={"events": events})
            if 200 <= result.status_code < 300:
                replayed += 1
                path.unlink(missing_ok=True)
        return replayed

    def _process_observation_payload(self, raw_observation: dict[str, object]) -> None:
        observation_id = str(raw_observation.get("id"))
        if self.checkpoint_store.is_processed_observation(observation_id):
            return
        if not self.network_connector.is_eligible_observation(raw_observation):
            logger.info("Skipping non-eligible observation %s", observation_id)
            return

        detail = raw_observation
        if not raw_observation.get("demoddata"):
            detail = self.network_connector.get_observation_detail(observation_id)
        if not self.network_connector.is_eligible_observation(detail):
            logger.info("Skipping observation %s after detail mismatch", observation_id)
            return
        observation = self.network_connector.normalize_observation(detail)
        if not self._has_demoddata(observation):
            logger.info("Skipping observation %s without demoddata", observation_id)
            return
        if observation.ground_station_id is None:
            self._write_observation_dlq("missing_ground_station_id", observation)
            return

        try:
            frames, invalid_lines = self.network_connector.extract_frames(observation)
        except (binascii.Error, ValueError) as exc:
            self._write_observation_dlq("frame_extraction_failed", observation, extra={"error": repr(exc)})
            return
        for item in invalid_lines:
            self.dlq.write(
                "frame",
                {
                    "reason": "invalid_hex_payload",
                    "observation_id": observation.observation_id,
                    "ground_station_id": observation.ground_station_id,
                    **item,
                },
            )

        if not frames:
            return

        self._process_frames(observation, frames)

    def _has_demoddata(self, observation: ObservationRecord) -> bool:
        demoddata = observation.demoddata
        if isinstance(demoddata, str):
            return bool(demoddata.strip())
        if isinstance(demoddata, list):
            return any(self._has_demoddata_item(item) for item in demoddata)
        return bool(observation.artifact_refs)

    def _has_demoddata_item(self, item: object) -> bool:
        if isinstance(item, str):
            return bool(item.strip())
        if isinstance(item, dict):
            for key in ("payload_demod", "payload", "frame", "hex"):
                value = item.get(key)
                if isinstance(value, str) and value.strip():
                    return True
        return False

    def _process_frames(self, observation: ObservationRecord, frames: list[FrameRecord]) -> None:
        receiver_id = self.mapper.build_receiver_id(observation)
        if receiver_id is None:
            self._write_observation_dlq("missing_receiver_id", observation)
            return

        partial_key = f"observation:{observation.observation_id}:last_published_frame_index"
        resume_index = int(self.checkpoint_store.get(partial_key, -1))
        batch: list[TelemetryEvent] = []
        batch_last_frame_index = resume_index
        sequence_seed = int(self.checkpoint_store.get(f"observation:{observation.observation_id}:sequence", 0))

        for frame in frames:
            if frame.frame_index <= resume_index:
                continue
            try:
                ax25 = parse_ax25_frame(frame.frame_bytes)
            except ValueError as exc:
                self.dlq.write(
                    "frame",
                    {
                        "reason": "ax25_decode_failed",
                        "observation_id": observation.observation_id,
                        "ground_station_id": observation.ground_station_id,
                        "frame_index": frame.frame_index,
                        "raw_line": frame.raw_line,
                        "error": repr(exc),
                    },
                )
                continue

            if not self.mapper.is_originated_packet(ax25):
                continue

            try:
                aprs = parse_aprs_payload(ax25.info_bytes)
            except ValueError as exc:
                self.dlq.write(
                    "frame",
                    {
                        "reason": "aprs_decode_failed",
                        "observation_id": observation.observation_id,
                        "ground_station_id": observation.ground_station_id,
                        "frame_index": frame.frame_index,
                        "raw_line": frame.raw_line,
                        "error": repr(exc),
                    },
                )
                continue

            frame_events = self.mapper.map_packet(
                observation=observation,
                frame=ax25,
                aprs_packet=aprs,
                reception_time=frame.reception_time,
                sequence_seed=sequence_seed,
            )
            if not frame_events:
                continue

            sequence_seed = frame_events[-1].sequence or sequence_seed
            batch.extend(frame_events)
            batch_last_frame_index = frame.frame_index
            if len(batch) >= self.config.publisher.batch_size_events:
                if not self._flush_batch(batch, observation=observation, last_frame_index=batch_last_frame_index):
                    return
                self.checkpoint_store.set(f"observation:{observation.observation_id}:sequence", sequence_seed)
                batch = []

        if batch and not self._flush_batch(batch, observation=observation, last_frame_index=batch_last_frame_index):
            return

        self.checkpoint_store.mark_processed_observation(observation.observation_id)
        self.checkpoint_store.pop(partial_key)
        self.checkpoint_store.pop(f"observation:{observation.observation_id}:sequence")

    def _flush_batch(self, batch: list[TelemetryEvent], *, observation: ObservationRecord, last_frame_index: int) -> bool:
        result = self.publisher.publish(
            batch,
            context={
                "observation_id": observation.observation_id,
                "ground_station_id": observation.ground_station_id,
                "stream_id": self.mapper.stream_id_for_observation(observation),
                "last_frame_index": last_frame_index,
            },
        )
        if not result.success:
            return False
        self.checkpoint_store.set(
            f"observation:{observation.observation_id}:last_published_frame_index",
            last_frame_index,
        )
        return True

    def _write_observation_dlq(self, reason: str, observation: ObservationRecord, *, extra: dict[str, object] | None = None) -> None:
        if not self.config.dlq.write_observation_dlq:
            return
        payload = {
            "reason": reason,
            "observation_id": observation.observation_id,
            "ground_station_id": observation.ground_station_id,
            "status": observation.status,
            "raw_json": observation.raw_json,
        }
        if extra:
            payload.update(extra)
        self.dlq.write("observation", payload)


def replay_dlq(config: AdapterConfig, *, max_age_seconds: int | None = None) -> int:
    dlq = FilesystemDlq(config.dlq.root_dir)
    checkpoint_store = FileCheckpointStore(config.checkpoints.path)
    network_connector = SatnogsNetworkConnector(config.satnogs, norad_id=config.vehicle.norad_id)
    publisher = IngestPublisher(ingest_url=config.platform.ingest_url, config=config.publisher, dlq=dlq)
    runner = AdapterRunner(
        config,
        network_connector=network_connector,
        publisher=publisher,
        checkpoint_store=checkpoint_store,
        dlq=dlq,
    )
    return runner.replay_batch_dlq(max_age_seconds=max_age_seconds)
