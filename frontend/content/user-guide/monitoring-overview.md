# Monitoring the Overview

**Workflow:** Stream connected → what to watch and how

The Overview is your main dashboard. When you have a telemetry stream connected (or historical data), it shows your watchlist, feed health, and anomalies.

## Watchlist Cards

Each card shows:

- **Channel name** — e.g. `PWR_BUS_A_VOLT`
- **Current value** — latest measurement with units
- **State badge** — Normal (green), Caution (yellow), or Warning (red)
- **Sparkline** — recent trend over time

Click a card to open the [channel detail page](/docs/investigating-channels) for stats, trend chart, and AI explanation.

## Context Banner

At the top of the Overview:

- **Feed status:** Live (green), Degraded, or No data
  - **Live** — receiving data within the last ~15 seconds
  - **Degraded** — no recent data for 15–60 seconds
  - **No data** — no data for 60+ seconds
- **Approximate rate** — e.g. "~5 Hz" when connected
- **Source selector** — when multiple sources exist, switch between them (see [Multi-Source Operations](/docs/multi-source))
- **Alert counts** — active alerts by severity

## Anomalies Queue

Channels with current state outside Normal appear in the anomalies queue, grouped by subsystem (Power, Thermal, ADCS, Comms, Other). Click an entry to open the channel detail.

## Edit Watchlist

Use **Edit watchlist** to add or remove channels. Use [Search](/docs/investigating-channels) to find channels by meaning (e.g. "voltage") and add them to the watchlist.
