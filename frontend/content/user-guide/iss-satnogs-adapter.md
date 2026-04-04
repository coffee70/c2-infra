# ISS SatNOGS Adapter

**Workflow:** Register ISS source → configure adapter UUID → ingest completed SatNOGS observations

Use the SatNOGS adapter to ingest ISS AX.25/APRS telemetry from SatNOGS Network observations into the platform.

## 1. Create the ISS source

Create a vehicle source that points at the committed ISS definition file:

```bash
curl -X POST http://localhost:8000/telemetry/sources \
  -H "Content-Type: application/json" \
  -d '{
    "source_type": "vehicle",
    "name": "International Space Station",
    "telemetry_definition_path": "vehicles/iss.yaml"
  }'
```

Save the returned `id`. That backend UUID is the canonical `source_id` for all adapter ingest.

## 2. Configure the adapter

Edit `satnogs_adapter/config.example.yaml` or provide your own config file.

- Set `platform.source_id` to the UUID returned by the backend.
- Keep `vehicle.telemetry_definition_path` pointed at `vehicles/iss.yaml`.
- Set `SATNOGS_API_TOKEN` if your SatNOGS deployment requires authenticated observation access.

`iss` is only the human-readable vehicle slug. The adapter publishes the backend UUID.

## 3. Start the service

```bash
docker compose up -d satnogs-adapter
```

The adapter polls recent SatNOGS observations for NORAD `25544`. Only completed or otherwise artifact-available observations are eligible for ingestion.

## 4. Runtime behavior

- One SatNOGS observation becomes one platform stream: `satnogs-obs-{observation_id}`.
- Only ISS-originated packets are accepted. Relay or digipeated traffic is dropped immediately after AX.25 decode.
- Stable fields defined in `vehicles/iss.yaml` emit catalog-backed `channel_name` values.
- Other numeric APRS fields emit as discovered channels using `tags.decoder=aprs` and `tags.field_name`.
- The adapter uses `receiver_id = satnogs-station-{ground_station_id}`. Observations without a ground station id are skipped.

## 5. Backfill and replay

- Use adapter `--mode backfill` only for bounded historical recovery windows.
- Use adapter `--mode replay-dlq` to retry batch DLQ entries after fixing an ingest or mapping issue.

DLQ and checkpoints are written under `tmp/satnogs-adapter/` by default.
