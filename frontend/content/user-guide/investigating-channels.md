# Investigating a Channel

**Workflow:** Anomaly or curiosity → understand a channel

When you see an anomaly or want to understand a telemetry channel, follow this flow.

## 1. Search for a Channel

Go to **Overview** and use the search bar under the Context Banner. Enter a semantic query (e.g. "voltage", "temperature", "speed"). The platform uses semantic search, so you find channels by meaning, not exact names.

- Search is scoped to the source selected in the Context Banner; results and current values follow that source.
- If a source defines channel aliases, search can match either the canonical name or an accepted alias. Results still open the canonical channel page.
- Runtime-discovered channels appear in search and watchlist pickers with a **Discovered** badge. These are fields the source emitted live even though they were not in the seeded definition catalog.
- Expand **Advanced filters** to filter by subsystem, units, anomalous status, or recent activity
- Add a channel to the watchlist
- Click a result to open the channel detail page

## 2. Channel Detail Page

Click a channel from **Telemetry**, Overview search, a watchlist card, or the anomaly queue to open its detail page.

The canonical detail URL is source-first under the Telemetry section: `/telemetry/{source_id}/{channel_name}`. This keeps the page anchored to one source/channel pair while preserving Telemetry as the active parent section.

If you open the page using an alias instead of the canonical channel name, the app resolves the alias and redirects to the canonical URL. This keeps history, watchlists, and copied links anchored to one channel identity.

The page is organized into **vertical tabs** so you can quickly switch between different views of the same channel:

- **Summary** – current value, state badge (Normal, Caution, Warning), compact statistics (P5/P95, min/max, sample count), and description.
- Registered catalog channels can open before data arrives. In that case, the detail page shows **No data**, omits percentile/statistics values, and keeps History and Trend Analysis in their empty states until samples are ingested.
- Discovered channels stay queryable like catalog channels, but they may have no units, no description, and no engineering limits until you curate them.
- **Live & Trends** – live time-series view plus the full **Trend Analysis** chart with range presets (15m, 1h, 6h, 24h, Custom), UTC/local toggle, comparison channels, and zoom controls.
- **History** – a tabular view of archived samples for this channel:
  - Choose **Stream** to restrict the table (and copy/export) to a specific telemetry stream of the selected source. The dropdown lists only streams that belong to the source in the Context Banner, labeled by start time. Defaults to the current stream (newest for that source).
  - Select a time range (15 min, 1 hr, 6 hr, 24 hr, or custom start time).
  - See a sortable table of timestamp and value (with units), with a UTC/local time toggle.
  - Filter rows by value. If the selected time window has no data, a banner explains that the table is showing the most recent samples instead.
  - Use the toolbar to **copy the table**, or export the visible range to **CSV**, **JSON**, or a Parquet-friendly text stub for data-science workflows.
  - Copy an individual row to the clipboard or **flag** samples you want to keep an eye on; flagged samples are highlighted for the current session.
- **Explanation & Events** – AI explanation plus recent ops events (alerts opened, acked, resolved) for that channel.

**Source and stream:** The **Context Banner** is the only place to change the source. The whole page is for that source. Summary, Live & Trends, and the default stream in History use the source’s current stream. In the History tab, the **Stream** dropdown lists only streams for that source so you can narrow the table to a chosen ingest session. If the target source does not provide the current channel, the app sends you back to the source’s **Telemetry** inventory with a clear unavailable message.

When you open a channel from an event or alert, the selected stream is carried separately in the URL so the page stays scoped to the source while still loading the chosen ingest session.

## 3. LLM Explanation

The platform provides an AI-generated explanation that:

- Describes what the channel measures
- Explains why the current value might be anomalous (if applicable)
- Gives context for operators

Requires an OpenAI API key (or compatible provider). A mock provider is used if no key is configured.

## 4. Recent Events

For each channel, the detail page shows recent ops events (e.g. alerts opened, acked, resolved) for that channel. This helps track when and how anomalies were handled.
