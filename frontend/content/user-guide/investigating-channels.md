# Investigating a Channel

**Workflow:** Anomaly or curiosity → understand a channel

When you see an anomaly or want to understand a telemetry channel, follow this flow.

## 1. Search for a Channel

Go to **Search** and enter a semantic query (e.g. "voltage", "temperature", "speed"). The platform uses semantic search, so you find channels by meaning, not exact names.

- Filter by subsystem, units, anomalous status, or recent activity
- Add a channel to the watchlist
- Click a result to open the channel detail page

## 2. Channel Detail Page

Click a channel (from Overview, Search, or anomaly queue) to open its detail page.

The page is organized into **vertical tabs** so you can quickly switch between different views of the same channel:

- **Summary** – current value, state badge (Normal, Caution, Warning), compact statistics (P5/P95, min/max, sample count), and description.
- **Live & Trends** – live time-series view plus the full **Trend Analysis** chart with range presets (15m, 1h, 6h, 24h, Custom), UTC/local toggle, comparison channels, and zoom controls.
- **History** – a tabular view of archived samples for this channel:
  - Select a time range (15 min, 1 hr, 6 hr, 24 hr, or custom start time).
  - See a sortable table of timestamp and value (with units), with a UTC/local time toggle.
  - Filter rows by timestamp or value.
  - Use the toolbar to **copy the table**, or export the visible range to **CSV**, **JSON**, or a Parquet-friendly text stub for data-science workflows.
  - Copy an individual row to the clipboard or **flag** samples you want to keep an eye on; flagged samples are highlighted for the current session.
- **Explanation & Events** – AI explanation plus recent ops events (alerts opened, acked, resolved) for that channel.

## 3. LLM Explanation

The platform provides an AI-generated explanation that:

- Describes what the channel measures
- Explains why the current value might be anomalous (if applicable)
- Gives context for operators

Requires an OpenAI API key (or compatible provider). A mock provider is used if no key is configured.

## 4. Recent Events

For each channel, the detail page shows recent ops events (e.g. alerts opened, acked, resolved) for that channel. This helps track when and how anomalies were handled.
