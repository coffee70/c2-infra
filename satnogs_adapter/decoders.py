"""AX.25 and APRS helpers."""

from __future__ import annotations

import re
from typing import Iterable

from satnogs_adapter.models import APRSPacket, AX25Frame

AX25_ADDRESS_SIZE = 7
POSITION_RE = re.compile(
    r"^(?:[!=/]|[@/]\d{6}[hz/])"
    r"(?P<lat>\d{4}\.\d{2}[NS])(?P<symtbl>.)"
    r"(?P<lon>\d{5}\.\d{2}[EW])(?P<symcode>.)(?P<rest>.*)$"
)
COURSE_SPEED_RE = re.compile(r"^(?P<course>\d{3})/(?P<speed>\d{3})")
ALTITUDE_RE = re.compile(r"/A=(?P<altitude>\d{6})")
KEY_VALUE_RE = re.compile(r"(?P<key>[A-Za-z][A-Za-z0-9_ -]{1,32})\s*[:=]\s*(?P<value>-?\d+(?:\.\d+)?)")


def _decode_ax25_callsign(chunk: bytes) -> str:
    raw = "".join(chr((byte >> 1) & 0x7F) for byte in chunk[:6]).strip()
    ssid = (chunk[6] >> 1) & 0x0F
    return f"{raw}-{ssid}" if ssid else raw


def parse_ax25_frame(frame_bytes: bytes) -> AX25Frame:
    if len(frame_bytes) < AX25_ADDRESS_SIZE * 2 + 2:
        raise ValueError("AX.25 frame too short")

    addresses: list[bytes] = []
    cursor = 0
    while cursor + AX25_ADDRESS_SIZE <= len(frame_bytes):
        chunk = frame_bytes[cursor : cursor + AX25_ADDRESS_SIZE]
        addresses.append(chunk)
        cursor += AX25_ADDRESS_SIZE
        if chunk[6] & 0x01:
            break

    if len(addresses) < 2:
        raise ValueError("AX.25 frame missing destination/source")
    if cursor + 2 > len(frame_bytes):
        raise ValueError("AX.25 frame missing control/pid")

    dest_callsign = _decode_ax25_callsign(addresses[0])
    src_callsign = _decode_ax25_callsign(addresses[1])
    digipeater_path = [_decode_ax25_callsign(chunk) for chunk in addresses[2:]]
    control = frame_bytes[cursor]
    pid = frame_bytes[cursor + 1]
    info_bytes = frame_bytes[cursor + 2 :]
    return AX25Frame(
        dest_callsign=dest_callsign,
        src_callsign=src_callsign,
        digipeater_path=digipeater_path,
        control=control,
        pid=pid,
        info_bytes=info_bytes,
    )


def normalize_callsign(callsign: str) -> str:
    return callsign.strip().upper()


def is_originated_packet(frame: AX25Frame, allowed_source_callsigns: Iterable[str]) -> bool:
    allowed = {normalize_callsign(item) for item in allowed_source_callsigns}
    return normalize_callsign(frame.src_callsign).split("-", 1)[0] in {
        item.split("-", 1)[0] for item in allowed
    }


def _ddmm_to_decimal(raw: str, *, is_lat: bool) -> float:
    head = 2 if is_lat else 3
    degrees = float(raw[:head])
    minutes = float(raw[head:-1])
    value = degrees + minutes / 60.0
    if raw.endswith(("S", "W")):
        value *= -1
    return value


def parse_aprs_payload(info_bytes: bytes) -> APRSPacket:
    payload = info_bytes.decode("ascii", errors="ignore").strip()
    if not payload:
        raise ValueError("empty APRS payload")

    fields: dict[str, float] = {}
    kv_fields: dict[str, float] = {}
    packet_type = "unknown"

    match = POSITION_RE.match(payload)
    if match:
        packet_type = "position"
        fields["latitude"] = _ddmm_to_decimal(match.group("lat"), is_lat=True)
        fields["longitude"] = _ddmm_to_decimal(match.group("lon"), is_lat=False)
        rest = match.group("rest")
        course_match = COURSE_SPEED_RE.match(rest)
        if course_match:
            fields["course_deg"] = float(course_match.group("course"))
            fields["speed_kmh"] = round(float(course_match.group("speed")) * 1.852, 3)
        altitude_match = ALTITUDE_RE.search(rest)
        if altitude_match:
            fields["altitude_m"] = round(float(altitude_match.group("altitude")) * 0.3048, 3)

    for kv_match in KEY_VALUE_RE.finditer(payload):
        key = kv_match.group("key").strip().lower().replace(" ", "_")
        value = float(kv_match.group("value"))
        kv_fields[key] = value
        fields.setdefault(key, value)

    if not fields:
        raise ValueError("APRS payload did not contain numeric telemetry")
    return APRSPacket(packet_type=packet_type, fields=fields, kv_fields=kv_fields, raw_payload=payload)

