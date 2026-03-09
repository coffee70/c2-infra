# Changelog

All notable changes to the Telemetry Operations Platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Constellation: Sources tab and multi-sim support**
  - **Sources** tab (replaces Simulator): lists Vehicles and Simulators in separate sections
  - Add-source wizard: add simulators with name and Base URL (server-reachable URL)
  - Edit simulators: update name and Base URL from the Sources page
  - Overview source selector grouped by **Vehicles** and **Simulators**
  - Per-simulator backend proxy: all simulator routes require `source_id` and resolve URL from DB
  - Two simulator containers (`simulator`, `simulator2`) in docker-compose for testing multi-sim
- Simulator dual status: connection (reachable vs disconnected) and runtime state (idle/running/paused)
  - Sources page (Manage panel): connection pill, Status card shows state and elapsed time; faster status polling (~2 s) and client-side elapsed tick
  - Overview: when selected source is a simulator, Context Banner shows simulator connection pill and runtime state (Running, Paused, Idle)
- Unified simulator status endpoint (`GET /simulator/status?source_id=...`): always returns 200 with `connected` and optional `state`/`config`/`sim_elapsed`; no 503 when simulator is unreachable
- Stronger audit logs for simulator start flow to trace requests end-to-end:
  - `simulator.start.received` (backend): backend received start request from frontend
  - `simulator.start.proxied` (backend): backend successfully forwarded to simulator
  - `simulator.start.proxy_failed` (backend): backend failed to reach simulator
  - `simulator.start.received` (simulator): simulator received start from backend
  - `simulator.start.handled` (simulator): simulator started streamer
  - `ingest.sent` (simulator): simulator sent telemetry batch to backend
  - `ingest.received` (backend): backend received telemetry from external source
  - `simulator.status.fetched` (frontend): frontend got updated status (on state change)
  - `simulator.start.sent` (frontend): frontend sent start request
- Structured audit logging across backend, simulator, and frontend for auditing and debugging
  - Backend: JSON logs to stdout for API requests, ingest, watchlist, alerts, schema, stats, simulator proxy
  - Simulator: JSON logs for start/pause/resume/stop, ingest batches, streamer state
  - Frontend: Console logs (dev or `NEXT_PUBLIC_AUDIT_LOG=true`) for user actions: simulator controls, watchlist, ack/resolve, search
- In-app user documentation at `/docs` with workflow-focused guides

### Changed

- **Configure watchlist modal:** Clearer structure (description, section counts), error and success feedback (Alert for errors, loading on remove, brief "Added" state after add), icon remove button with aria-label, primary Done button in footer, slightly wider modal (max-w-lg), and accessibility improvements (DialogDescription, section headings).
- **Context banner alerts:** On Overview, the Alerts count in the context banner is clickable: it scrolls to the Events Console. A dropdown on the count shows a short preview of active alerts (subsystem and channel) with a "View all in Events Console" action.
- **Simulator status display:** Overview context banner, Sources page (Simulators list), and Manage simulator panel now show a single status badge per simulator (Disconnected, Running, Paused, or Idle) with consistent semantic colors instead of separate connection and run-state indicators. Context banner "Simulator:" label styling aligned with Feed and Alerts.
- Overview source selection now persists when navigating away and back (via URL `?source=` and sessionStorage so the nav Overview link restores your last selection).

- **Simulator** nav link renamed to **Sources**; `/simulator` redirects to `/sources`
- Simulator API: all routes (`/status`, `/start`, `/pause`, `/resume`, `/stop`) now require `source_id` query or body param; URL resolved from DB per source
- Docs page: sticky side nav, centered article content

### Fixed

- Trend Analysis "no data" when Overview has sparkline: recent endpoint now falls back to most recent points when the requested time range yields no data; range selector (15m, 1h, 6h, 24h, Custom) now stays visible so users can try different time ranges
- Telemetry channel detail 404 for simulator sources: summary and explain endpoints now compute statistics on-the-fly when missing (e.g. new simulator sources that have data but no precomputed stats)
- Feed status: API now exposes three-state `state` (connected/degraded/disconnected) so the context banner can show "No data" when a previously active source goes silent for >60s instead of staying "Degraded"
- Removed unused `.cursor` volume mounts from backend and simulator in docker-compose
- Overview default source set to `"default"` so the dashboard shows data after Quick Start (telemetry and backend APIs use `source_id=default` when none is provided)
- Simulator ingest timeout: backend ingest endpoint now async (avoids thread pool contention), bus uses dedicated processor pool, simulator uses HTTP session with retries and separate connect/read timeouts
- Changelog and agent rule for keeping docs up to date
