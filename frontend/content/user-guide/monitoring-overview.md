# Monitoring the Overview

**Workflow:** Stream connected → what to watch and how

The Overview is your main dashboard. When you have a telemetry stream connected (or historical data), it shows your watchlist, feed health, anomalies, event workflows, and integrated telemetry search in a single data-focused layout—no Earth view on this page.

For a full-screen 3D Earth view with position markers and source selection, use the **Planning** tab (or [Planning](/planning)): the globe fills the viewport below the app bar. Each selected source shows its current position (point and label) and a recent position trail (polyline) that builds as telemetry is received. For simulators, Planning follows the source's active stream automatically, so you keep selecting the logical source while the globe reads live position and orbit status from the current stream behind it. A single left-side card (“Earth view”) has two independent sections: **Show on globe** (a dropdown to select one or multiple sources to display) and **Position mapping** (per-source configuration of frame and channels). You can configure position for any source whether or not it’s currently shown on the globe.

## Watchlist Cards

Each card shows:

- **Channel name** — e.g. `PWR_BUS_A_VOLT`
- **Current value** — latest measurement with units
- **State badge** — Normal (green), Caution (yellow), or Warning (red)
- **Sparkline** — recent trend over time
- **Persistent visibility** — If a channel is on the watchlist, its card stays on the Overview even when the selected source or simulator stream has no current data for it. In that case the card shows **No data** until telemetry resumes or you remove the channel from the watchlist.

Click a card to open the [channel detail page](/docs/investigating-channels) for stats, trend chart, and AI explanation.

## Context Banner

At the top of the Overview:

- **Feed status:** Live (green), Degraded, or No data
  - **Live** — receiving data within the last ~15 seconds
  - **Degraded** — no recent data for 15–60 seconds
  - **No data** — no data for 60+ seconds
- **Simulator/stream sync:** If the selected source is a simulator and you start or stop it from the [Sources](/sources) page, the Overview switches to the simulator's active stream automatically within a few seconds. The page stays in place during the handoff, shows a small switching indicator, and updates the watchlist, feed badge, and `Live` pill without a browser refresh.
- **Approximate rate** — e.g. "~5 Hz" when connected
- **Simulator status** — when the selected source is a simulator: a single status badge (Disconnected, Running, Paused, or Idle) with semantic color
- **Source selector** — when multiple sources exist, switch between them; grouped by **Vehicles** and **Simulators** (see [Multi-Source Operations](/docs/multi-source))
- **Alerts** — active alert count; click the count to scroll to the **Events Console** on the same page, or open the dropdown to see a short preview of alerts (subsystem and channel name). **Other** in the preview means the channel is not classified as Power, Thermal, ADCS, or Comms. Use **View all in Events Console** to jump to the full list.

## Search From Overview

Directly under the Context Banner, use the search bar to open the semantic search popover.

- Enter a meaning-based query such as "voltage", "temperature", or "speed"
- Search is scoped to the source selected in the Context Banner
- Expand **Advanced filters** to narrow by subsystem, units, anomalous status, or recent activity
- Add channels to the watchlist from the result list
- Click a result to open the channel detail page

## Overview Tabs

Below the search bar, the Overview uses a vertical tab rail:

- **Watchlist** — key telemetry cards for the current source, including live state and sparklines
- **Event Console** — active alerts grouped by subsystem, with Ack and Resolve actions
- **Event History** — recent and historical ops events for the current source, with time-range and event-type filters

## Event Console

Channels with current state outside Normal appear in the Event Console (and in the context banner alert preview), grouped by subsystem: **Power**, **Thermal**, **ADCS**, **Comms**, or **Other**. **Other** is used for channels that don't belong to one of the four main subsystems. Click an entry to open the channel detail, or Ack/Resolve the alert from the console.

## Edit Watchlist

Use **Edit watchlist** to open the configure modal: add or remove channels, and see how many are on the list and how many are available. Order in the modal matches the Overview cards. Use the integrated search bar to find channels by meaning (e.g. "voltage") and add them to the watchlist.

## Configure position mapping

On the [Planning](/planning) page, the left-side **Earth view** card has two separate areas:

- **Show on globe** — Open the dropdown to select which sources appear on the globe. You can pick one, several, or all. This does not affect which sources you can configure.
- **Position mapping** — A list of all sources; each row shows the source name, type, and current mapping (or “Not configured”). Expand a row to set **frame** (GPS lat/lon/alt or ECEF/ECI X/Y/Z) and channel names, then **Save mapping** or **Remove mapping**. You can configure any source even if it’s not currently shown on the globe.

Each source has at most one active position mapping. If a source has no valid mapping, it won’t show a position on the globe when you add it to “Show on globe.”

### Workflow: Simulator on the Planning globe

To see a simulator’s position and trail on the globe:

1. **Generate position telemetry** — On the [Sources](/sources) page, add a simulator (if needed), click **Manage**, then **Start**. The simulator emits position channels (e.g. `GPS_LAT`, `GPS_LON`, `GPS_ALT`) along with other telemetry.
2. **Open Planning** — Go to the [Planning](/planning) tab. In the Earth view card, open **Show on globe** and select the simulator (and any other sources you want).
3. **Confirm the mapping** — Built-in and newly registered sources seed their position mapping from the telemetry definition file. In **Position mapping**, verify the frame and channel names if you want operator confirmation or an override. `DrogonSat` uses GPS/LLA channels; `RhaegalSat` uses ECEF XYZ channels.
4. Planning resolves the simulator source to its current stream automatically. The globe then shows the simulator’s current position (point and label), a recent trail (polyline), and the correct `Live` status as telemetry is received for that stream.
5. Use **Nominal** or **Orbit nominal** when you want a stable realistic path on the globe. Use **Orbit decay**, **Orbit highly elliptical**, **Orbit suborbital**, or **Orbit escape** only when you intentionally want the orbit-analysis badges and alerting to exercise those cases.

## Orbit validation

For sources that have a **position mapping** (and thus a position telemetry stream), the platform runs **orbit validation** in real time: it computes orbital parameters (perigee, apogee, eccentricity, velocity), classifies the orbit (LEO, MEO, GEO), and detects anomalies such as escape trajectory, suborbital, orbit decay, or highly elliptical LEO.

- **Where to see status**
  - **Planning page** — In the left panel, each source with a position mapping shows an orbit status badge (e.g. **LEO** for valid nominal, or the anomaly type). If any source currently shown on the globe has an orbit anomaly, a **red alert banner** appears in the left panel with the source name and reason.
  - **Overview** — Orbit anomalies appear in the **Events Console** under an **Orbit** subsection (with a link to Planning). The **Alerts** count and dropdown in the Context Banner include orbit anomalies so you see them alongside telemetry alerts.

- **What anomalies mean** — *Escape trajectory*: orbital energy ≥ 0 (unbound). *Suborbital*: velocity < 7 km/s at altitude < 1000 km. *Orbit decay*: predicted perigee below 120 km. *Highly elliptical*: eccentricity > 0.2 for an expected LEO mission. Status updates are pushed in real time over the same WebSocket as telemetry and alerts.

The built-in simulators keep their nominal position telemetry smooth and bounded so Planning trails stay readable. `DrogonSat` exercises GPS/LLA feeds, while `RhaegalSat` exercises ECEF feeds. Orbit-analysis edge cases are exposed as explicit simulator presets instead of random position spikes.
