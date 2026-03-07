# Situational awareness QA

## Manual validation

### Multi-source correctness
1. Run backend + frontend + simulator.
2. Start simulator with `source_id=simulator`.
3. Run `mock_vehicle_streamer.py` with `--scenario nominal` (uses `source_id=mock_vehicle`).
4. Add the same channel to watchlist from both sources.
5. Verify Overview shows source-specific data when switching the source selector.
6. Verify `/telemetry/{name}/recent?source_id=simulator` vs `source_id=mock_vehicle` return different histories.

### Feed health
1. Start simulator; verify ContextBanner shows "Live" and ~N Hz.
2. Stop simulator; within 15s banner should show "Degraded", then "No data" after 60s.
3. Restart simulator; banner should return to "Live".

### Timeline / ops_events
1. Trigger an alert (e.g. power_sag scenario); verify "alert.opened" appears in Now panel and Timeline.
2. Ack the alert; verify "alert.acked" appears.
3. Resolve the alert; verify "alert.resolved" appears.
4. On telemetry detail page, verify "Recent events for this channel" shows events for that channel.

## Unit tests
- `pytest backend/tests/test_source_aware.py`
- `pytest backend/tests/test_ops_events.py`
