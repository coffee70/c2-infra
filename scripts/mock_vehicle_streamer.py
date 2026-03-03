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
from datetime import datetime, timezone
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
from generate_synthetic_telemetry import TELEMETRY_DEFINITIONS

# Rates (Hz) per subsystem for mixed-rate streaming
RATES_HZ = {
    "power": 1.0,
    "thermal": 0.2,
    "adcs": 5.0,
    "comms": 0.5,
    "obc": 0.5,
    "payload": 0.2,
    "propulsion": 0.1,
    "gps": 1.0,
    "safety": 0.2,
}

SCENARIOS = {
    "nominal": {
        "description": "Normal operation, occasional minor anomalies",
        "anomaly_fraction": 0.02,
        "events": [],
    },
    "power_sag": {
        "description": "Power bus voltage sag after t=30s",
        "anomaly_fraction": 0.01,
        "events": [
            {"t0": 30, "duration": 45, "type": "offset", "channels": ["PWR_BUS_A_VOLT", "PWR_BAT_VOLT"], "magnitude": -2.5},
        ],
    },
    "thermal_runaway": {
        "description": "Thermal panel temps rise after t=20s",
        "anomaly_fraction": 0.01,
        "events": [
            {"t0": 20, "duration": 60, "type": "ramp", "channels": ["THERM_PANEL_1_TEMP", "THERM_PANEL_2_TEMP", "THERM_CPU_TEMP"], "magnitude": 15},
        ],
    },
    "comm_dropout": {
        "description": "Comms dropout window at t=40-55s",
        "anomaly_fraction": 0.01,
        "dropout": {"t0": 40, "duration": 15},
    },
    "safe_mode": {
        "description": "Safe mode triggered at t=25s",
        "anomaly_fraction": 0.0,
        "events": [
            {"t0": 25, "duration": 999, "type": "set", "channels": ["SAFE_MODE"], "magnitude": 1.0},
        ],
    },
}


def get_subsystem(name: str) -> str:
    prefixes = [
        ("PWR_", "power"), ("EPS_", "power"),
        ("THERM_", "thermal"),
        ("ADCS_", "adcs"),
        ("COMM_", "comms"),
        ("OBC_", "obc"),
        ("PAY_", "payload"),
        ("PROP_", "propulsion"),
        ("GPS_", "gps"),
        ("SAFE_", "safety"), ("WATCHDOG_", "safety"), ("ERR_", "safety"), ("HEALTH_", "safety"),
    ]
    for prefix, sub in prefixes:
        if name.startswith(prefix):
            return sub
    return "other"


def get_rate(name: str) -> float:
    return RATES_HZ.get(get_subsystem(name), 0.5)


def main() -> None:
    parser = argparse.ArgumentParser(description="Mock vehicle telemetry streamer")
    parser.add_argument("--base-url", default="http://localhost:8000", help="Backend API URL")
    parser.add_argument("--scenario", default="nominal", choices=list(SCENARIOS), help="Scenario to run")
    parser.add_argument("--speed", type=float, default=1.0, help="Time speed factor (e.g. 10 = 10x faster)")
    parser.add_argument("--duration", type=float, default=300, help="Duration in seconds")
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
                    "source_id": "mock_vehicle",
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
