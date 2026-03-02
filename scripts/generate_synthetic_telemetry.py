#!/usr/bin/env python3
"""
Synthetic telemetry data generator for local development and validation.

Generates at least 50 telemetry points with spacecraft-style names,
Gaussian-distributed time-series data, and occasional anomalies.

Usage:
    python scripts/generate_synthetic_telemetry.py [--base-url URL]

Requires the backend to be running (e.g., docker compose up -d backend).
"""

import argparse
import random
import sys
from datetime import datetime, timedelta, timezone
from typing import Any

try:
    import requests
except ImportError:
    print("Install requests: pip install requests")
    sys.exit(1)

# Telemetry definitions: (name, units, description, mean, std_dev, subsystem_tag, red_low, red_high)
# red_low/red_high are optional; use None for no limits
TELEMETRY_DEFINITIONS = [
    ("PWR_BUS_A_VOLT", "V", "Power bus A voltage", 28.0, 0.5, "power", 26.0, 30.0),
    ("PWR_BUS_B_VOLT", "V", "Power bus B voltage", 28.0, 0.5, "power", None, None),
    ("PWR_BUS_C_VOLT", "V", "Power bus C voltage", 28.0, 0.5, "power", None, None),
    ("PWR_BAT_VOLT", "V", "Battery voltage", 24.0, 1.0, "power", None, None),
    ("PWR_BAT_CURR", "A", "Battery current", 2.5, 0.3, "power", None, None),
    ("PWR_SOLAR_CURR", "A", "Solar panel current", 5.0, 0.8, "power", None, None),
    ("THERM_PANEL_1_TEMP", "C", "Thermal panel 1 temperature", 25.0, 5.0, "thermal", None, None),
    ("THERM_PANEL_2_TEMP", "C", "Thermal panel 2 temperature", 25.0, 5.0, "thermal", None, None),
    ("THERM_PANEL_3_TEMP", "C", "Thermal panel 3 temperature", 24.0, 5.0, "thermal", None, None),
    ("THERM_PANEL_4_TEMP", "C", "Thermal panel 4 temperature", 26.0, 5.0, "thermal", None, None),
    ("THERM_BAT_TEMP", "C", "Battery temperature", 20.0, 3.0, "thermal", None, None),
    ("THERM_CPU_TEMP", "C", "CPU temperature", 45.0, 8.0, "thermal", None, None),
    ("THERM_RAD_TEMP", "C", "Radiator temperature", 15.0, 4.0, "thermal", None, None),
    ("ADCS_RW_1_SPEED", "rpm", "Reaction wheel 1 speed", 0.0, 500.0, "adcs", None, None),
    ("ADCS_RW_2_SPEED", "rpm", "Reaction wheel 2 speed", 0.0, 500.0, "adcs", None, None),
    ("ADCS_RW_3_SPEED", "rpm", "Reaction wheel 3 speed", 0.0, 500.0, "adcs", None, None),
    ("ADCS_RW_4_SPEED", "rpm", "Reaction wheel 4 speed", 0.0, 500.0, "adcs", None, None),
    ("ADCS_MAG_X", "nT", "Magnetometer X axis", 0.0, 100.0, "adcs", None, None),
    ("ADCS_MAG_Y", "nT", "Magnetometer Y axis", 0.0, 100.0, "adcs", None, None),
    ("ADCS_MAG_Z", "nT", "Magnetometer Z axis", 0.0, 100.0, "adcs", None, None),
    ("ADCS_GYRO_X", "deg/s", "Gyroscope X rate", 0.0, 0.1, "adcs", None, None),
    ("ADCS_GYRO_Y", "deg/s", "Gyroscope Y rate", 0.0, 0.1, "adcs", None, None),
    ("ADCS_GYRO_Z", "deg/s", "Gyroscope Z rate", 0.0, 0.1, "adcs", None, None),
    ("ADCS_SUN_X", "V", "Sun sensor X", 2.5, 0.2, "adcs", None, None),
    ("ADCS_SUN_Y", "V", "Sun sensor Y", 2.5, 0.2, "adcs", None, None),
    ("ADCS_SUN_Z", "V", "Sun sensor Z", 2.5, 0.2, "adcs", None, None),
    ("COMM_RSSI", "dBm", "Communication RSSI", -70.0, 10.0, "comms", None, None),
    ("COMM_BER", "1", "Bit error rate", 1e-6, 1e-7, "comms", None, None),
    ("COMM_TX_PWR", "dBm", "Transmit power", 30.0, 2.0, "comms", None, None),
    ("OBC_CPU_LOAD", "%", "CPU load percentage", 40.0, 20.0, "obc", None, None),
    ("OBC_MEM_USED", "%", "Memory used percentage", 60.0, 15.0, "obc", None, None),
    ("OBC_DISK_USED", "%", "Disk used percentage", 45.0, 10.0, "obc", None, None),
    ("OBC_UPTIME", "s", "System uptime seconds", 86400.0, 10000.0, "obc", None, None),
    ("PAY_CAM_TEMP", "C", "Camera temperature", 30.0, 5.0, "payload", None, None),
    ("PAY_CAM_GAIN", "dB", "Camera gain", 20.0, 5.0, "payload", None, None),
    ("PAY_SPEC_TEMP", "C", "Spectrometer temperature", 25.0, 3.0, "payload", None, None),
    ("PAY_SPEC_INT", "counts", "Spectrometer intensity", 1000.0, 200.0, "payload", None, None),
    ("EPS_3V3_CURR", "mA", "3.3V rail current", 500.0, 50.0, "power", None, None),
    ("EPS_5V_CURR", "mA", "5V rail current", 300.0, 40.0, "power", None, None),
    ("EPS_12V_CURR", "mA", "12V rail current", 100.0, 20.0, "power", None, None),
    ("EPS_3V3_VOLT", "V", "3.3V rail voltage", 3.3, 0.05, "power", None, None),
    ("EPS_5V_VOLT", "V", "5V rail voltage", 5.0, 0.08, "power", None, None),
    ("EPS_12V_VOLT", "V", "12V rail voltage", 12.0, 0.15, "power", None, None),
    ("PROP_TANK_PRES", "kPa", "Propellant tank pressure", 200.0, 20.0, "propulsion", None, None),
    ("PROP_TANK_TEMP", "C", "Propellant tank temperature", 15.0, 5.0, "propulsion", None, None),
    ("PROP_VALVE_1", "0/1", "Propulsion valve 1 state", 0.0, 0.1, "propulsion", None, None),
    ("PROP_VALVE_2", "0/1", "Propulsion valve 2 state", 0.0, 0.1, "propulsion", None, None),
    ("GPS_LAT", "deg", "GPS latitude", 0.0, 5.0, "gps", None, None),
    ("GPS_LON", "deg", "GPS longitude", 0.0, 5.0, "gps", None, None),
    ("GPS_ALT", "m", "GPS altitude", 400000.0, 10000.0, "gps", None, None),
    ("GPS_SATS", "1", "GPS satellites in view", 8.0, 2.0, "gps", None, None),
    ("SAFE_MODE", "0/1", "Safe mode indicator", 0.0, 0.05, "safety", None, None),
    ("WATCHDOG_CNT", "1", "Watchdog reset count", 0.0, 0.5, "safety", None, None),
    ("ERR_CNT", "1", "Error counter", 0.0, 2.0, "safety", None, None),
    ("HEALTH_STATUS", "0/1", "Overall health status", 1.0, 0.1, "safety", None, None),
]

