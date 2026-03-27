# Connecting a Telemetry Stream

**Workflow:** No live data → live stream → Live badge on Overview

Once you have historical data or synthetic data loaded, you can connect a real-time telemetry stream. When a stream is active, the Overview shows a green **Live** badge and updates in real time.

## Option A: In-app Simulator

1. Go to the **Sources** page (nav link). The page lists Vehicles and Simulators. Add a simulator with **Add source** → choose **Simulator** → enter a name, a telemetry definition path (for example `simulators/drogonsat.yaml`), and a Base URL (for example `http://simulator:8001`). The server uses the definition file to seed the expected channel catalog and uses the Base URL to reach the simulator.
2. Click **Manage** on a simulator to open its control panel on a dedicated page. The panel shows a connection pill (green when reachable, red when disconnected) and runtime state (Idle, Running, Paused) with elapsed time.
3. Choose a scenario:
   - **Nominal** — normal operation
   - **Power sag** — voltage anomalies
   - **Thermal runaway** — temperature excursions
   - **Comm dropout** — communications issues
   - **Safe mode** — vehicle enters safe mode
   - **Orbit nominal** — smooth physically plausible orbit for globe testing
   - **Orbit decay / highly elliptical / suborbital / escape** — explicit orbit-analysis test presets
4. Adjust duration, speed, dropout, and jitter if desired.
5. Click **Start**.

The simulator posts to the ingest API; the Overview will show live updates and the **Live** badge when connected. Position mapping is now seeded from the telemetry definition file, so built-in simulators are ready for the Planning globe without a separate mapping step. `DrogonSat` emits GPS/LLA position channels, while `RhaegalSat` emits ECEF XYZ channels. Nominal orbit scenarios keep motion smooth by default, while orbit-analysis edge cases come from the explicit orbit presets—see [Monitoring the Overview](/docs/monitoring-overview#workflow-simulator-on-the-planning-globe).

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

The streamer posts to `POST /telemetry/realtime/ingest` with the built-in mock vehicle source id. Its telemetry catalog also comes from a committed definition file, so the backend and streamer agree on the expected channels.

If an external decoder or payload stream emits a field that is not in the seeded catalog, the backend now creates a source-scoped **discovered** channel instead of dropping the sample. When the producer sends structured decoder tags such as `decoder=APRS` and `field_name=Payload Temp`, the stored channel name is derived into a stable namespace like `decoder.aprs.payload_temp`.

Some external decoders only know when a packet was heard, not when it was generated onboard. Those streams may send `reception_time` without `generation_time`; the backend will synthesize `generation_time = reception_time` so the packet still flows through realtime ingest. For those packets, ordering and freshness are reception-based.

For catalog-backed telemetry, the definition file can now carry **channel aliases**. This lets external producers keep sending names such as `BAT_V`, `BATTERY_VOLT`, or `VBAT` while the platform resolves them to one canonical channel like `PWR_MAIN_BUS_VOLT`. Alias matching is source-scoped, and stored watchlists, position mappings, alerts, and history still use the canonical channel name after resolution.

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
