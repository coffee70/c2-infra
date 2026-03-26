# Changelog

All notable changes to the Telemetry Operations Platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Dynamic telemetry channel discovery** — Realtime ingest now creates durable source-scoped `discovered` channels for unknown live fields instead of dropping them. Decoder-tagged payloads can derive stable names such as `decoder.aprs.payload_temp`, and those channels now appear in source-scoped lists, search, summaries, and watchlist configuration.
- **Per-source telemetry definition files** — Vehicles and simulators now register with a JSON or YAML `telemetry_definition_path`. The backend validates the file, seeds that source’s telemetry catalog automatically, and seeds any inline position mapping so the system knows which channels to expect before the source goes live.
- **Built-in source catalog refresh** — The local stack now ships with four named built-ins backed by fixed UUID source IDs: `Aegon Relay`, `Balerion Surveyor`, `DrogonSat`, and `RhaegalSat`.
- **Simulator orbit anomaly presets** — The simulator now includes explicit `orbit_nominal`, `orbit_decay`, `orbit_highly_elliptical`, `orbit_suborbital`, and `orbit_escape` scenarios so operators can drive Planning and orbit-analysis workflows with intentional trajectory cases instead of random GPS corruption.
- **Real-time orbit validation** — Backend orbit validation for sources with an active position channel mapping. Assembles position from GPS/LLA (or ECEF) channels, computes orbital parameters (perigee, apogee, eccentricity, velocity), classifies LEO/MEO/GEO, and detects anomalies (escape trajectory, suborbital, orbit decay, highly elliptical LEO). Status is exposed via `GET /telemetry/orbit/status` and broadcast over WebSocket (`orbit_status`) when status changes.
- **Planning page orbit status and anomaly banner** — For sources with a position mapping that are shown on the globe, the left panel shows orbit status (VALID/LEO nominal or anomaly type). When any visible source has an orbit anomaly, a prominent alert banner appears in the left panel with source name and reason. Status updates in real time via WebSocket.
- **Overview orbit anomalies** — Orbit anomalies appear in the Event Console under an **Orbit** subsection (source name, reason, link to Planning) and are included in the Context Banner alert count and dropdown summary so operators see orbit issues alongside telemetry alerts.
- **OpenStatus time picker:** Custom date/time selection (History custom start, Trend Analysis custom range) now uses the [OpenStatus time-picker](https://github.com/openstatusHQ/time-picker) for time input: keyboard navigation, arrow keys, and consistent styling instead of the browser default.

- **Source and run hierarchy:** A **source** is a vehicle or simulator (from the source list). Each source can have multiple **runs** (one execution). The **Context Banner** is the only place to change source; it lists only sources (no runs). URL and banner use source id only (`?source=...`). Overview and Telemetry Detail resolve the source’s **current run** (newest) for data. The **History** tab has a **Run** dropdown scoped to the selected source so you can narrow the table to a specific run (e.g. "Run started at 2026-03-11 19:03 UTC").
- **Simulator run id per source:** When you start a simulator with a registered source id (e.g. from Sources → Manage → Start), the simulator creates a run id `{source_id}-{timestamp}` so runs are tied to that source.
- **Backend:** `GET /telemetry/{name}/runs?source_id=...` returns runs for a source that have data for that channel; `GET /telemetry/sources/{source_id}/runs` returns runs for a source (any channel). Used for Run dropdown and to resolve current run.
- **Search Telemetry source filter:** On the Search page, a **Source** dropdown in Filters lets you restrict search to a specific vehicle or simulator; results and current values are scoped to that source. The selected source is reflected in the URL (`/search?source=...`) for sharing.
- Telemetry detail page vertical layout with **Summary**, **Live & Trends**, **History**, and **Explanation & Events** sections, so operators can focus on summary, live behavior, history, or context without excessive scrolling.
- Per-channel **Telemetry History** tab backed by `/telemetry/{name}/recent` with time-range presets, UTC/local toggle, filter, table copy, and export of the visible range to CSV, JSON, and a Parquet-ready text stub for offline and agent-driven analysis.
- **Planning** page and nav tab with full-screen 3D Earth view and source selector; use the Planning tab for globe-based position visualization (Overview is data-only).
- 3D Earth visualization and position mapping
  - Backend `PositionChannelMapping` model, coordinate helpers, and `/telemetry/position/*` APIs to expose latest per-source positions in a canonical latitude/longitude/altitude form.
  - Frontend Earth view on the **Planning** page: full-viewport globe with overlay source selector, live/stale indication, and **position history trail** (recent path per source as a polyline in addition to the current position point).
  - Operator-facing **Position mapping** UI on the Planning page (overlay control) to configure which telemetry channels (e.g. `GPS_LAT`/`GPS_LON`/`GPS_ALT` or XYZ) should be treated as position for each source.
- **Constellation: Sources tab and multi-sim support**
  - **Sources** tab (replaces Simulator): lists Vehicles and Simulators in separate sections
  - Add-source wizard: add vehicles or simulators with a telemetry definition path; simulators also include a Base URL (server-reachable URL)
  - Edit sources: update name, Base URL, and telemetry definition path from the Sources page
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

- Built-in simulators are now distinct spacecraft instead of duplicate feeds. `DrogonSat` is a lighter GPS/LLA bus with fewer computers and a single propulsion tank; `RhaegalSat` is a heavier ECEF bus with multiple OBC temperature points, dual tanks, and a larger payload/comms set.
- Telemetry detail navigation is now **source-first** across the stack. Channel detail pages use `/sources/{source_id}/telemetry/{channel_name}`, watchlists are scoped per source, and channel catalogs/search/filtering now only expose channels that belong to the selected source.
- App bar navigation now treats Docs as a right-side help icon instead of a primary tab, aligning documentation access with other utility actions like keyboard shortcuts.
- **Simulator nominal orbit telemetry** — Nominal `GPS_LAT`, `GPS_LON`, and `GPS_ALT` now come from a bounded continuous orbit perturbation model, so default Planning globe tracks stay smooth and physically plausible instead of picking up one-sample anomaly spikes.
- **Cesium static assets:** No longer committed; `frontend/public/cesium` is in `.gitignore` and is copied from `node_modules/cesium/Build/Cesium` at build time (`prebuild` / `predev` script). Removes 392+ vendored files from the repo and keeps assets in sync with the installed `cesium` package. If your branch already had these files tracked, run `git rm -r --cached frontend/public/cesium` once.
- **CORS:** Allowed origins are configurable via the `CORS_ORIGINS` environment variable (comma-separated list). Default is `http://localhost:3000,http://127.0.0.1:3000` for local development; set to your frontend URL(s) when deploying (e.g. `https://app.example.com`).
- **Simulator GPS telemetry:** Simulator now emits orbit-driven position for `GPS_LAT`, `GPS_LON`, and `GPS_ALT` (simple circular LEO model) so the Planning Earth view shows a time-varying trajectory instead of random noise.
- Overview reverted to a data-only layout: watchlist, feed health, anomalies, and Event Console only; no Earth on Overview (use the **Planning** tab for the full-screen 3D Earth view).
- **Position mapping** moved from Overview to Planning and merged into the Earth view card: a single **left-side card** on Planning (“Earth view”) now includes source visibility, live/stale indicator, and per-source position mapping—no separate modal or button.
- **Planning Earth view card UX:** “Show on globe” is a multi-select dropdown (no per-source checkboxes). “Position mapping” is a per-source list with expandable rows; you can configure frame and channels for any source independently of whether it’s currently shown on the globe.
- **Configure watchlist modal:** Clearer structure (description, section counts), error and success feedback (Alert for errors, loading on remove, brief "Added" state after add), icon remove button with aria-label, primary Done button in footer, slightly wider modal (max-w-lg), and accessibility improvements (DialogDescription, section headings).
- **Context banner alerts:** On Overview, the Alerts count in the context banner is clickable: it scrolls to the Events Console. A dropdown on the count shows a short preview of active alerts (subsystem and channel) with a "View all in Events Console" action.
- **Simulator status display:** Overview context banner, Sources page (Simulators list), and Manage simulator panel now show a single status badge per simulator (Disconnected, Running, Paused, or Idle) with consistent semantic colors instead of separate connection and run-state indicators. Context banner "Simulator:" label styling aligned with Feed and Alerts.
- Overview source selection now persists when navigating away and back (via URL `?source=` and sessionStorage so the nav Overview link restores your last selection).
- Planning "Show on globe" selection now persists when navigating away and back (sessionStorage key `planningShowOnGlobeIds`).

- **Simulator** nav link renamed to **Sources**; `/simulator` redirects to `/sources`
- Simulator API: all routes (`/status`, `/start`, `/pause`, `/resume`, `/stop`) now require `source_id` query or body param; URL resolved from DB per source
- Docs page: sticky side nav, centered article content

### Fixed

- **Search and watchlist access for runtime-discovered channels** — Newly discovered live fields are now searchable from Overview and visible in watchlist/source pickers with a `Discovered` badge, so operators can inspect and pin dynamic payload telemetry without waiting for a catalog update.
- **Cross-source watchlist adds** — Adding the same channel name to different sources now persists correctly. A leftover legacy unique index on `watchlist.telemetry_name` was blocking source-scoped watchlists and causing add-to-watchlist actions to appear successful before the database commit failed.
- Switching from a valid channel detail page to a source that does not expose that channel no longer leads operators into invalid channel pages or 404s. The app now redirects to the selected source’s Overview with an unavailable notice.
- **Planning globe renderer startup:** Cesium static assets now resolve from the app’s `/cesium/` public path before the first globe render, preventing the Planning Earth view from crashing on startup and dropping otherwise-valid live simulator position markers.
- **Orbit status WebSocket callbacks** — Orbit status updates now invoke registered per-source callbacks correctly, so live `orbit_status` broadcasts reach connected clients instead of being dropped by a mismatched status payload check.
- **Planning run handoff on the globe:** The Planning page now resolves each selected source to its current run for live position and orbit status. A simulator with a position mapping stays source-oriented in the UI, but the globe, `Live`/`Stale` indicator, trail, and orbit badges now follow the simulator's active run instead of reading only from the base source id.
- **Orbit anomaly badges after simulator scenario switches:** Orbit analysis now ignores late GPS frames from older simulator runs once a newer run has started, so Planning reliably promotes `orbit_decay`, `orbit_highly_elliptical`, `orbit_suborbital`, and `orbit_escape` to their intended anomaly badges instead of briefly inheriting stale status from the previous run.
- **Watchlist card visibility on Overview:** Overview cards now follow the watchlist configuration only. Adding a channel shows its card immediately, and simulator run handoff or idle state no longer removes configured cards; channels without current telemetry stay visible with a `No data` placeholder until data resumes or the channel is removed from the watchlist.
- **Simulator live sync on Overview:** When a simulator starts or stops from the Sources page, the Overview now rebinds to the simulator's active run automatically, updates the watchlist/feed live state without a page refresh, and clears the stale `Live` indicator promptly when the simulator returns to idle.
- **Overview run handoff UX:** Simulator start/stop no longer blanks the whole Overview while the next run snapshot loads. The current view stays mounted, shows a local switching indicator, and only swaps to the new run once the next snapshot is ready.
- **Watchlist modal stays open during edits:** Adding or removing channels from the Overview watchlist now refreshes the cards in place instead of triggering a full Overview refresh, so operators can make multiple changes in one session and click **Done** when finished.
- Trend Analysis "no data" when Overview has sparkline: recent endpoint now falls back to most recent points when the requested time range yields no data; range selector (15m, 1h, 6h, 24h, Custom) now stays visible so users can try different time ranges
- Telemetry channel detail 404 for simulator sources: summary and explain endpoints now compute statistics on-the-fly when missing (e.g. new simulator sources that have data but no precomputed stats)
- Feed status: API now exposes three-state `state` (connected/degraded/disconnected) so the context banner can show "No data" when a previously active source goes silent for >60s instead of staying "Degraded"
- Removed unused `.cursor` volume mounts from backend and simulator in docker-compose
- Overview default source set to `"default"` so the dashboard shows data after Quick Start (telemetry and backend APIs use `source_id=default` when none is provided)
- Simulator ingest timeout: backend ingest endpoint now async (avoids thread pool contention), bus uses dedicated processor pool, simulator uses HTTP session with retries and separate connect/read timeouts
- Changelog and agent rule for keeping docs up to date
