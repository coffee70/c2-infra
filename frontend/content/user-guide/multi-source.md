# Multi-Source Operations

**Workflow:** Multiple streams → switch context

The platform supports multiple telemetry sources (vehicles and simulators). A **source** is one row in the source list (e.g. a vehicle or a simulator). Each source can have multiple **runs** (one execution/stream). A run belongs to exactly one source. Data is keyed by run: for vehicles the run is usually the source id; for simulators each start creates a new run (e.g. `sim_abc12345-2026-03-11T19-03-00Z`).

## Source Selector

In the **Context Banner** on the Overview and Telemetry Detail pages, you switch between **sources** only (vehicles and simulators). The dropdown lists only registered sources (no individual runs). The URL uses the source id (`?source=...`). The app resolves the source’s **current run** (e.g. newest) for Overview data, Summary, Live & Trends, and the default run in the History tab.

## Per-Source Feed Health

Each source has its own feed status:

- **Live** — receiving data within ~15 seconds
- **Degraded** — no recent data for 15–60 seconds
- **No data** — no data for 60+ seconds

The banner shows the status for the currently selected source.

## Timeline Filtered by Source

The **Timeline** page shows ops events for the selected source. Filter by source, event type, time range, and channel name.

## When to Use Multi-Source

- **Multiple vehicles** — monitor several spacecraft from one dashboard
- **Multiple simulators** — run several simulator instances (e.g. for testing or demos)
- **Test vs prod** — compare simulator vs live ingest

## Adding a Simulator

1. Go to the **Sources** page.
2. Click **Add source**.
3. Choose **Simulator** (Vehicle is coming later).
4. Enter a name and **Base URL** — the URL the server uses to reach the simulator (e.g. `http://simulator:8001`).
5. Click **Create**.

The simulator appears in the Simulators list. Click **Manage** to open its control panel and start, pause, or stop it.

## Simulator runs (fresh slate per run)

Each time you **start** a simulator from the Sources page, the platform creates a **new run** for that source (run id = source id + timestamp). You are taken to the **Overview** with that **source** selected; the Overview (and Telemetry Detail) then show data for that source’s **current run** (the newest run, including the one you just started). All data (History, Trends, copy/export) is scoped to runs of the selected source. On Telemetry Detail, the **Run** dropdown in the History tab lists only runs for that source so you can narrow the table to a specific run (e.g. "Run started at 2026-03-11 19:03 UTC").

## Adding a Vehicle

When you ingest data or run a streamer, include a `source_id` in the payload. The platform registers the source and makes it available in the selector. Default is `"default"` if not specified.
