"""Simple circular LEO orbit model for simulator GPS position telemetry."""

import math


def position_at_time(
    sim_elapsed_sec: float,
    *,
    period_sec: float,
    inclination_deg: float,
    alt_m: float,
    lon0_deg: float = 0.0,
) -> tuple[float, float, float]:
    """Compute lat/lon/alt (degrees, degrees, meters) for a circular orbit at sim_elapsed.

    Latitude: phi = arcsin(sin(i) * sin(theta)), theta = 2*pi*t/T.
    Longitude: lambda = lon0 + (theta_dot - omega_earth)*t (rad), then wrap to [-180, 180].
    Altitude: constant.
    """
    theta = 2.0 * math.pi * sim_elapsed_sec / period_sec
    i_rad = math.radians(inclination_deg)
    lat_rad = math.asin(math.sin(i_rad) * math.sin(theta))
    lat_deg = math.degrees(lat_rad)

    theta_dot = 2.0 * math.pi / period_sec
    omega_earth = 2.0 * math.pi / 86400.0  # rad/s
    lon0_rad = math.radians(lon0_deg)
    lon_rad = lon0_rad + (theta_dot - omega_earth) * sim_elapsed_sec
    lon_deg = math.degrees(lon_rad)
    # Wrap to [-180, 180]
    lon_deg = ((lon_deg + 180.0) % 360.0) - 180.0

    return (lat_deg, lon_deg, alt_m)
