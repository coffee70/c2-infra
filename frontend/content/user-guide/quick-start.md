# Quick Start

**Workflow:** First-time setup → see data in the UI

Follow these steps to get the platform running and see telemetry on the Overview dashboard.

## 1. Start services

```bash
docker compose up -d
```

This starts Postgres (with TimescaleDB and pgvector), the backend API, the frontend, and the simulator. Migrations run automatically on backend startup.

## 2. Generate synthetic data

Using a virtual environment (recommended):

```bash
python3 -m venv .venv
source .venv/bin/activate   # On Windows: .venv\Scripts\activate
pip install -r scripts/requirements.txt
python scripts/generate_synthetic_telemetry.py --base-url http://localhost:8000
```

Or run the shell script (uses `.venv` if present):

```bash
./scripts/generate_synthetic_telemetry.sh
```

This creates 50+ telemetry schemas and ~50,000 time-series points with occasional anomalies.

## 3. Compute statistics

```bash
curl -X POST http://localhost:8000/telemetry/recompute-stats
```

Statistics (mean, std dev, z-score) are required for anomaly detection and state badges.

## 4. Open the Overview

1. Open http://localhost:3000
2. **Overview** (home): You'll see the watchlist of key channels with current values, state badges (Normal/Caution/Warning), sparklines, and the anomalies queue.

From here, you can [connect a live stream](/docs/connecting-streams) to see real-time updates, or [search for channels](/docs/investigating-channels) to explore.
