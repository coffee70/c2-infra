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
- **Data scope** – the sticky channel header shows a compact scope pill (hover for the full summary). **Edit scope** opens a modal to choose whether the whole page uses the latest stream, one or more selected streams, selected streams with time bounds, or all channel data in a date range.
- **Analysis** – trend chart and history table for this channel using the page data scope, with comparison overlays and UTC presentation. Live value updates are available only in Latest mode.
- **History** – a tabular view of archived samples for this channel:
  - The table uses the page Data scope. It does not have separate stream or date controls.
  - When the scope spans multiple streams, the table includes a Stream column.
  - See a sortable table of timestamp and value (with units), with a UTC/local time toggle.
  - Filter rows by value.
  - Use the toolbar to **copy the table**, or export the visible range to **CSV**, **JSON**, or a Parquet-friendly text stub for data-science workflows.
  - Copy an individual row to the clipboard or **flag** samples you want to keep an eye on; flagged samples are highlighted for the current session.
- **Explanation & Events** – AI explanation plus recent ops events (alerts opened, acked, resolved) for that channel.

**Source and data scope:** The **Context Banner** is the only place to change the source. **Edit scope** in the channel header is where you change which dataset the detail page uses. If the target source does not provide the current channel, the app sends you back to the source’s **Telemetry** inventory with a clear unavailable message.

When you open a related channel from this page, the current Data scope is preserved. Changing source resets the detail page to Latest.

## 3. LLM Explanation

The platform provides an AI-generated explanation that:

- Describes what the channel measures
- Explains why the current value might be anomalous (if applicable)
- Gives context for operators

Requires an OpenAI API key (or compatible provider). A mock provider is used if no key is configured.

## 4. Recent Events

For each channel, the detail page shows recent ops events (e.g. alerts opened, acked, resolved) for that channel. This helps track when and how anomalies were handled.
