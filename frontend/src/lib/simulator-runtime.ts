"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface SimulatorRuntimeStatus {
  connected: boolean;
  state?: "idle" | "running" | "paused";
  config?: {
    scenario: string;
    duration: number;
    speed: number;
    drop_prob: number;
    jitter: number;
    source_id: string;
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
  const activeRunId = isActive ? status?.config?.source_id ?? null : null;
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
    `${API_URL}/simulator/status?source_id=${encodeURIComponent(sourceId)}`,
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
  const initialState = useMemo(
    () => toRuntimeState(enabled ? initialStatus : null),
    [enabled, initialStatus]
  );
  const [runtimeStore, setRuntimeStore] = useState<{
    sourceId: string;
    runtime: SimulatorRuntimeState;
  }>(() => ({
    sourceId,
    runtime: initialState,
  }));
  const runtime =
    enabled && runtimeStore.sourceId === sourceId
      ? runtimeStore.runtime
      : initialState;

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const status = await fetchSimulatorRuntimeStatus(sourceId);
      setRuntimeStore({
        sourceId,
        runtime: toRuntimeState(status),
      });
    } catch {
      setRuntimeStore({
        sourceId,
        runtime: toRuntimeState({ connected: false }),
      });
    }
  }, [enabled, sourceId]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const load = async () => {
      try {
        const status = await fetchSimulatorRuntimeStatus(sourceId);
        if (!cancelled) {
          setRuntimeStore({
            sourceId,
            runtime: toRuntimeState(status),
          });
        }
      } catch {
        if (!cancelled) {
          setRuntimeStore({
            sourceId,
            runtime: toRuntimeState({ connected: false }),
          });
        }
      }
    };

    load();
    const intervalId = setInterval(load, pollMs);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [enabled, pollMs, sourceId]);

  return {
    ...runtime,
    refresh,
  };
}
