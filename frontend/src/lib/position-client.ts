"use client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const API_FALLBACK_URL = process.env.NEXT_PUBLIC_API_FALLBACK_URL || "";

function getApiBases(): string[] {
  const bases = [API_URL, API_FALLBACK_URL].filter(Boolean);
  // Deduplicate while preserving order
  return bases.filter((v, i, arr) => arr.indexOf(v) === i);
}

async function fetchWithFallback(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const bases = getApiBases();
  let lastError: unknown = null;
  for (const base of bases) {
    try {
      const res = await fetch(`${base}${path}`, {
        cache: "no-store",
        ...(init ?? {}),
      });
      if (res.ok) return res;
      lastError = new Error(`HTTP ${res.status} from ${base}${path}`);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error("All API paths failed");
}

export interface PositionChannelMapping {
  id: string;
  vehicle_id: string;
  frame_type: string;
  lat_channel_name?: string | null;
  lon_channel_name?: string | null;
  alt_channel_name?: string | null;
  x_channel_name?: string | null;
  y_channel_name?: string | null;
  z_channel_name?: string | null;
  active: boolean;
}

export interface PositionChannelMappingUpsert {
  vehicle_id: string;
  frame_type: string;
  lat_channel_name?: string | null;
  lon_channel_name?: string | null;
  alt_channel_name?: string | null;
  x_channel_name?: string | null;
  y_channel_name?: string | null;
  z_channel_name?: string | null;
  active?: boolean;
}

export interface PositionSample {
  vehicle_id: string;
  vehicle_name: string;
  vehicle_type: string;
  stream_id?: string | null;
  lat_deg?: number | null;
  lon_deg?: number | null;
  alt_m?: number | null;
  timestamp?: string | null;
  valid: boolean;
  frame_type: string;
  raw_channels?: Record<string, number | null> | null;
}

/** One point in a position history trail (lat/lon/alt + optional timestamp). */
export interface PositionHistoryEntry {
  lat_deg: number;
  lon_deg: number;
  alt_m: number;
  timestamp?: string;
}

export async function fetchPositionConfig(
  vehicleId?: string
): Promise<PositionChannelMapping[]> {
  const qs = vehicleId ? `?vehicle_id=${encodeURIComponent(vehicleId)}` : "";
  const res = await fetchWithFallback(`/telemetry/position/config${qs}`);
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data as PositionChannelMapping[];
}

export async function fetchLatestPositions(
  vehicleIds?: string[]
): Promise<PositionSample[]> {
  const params = new URLSearchParams();
  if (vehicleIds && vehicleIds.length > 0) {
    for (const id of vehicleIds) {
      params.append("vehicle_ids", id);
    }
  }
  const qs = params.toString();
  const res = await fetchWithFallback(
    `/telemetry/position/latest${qs ? `?${qs}` : ""}`
  );
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data as PositionSample[];
}

export async function upsertPositionConfig(
  body: PositionChannelMappingUpsert
): Promise<PositionChannelMapping> {
  const res = await fetchWithFallback(`/telemetry/position/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      active: body.active ?? true,
    }),
  } as RequestInit);
  if (!res.ok) {
    const text = await res.text();
    let message = "Failed to save position mapping";
    try {
      const json = JSON.parse(text) as { detail?: string };
      if (typeof json.detail === "string") message = json.detail;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }
  return (await res.json()) as PositionChannelMapping;
}

export async function deletePositionConfig(id: string): Promise<void> {
  const res = await fetchWithFallback(`/telemetry/position/config/${id}`, {
    method: "DELETE",
  } as RequestInit);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Failed to delete position mapping");
  }
}
