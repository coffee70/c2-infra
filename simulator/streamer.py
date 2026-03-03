"""Background telemetry streamer with pause/resume/stop support."""

import random
import threading
import time
from datetime import datetime, timezone
from typing import Any

import requests

from simulator.telemetry_definitions import (
    RATES_HZ,
    SCENARIOS,
    TELEMETRY_DEFINITIONS,
)


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


class StreamerState:
    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"


class TelemetryStreamer:
    """Runs telemetry streaming in a background thread with pause/resume/stop."""

    def __init__(
        self,
        base_url: str,
        scenario: str = "nominal",
        duration: float = 300,
        speed: float = 1.0,
        drop_prob: float = 0.0,
        jitter: float = 0.1,
        source_id: str = "simulator",
    ):
        self.base_url = base_url.rstrip("/")
        self.ingest_url = f"{self.base_url}/telemetry/realtime/ingest"
        self.scenario_name = scenario
        self.scenario = SCENARIOS.get(scenario, SCENARIOS["nominal"])
        self.duration = duration
        self.speed = speed
        self.drop_prob = drop_prob
        self.jitter = jitter
        self.source_id = source_id

        self._state = StreamerState.IDLE
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._pause_event = threading.Event()
        self._pause_event.set()  # Not paused initially
        self._lock = threading.Lock()
        self._sim_elapsed = 0.0
        self._start_wall: float | None = None
        self._paused_at_sim: float = 0.0

    @property
    def state(self) -> str:
        with self._lock:
            return self._state

    @property
    def sim_elapsed(self) -> float:
        with self._lock:
            if self._state == StreamerState.PAUSED:
                return self._paused_at_sim
            if self._state == StreamerState.RUNNING and self._start_wall is not None:
                return (time.monotonic() - self._start_wall) * self.speed
            return self._sim_elapsed

    def _run_loop(self) -> None:
        dropout_window = self.scenario.get("dropout")
        events = self.scenario.get("events", [])
        anomaly_frac = self.scenario.get("anomaly_fraction", 0.02)
        batch_size = 20
        batch: list[dict[str, Any]] = []
        seq = 0

        while not self._stop_event.is_set():
            self._pause_event.wait()
            if self._stop_event.is_set():
                break

            with self._lock:
                if self._start_wall is None:
                    break
                sim_elapsed = (time.monotonic() - self._start_wall) * self.speed

            if self.duration > 0 and sim_elapsed >= self.duration:
                with self._lock:
                    self._state = StreamerState.IDLE
                break

            now = datetime.now(timezone.utc)

            if dropout_window and dropout_window["t0"] <= sim_elapsed < dropout_window["t0"] + dropout_window["duration"]:
                time.sleep(0.1)
                continue

            if self.drop_prob > 0 and random.random() < self.drop_prob:
                time.sleep(0.05)
                continue

            for row in TELEMETRY_DEFINITIONS:
                name, mean, std = row[0], row[3], row[4]
                rate = get_rate(name)
                dt = 0.1
                if random.random() > rate * dt:
                    continue

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
                    "source_id": self.source_id,
                    "channel_name": name,
                    "generation_time": now.isoformat(),
                    "value": value,
                    "quality": "valid",
                    "sequence": seq,
                })

            if len(batch) >= batch_size:
                try:
                    r = requests.post(self.ingest_url, json={"events": batch}, timeout=5)
                    if r.status_code != 200:
                        pass
                    batch = []
                except requests.RequestException:
                    batch = []

            jitter_sleep = 0.1 * (1 + (random.random() - 0.5) * self.jitter * 2)
            time.sleep(jitter_sleep / self.speed)

        if batch:
            try:
                requests.post(self.ingest_url, json={"events": batch}, timeout=5)
            except Exception:
                pass

        with self._lock:
            self._state = StreamerState.IDLE

    def start(self) -> bool:
        with self._lock:
            if self._state != StreamerState.IDLE:
                return False
            self._state = StreamerState.RUNNING
            self._stop_event.clear()
            self._pause_event.set()
            self._start_wall = time.monotonic()
            self._thread = threading.Thread(target=self._run_loop, daemon=True)
            self._thread.start()
        return True

    def pause(self) -> bool:
        with self._lock:
            if self._state != StreamerState.RUNNING:
                return False
            self._state = StreamerState.PAUSED
            self._paused_at_sim = (time.monotonic() - (self._start_wall or 0)) * self.speed
            self._pause_event.clear()
        return True

    def resume(self) -> bool:
        with self._lock:
            if self._state != StreamerState.PAUSED:
                return False
            self._state = StreamerState.RUNNING
            elapsed = self._paused_at_sim
            self._start_wall = time.monotonic() - (elapsed / self.speed)
            self._pause_event.set()
        return True

    def stop(self) -> bool:
        with self._lock:
            if self._state == StreamerState.IDLE:
                return True
            self._stop_event.set()
            self._pause_event.set()
        if self._thread:
            self._thread.join(timeout=2.0)
        with self._lock:
            self._state = StreamerState.IDLE
            self._thread = None
        return True
