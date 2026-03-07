# Multi-Source Operations

**Workflow:** Multiple streams → switch context

The platform supports multiple telemetry sources (e.g. multiple vehicles, test vs prod, simulator vs live). Each source has its own feed health and data.

## Source Selector

In the **Context Banner** on the Overview (and other pages), you can switch between sources using the source selector dropdown. Only sources that have sent data appear in the list.

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
- **Test vs prod** — compare simulator vs live ingest
- **Different ingest paths** — e.g. simulator (`source_id=simulator`) and mock streamer (`source_id=mock_vehicle`)

## Adding a Source

When you ingest data or run a streamer, include a `source_id` in the payload. The platform will register the source and make it available in the selector. Default is `"default"` if not specified.
