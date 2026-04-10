"""Runtime orchestration for the SatNOGS adapter."""

from __future__ import annotations

import binascii
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

from satnogs_adapter.checkpoints import FileCheckpointStore
from satnogs_adapter.config import AdapterConfig
from satnogs_adapter.connectors import SatnogsNetworkConnector, SatnogsRateLimitError
from satnogs_adapter.decoders import DecoderRegistry, PayloadDecodeError, PayloadDecodeService, parse_ax25_frame
from satnogs_adapter.dlq import FilesystemDlq
from satnogs_adapter.mapper import TelemetryMapper
from satnogs_adapter.models import FrameRecord, ObservationRecord, TelemetryEvent
from satnogs_adapter.publisher import IngestPublisher, ObservationsPublisher

logger = logging.getLogger(__name__)


class AdapterRunner:
    def __init__(
        self,
        config: AdapterConfig,
        *,
        network_connector: SatnogsNetworkConnector,
        publisher: IngestPublisher,
        observations_publisher: ObservationsPublisher,
        checkpoint_store: FileCheckpointStore,
        dlq: FilesystemDlq,
        payload_decode_service: PayloadDecodeService,
        source_id: str | None = None,
    ) -> None:
        self.config = config
        self.network_connector = network_connector
        self.publisher = publisher
        self.observations_publisher = observations_publisher
        self.checkpoint_store = checkpoint_store
        self.dlq = dlq
        self.payload_decode_service = payload_decode_service
        self._last_observation_sync_monotonic: float | None = None
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
        self._sync_upcoming_observations_if_due()
        self._run_observation_pages()

    def _sync_upcoming_observations_if_due(self) -> None:
        now_monotonic = time.monotonic()
        if (
            self._last_observation_sync_monotonic is not None
            and now_monotonic - self._last_observation_sync_monotonic
            < self.config.satnogs.observation_sync_interval_seconds
        ):
            return
        self._last_observation_sync_monotonic = now_monotonic
        try:
            observation_page = self.network_connector.list_upcoming_observations()
            observations = []
            for raw_observation in observation_page.results:
                if not self.network_connector.is_eligible_observation(
                    raw_observation,
                    status=self.config.satnogs.upcoming_status,
                    require_status=False,
                ):
                    continue
                observation = self.network_connector.normalize_observation(raw_observation)
                payload = self._observation_window_payload(observation)
                if payload is not None:
                    observations.append(payload)
            result = self.observations_publisher.publish(
                observations,
                provider="satnogs",
                replace_future_scheduled=True,
                context={"source_id": self.mapper.source_id, "count": len(observations)},
            )
            if not result.success:
                logger.warning("SatNOGS observation sync failed: status=%s body=%s", result.status_code, result.response_body)
            else:
                logger.info(
                    "Synced SatNOGS upcoming observations: source_id=%s count=%s status=%s",
                    self.mapper.source_id,
                    len(observations),
                    result.status_code,
                )
        except SatnogsRateLimitError as exc:
            logger.warning("SatNOGS observation sync throttled; retry after %ss", exc.retry_after_seconds)
        except Exception:
            logger.exception("SatNOGS observation sync failed")

    def _observation_window_payload(self, observation: ObservationRecord) -> dict[str, object] | None:
        if not observation.start_time or not observation.end_time:
            return None
        station_name = observation.station_callsign or observation.observer
        raw_json = observation.raw_json or {}
        max_elevation = (
            raw_json.get("max_elevation")
            or raw_json.get("max_elevation_deg")
            or raw_json.get("max_altitude")
        )
        details = {
            "satnogs_status": observation.status,
            "satellite_norad_cat_id": observation.satellite_norad_cat_id,
        }
        if observation.transmitter_uuid:
            details["transmitter_uuid"] = observation.transmitter_uuid
        payload: dict[str, object] = {
            "external_id": observation.observation_id,
            "status": "scheduled",
            "start_time": observation.start_time,
            "end_time": observation.end_time,
            "station_name": station_name,
            "station_id": observation.ground_station_id,
            "receiver_id": self.mapper.build_receiver_id(observation),
            "details": details,
        }
        if max_elevation is not None:
            try:
                payload["max_elevation_deg"] = float(max_elevation)
            except (TypeError, ValueError):
                pass
        return payload

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
            try:
                observation_page = self.network_connector.list_recent_observations(
                    next_url=next_url,
                    start_time=None if next_url else start_time,
                    end_time=None if next_url else end_time,
                )
            except SatnogsRateLimitError as exc:
                logger.warning("SatNOGS observation poll throttled; retry after %ss", exc.retry_after_seconds)
                return
            results = observation_page.results
            if not results:
                logger.info("SatNOGS observation poll returned no results")
                return
            logger.info(
                "SatNOGS observation poll returned page: count=%s has_next=%s",
                len(results),
                bool(observation_page.next_url),
            )
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
            logger.info("Skipping already-processed observation %s", observation_id)
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
            logger.warning("Skipping observation %s without ground_station_id", observation_id)
            self._write_observation_dlq("missing_ground_station_id", observation)
            return

        try:
            frames, invalid_lines = self.network_connector.extract_frames(observation)
        except (binascii.Error, ValueError) as exc:
            logger.warning("Frame extraction failed for observation %s: %r", observation.observation_id, exc)
            self._write_observation_dlq("frame_extraction_failed", observation, extra={"error": repr(exc)})
            return
        logger.info(
            "Extracted SatNOGS frames: observation_id=%s ground_station_id=%s frames=%s invalid_lines=%s",
            observation.observation_id,
            observation.ground_station_id,
            len(frames),
            len(invalid_lines),
        )
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
            logger.info("No frames extracted for observation %s", observation.observation_id)
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
        skipped_non_originated = 0
        failed_ax25_decode = 0
        unknown_payload_format_count = 0
        failed_payload_decode = 0
        mapped_frame_count = 0
        mapped_event_count = 0
        skipped_published_frame_count = 0

        for frame in frames:
            if frame.frame_index <= resume_index:
                skipped_published_frame_count += 1
                continue
            try:
                ax25 = parse_ax25_frame(frame.frame_bytes)
            except ValueError as exc:
                failed_ax25_decode += 1
                self.dlq.write(
                    "frame",
                    {
                        "reason": "ax25_decode_failed",
                        "observation_id": observation.observation_id,
                        "ground_station_id": observation.ground_station_id,
                        "frame_index": frame.frame_index,
                        "raw_line": frame.raw_line,
                        "error_message": str(exc),
                    },
                )
                continue

            if not self.mapper.is_originated_packet(ax25):
                skipped_non_originated += 1
                continue

            try:
                decoded_packet = self.payload_decode_service.decode(
                    observation=observation,
                    frame=frame,
                    ax25_packet=ax25,
                )
            except PayloadDecodeError as exc:
                failed_payload_decode += 1
                self._write_payload_dlq(
                    observation=observation,
                    frame=frame,
                    ax25=ax25,
                    error=exc,
                )
                continue

            if decoded_packet is None:
                unknown_payload_format_count += 1
                continue

            frame_events = self.mapper.map_decoded_packet(
                observation=observation,
                frame=ax25,
                decoded_packet=decoded_packet,
                reception_time=frame.reception_time,
                sequence_seed=sequence_seed,
            )
            if not frame_events:
                continue

            mapped_frame_count += 1
            mapped_event_count += len(frame_events)
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

        logger.info(
            "Processed SatNOGS frames: observation_id=%s total_frames=%s mapped_frames=%s mapped_events=%s skipped_already_published=%s skipped_non_originated=%s failed_ax25_decode=%s unknown_payload_format_count=%s failed_payload_decode=%s",
            observation.observation_id,
            len(frames),
            mapped_frame_count,
            mapped_event_count,
            skipped_published_frame_count,
            skipped_non_originated,
            failed_ax25_decode,
            unknown_payload_format_count,
            failed_payload_decode,
        )

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
            logger.warning(
                "Failed publishing SatNOGS telemetry batch: observation_id=%s stream_id=%s events=%s last_frame_index=%s status=%s body=%s",
                observation.observation_id,
                self.mapper.stream_id_for_observation(observation),
                len(batch),
                last_frame_index,
                result.status_code,
                result.response_body,
            )
            return False
        logger.info(
            "Published SatNOGS telemetry batch: observation_id=%s stream_id=%s events=%s last_frame_index=%s status=%s attempts=%s",
            observation.observation_id,
            self.mapper.stream_id_for_observation(observation),
            len(batch),
            last_frame_index,
            result.status_code,
            result.attempts,
        )
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

    def _write_payload_dlq(
        self,
        *,
        observation: ObservationRecord,
        frame: FrameRecord,
        ax25,
        error: PayloadDecodeError,
    ) -> None:
        payload: dict[str, Any] = {
            "reason": error.reason,
            "observation_id": observation.observation_id,
            "frame_index": frame.frame_index,
            "ground_station_id": observation.ground_station_id,
            "source_callsign": ax25.src_callsign,
            "destination_callsign": ax25.dest_callsign,
            "raw_line": frame.raw_line,
            "frame_hex": frame.frame_bytes.hex(),
            "payload_hex": ax25.info_bytes.hex(),
            "decoder_id": error.decoder_id,
            "decoder_strategy": error.decoder_strategy,
            "packet_name": error.packet_name,
            "error_message": error.error_message,
        }
        if error.metadata:
            payload["metadata"] = error.metadata
        self.dlq.write("frame", payload)


def replay_dlq(config: AdapterConfig, *, max_age_seconds: int | None = None) -> int:
    dlq = FilesystemDlq(config.dlq.root_dir)
    checkpoint_store = FileCheckpointStore(config.checkpoints.path)
    network_connector = SatnogsNetworkConnector(config.satnogs, norad_id=config.vehicle.norad_id)
    publisher = IngestPublisher(ingest_url=config.platform.ingest_url, config=config.publisher, dlq=dlq)
    observations_publisher = ObservationsPublisher(
        batch_upsert_url=config.platform.observations_batch_upsert_url.format(source_id=config.platform.source_id or ""),
        config=config.publisher,
        dlq=dlq,
    )
    runner = AdapterRunner(
        config,
        network_connector=network_connector,
        publisher=publisher,
        observations_publisher=observations_publisher,
        checkpoint_store=checkpoint_store,
        dlq=dlq,
        payload_decode_service=PayloadDecodeService(
            decoder_config=config.vehicle.decoder,
            registry=DecoderRegistry(),
        ),
    )
    return runner.replay_batch_dlq(max_age_seconds=max_age_seconds)
