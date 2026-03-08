# Multi-Source Operations

**Workflow:** Multiple streams → switch context

The platform supports multiple telemetry sources (vehicles and simulators). Each source has its own feed health and data. Sources are kept distinct so you can monitor several spacecraft or simulators without mixing them up.

## Source Selector

In the **Context Banner** on the Overview (and other pages), you can switch between sources using the source selector dropdown. The list is grouped into **Vehicles** and **Simulators**.

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

## Adding a Vehicle

When you ingest data or run a streamer, include a `source_id` in the payload. The platform registers the source and makes it available in the selector. Default is `"default"` if not specified.
