"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { runIdToSourceId } from "@/components/context-banner";
import { WatchlistConfig } from "@/components/watchlist-config";
import { RealtimeOverviewWrapper } from "@/components/realtime-overview-wrapper";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import {
  useSimulatorRuntime,
  type SimulatorRuntimeStatus,
} from "@/lib/simulator-runtime";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const API_FALLBACK_URL = process.env.NEXT_PUBLIC_API_FALLBACK_URL || "";

const DEFAULT_SOURCE_ID = "default";

async function fetchWithTimeoutAndFallback(path: string): Promise<Response> {
  const bases = [API_URL, API_FALLBACK_URL].filter(
    (v, i, arr) => arr.indexOf(v) === i
  );
  let lastError: unknown = null;
  for (const base of bases) {
    try {
      const res = await fetch(`${base}${path}`, {
        cache: "no-store",
      });
      if (res.ok) {
        return res;
      }
      lastError = new Error(`HTTP ${res.status} from ${base}${path}`);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error("All API paths failed");
}

interface OverviewChannel {
  name: string;
  units?: string | null;
  description?: string | null;
  subsystem_tag: string;
  current_value: number | null;
  last_timestamp: string | null;
  state: string;
  state_reason?: string | null;
  z_score?: number | null;
  sparkline_data: { timestamp: string; value: number }[];
}

interface WatchlistEntry {
  name: string;
  display_order: number;
}

interface AnomaliesData {
  power: { name: string; units?: string; current_value: number; last_timestamp: string; z_score?: number; state_reason?: string }[];
  thermal: { name: string; units?: string; current_value: number; last_timestamp: string; z_score?: number; state_reason?: string }[];
  adcs: { name: string; units?: string; current_value: number; last_timestamp: string; z_score?: number; state_reason?: string }[];
  comms: { name: string; units?: string; current_value: number; last_timestamp: string; z_score?: number; state_reason?: string }[];
  other?: { name: string; units?: string; current_value: number; last_timestamp: string; z_score?: number; state_reason?: string }[];
}

interface TelemetrySource {
  id: string;
  name: string;
  description?: string | null;
  source_type?: string;
}

interface OverviewSnapshot {
  channels: OverviewChannel[];
  anomalies: AnomaliesData;
  hasPartialFailure: boolean;
}

const OVERVIEW_SOURCE_STORAGE_KEY = "overviewSourceId";
const EMPTY_ANOMALIES: AnomaliesData = {
  power: [],
  thermal: [],
  adcs: [],
  comms: [],
  other: [],
};

function buildPlaceholderChannel(name: string): OverviewChannel {
  return {
    name,
    units: null,
    description: null,
    subsystem_tag: "other",
    current_value: null,
    last_timestamp: null,
    state: "no_data",
    state_reason: "waiting_for_data",
    z_score: null,
    sparkline_data: [],
  };
}

function mergeWatchlistChannels(
  entries: WatchlistEntry[],
  channels: OverviewChannel[]
): OverviewChannel[] {
  const channelsByName = new Map(channels.map((channel) => [channel.name, channel]));
  return entries.map((entry) => channelsByName.get(entry.name) ?? buildPlaceholderChannel(entry.name));
}

async function fetchOverviewSnapshot(
  runId: string
): Promise<OverviewSnapshot> {
  const [overviewRes, anomaliesRes, watchlistRes] = await Promise.all([
    fetchWithTimeoutAndFallback(
      `/telemetry/overview?source_id=${encodeURIComponent(runId)}`
    ),
    fetchWithTimeoutAndFallback(
      `/telemetry/anomalies?source_id=${encodeURIComponent(runId)}`
    ),
    fetchWithTimeoutAndFallback("/telemetry/watchlist"),
  ]);

  const overviewData = overviewRes.ok ? await overviewRes.json() : { channels: [] };
  const anomaliesData = anomaliesRes.ok
    ? await anomaliesRes.json()
    : EMPTY_ANOMALIES;
  const watchlistData = watchlistRes.ok ? await watchlistRes.json() : { entries: [] };
  const watchlistEntries = Array.isArray(watchlistData.entries)
    ? watchlistData.entries
    : [];

  return {
    channels: mergeWatchlistChannels(
      watchlistEntries,
      Array.isArray(overviewData.channels) ? overviewData.channels : []
    ),
    anomalies: {
      power: anomaliesData.power || [],
      thermal: anomaliesData.thermal || [],
      adcs: anomaliesData.adcs || [],
      comms: anomaliesData.comms || [],
      other: anomaliesData.other || [],
    },
    hasPartialFailure: !overviewRes.ok || !anomaliesRes.ok || !watchlistRes.ok,
  };
}

export function OverviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sourceFromUrl = searchParams.get("source");

  const [storedSource, setStoredSource] = useState<string | null>(null);
  const [storageChecked, setStorageChecked] = useState(false);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<OverviewChannel[]>([]);
  const [anomalies, setAnomalies] = useState<AnomaliesData>(EMPTY_ANOMALIES);
  const [sources, setSources] = useState<TelemetrySource[]>([]);
  const [initialSimulatorSourceId, setInitialSimulatorSourceId] = useState<
    string | null
  >(null);
  const [initialSimulatorStatus, setInitialSimulatorStatus] = useState<
    SimulatorRuntimeStatus | null
  >(null);
  const [committedRunId, setCommittedRunId] = useState<string | null>(null);
  const [desiredRunId, setDesiredRunId] = useState<string | null>(null);
  const [showSwitchingIndicator, setShowSwitchingIndicator] = useState(false);

  let effectiveSource =
    sourceFromUrl ?? storedSource ?? DEFAULT_SOURCE_ID;
  if (effectiveSource && /-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z?$/.test(effectiveSource)) {
    effectiveSource = runIdToSourceId(effectiveSource);
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem(OVERVIEW_SOURCE_STORAGE_KEY, effectiveSource);
      } catch {}
      router.replace(`/overview?source=${encodeURIComponent(effectiveSource)}`);
    }
  }
  const sourceReady = sourceFromUrl !== null || storageChecked;
  const sourceType = useMemo(
    () => sources.find((s) => s.id === effectiveSource)?.source_type,
    [effectiveSource, sources]
  );
  const isSimulatorSource = sourceType === "simulator";
  const simulatorRuntime = useSimulatorRuntime({
    sourceId: effectiveSource,
    enabled: sourceReady && isSimulatorSource,
    initialStatus:
      initialSimulatorSourceId === effectiveSource ? initialSimulatorStatus : null,
  });
  const isSwitchingRuns =
    !bootstrapLoading &&
    desiredRunId != null &&
    committedRunId != null &&
    desiredRunId !== committedRunId;

  const refreshCommittedSnapshot = useCallback(async () => {
    if (!committedRunId) return;

    try {
      setError(null);
      const snapshot = await fetchOverviewSnapshot(committedRunId);
      setChannels(snapshot.channels);
      setAnomalies(snapshot.anomalies);
      if (snapshot.hasPartialFailure) {
        setError("Some data failed to load");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load overview");
    }
  }, [committedRunId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setStoredSource(sessionStorage.getItem(OVERVIEW_SOURCE_STORAGE_KEY));
    } catch {
      setStoredSource(null);
    }
    setStorageChecked(true);
  }, []);

  useEffect(() => {
    if (!sourceReady) return;

    let cancelled = false;

    async function loadBootstrap() {
      try {
        setBootstrapLoading(true);
        setError(null);
        setCommittedRunId(null);
        setDesiredRunId(null);
        setShowSwitchingIndicator(false);

        const sourcesPromise = fetchWithTimeoutAndFallback(
          "/telemetry/sources"
        );
        const runsPromise = fetchWithTimeoutAndFallback(
          `/telemetry/sources/${encodeURIComponent(effectiveSource)}/runs`
        );

        const [sourcesRes, runsRes] = await Promise.all([
          sourcesPromise,
          runsPromise,
        ]);

        if (cancelled) return;

        const sourcesList = sourcesRes.ok ? await sourcesRes.json() : [];
        const runsData = runsRes.ok ? await runsRes.json() : { sources: [] };
        const runsList = Array.isArray(runsData.sources)
          ? runsData.sources
          : [];

        const isSimulatorSource = Array.isArray(sourcesList)
          && sourcesList.some(
            (s: TelemetrySource) =>
              s.id === effectiveSource && s.source_type === "simulator"
          );

        let simSourceId: string | null = null;
        let simStatus: SimulatorRuntimeStatus | null = null;
        if (isSimulatorSource) {
          try {
            const simRes = await fetchWithTimeoutAndFallback(
              `/simulator/status?source_id=${encodeURIComponent(effectiveSource)}`
            );
            simStatus = simRes.ok ? await simRes.json() : { connected: false };
            simSourceId = effectiveSource;
          } catch {
            simStatus = { connected: false };
            simSourceId = effectiveSource;
          }
        }

        const runtimeRunId =
          simStatus?.connected && simStatus.state !== "idle"
            ? simStatus.config?.source_id ?? null
            : null;
        const effectiveRunId = isSimulatorSource
          ? runtimeRunId ?? effectiveSource
          : runsList[0]?.source_id ?? effectiveSource;
        const snapshot = await fetchOverviewSnapshot(effectiveRunId);

        if (cancelled) return;

        setSources(Array.isArray(sourcesList) ? sourcesList : []);
        setChannels(snapshot.channels);
        setAnomalies(snapshot.anomalies);
        setCommittedRunId(effectiveRunId);
        setDesiredRunId(effectiveRunId);
        setInitialSimulatorSourceId(simSourceId);
        setInitialSimulatorStatus(simStatus);
        if (snapshot.hasPartialFailure) {
          setError("Some data failed to load");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load overview");
        }
      } finally {
        if (!cancelled) {
          setBootstrapLoading(false);
        }
      }
    }

    loadBootstrap();
    return () => {
      cancelled = true;
    };
  }, [effectiveSource, sourceReady]);

  useEffect(() => {
    if (!sourceReady || !isSimulatorSource) return;

    const nextRunId = simulatorRuntime.isActive
      ? simulatorRuntime.activeRunId ?? desiredRunId ?? effectiveSource
      : effectiveSource;
    if (!nextRunId || nextRunId === desiredRunId) return;
    setDesiredRunId(nextRunId);
  }, [
    desiredRunId,
    effectiveSource,
    isSimulatorSource,
    simulatorRuntime.activeRunId,
    simulatorRuntime.isActive,
    sourceReady,
  ]);

  useEffect(() => {
    if (
      !sourceReady ||
      bootstrapLoading ||
      !committedRunId ||
      !desiredRunId ||
      desiredRunId === committedRunId
    ) {
      return;
    }

    let cancelled = false;
    const runId = desiredRunId;

    async function switchSnapshot() {
      try {
        setShowSwitchingIndicator(true);
        setError(null);

        const snapshot = await fetchOverviewSnapshot(runId);

        if (cancelled) return;

        setChannels(snapshot.channels);
        setAnomalies(snapshot.anomalies);
        setCommittedRunId(runId);
        if (snapshot.hasPartialFailure) {
          setError("Some data failed to load");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load overview");
        }
      }
    }

    switchSnapshot();
    return () => {
      cancelled = true;
    };
  }, [bootstrapLoading, committedRunId, desiredRunId, sourceReady]);

  useEffect(() => {
    if (isSwitchingRuns || !showSwitchingIndicator) return;

    const timeoutId = window.setTimeout(() => {
      setShowSwitchingIndicator(false);
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isSwitchingRuns, showSwitchingIndicator]);

  if (!sourceReady || bootstrapLoading || !committedRunId) {
    return (
      <div className="min-h-screen p-4 sm:p-6 lg:p-8 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Spinner size="lg" className="h-10 w-10" />
          <p className="text-sm text-muted-foreground">Loading overview…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              {error} — Check your connection and try again.
            </AlertDescription>
          </Alert>
        )}
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              Operator Overview
            </h1>
          </div>
          <WatchlistConfig onChanged={refreshCommittedSnapshot} />
        </div>
        <RealtimeOverviewWrapper
          initialChannels={channels}
          initialAnomalies={anomalies}
          hasError={!!error}
          sources={sources}
          initialSourceId={effectiveSource || DEFAULT_SOURCE_ID}
          feedSourceId={committedRunId ?? undefined}
          defaultSourceId={DEFAULT_SOURCE_ID}
          initialSimulatorSourceId={initialSimulatorSourceId}
          initialSimulatorStatus={initialSimulatorStatus}
          simulatorStatus={simulatorRuntime.status}
          isSwitchingRuns={isSwitchingRuns}
          showSwitchingIndicator={showSwitchingIndicator || isSwitchingRuns}
        />
      </div>
    </div>
  );
}
