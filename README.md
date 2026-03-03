# Telemetry Operations Platform

A **spacecraft telemetry monitoring and analysis platform** for mission operations. Ingest telemetry from power, thermal, ADCS, communications, and other subsystems; visualize trends and anomalies in real time; and get AI-powered explanations that help operators understand what each channel means and why values might be out of range.

## What It Does

- **Ingests & stores** telemetry schemas and time-series data (historical and real-time)
- **Computes statistics** (mean, std dev, z-score) and detects anomalies (Normal/Caution/Warning)
- **Semantic search** — find channels by meaning (e.g., "voltage", "temperature") instead of exact names
- **LLM explanations** — contextual, human-readable summaries of each channel and its current state
- **Live dashboard** — watchlist of key channels with sparklines, state badges, and an anomalies queue
- **Real-time streaming** — WebSocket support for live telemetry and alerts with Ack/Resolve workflows
- **Simulator** — mock vehicle streamer with scenarios (nominal, power sag, thermal runaway, etc.) for testing

Designed for spacecraft ground operations, mission control dashboards, and teams that need to monitor and interpret large numbers of telemetry channels with AI-assisted context.

## Architecture

- **Backend**: FastAPI (Python 3.11+), SQLAlchemy 2.0, sentence-transformers, NumPy/Pandas
- **Database**: PostgreSQL with TimescaleDB and pgvector extensions
- **Frontend**: Next.js 16, React Server Components, Shadcn UI, Recharts

## Prerequisites

- Docker and Docker Compose
- (Optional) OpenAI API key for real LLM explanations; mock provider used otherwise

## Quick Start

### 1. Start services

```bash
docker compose up -d
```

This starts:
- **Postgres** (port 5432) with TimescaleDB and pgvector
- **Backend** (port 8000) — FastAPI telemetry API
- **Frontend** (port 3000) — Next.js dashboard
- **Simulator** (port 8001) — mock vehicle streamer for testing scenarios

Migrations run automatically on backend startup.

### 2. Generate synthetic data

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

### 3. Compute statistics

```bash
curl -X POST http://localhost:8000/telemetry/recompute-stats
```

### 4. Use the UI

1. Open http://localhost:3000
2. **Overview** (home): Watchlist of key channels (power, thermal, ADCS, comms) with current values, state badges, sparklines, and anomalies queue
3. **Search**: Find telemetry by semantic search (e.g., "voltage", "temperature", "speed")
4. **Simulator**: Start/stop mock vehicle streams with configurable scenarios (nominal, power sag, thermal runaway, etc.)
5. Click a channel to view stats, trend chart, z-score, and LLM explanation

### 5. Realtime streaming (optional)

Start the mock vehicle streamer to see live telemetry and alerts:

```bash
./scripts/mock_vehicle_streamer.sh --scenario nominal --duration 120
```

Or with anomalies:

```bash
./scripts/mock_vehicle_streamer.sh --scenario power_sag --speed 10
./scripts/mock_vehicle_streamer.sh --scenario thermal_runaway --duration 90
```

The Overview page will show live updates (green "Live" badge when connected). The Events Console supports Ack and Resolve for alerts.

## API Reference

### POST /telemetry/schema

Create telemetry metadata with semantic embedding.

```bash
curl -X POST http://localhost:8000/telemetry/schema \
  -H "Content-Type: application/json" \
  -d '{"name": "PWR_BUS_A_VOLT", "units": "V", "description": "Power bus A voltage"}'
```

Response:
```json
{"status": "created", "telemetry_id": "<uuid>"}
```

### POST /telemetry/realtime/ingest

Ingest realtime measurement events (batch).

```bash
curl -X POST http://localhost:8000/telemetry/realtime/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {"source_id": "vehicle1", "channel_name": "PWR_BUS_A_VOLT", "generation_time": "2025-03-02T12:00:00Z", "value": 28.3}
    ]
  }'
```

### WebSocket /telemetry/realtime/ws

Subscribe to live telemetry and alerts. Client messages: `subscribe_watchlist`, `subscribe_alerts`, `ack_alert`, `resolve_alert`.

### POST /telemetry/data

Ingest time-series data.

