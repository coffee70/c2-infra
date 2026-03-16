# Investigating a Channel

**Workflow:** Anomaly or curiosity → understand a channel

When you see an anomaly or want to understand a telemetry channel, follow this flow.

## 1. Search for a Channel

Go to **Overview** and use the search bar under the Context Banner. Enter a semantic query (e.g. "voltage", "temperature", "speed"). The platform uses semantic search, so you find channels by meaning, not exact names.

- Search is scoped to the source selected in the Context Banner; results and current values follow that source.
- Expand **Advanced filters** to filter by subsystem, units, anomalous status, or recent activity
- Add a channel to the watchlist
- Click a result to open the channel detail page

## 2. Channel Detail Page

Click a channel (from Overview search, a watchlist card, or the anomaly queue) to open its detail page.

The canonical detail URL is source-first: `/sources/{source_id}/telemetry/{channel_name}`. This means the page always represents one channel in one source’s catalog, not a global channel name with a source filter layered on later.

The page is organized into **vertical tabs** so you can quickly switch between different views of the same channel:

- **Summary** – current value, state badge (Normal, Caution, Warning), compact statistics (P5/P95, min/max, sample count), and description.
- **Live & Trends** – live time-series view plus the full **Trend Analysis** chart with range presets (15m, 1h, 6h, 24h, Custom), UTC/local toggle, comparison channels, and zoom controls.
- **History** – a tabular view of archived samples for this channel:
  - Choose **Run** to restrict the table (and copy/export) to a specific run of the selected source. The dropdown lists only runs that belong to the source in the Context Banner, labeled by start time (e.g. "Run started at 2026-03-11 19:03 UTC"). Defaults to the current run (newest for that source).
  - Select a time range (15 min, 1 hr, 6 hr, 24 hr, or custom start time).
  - See a sortable table of timestamp and value (with units), with a UTC/local time toggle.
  - Filter rows by value. If the selected time window has no data, a banner explains that the table is showing the most recent samples instead.
  - Use the toolbar to **copy the table**, or export the visible range to **CSV**, **JSON**, or a Parquet-friendly text stub for data-science workflows.
  - Copy an individual row to the clipboard or **flag** samples you want to keep an eye on; flagged samples are highlighted for the current session.
- **Explanation & Events** – AI explanation plus recent ops events (alerts opened, acked, resolved) for that channel.

**Source and run:** The **Context Banner** is the only place to change the **source** (vehicle or simulator). The whole page is for that source. Summary, Live & Trends, and the default run in History use the source’s **current run** (e.g. newest). In the History tab, the **Run** dropdown lists only runs for that source so you can narrow the table to a chosen run (e.g. to export one orbit). If the target source does not provide the current channel, the app sends you back to that source’s Overview with a clear unavailable message.

## 3. LLM Explanation

The platform provides an AI-generated explanation that:

- Describes what the channel measures
- Explains why the current value might be anomalous (if applicable)
- Gives context for operators

Requires an OpenAI API key (or compatible provider). A mock provider is used if no key is configured.

## 4. Recent Events

For each channel, the detail page shows recent ops events (e.g. alerts opened, acked, resolved) for that channel. This helps track when and how anomalies were handled.
