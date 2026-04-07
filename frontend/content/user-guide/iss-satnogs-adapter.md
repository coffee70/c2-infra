# ISS SatNOGS Adapter

**Workflow:** Start backend → start adapter → ingest completed SatNOGS observations

Use the SatNOGS adapter to ingest ISS AX.25/APRS telemetry from SatNOGS Network observations into the platform.

## 1. Configure the adapter

Edit `satnogs_adapter/config.example.yaml` or provide your own config file.

- Keep `platform.source_resolve_url` pointed at `/telemetry/sources/resolve`.
- Keep `vehicle.vehicle_config_path` pointed at `vehicles/iss.yaml`.
- Set `SATNOGS_API_TOKEN` if your SatNOGS deployment requires authenticated observation access.

The adapter resolves the canonical backend `source_id` from `vehicle.vehicle_config_path` during startup. `platform.source_id` is still supported as an advanced override for testing or debugging, but it is normally omitted.

## 2. Start the service

```bash
docker compose up -d satnogs-adapter
```

The backend auto-registers known vehicle configs during startup. If the ISS source already exists, the adapter receives that existing source ID. If it is missing, the backend creates it through the generic vehicle source resolution path. The adapter then polls recent SatNOGS observations for NORAD `25544`. Only completed or otherwise artifact-available observations are eligible for ingestion.

## 3. Runtime behavior

- One SatNOGS observation becomes one platform stream: `satnogs-obs-{observation_id}`.
- Only ISS-originated packets are accepted. Relay or digipeated traffic is dropped immediately after AX.25 decode.
- Stable fields defined in `vehicles/iss.yaml` emit catalog-backed `channel_name` values.
- Other numeric APRS fields emit as discovered channels using `tags.decoder=aprs` and `tags.field_name`.
- The adapter uses `receiver_id = satnogs-station-{ground_station_id}`. Observations without a ground station id are skipped.

## 4. Backfill and replay

- Use adapter `--mode backfill` only for bounded historical recovery windows.
- Use adapter `--mode replay-dlq` to retry batch DLQ entries after fixing an ingest or mapping issue.

DLQ and checkpoints are written under `tmp/satnogs-adapter/` by default.
