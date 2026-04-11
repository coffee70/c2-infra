# SatNOGS Adapter

**Workflow:** Start backend → start adapter → live ingest + background backfill

Use the SatNOGS adapter to ingest AX.25 telemetry from one SatNOGS satellite/transmitter pair into the platform. The example config uses LASARSAT NORAD `62391` with transmitter UUID `C3RnLSSuaKzWhHrtJCqUgu`.

## 1. Configure the adapter

Edit `satnogs_adapter/config.example.yaml` or provide your own config file.

- Keep `platform.source_resolve_url` pointed at `/telemetry/sources/resolve`.
- Keep `platform.observations_batch_upsert_url` pointed at `/telemetry/sources/{source_id}/observations:batch-upsert`.
- Keep `platform.backfill_progress_url` and `platform.live_state_url` pointed at the matching source state endpoints.
- Keep `vehicle.vehicle_config_path` pointed at `vehicles/lasarsat.yaml` for the example pair.
- Set `vehicle.norad_id` to the satellite NORAD ID.
- Set `vehicle.monitoring_start_time` to the earliest observation time that should be eligible for first-run backfill.
- Set `vehicle.decoder.strategy` to the payload decoder strategy. Use `aprs` for APRS payloads such as ISS, or `kaitai` plus `vehicle.decoder.decoder_id: "lasarsat"` for LASARSAT.
- Set `satnogs.transmitter_uuid` to the SatNOGS transmitter UUID.
- Set `satnogs.status` to the observation status to ingest, normally `good`.
- Set `satnogs.upcoming_status` to the provider status used for future scheduled observations, normally `future`.
- Set `SATNOGS_API_TOKEN` if your SatNOGS deployment requires authenticated observation access.

The adapter resolves the canonical backend `source_id` from `vehicle.vehicle_config_path` during startup. Adapter configs do not carry a durable source ID or checkpoint path; after first resolution, ongoing backfill progress lives in the platform source record.

## 2. Start the service

```bash
docker compose up -d satnogs-adapter
```

The backend auto-registers known vehicle configs during startup. If the LASARSAT source already exists, the adapter receives that existing source ID and ingestion contract. If it is missing, the backend creates it through the generic vehicle source resolution path. The adapter publishes future expected contact windows to the source observation API, runs live polling, and for replay-capable sources drains a background historical backlog in chunks. Only observations matching the configured satellite, transmitter, and status are eligible for ingestion.

## 3. Runtime behavior

- One SatNOGS observation becomes one platform stream: `satnogs-obs-{observation_id}`.
- Future scheduled observations are published as source-scoped expected contact windows. Planning uses those windows to show upcoming observations; they are not a guarantee that telemetry will decode.
- Each poll starts with the filtered observations URL and follows the response `Link` header until no next link remains. Re-reading earlier results is safe because backend ingest is replay-tolerant and observation windows are keyed by source and upstream external ID.
- Observations without demoddata are skipped. Observations with `payload_demod` files are downloaded, decoded, and published.
- Only packets from the configured source callsign are accepted. Relay or digipeated traffic is dropped immediately after AX.25 decode.
- Stable fields defined in the configured vehicle file emit catalog-backed `channel_name` values.
- Other numeric decoded fields emit as discovered channels with `tags.decoder`, `tags.decoder_strategy`, `tags.field_name`, and `tags.packet_name`.
- Each emitted telemetry sample carries an increasing observation-stream sequence, so repeated same-channel packets in one observation remain distinct in history even when SatNOGS only provides one observation-level timestamp.
- LASARSAT remains discovered-only in this rollout. Upstream field names such as `psu_battery`, `uhf_trx_temp`, and `dos_mode` pass through unchanged and become backend-derived discovered channel names under the decoder namespace.
- The adapter uses `receiver_id = satnogs-station-{ground_station_id}`. Observations without a ground station id are skipped.
- Backend ingest payloads and tags do not include the transmitter UUID.

## 4. Backfill and replay

- The platform stores `monitoring_start_time`, `last_reconciled_at`, `history_mode`, `live_state`, and `backfill_state` for each source.
- When the adapter starts, it captures one startup cutoff. Backfill reconciles from `last_reconciled_at` or `monitoring_start_time` up to that cutoff, while live polling handles observations whose end time is after the cutoff.
- Live polling and backfill run at the same time. SatNOGS HTTP requests go through one shared coordinator so rate-limit and retry-after handling apply globally.
- Backfill splits work by `chunk_size_hours`, validates each returned observation against the active chunk, skips observations with malformed timestamps, and reports progress only after the whole chunk succeeds.
- If the adapter restarts during backfill, the new process supersedes the stale running target and continues from the platform checkpoint with a new startup cutoff.
- Use adapter `--mode replay-dlq` to retry batch DLQ entries after fixing an ingest or mapping issue.

DLQ files are written under `tmp/satnogs-adapter/` by default. The adapter does not write local checkpoint state.
