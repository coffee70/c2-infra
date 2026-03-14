"""Tests for simulator orbit profiles and anomaly presets."""

from __future__ import annotations

from app.orbit import get_status, submit_position_sample
from app.orbit.math import lla_to_ecef_km, velocity_from_positions
from app.orbit.state import get_orbit_state
from simulator.orbit import position_at_time

PERIOD_SEC = 90.0 * 60.0
INCLINATION_DEG = 51.6
ALT_M = 400_000.0


def _reset_orbit_state() -> None:
    state = get_orbit_state()
    state._status.clear()
    state._buffers.clear()


def _sample_status(profile: str, *, t0: float = 1200.0, dt: float = 1.0) -> dict:
    _reset_orbit_state()
    lat0, lon0, alt0 = position_at_time(
        t0,
        period_sec=PERIOD_SEC,
        inclination_deg=INCLINATION_DEG,
        alt_m=ALT_M,
        profile=profile,
    )
    lat1, lon1, alt1 = position_at_time(
        t0 + dt,
        period_sec=PERIOD_SEC,
        inclination_deg=INCLINATION_DEG,
        alt_m=ALT_M,
        profile=profile,
    )
    submit_position_sample(profile, t0, lat0, lon0, alt0)
    submit_position_sample(profile, t0 + dt, lat1, lon1, alt1)
    return get_status(profile)


def test_orbit_nominal_path_stays_physically_plausible() -> None:
    max_speed_km_s = 0.0
    prev = None
    for t in range(0, 180):
        curr = position_at_time(
            float(t),
            period_sec=PERIOD_SEC,
            inclination_deg=INCLINATION_DEG,
            alt_m=ALT_M,
            profile="orbit_nominal",
        )
        if prev is not None:
            r_prev = lla_to_ecef_km(*prev)
            r_curr = lla_to_ecef_km(*curr)
            vx, vy, vz = velocity_from_positions(r_prev, r_curr, 1.0)
            speed = (vx * vx + vy * vy + vz * vz) ** 0.5
            max_speed_km_s = max(max_speed_km_s, speed)
        prev = curr

    assert max_speed_km_s < 9.0


def test_orbit_decay_profile_triggers_decay() -> None:
    status = _sample_status("orbit_decay")
    assert status["status"] == "ORBIT_DECAY"


def test_orbit_highly_elliptical_profile_triggers_high_eccentricity() -> None:
    status = _sample_status("orbit_highly_elliptical", t0=0.0)
    assert status["status"] == "HIGHLY_ELLIPTICAL"


def test_orbit_suborbital_profile_triggers_suborbital() -> None:
    status = _sample_status("orbit_suborbital")
    assert status["status"] == "SUBORBITAL"


def test_orbit_escape_profile_triggers_escape() -> None:
    status = _sample_status("orbit_escape")
    assert status["status"] == "ESCAPE_TRAJECTORY"