# Default watchlist channels for operator overview
DEFAULT_WATCHLIST = [
    "PWR_BUS_A_VOLT",
    "PWR_BAT_VOLT",
    "PWR_SOLAR_CURR",
    "THERM_BAT_TEMP",
    "THERM_CPU_TEMP",
    "THERM_PANEL_1_TEMP",
    "ADCS_RW_1_SPEED",
    "ADCS_MAG_X",
    "ADCS_GYRO_X",
    "COMM_RSSI",
    "COMM_TX_PWR",
]

ANOMALY_FRACTION = 0.03  # ~3% of points are anomalies
POINTS_PER_TELEMETRY = 1000
BATCH_SIZE = 100


def generate_value(mean: float, std: float, anomaly: bool) -> float:
    """Generate a value, optionally as anomaly (beyond 2 sigma)."""
    if anomaly:
        sign = random.choice([-1, 1])
        return mean + sign * random.uniform(2.5, 5.0) * std
    return random.gauss(mean, std)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic telemetry data")
    parser.add_argument(
        "--base-url",
        default="http://localhost:8000",
        help="Backend API base URL",
    )
    args = parser.parse_args()
    base_url = args.base_url.rstrip("/")

    print(f"Using API: {base_url}")
    print(f"Creating {len(TELEMETRY_DEFINITIONS)} telemetry schemas...")

    for row in TELEMETRY_DEFINITIONS:
        name, units, desc, mean, std = row[0], row[1], row[2], row[3], row[4]
        subsystem = row[5] if len(row) > 5 else None
        red_low = row[6] if len(row) > 6 else None
        red_high = row[7] if len(row) > 7 else None
        payload = {"name": name, "units": units, "description": desc}
        if subsystem:
            payload["subsystem_tag"] = subsystem
        if red_low is not None:
            payload["red_low"] = red_low
        if red_high is not None:
            payload["red_high"] = red_high
        try:
            r = requests.post(
                f"{base_url}/telemetry/schema",
                json=payload,
                timeout=30,
            )
            if r.status_code == 200:
                print(f"  Created: {name}")
            elif r.status_code == 409:
                print(f"  Exists:  {name}")
            else:
                print(f"  Error {r.status_code}: {name} - {r.text}")
        except requests.RequestException as e:
            print(f"  Failed: {name} - {e}")
            sys.exit(1)

    print(f"\nGenerating {POINTS_PER_TELEMETRY} data points per telemetry...")

    base_time = datetime.now(timezone.utc) - timedelta(hours=24)
    total_inserted = 0

    for row in TELEMETRY_DEFINITIONS:
        name, units, desc, mean, std = row[0], row[1], row[2], row[3], row[4]
        data: list[dict[str, Any]] = []
        for i in range(POINTS_PER_TELEMETRY):
            ts = base_time + timedelta(seconds=i * 86.4)  # ~1000 points over 24h
            anomaly = random.random() < ANOMALY_FRACTION
            value = generate_value(mean, std, anomaly)
            data.append({"timestamp": ts.isoformat(), "value": value})

        for i in range(0, len(data), BATCH_SIZE):
            batch = data[i : i + BATCH_SIZE]
            try:
                r = requests.post(
                    f"{base_url}/telemetry/data",
                    json={"telemetry_name": name, "data": batch},
                    timeout=60,
                )
                if r.status_code == 200:
                    total_inserted += r.json().get("rows_inserted", 0)
                else:
                    print(f"  Error inserting {name}: {r.status_code}")
            except requests.RequestException as e:
                print(f"  Failed insert {name}: {e}")

        print(f"  Loaded: {name}")

    print(f"\nTotal rows inserted: {total_inserted}")

    print("\nSeeding default watchlist...")
    for i, ch_name in enumerate(DEFAULT_WATCHLIST):
        try:
            r = requests.post(
                f"{base_url}/telemetry/watchlist",
                json={"telemetry_name": ch_name},
                timeout=10,
            )
            if r.status_code in (200, 201):
                print(f"  Added to watchlist: {ch_name}")
        except requests.RequestException as e:
            print(f"  Watchlist add failed for {ch_name}: {e}")

    print("\nNext step: POST to /telemetry/recompute-stats to compute statistics")
    print("  curl -X POST http://localhost:8000/telemetry/recompute-stats")


if __name__ == "__main__":
    main()
