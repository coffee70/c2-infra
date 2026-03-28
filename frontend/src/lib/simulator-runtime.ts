"use client";

import { useMemo } from "react";
import { useSimulatorStatusQuery } from "@/lib/query-hooks";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface SimulatorRuntimeStatus {
  connected: boolean;
  supported_scenarios?: {
    name: string;
    description: string;
  }[];
  state?: "idle" | "running" | "paused";
  config?: {
    scenario: string;
    duration: number;
    speed: number;
    drop_prob: number;
    jitter: number;
    vehicle_id: string;
    stream_id: string;
    packet_source?: string | null;
    receiver_id?: string | null;
    base_url: string;
  } | null;
  sim_elapsed?: number;
}

export interface SimulatorRuntimeState {
  status: SimulatorRuntimeStatus | null;
  activeRunId: string | null;
  isActive: boolean;
}

interface UseSimulatorRuntimeOptions {
  sourceId: string;
  enabled: boolean;
  pollMs?: number;
  initialStatus?: SimulatorRuntimeStatus | null;
}

function toRuntimeState(
  status: SimulatorRuntimeStatus | null
): SimulatorRuntimeState {
  const isActive =
    status?.connected === true &&
    status.state != null &&
    status.state !== "idle";
  const activeRunId = isActive ? status?.config?.stream_id ?? null : null;
  return {
    status,
    activeRunId,
    isActive,
  };
}

export async function fetchSimulatorRuntimeStatus(
  sourceId: string
): Promise<SimulatorRuntimeStatus> {
  const response = await fetch(
    `${API_URL}/simulator/status?vehicle_id=${encodeURIComponent(sourceId)}`,
    { cache: "no-store" }
  );
  if (!response.ok) {
    return { connected: false };
  }
  const data = (await response.json()) as SimulatorRuntimeStatus;
  return data ?? { connected: false };
}

export function useSimulatorRuntime({
  sourceId,
  enabled,
  pollMs = 2000,
  initialStatus = null,
}: UseSimulatorRuntimeOptions): SimulatorRuntimeState & {
  refresh: () => Promise<void>;
} {
  const initialState = useMemo(() => toRuntimeState(enabled ? initialStatus : null), [enabled, initialStatus]);
  const statusQuery = useSimulatorStatusQuery(sourceId, {
    enabled,
    refetchInterval: pollMs,
    initialData: initialStatus,
  });
  const runtime = enabled ? toRuntimeState(statusQuery.data ?? { connected: false }) : initialState;

  return {
    ...runtime,
    refresh: async () => {
      await statusQuery.refetch();
    },
  };
}
