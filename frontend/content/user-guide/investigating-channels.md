# Investigating a Channel

**Workflow:** Anomaly or curiosity → understand a channel

When you see an anomaly or want to understand a telemetry channel, follow this flow.

## 1. Search for a Channel

Go to **Search** and enter a semantic query (e.g. "voltage", "temperature", "speed"). The platform uses semantic search, so you find channels by meaning, not exact names.

- Filter by subsystem, units, anomalous status, or recent activity
- Add a channel to the watchlist
- Click a result to open the channel detail page

## 2. Channel Detail Page

Click a channel (from Overview, Search, or anomaly queue) to open its detail page. You'll see:

- **Stats table** — mean, std dev, min, max, sample count
- **Trend chart** — recent time-series values
- **Z-score** — how far the current value is from the mean (in standard deviations)
- **State badge** — Normal, Caution, or Warning

## 3. LLM Explanation

The platform provides an AI-generated explanation that:

- Describes what the channel measures
- Explains why the current value might be anomalous (if applicable)
- Gives context for operators

Requires an OpenAI API key (or compatible provider). A mock provider is used if no key is configured.

## 4. Recent Events

For each channel, the detail page shows recent ops events (e.g. alerts opened, acked, resolved) for that channel. This helps track when and how anomalies were handled.
