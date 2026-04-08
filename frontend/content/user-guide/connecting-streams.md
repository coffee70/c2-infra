# Connecting a Telemetry Stream

**Workflow:** No live data → live stream → Live badge on Overview

Once you have historical data or synthetic data loaded, you can connect a real-time telemetry stream. When a stream is active, the Overview shows a green **Live** badge and updates in real time.

By default, live Overview and watchlist subscriptions stay **source-scoped**: if a source rolls from one stream to the next, the live UI follows the current stream automatically. Use an explicit stream selection only when you intentionally want a pinned historical or per-run view.

## Option A: In-app Simulator

1. Go to the **Sources** page (nav link). The page lists Vehicles and Simulators. Add a simulator with **Add source** → choose **Simulator** → enter a name, a vehicle configuration path (for example `simulators/drogonsat.yaml`), and a Base URL (for example `http://simulator:8001`). The server uses the vehicle configuration file to seed the expected channel catalog and uses the Base URL to reach the simulator.
2. Use **Vehicle Configurations** from the Sources page when you need to inspect or edit the backing YAML/JSON files directly. The page now opens as a full workspace: an explorer on the left mirrors the folder structure under `VEHICLE_CONFIGURATION_PATH`, the editor fills the right side, and the divider can be dragged wider or narrower.
3. Click **Manage** on a simulator to open its control panel on a dedicated page. The panel shows a connection pill (green when reachable, red when disconnected) and runtime state (Idle, Running, Paused) with elapsed time.
4. Choose a scenario:
   - **Nominal** — normal operation
   - **Power sag** — voltage anomalies
   - **Thermal runaway** — temperature excursions
   - **Comm dropout** — communications issues
   - **Safe mode** — vehicle enters safe mode
   - **Orbit nominal** — smooth physically plausible orbit for globe testing
   - **Orbit decay / highly elliptical / suborbital / escape** — explicit orbit-analysis test presets
5. Adjust duration, speed, dropout, and jitter if desired.
6. Click **Start**.

The simulator posts to the ingest API; the Overview will show live updates and the **Live** badge when connected. Position mapping is seeded from the vehicle configuration file, so simulator sources with mappings are ready for the Planning globe without a separate mapping step. `DrogonSat` emits GPS/LLA position channels, while `RhaegalSat` emits ECEF XYZ channels. Nominal orbit scenarios keep motion smooth by default, while orbit-analysis edge cases come from the explicit orbit presets—see [Monitoring the Overview](/docs/monitoring-overview#workflow-simulator-on-the-planning-globe).

## Option B: External Mock Streamer

Run the mock vehicle streamer from the command line:

```bash
./scripts/mock_vehicle_streamer.sh --scenario nominal --duration 120
```

With anomalies:

```bash
./scripts/mock_vehicle_streamer.sh --scenario power_sag --speed 10
./scripts/mock_vehicle_streamer.sh --scenario thermal_runaway --duration 90
```

The streamer posts to `POST /telemetry/realtime/ingest` with a registered source id. Its telemetry catalog also comes from a committed vehicle configuration file, so the backend and streamer agree on the expected channels.

## Option C: SatNOGS Adapter

Use the SatNOGS adapter when you want a real external packet-radio feed instead of simulator traffic.

1. Start the backend so it can auto-register vehicle configuration files.
2. Keep the adapter config pointed at `platform.source_resolve_url` and `platform.observations_batch_upsert_url`, then set `vehicle.vehicle_config_path: "vehicles/lasarsat.yaml"`, `vehicle.norad_id: 62391`, `satnogs.transmitter_uuid: "C3RnLSSuaKzWhHrtJCqUgu"`, and `satnogs.status: "good"`.
3. Start the compose-managed `satnogs-adapter` service.
4. The adapter resolves the canonical backend vehicle source, publishes upcoming observation windows for Planning, polls SatNOGS observations for the configured satellite/transmitter/status using `Link` header pagination, maps one completed observation to one stream, and posts numeric telemetry events to realtime ingest without exposing transmitter UUID in backend payloads.

The detailed workflow lives in [SatNOGS Adapter](/docs/satnogs-adapter).

If an external decoder or payload stream emits a field that is not in the seeded catalog, the backend now creates a source-scoped **discovered** channel instead of dropping the sample. When the producer sends structured decoder tags such as `decoder=APRS` and `field_name=Payload Temp`, the stored channel name is derived into a stable namespace like `decoder.aprs.payload_temp`.

Some external decoders only know when a packet was heard, not when it was generated onboard. Those streams may send `reception_time` without `generation_time`; the backend will synthesize `generation_time = reception_time` so the packet still flows through realtime ingest. For those packets, ordering and freshness are reception-based.

For catalog-backed telemetry, the vehicle configuration file can now carry **channel aliases**. This lets external producers keep sending names such as `BAT_V`, `BATTERY_VOLT`, or `VBAT` while the platform resolves them to one canonical channel like `PWR_MAIN_BUS_VOLT`. Alias matching is source-scoped, and stored watchlists, position mappings, alerts, and history still use the canonical channel name after resolution.

## Data Flow

```
Streamer (Simulator or mock_vehicle_streamer)
    → POST /telemetry/realtime/ingest
    → Realtime bus
    → WebSocket hub
    → Frontend (Overview, watchlist, etc.)
```

## When to Use Each

- **In-app Simulator:** Quick demos, testing scenarios, UI development.
- **External streamer:** Longer runs, CI/CD, automated tests, or when you want to simulate multiple sources from different processes.
