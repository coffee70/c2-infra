"use client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const API_FALLBACK_URL = process.env.NEXT_PUBLIC_API_FALLBACK_URL || "";

function getApiBases(): string[] {
  const bases = [API_URL, API_FALLBACK_URL].filter(Boolean);
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

export interface OrbitStatus {
  source_id: string;
  status: "VALID" | "ANOMALY" | "INSUFFICIENT_DATA" | string;
  reason: string;
  orbit_type?: string | null;
  perigee_km?: number | null;
  apogee_km?: number | null;
  eccentricity?: number | null;
  velocity_kms?: number | null;
  period_sec?: number | null;
}

/** Response: map of source_id -> OrbitStatus */
export type OrbitStatusResponse = Record<string, OrbitStatus>;

function isOrbitStatus(value: unknown): value is OrbitStatus {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OrbitStatus>;
  return typeof candidate.source_id === "string" && typeof candidate.status === "string";
}

export async function fetchOrbitStatus(
  sourceId?: string
): Promise<OrbitStatusResponse> {
  const qs = sourceId
    ? `?source_id=${encodeURIComponent(sourceId)}`
    : "";
  const res = await fetchWithFallback(`/telemetry/orbit/status${qs}`);
  const data = (await res.json()) as OrbitStatusResponse | OrbitStatus | null;
  if (isOrbitStatus(data)) {
    return { [data.source_id]: data };
  }
  return data ?? {};
}