```bash
curl -X POST http://localhost:8000/telemetry/data \
  -H "Content-Type: application/json" \
  -d '{
    "telemetry_name": "PWR_BUS_A_VOLT",
    "data": [
      {"timestamp": "2025-03-02T12:00:00Z", "value": 28.3},
      {"timestamp": "2025-03-02T12:01:00Z", "value": 28.1}
    ]
  }'
```

Response:
```json
{"rows_inserted": 2}
```

### POST /telemetry/recompute-stats

Recompute statistics for all telemetry points.

```bash
curl -X POST http://localhost:8000/telemetry/recompute-stats
```

Response:
```json
{"telemetry_processed": 50}
```

### GET /telemetry/search?q=

Semantic search over telemetry.

```bash
curl "http://localhost:8000/telemetry/search?q=voltage"
```

Response:
```json
{
  "results": [
    {"name": "PWR_BUS_A_VOLT", "similarity_score": 0.85},
    {"name": "PWR_BUS_B_VOLT", "similarity_score": 0.82}
  ]
}
```

### GET /telemetry/{name}/explain

Get full explanation with stats, z-score, and LLM response.

```bash
curl "http://localhost:8000/telemetry/PWR_BUS_A_VOLT/explain"
```

Response:
```json
{
  "name": "PWR_BUS_A_VOLT",
  "description": "Power bus A voltage",
  "statistics": {"mean": 28.0, "std_dev": 0.5, ...},
  "recent_value": 28.3,
  "z_score": 0.6,
  "is_anomalous": false,
  "llm_explanation": "..."
}
```

### GET /telemetry/{name}/recent?limit=100

Get recent data points for charting.

```bash
curl "http://localhost:8000/telemetry/PWR_BUS_A_VOLT/recent?limit=100"
```

### GET /telemetry/overview

Get overview data for watchlist channels (current value, state, sparkline data).

```bash
curl "http://localhost:8000/telemetry/overview"
```

### GET /telemetry/anomalies

Get all anomalous channels grouped by subsystem (power, thermal, adcs, comms).

```bash
curl "http://localhost:8000/telemetry/anomalies"
```

### GET /telemetry/watchlist

List watchlist entries.

```bash
curl "http://localhost:8000/telemetry/watchlist"
```

### POST /telemetry/watchlist

Add a channel to the watchlist.

```bash
curl -X POST "http://localhost:8000/telemetry/watchlist" \
  -H "Content-Type: application/json" \
  -d '{"telemetry_name": "PWR_BUS_A_VOLT"}'
```

## Test Sequence

1. `docker compose up -d`
2. Wait for backend to be healthy (migrations complete)
3. `python scripts/generate_synthetic_telemetry.py` (creates schemas, data, and seeds default watchlist)
4. `curl -X POST http://localhost:8000/telemetry/recompute-stats`
5. Open http://localhost:3000 → Overview dashboard with watchlist cards and anomalies queue
6. Search in UI: "voltage" → should return PWR_* telemetry
7. Click a channel → verify stats table, chart, state badge (Normal/Caution/Warning), explanation
8. Edit watchlist via "Edit watchlist" button on Overview

## Configuration

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `OPENAI_API_KEY` | OpenAI API key (optional; mock used if empty) |
| `OPENAI_BASE_URL` | Custom API base (e.g., Ollama) |
| `NEXT_PUBLIC_API_URL` | Backend URL for frontend (default: http://localhost:8000) |

## Project Structure

```
c2-infra/
├── backend/           # FastAPI telemetry API
│   ├── app/
│   │   ├── models/    # SQLAlchemy models, Pydantic schemas
│   │   ├── routes/    # API endpoints (telemetry, realtime, simulator)
│   │   ├── services/  # Business logic (stats, embeddings, LLM)
│   │   └── interfaces/  # Embedding/LLM provider abstractions
│   └── migrations/
├── frontend/          # Next.js dashboard (Overview, Search, Simulator)
├── simulator/        # Mock vehicle streamer (scenarios, ingest)
├── scripts/
│   ├── init-db.sql    # Postgres extensions (TimescaleDB, pgvector)
│   └── generate_synthetic_telemetry.py
└── docker-compose.yml
```
