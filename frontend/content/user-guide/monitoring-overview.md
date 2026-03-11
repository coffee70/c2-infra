# Monitoring the Overview

**Workflow:** Stream connected → what to watch and how

The Overview is your main dashboard. When you have a telemetry stream connected (or historical data), it shows your watchlist, feed health, and anomalies in a single data-focused layout—no Earth view on this page.

For a full-screen 3D Earth view with position markers and source selection, use the **Planning** tab (or [Planning](/planning)): the globe fills the viewport below the app bar. Each selected source shows its **current position** (point and label) and a **recent position trail** (polyline) that builds as telemetry is received. A single **left-side card** (“Earth view”) has two independent sections: **Show on globe** (a dropdown to select one or multiple sources to display) and **Position mapping** (per-source configuration of frame and channels). You can configure position for any source whether or not it’s currently shown on the globe.

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

Use **Edit watchlist** to open the configure modal: add or remove channels, and see how many are on the list and how many are available. Order in the modal matches the Overview cards. Use [Search](/docs/investigating-channels) to find channels by meaning (e.g. "voltage") and add them to the watchlist.

## Configure position mapping

On the [Planning](/planning) page, the left-side **Earth view** card has two separate areas:

- **Show on globe** — Open the dropdown to select which sources appear on the globe. You can pick one, several, or all. This does not affect which sources you can configure.
- **Position mapping** — A list of all sources; each row shows the source name, type, and current mapping (or “Not configured”). Expand a row to set **frame** (GPS lat/lon/alt or ECEF/ECI X/Y/Z) and channel names, then **Save mapping** or **Remove mapping**. You can configure any source even if it’s not currently shown on the globe.

Each source has at most one active position mapping. If a source has no valid mapping, it won’t show a position on the globe when you add it to “Show on globe.”

### Workflow: Simulator on the Planning globe

To see a simulator’s position and trail on the globe:

1. **Generate position telemetry** — On the [Sources](/sources) page, add a simulator (if needed), click **Manage**, then **Start**. The simulator emits position channels (e.g. `GPS_LAT`, `GPS_LON`, `GPS_ALT`) along with other telemetry.
2. **Open Planning** — Go to the [Planning](/planning) tab. In the Earth view card, open **Show on globe** and select the simulator (and any other sources you want).
3. **Set frame and channels** — In **Position mapping**, find the simulator row. If it shows “Not configured,” expand the row. Choose **frame** (e.g. GPS lat/lon/alt), set the channel names (e.g. `GPS_LAT`, `GPS_LON`, `GPS_ALT` for the default simulator), then click **Save mapping**.
4. The globe shows the simulator’s **current position** (point and label) and a **recent trail** (polyline) that builds as telemetry is received.
