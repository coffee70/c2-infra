"""CLI entrypoint for the SatNOGS adapter."""

from __future__ import annotations

import argparse
import logging

from satnogs_adapter.checkpoints import FileCheckpointStore
from satnogs_adapter.config import AdapterConfig, load_config
from satnogs_adapter.connectors import SatnogsNetworkConnector
from satnogs_adapter.dlq import FilesystemDlq
from satnogs_adapter.publisher import IngestPublisher
from satnogs_adapter.runner import AdapterRunner
from satnogs_adapter.source_resolver import BackendSourceResolver

logger = logging.getLogger(__name__)


def resolve_runtime_source_id(config: AdapterConfig) -> str:
    if config.platform.source_id:
        logger.info("Using configured source_id override: %s", config.platform.source_id)
        return config.platform.source_id
    if not config.platform.source_resolve_url:
        raise ValueError("platform.source_resolve_url is required when platform.source_id is absent")
    logger.info("Resolving source for vehicle_config_path=%s", config.vehicle.vehicle_config_path)
    resolve_retry = config.publisher.retry.model_copy(
        update={
            "max_attempts": max(config.publisher.retry.max_attempts, 12),
            "backoff_seconds": min(config.publisher.retry.backoff_seconds, 1.0),
        }
    )
    resolver = BackendSourceResolver(
        resolve_url=config.platform.source_resolve_url,
        retry=resolve_retry,
        timeout_seconds=config.publisher.timeout_seconds,
    )
    source = resolver.resolve_vehicle_source(config.vehicle)
    logger.info(
        "Resolved backend source id=%s created=%s vehicle_config_path=%s",
        source.id,
        source.created,
        source.vehicle_config_path,
    )
    return source.id


def build_runner(config_path: str) -> AdapterRunner:
    config = load_config(config_path)
    source_id = resolve_runtime_source_id(config)
    checkpoint_store = FileCheckpointStore(config.checkpoints.path)
    dlq = FilesystemDlq(config.dlq.root_dir)
    network_connector = SatnogsNetworkConnector(config.satnogs, norad_id=config.vehicle.norad_id)
    publisher = IngestPublisher(
        ingest_url=config.platform.ingest_url,
        config=config.publisher,
        dlq=dlq,
    )
    return AdapterRunner(
        config,
        network_connector=network_connector,
        publisher=publisher,
        checkpoint_store=checkpoint_store,
        dlq=dlq,
        source_id=source_id,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="SatNOGS AX.25/APRS telemetry adapter")
    parser.add_argument("--config", default="satnogs_adapter/config.example.yaml", help="Path to adapter YAML config")
    parser.add_argument("--mode", choices=["live", "backfill", "replay-dlq", "once"], default="live")
    parser.add_argument("--max-age-seconds", type=int, default=None, help="Replay only DLQ files newer than this age")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    runner = build_runner(args.config)

    if args.mode == "live":
        runner.run_forever()
        return
    if args.mode == "once":
        runner.run_live_once()
        return
    if args.mode == "backfill":
        runner.run_backfill_once()
        return
    replayed = runner.replay_batch_dlq(max_age_seconds=args.max_age_seconds)
    logging.getLogger(__name__).info("Replayed %s DLQ batches", replayed)


if __name__ == "__main__":
    main()
