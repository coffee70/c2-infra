# Connecting a Telemetry Stream

**Workflow:** No live data → live stream → Live badge on Overview

Once you have historical data or synthetic data loaded, you can connect a real-time telemetry stream. When a stream is active, the Overview shows a green **Live** badge and updates in real time.

## Option A: In-app Simulator

1. Go to the **Simulator** page (nav link).
2. Choose a scenario:
   - **Nominal** — normal operation
   - **Power sag** — voltage anomalies
   - **Thermal runaway** — temperature excursions
   - **Comm dropout** — communications issues
   - **Safe mode** — vehicle enters safe mode
3. Adjust duration, speed, dropout, and jitter if desired.
4. Click **Start**.

The simulator posts to the ingest API; the Overview will show live updates and the **Live** badge when connected.

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
