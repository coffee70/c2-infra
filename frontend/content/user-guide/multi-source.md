# Multi-Source Operations

**Workflow:** Multiple telemetry streams -> switch context

The platform supports multiple telemetry vehicles and simulators. A **vehicle** is one row in the source list. Each vehicle can have multiple **streams** (one execution or ingest session). A stream belongs to exactly one vehicle. Catalog metadata, watchlists, and position mappings are keyed by vehicle; live telemetry data is keyed by stream.

## Source Selector

In the **Context Banner** on the Overview and Telemetry Detail pages, you switch between logical vehicles only. The dropdown lists registered vehicles, not individual streams. Telemetry Detail URLs stay vehicle-first: `/sources/{vehicle_id}/telemetry/{channel_name}`. The app resolves the vehicle's **current stream** for Overview data, Summary, Live & Trends, and the default stream in the History tab.

Because channel catalogs are now source-scoped, a channel detail page is only valid for sources that actually expose that channel. If you switch to a source that does not provide the current channel, the app redirects you back to that source’s Overview with a notice instead of leaving you on a 404 page.

## Per-Source Feed Health

Each source has its own feed status:

- **Live** — receiving data within ~15 seconds
- **Degraded** — no recent data for 15–60 seconds
- **No data** — no data for 60+ seconds

The banner shows the status for the currently selected source.

## Event History Filtered by Source

The **Overview** page shows ops events for the selected source directly under the Event Console. The historical event browser follows the source selected in the Context Banner and supports event-type and time-range filtering.

## When to Use Multi-Source

- **Multiple vehicles** — monitor several spacecraft from one dashboard
- **Multiple simulators** — run several simulator instances (e.g. for testing or demos)
- **Test vs prod** — compare simulator vs live ingest

## Adding a Simulator

1. Go to the **Sources** page.
2. Click **Add source**.
3. Choose **Simulator**.
4. Enter a name, a **Telemetry definition path** (JSON or YAML under the server’s definitions catalog), and a **Base URL** — the URL the server uses to reach the simulator (e.g. `http://simulator:8001`).
5. Click **Create**.

The simulator appears in the Simulators list. The backend seeds its expected channel catalog immediately from the definition file. Click **Manage** to open its control panel and start, pause, or stop it.

## Adding a Vehicle

1. Go to the **Sources** page.
2. Click **Add source**.
3. Choose **Vehicle**.
4. Enter a name and a **Telemetry definition path**.
5. Click **Create**.

The backend seeds the source catalog from that definition so searches, watchlists, summaries, and alerts know which channels belong to that vehicle before live ingest starts.

## Simulator streams (fresh slate per start)

Each time you **start** a simulator from the Sources page, the platform creates a **new stream** for that vehicle (`{vehicle_id}-{timestamp}`). You are taken to the **Overview** with that vehicle selected; the Overview and Telemetry Detail then show data for the vehicle's **current stream**. History, trends, and exports remain stream-scoped, while the page URL stays at the vehicle level.

## Built-in Local Sources

The default local stack includes four built-ins:

- `Aegon Relay` and `Balerion Surveyor` as vehicle sources
- `DrogonSat` as a lighter simulator that emits GPS/LLA position channels
- `RhaegalSat` as a heavier simulator that emits ECEF position channels

`DrogonSat` and `RhaegalSat` intentionally share only a small common core. `RhaegalSat` has more onboard computer temperature/load channels, a split propulsion system, and a larger payload/comms catalog, so source switching exercises real source-specific workflows instead of identical feeds with different names.
