"use client";

import { fetchJson } from "@/lib/api-client";

export type FeedState = "connected" | "degraded" | "disconnected";

export interface FeedStatusResponse {
  source_id: string;
  connected: boolean;
  state?: FeedState;
  last_reception_time: number | string | null;
  approx_rate_hz?: number | null;
}

export interface FeedStatus {
  source_id: string;
  connected: boolean;
  state: FeedState;
  last_reception_time: string | null;
  approx_rate_hz: number | null;
}

export function deriveFeedState(status: {
  connected: boolean;
  state?: FeedState;
  last_reception_time: number | string | null;
}): FeedState {
  if (status.state) return status.state;
  if (status.connected) return "connected";
  return status.last_reception_time != null ? "degraded" : "disconnected";
}

export function normalizeFeedStatus(
  status: FeedStatusResponse
): FeedStatus {
  const lastReceptionTime =
    typeof status.last_reception_time === "number"
      ? new Date(status.last_reception_time * 1000).toISOString()
      : status.last_reception_time;

  return {
    source_id: status.source_id,
    connected: status.connected,
    state: deriveFeedState(status),
    last_reception_time: lastReceptionTime,
    approx_rate_hz: status.approx_rate_hz ?? null,
  };
}

export async function fetchFeedStatus(sourceId: string): Promise<FeedStatus> {
  const data = await fetchJson<FeedStatusResponse>(
    `/ops/feed-status?source_id=${encodeURIComponent(sourceId)}`,
    { useFallback: true, cache: "no-store" }
  );
  return normalizeFeedStatus(data);
}
