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
- **Simulator status** — when the selected source is a simulator: a single status badge (Disconnected, Running, Paused, or Idle) with semantic color
- **Source selector** — when multiple sources exist, switch between them; grouped by **Vehicles** and **Simulators** (see [Multi-Source Operations](/docs/multi-source))
- **Alerts** — active alert count; click the count to scroll to the **Events Console** on the same page, or open the dropdown to see a short preview of alerts (subsystem and channel name). **Other** in the preview means the channel is not classified as Power, Thermal, ADCS, or Comms. Use **View all in Events Console** to jump to the full list.

## Anomalies Queue

Channels with current state outside Normal appear in the anomalies queue (and in the context banner alert preview), grouped by subsystem: **Power**, **Thermal**, **ADCS**, **Comms**, or **Other**. **Other** is used for channels that don't belong to one of the four main subsystems. Click an entry to open the channel detail.

## Edit Watchlist

Use **Edit watchlist** to add or remove channels. Use [Search](/docs/investigating-channels) to find channels by meaning (e.g. "voltage") and add them to the watchlist.
