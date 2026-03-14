# Connecting a Telemetry Stream

**Workflow:** No live data → live stream → Live badge on Overview

Once you have historical data or synthetic data loaded, you can connect a real-time telemetry stream. When a stream is active, the Overview shows a green **Live** badge and updates in real time.

## Option A: In-app Simulator

1. Go to the **Sources** page (nav link). The page lists Vehicles and Simulators. Add a simulator with **Add source** → choose **Simulator** → enter a name and Base URL (e.g. `http://simulator:8001`). The server uses this URL to reach the simulator.
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

The simulator posts to the ingest API; the Overview will show live updates and the **Live** badge when connected. To see the simulator’s position and trail on the 3D globe, go to the **Planning** tab, add the simulator to **Show on globe**, and configure **Position mapping** (frame and channels, e.g. GPS LLA with `GPS_LAT`, `GPS_LON`, `GPS_ALT`) for that source. Nominal orbit scenarios now keep GPS motion smooth by default, while orbit-analysis edge cases come from the explicit orbit presets—see [Monitoring the Overview](/docs/monitoring-overview#workflow-simulator-on-the-planning-globe).

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

The streamer posts to `POST /telemetry/realtime/ingest` with `source_id=mock_vehicle`

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
