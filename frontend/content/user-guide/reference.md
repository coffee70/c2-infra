# Reference

Quick reference for pages and features.

## Pages

| Page | Purpose |
|------|---------|
| **Overview** | Main dashboard: watchlist cards, sparklines, anomalies queue, feed health |
| **Timeline** | Ops events (alerts, feed status) with time range and filters |
| **Search** | Semantic search over channels; add to watchlist |
| **Simulator** | Start/stop mock vehicle streamer with scenario selection |
| **Channel detail** | Stats, trend chart, z-score, LLM explanation, recent events |

## Keyboard Shortcuts

Click the **?** button in the nav to view available keyboard shortcuts. Common shortcuts include navigation and quick actions.

## Logs and Debugging

The platform emits structured JSON audit logs for auditing and debugging:

- **Backend / Simulator:** Logs go to stdout. With Docker: `docker compose logs backend` or `docker compose logs simulator`. Each line is JSON with `audit: true`, `action`, `component`, and action-specific fields.
- **Frontend:** In development, user actions (simulator, watchlist, ack/resolve, search) are logged to the browser console. In production, set `NEXT_PUBLIC_AUDIT_LOG=true` to enable.

## Operator Mode

For mission control environments, the platform supports:

- **High-contrast mode** — higher contrast for visibility
- **Large-type mode** — larger text for readability

Use the toggle in the nav to switch modes. Preferences are stored in the browser.
