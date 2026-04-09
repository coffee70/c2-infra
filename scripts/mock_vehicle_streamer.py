#!/usr/bin/env python3
"""
Mock vehicle telemetry streamer for realtime demo.

Streams mixed-rate telemetry to POST /telemetry/realtime/ingest,
with scenario-based anomaly injections and link behavior simulation.

Usage:
    python scripts/mock_vehicle_streamer.py [options]

Requires backend running with realtime ingest. Run generate_synthetic_telemetry.py
and recompute-stats first to ensure schemas and statistics exist.

Examples:
    python scripts/mock_vehicle_streamer.py --scenario nominal --duration 120
    python scripts/mock_vehicle_streamer.py --scenario power_sag --speed 10
    python scripts/mock_vehicle_streamer.py --scenario thermal_runaway --drop-prob 0.02
"""

import argparse
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any

try:
    import requests
except ImportError:
    print("Install requests: pip install requests")
    sys.exit(1)

# Ensure we can import from scripts/
_SCRIPT_DIR = __file__.rsplit("/", 1)[0] if "/" in __file__ else "."
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)
_REPO_ROOT = __file__.rsplit("/", 2)[0] if "/" in __file__ else "."
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from telemetry_catalog.builtins import MOCK_VEHICLE_SOURCE_ID
from telemetry_catalog.definitions import channel_rate_hz, load_vehicle_config_file

DEFINITION = load_vehicle_config_file("vehicles/balerion-surveyor.json")
TELEMETRY_DEFINITIONS = [
    (
        channel.name,
        channel.units,
        channel.description,
        channel.mean,
        channel.std_dev,
        channel.subsystem,
        channel.red_low,
        channel.red_high,
    )
    for channel in DEFINITION.channels
]
RATES_HZ = {channel.name: channel_rate_hz(channel) for channel in DEFINITION.channels}

SCENARIOS = {
    name: scenario.model_dump()
    for name, scenario in DEFINITION.scenarios.items()
} or {
    "nominal": {
        "description": "Normal operation",
        "anomaly_fraction": 0.01,
        "events": [],
    }
}


def get_rate(name: str) -> float:
    return RATES_HZ.get(name, 0.5)


