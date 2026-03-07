# Changelog

All notable changes to the Telemetry Operations Platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

- Docs page: sticky side nav, centered article content

### Fixed

- Feed status: API now exposes three-state `state` (connected/degraded/disconnected) so the context banner can show "No data" when a previously active source goes silent for >60s instead of staying "Degraded"
- Removed unused `.cursor` volume mounts from backend and simulator in docker-compose
- Overview default source set to `"default"` so the dashboard shows data after Quick Start (telemetry and backend APIs use `source_id=default` when none is provided)
- Simulator ingest timeout: backend ingest endpoint now async (avoids thread pool contention), bus uses dedicated processor pool, simulator uses HTTP session with retries and separate connect/read timeouts
- Changelog and agent rule for keeping docs up to date
