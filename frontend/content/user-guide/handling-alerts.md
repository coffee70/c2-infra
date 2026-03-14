# Handling Alerts

**Workflow:** Alert appears → Ack → Resolve

When an anomaly triggers an alert, it appears in the Event Console. Operators can acknowledge and resolve alerts to track response.

## 1. Alert Opens

When a channel exceeds its threshold, an `alert.opened` event is created. The alert appears in:

- **Event Console** — on the Overview page
- **Event History** — recent and historical ops events on the Overview page

## 2. Acknowledge

An operator can **Ack** the alert to indicate it has been seen:

- Sends `ack_alert` via WebSocket
- An `alert.acked` event is recorded
- The alert is marked as acknowledged

## 3. Resolve

When the issue is addressed, the operator can **Resolve** the alert:

- Enter resolution text (optional) describing what was done
- Sends `resolve_alert` via WebSocket
- An `alert.resolved` event is recorded

## 4. Events in Overview and Channel Detail

All events (opened, acked, resolved) appear in:

- **Event History** — filterable by source context, event type, and time range on Overview
- **Channel detail** — recent events for that channel

## Summary

```
Alert opens → Event Console
    → Ack (alert.acked)
    → Resolve with text (alert.resolved)
    → Events visible in Event History and channel detail
```