def backfill_historical(
    base_url: str,
    minutes: int,
    channels: dict[str, tuple[float, float]],
    anomaly_frac: float = 0.02,
) -> None:
    """Seed recent history with synthetic data so charts show a full time range."""
    data_url = f"{base_url.rstrip('/')}/telemetry/data"
    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(minutes=minutes)
    # ~1 point every 5 seconds for reasonable density
    interval_sec = 5
    n_points = max(1, (minutes * 60) // interval_sec)

    print(f"Backfilling {minutes} minutes of history ({n_points} points per channel)...")
    for name, (mean, std) in channels.items():
        data: list[dict[str, Any]] = []
        for i in range(n_points):
            ts = start_time + timedelta(seconds=i * interval_sec)
            anomaly = random.random() < anomaly_frac
            value = mean + (random.choice([-1, 1]) * random.uniform(2.5, 5.0) * std) if anomaly else random.gauss(mean, std)
            data.append({"timestamp": ts.isoformat(), "value": value})

        batch_size = 100
        for i in range(0, len(data), batch_size):
            batch = data[i : i + batch_size]
            try:
                r = requests.post(
                    data_url,
                    json={
                        "telemetry_name": name,
                        "data": batch,
                        "source_id": MOCK_VEHICLE_SOURCE_ID,
                        "stream_id": MOCK_VEHICLE_SOURCE_ID,
                    },
                    timeout=30,
                )
                if r.status_code != 200:
                    print(f"  Backfill error for {name}: {r.status_code}")
            except requests.RequestException as e:
                print(f"  Backfill failed for {name}: {e}")
    print("Backfill complete.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Mock vehicle telemetry streamer")
    parser.add_argument("--base-url", default="http://localhost:8000", help="Backend API URL")
    parser.add_argument("--scenario", default="nominal", choices=list(SCENARIOS), help="Scenario to run")
    parser.add_argument("--speed", type=float, default=1.0, help="Time speed factor (e.g. 10 = 10x faster)")
    parser.add_argument("--duration", type=float, default=3600, help="Duration in seconds")
    parser.add_argument(
        "--backfill-minutes",
        type=int,
        default=0,
        metavar="N",
        help="Seed N minutes of historical data before streaming (for full chart range)",
    )
    parser.add_argument("--drop-prob", type=float, default=0.0, help="Link dropout probability per sample")
    parser.add_argument("--jitter", type=float, default=0.1, help="Inter-sample jitter factor (0-1)")
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    ingest_url = f"{base_url}/telemetry/realtime/ingest"
    scenario = SCENARIOS[args.scenario]
    dropout_window = scenario.get("dropout")
    events = scenario.get("events", [])
    anomaly_frac = scenario.get("anomaly_fraction", 0.02)

    # Build channel lookup: name -> (mean, std)
    channels = {row[0]: (row[3], row[4]) for row in TELEMETRY_DEFINITIONS}

    if args.backfill_minutes > 0:
        backfill_historical(base_url, args.backfill_minutes, channels, anomaly_frac)

    print(f"Scenario: {args.scenario} - {scenario['description']}")
    print(f"Duration: {args.duration}s (speed={args.speed}x)")
    print(f"Ingest URL: {ingest_url}")
    print("Streaming... (Ctrl+C to stop)")

    start_wall = time.monotonic()
    start_sim = 0.0
    seq = 0
    batch: list[dict[str, Any]] = []
    batch_size = 20

    try:
        while True:
            wall_elapsed = time.monotonic() - start_wall
            sim_elapsed = wall_elapsed * args.speed
            if sim_elapsed >= args.duration:
                break

            now = datetime.now(timezone.utc)
            gen_time = (datetime.now(timezone.utc).replace(tzinfo=timezone.utc)).isoformat()

            # Check dropout window
            if dropout_window and dropout_window["t0"] <= sim_elapsed < dropout_window["t0"] + dropout_window["duration"]:
                time.sleep(0.1)
                continue

            # Check random dropout
            if args.drop_prob > 0 and random.random() < args.drop_prob:
                time.sleep(0.05)
                continue

            for row in TELEMETRY_DEFINITIONS:
                name, mean, std = row[0], row[3], row[4]
                rate = get_rate(name)
                # Simple rate limiting: emit with probability proportional to rate * dt
                dt = 0.1
                if random.random() > rate * dt:
                    continue

                # Apply scenario events
                value = random.gauss(mean, std)
                for ev in events:
                    if ev["t0"] <= sim_elapsed < ev["t0"] + ev.get("duration", 999):
                        if name in ev["channels"]:
                            if ev["type"] == "offset":
                                value += ev["magnitude"]
                            elif ev["type"] == "ramp":
                                progress = (sim_elapsed - ev["t0"]) / ev["duration"]
                                value += ev["magnitude"] * min(1.0, progress)
                            elif ev["type"] == "set":
                                value = ev["magnitude"]

                if random.random() < anomaly_frac:
                    value += random.choice([-1, 1]) * random.uniform(2.5, 5.0) * std

                seq += 1
                batch.append({
                    "source_id": MOCK_VEHICLE_SOURCE_ID,
                    "stream_id": MOCK_VEHICLE_SOURCE_ID,
                    "channel_name": name,
                    "generation_time": now.isoformat(),
                    "value": value,
                    "quality": "valid",
                    "sequence": seq,
                })

            if len(batch) >= batch_size:
                try:
                    r = requests.post(ingest_url, json={"events": batch}, timeout=5)
                    if r.status_code != 200:
                        print(f"  Ingest error {r.status_code}: {r.text[:200]}")
                    batch = []
                except requests.RequestException as e:
                    print(f"  Ingest failed: {e}")
                    batch = []

            jitter_sleep = 0.1 * (1 + (random.random() - 0.5) * args.jitter * 2)
            time.sleep(jitter_sleep / args.speed)

    except KeyboardInterrupt:
        print("\nStopped by user")

    if batch:
        try:
            requests.post(ingest_url, json={"events": batch}, timeout=5)
        except Exception:
            pass

    print("Done.")


if __name__ == "__main__":
    main()
