# SatNOGS Adapter

**Workflow:** Start backend → start adapter → ingest completed SatNOGS observations

Use the SatNOGS adapter to ingest AX.25 telemetry from one SatNOGS satellite/transmitter pair into the platform. The example config uses LASARSAT NORAD `62391` with transmitter UUID `C3RnLSSuaKzWhHrtJCqUgu`.

## 1. Configure the adapter

Edit `satnogs_adapter/config.example.yaml` or provide your own config file.

- Keep `platform.source_resolve_url` pointed at `/telemetry/sources/resolve`.
- Keep `vehicle.vehicle_config_path` pointed at `vehicles/lasarsat.yaml` for the example pair.
- Set `vehicle.norad_id` to the satellite NORAD ID.
- Set `satnogs.transmitter_uuid` to the SatNOGS transmitter UUID.
- Set `satnogs.status` to the observation status to ingest, normally `good`.
- Set `SATNOGS_API_TOKEN` if your SatNOGS deployment requires authenticated observation access.

The adapter resolves the canonical backend `source_id` from `vehicle.vehicle_config_path` during startup. `platform.source_id` is still supported as an advanced override for testing or debugging, but it is normally omitted.

## 2. Start the service

```bash
docker compose up -d satnogs-adapter
```

The backend auto-registers known vehicle configs during startup. If the LASARSAT source already exists, the adapter receives that existing source ID. If it is missing, the backend creates it through the generic vehicle source resolution path. The adapter then polls recent SatNOGS observations using `satellite__norad_cat_id`, `transmitter_uuid`, and `status`, and follows SatNOGS `Link` headers for pagination. Only observations matching the configured satellite, transmitter, and status are eligible for ingestion.

## 3. Runtime behavior

- One SatNOGS observation becomes one platform stream: `satnogs-obs-{observation_id}`.
- Each poll starts with the filtered observations URL and follows the response `Link` header until no next link remains. Re-reading earlier results is safe because processed observations are checkpointed by SatNOGS observation ID.
- Observations without demoddata are skipped. Observations with `payload_demod` files are downloaded, decoded, and published.
- Only packets from the configured source callsign are accepted. Relay or digipeated traffic is dropped immediately after AX.25 decode.
- Stable fields defined in the configured vehicle file emit catalog-backed `channel_name` values.
- Other numeric APRS fields emit as discovered channels using `tags.decoder=aprs` and `tags.field_name`.
- The adapter uses `receiver_id = satnogs-station-{ground_station_id}`. Observations without a ground station id are skipped.
- Backend ingest payloads and tags do not include the transmitter UUID.

## 4. Backfill and replay

- Use adapter `--mode backfill` only for bounded historical recovery windows.
- Use adapter `--mode replay-dlq` to retry batch DLQ entries after fixing an ingest or mapping issue.

DLQ and checkpoints are written under `tmp/satnogs-adapter/` by default.
