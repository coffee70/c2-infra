"""CLI entrypoint for the SatNOGS adapter."""

from __future__ import annotations

import argparse
import logging

from satnogs_adapter.checkpoints import FileCheckpointStore
from satnogs_adapter.config import load_config
from satnogs_adapter.connectors import SatnogsDbBackfillConnector, SatnogsNetworkConnector
from satnogs_adapter.dlq import FilesystemDlq
from satnogs_adapter.publisher import IngestPublisher
from satnogs_adapter.runner import AdapterRunner


def build_runner(config_path: str) -> AdapterRunner:
    config = load_config(config_path)
    checkpoint_store = FileCheckpointStore(config.checkpoints.path)
    dlq = FilesystemDlq(config.dlq.root_dir)
    network_connector = SatnogsNetworkConnector(config.satnogs_network)
    backfill_connector = SatnogsDbBackfillConnector(config.backfill, base_url=config.satnogs_network.base_url)
    publisher = IngestPublisher(
        ingest_url=config.platform.ingest_url,
        config=config.publisher,
        dlq=dlq,
    )
    return AdapterRunner(
        config,
        network_connector=network_connector,
        backfill_connector=backfill_connector,
        publisher=publisher,
        checkpoint_store=checkpoint_store,
        dlq=dlq,
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

