"""Coordinate conversion utilities for position telemetry."""

from __future__ import annotations

import math
from typing import Tuple


# WGS84 ellipsoid constants
_WGS84_A = 6378137.0  # semi-major axis (m)
_WGS84_E2 = 6.69437999014e-3  # first eccentricity squared


def ecef_to_lla(x: float, y: float, z: float) -> Tuple[float, float, float]:
    """Convert ECEF (meters) to geodetic latitude, longitude, altitude.

    Returns (lat_deg, lon_deg, alt_m).
    """
    # Algorithm based on standard WGS84 closed-form approximation
    a = _WGS84_A
    e2 = _WGS84_E2
    b = a * math.sqrt(1.0 - e2)
    ep2 = (a * a - b * b) / (b * b)

    p = math.hypot(x, y)
    if p == 0.0:
        # On the polar axis; longitude is undefined, choose 0
        lon = 0.0
        lat = math.copysign(math.pi / 2.0, z)
        alt = abs(z) - b
        return math.degrees(lat), math.degrees(lon), alt

    th = math.atan2(a * z, b * p)
    lon = math.atan2(y, x)

    sin_th = math.sin(th)
    cos_th = math.cos(th)

    lat = math.atan2(
        z + ep2 * b * sin_th * sin_th * sin_th,
        p - e2 * a * cos_th * cos_th * cos_th,
    )

    sin_lat = math.sin(lat)
    N = a / math.sqrt(1.0 - e2 * sin_lat * sin_lat)
    alt = p / math.cos(lat) - N

    lat_deg = math.degrees(lat)
    lon_deg = math.degrees(lon)
    return lat_deg, lon_deg, alt


def eci_to_lla(x: float, y: float, z: float, timestamp) -> Tuple[float, float, float]:
    """Convert ECI to LLA.

    This is intentionally conservative for now: we do not attempt to
    approximate Earth rotation or handle precise orbit propagation here.
    For v1 of the Earth view, ECI-based mappings are not supported and
    callers should treat this as unavailable.
    """
    raise ValueError("eci_to_lla is not implemented; use gps_lla or ecef mappings")

