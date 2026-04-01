"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { WatchlistConfig } from "@/components/watchlist-config";
import { RealtimeOverviewWrapper } from "@/components/realtime-overview-wrapper";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  useSimulatorRuntime,
  type SimulatorRuntimeStatus,
} from "@/lib/simulator-runtime";
import { DEFAULT_SOURCE_ID, resolveSourceAlias } from "@/lib/source-ids";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const API_FALLBACK_URL = process.env.NEXT_PUBLIC_API_FALLBACK_URL || "";
const BOOTSTRAP_REQUEST_TIMEOUT_MS = 10_000;

async function fetchWithTimeoutAndFallback(path: string): Promise<Response> {
  const bases = [API_URL, API_FALLBACK_URL].filter(
    (v, i, arr) => arr.indexOf(v) === i
  );
  let lastError: unknown = null;
  for (const base of bases) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, BOOTSTRAP_REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}${path}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (res.ok) {
        return res;
      }
      lastError = new Error(`HTTP ${res.status} from ${base}${path}`);
    } catch (e) {
      lastError =
        controller.signal.aborted && e instanceof DOMException && e.name === "AbortError"
          ? new Error(`Request timed out after ${BOOTSTRAP_REQUEST_TIMEOUT_MS}ms for ${base}${path}`)
          : e;
    } finally {
      window.clearTimeout(timeoutId);
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

async function readJsonResponse<T>(
  response: Response,
  label: string
): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "unknown content type";
  const body = await response.text();

  if (!contentType.includes("application/json")) {
    const snippet = body.slice(0, 120).replace(/\s+/g, " ").trim();
    throw new Error(
      `Expected JSON from ${label}, got ${contentType}${snippet ? ` (${snippet})` : ""}`
    );
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    const snippet = body.slice(0, 120).replace(/\s+/g, " ").trim();
    console.error(`[Overview] Invalid JSON from ${label}`, {
      contentType,
      snippet,
    });
    throw new Error(
      `Invalid JSON from ${label}${snippet ? ` (${snippet})` : ""}`
    );
  }
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
  streamId: string
): Promise<OverviewSnapshot> {
  const [overviewRes, anomaliesRes, watchlistRes] = await Promise.all([
    fetchWithTimeoutAndFallback(
      `/telemetry/overview?source_id=${encodeURIComponent(streamId)}`
    ),
    fetchWithTimeoutAndFallback(
      `/telemetry/anomalies?source_id=${encodeURIComponent(streamId)}`
    ),
    fetchWithTimeoutAndFallback(`/telemetry/watchlist?source_id=${encodeURIComponent(streamId)}`),
  ]);

  const overviewData = overviewRes.ok
    ? await readJsonResponse<{ channels?: OverviewChannel[] }>(
        overviewRes,
        "/telemetry/overview"
      )
    : { channels: [] };
  const anomaliesData = anomaliesRes.ok
    ? await readJsonResponse<AnomaliesData>(anomaliesRes, "/telemetry/anomalies")
    : EMPTY_ANOMALIES;
  const watchlistData = watchlistRes.ok
    ? await readJsonResponse<{ entries?: WatchlistEntry[] }>(
        watchlistRes,
        "/telemetry/watchlist"
      )
    : { entries: [] };
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
  const unavailableChannel = searchParams.get("channel_unavailable");
  const unavailableMessage = unavailableChannel
    ? `${unavailableChannel} is not available for this source`
    : null;

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
  const [latestSimulatorStreamId, setLatestSimulatorStreamId] = useState<string | null>(
    null
  );
  const [committedStreamId, setCommittedStreamId] = useState<string | null>(null);
  const [desiredStreamId, setDesiredStreamId] = useState<string | null>(null);
  const [showSwitchingIndicator, setShowSwitchingIndicator] = useState(false);
  const [watchlistVersion, setWatchlistVersion] = useState(0);

  useEffect(() => {
    if (!unavailableChannel) return;
    setError(unavailableMessage);
  }, [unavailableChannel, unavailableMessage]);

  let effectiveSource = resolveSourceAlias(
    sourceFromUrl ?? storedSource ?? DEFAULT_SOURCE_ID
  );
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
  const isSwitchingStreams =
    !bootstrapLoading &&
    desiredStreamId != null &&
    committedStreamId != null &&
    desiredStreamId !== committedStreamId;

  const refreshCommittedSnapshot = useCallback(async () => {
    if (!committedStreamId) return;

    try {
      setError(unavailableMessage);
      const snapshot = await fetchOverviewSnapshot(committedStreamId);
      setChannels(snapshot.channels);
      setAnomalies(snapshot.anomalies);
      if (snapshot.hasPartialFailure) {
        setError("Some data failed to load");
      }
    } catch (e) {
      console.error("[Overview] refresh committed snapshot failed", e);
      setError("Failed to load overview");
    }
  }, [committedStreamId, unavailableMessage]);

  const handleWatchlistChanged = useCallback(async () => {
    try {
      await refreshCommittedSnapshot();
    } finally {
      setWatchlistVersion((current) => current + 1);
    }
  }, [refreshCommittedSnapshot]);

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
        setError(unavailableMessage);
        setCommittedStreamId(null);
        setDesiredStreamId(null);
        setShowSwitchingIndicator(false);
        setLatestSimulatorStreamId(null);

        const sourcesPromise = fetchWithTimeoutAndFallback(
          "/telemetry/sources"
        );
        const runsPromise = fetchWithTimeoutAndFallback(
          `/telemetry/sources/${encodeURIComponent(effectiveSource)}/streams`
        );

        const [sourcesRes, runsRes] = await Promise.all([
          sourcesPromise,
          runsPromise,
        ]);

        if (cancelled) return;

        const sourcesList = sourcesRes.ok
          ? await readJsonResponse<TelemetrySource[]>(
              sourcesRes,
              "/telemetry/sources"
            )
          : [];
        const streamsData = runsRes.ok
          ? await readJsonResponse<{ sources?: Array<{ stream_id?: string }> }>(
              runsRes,
              `/telemetry/sources/${encodeURIComponent(effectiveSource)}/streams`
            )
          : { sources: [] };
        const streamsList = Array.isArray(streamsData.sources)
          ? streamsData.sources
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
              `/simulator/status?vehicle_id=${encodeURIComponent(effectiveSource)}`
            );
            simStatus = simRes.ok
              ? await readJsonResponse<SimulatorRuntimeStatus>(
                  simRes,
                  `/simulator/status?vehicle_id=${encodeURIComponent(effectiveSource)}`
                )
              : { connected: false };
            simSourceId = effectiveSource;
          } catch {
            simStatus = { connected: false };
            simSourceId = effectiveSource;
          }
        }

        const runtimeStreamId =
          simStatus?.connected && simStatus.state !== "idle"
            ? simStatus.config?.stream_id ?? null
            : null;
        const effectiveStreamId = isSimulatorSource
          ? runtimeStreamId ?? streamsList[0]?.stream_id ?? effectiveSource
          : streamsList[0]?.stream_id ?? effectiveSource;
        const snapshot = await fetchOverviewSnapshot(effectiveStreamId);

        if (cancelled) return;

        setSources(Array.isArray(sourcesList) ? sourcesList : []);
        setChannels(snapshot.channels);
        setAnomalies(snapshot.anomalies);
        setCommittedStreamId(effectiveStreamId);
        setDesiredStreamId(effectiveStreamId);
        setInitialSimulatorSourceId(simSourceId);
        setInitialSimulatorStatus(simStatus);
        setLatestSimulatorStreamId(
          isSimulatorSource ? runtimeStreamId ?? streamsList[0]?.stream_id ?? null : null
        );
        if (snapshot.hasPartialFailure) {
          setError("Some data failed to load");
        }
      } catch (e) {
        if (!cancelled) {
          console.error("[Overview] bootstrap load failed", e);
          setError("Failed to load overview");
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
  }, [effectiveSource, sourceReady, unavailableMessage]);

  useEffect(() => {
    if (!isSimulatorSource || !simulatorRuntime.activeStreamId) return;
    setLatestSimulatorStreamId((current) =>
      current === simulatorRuntime.activeStreamId ? current : simulatorRuntime.activeStreamId
    );
  }, [isSimulatorSource, simulatorRuntime.activeStreamId]);

  useEffect(() => {
    if (!sourceReady || !isSimulatorSource) return;

    const nextStreamId = simulatorRuntime.isActive
      ? simulatorRuntime.activeStreamId ?? desiredStreamId ?? effectiveSource
      : latestSimulatorStreamId ?? effectiveSource;
    if (!nextStreamId || nextStreamId === desiredStreamId) return;
    setDesiredStreamId(nextStreamId);
  }, [
    desiredStreamId,
    effectiveSource,
    isSimulatorSource,
    latestSimulatorStreamId,
    simulatorRuntime.activeStreamId,
    simulatorRuntime.isActive,
    sourceReady,
  ]);

  useEffect(() => {
    if (
      !sourceReady ||
      bootstrapLoading ||
      !committedStreamId ||
      !desiredStreamId ||
      desiredStreamId === committedStreamId
    ) {
      return;
    }

    let cancelled = false;
    const streamId = desiredStreamId;

    async function switchSnapshot() {
      try {
        setShowSwitchingIndicator(true);
        setError(unavailableMessage);

        const snapshot = await fetchOverviewSnapshot(streamId);

        if (cancelled) return;

        setChannels(snapshot.channels);
        setAnomalies(snapshot.anomalies);
        setCommittedStreamId(streamId);
        if (snapshot.hasPartialFailure) {
          setError("Some data failed to load");
        }
      } catch (e) {
        if (!cancelled) {
          console.error("[Overview] snapshot switch failed", e);
          setError("Failed to load overview");
        }
      }
    }

    switchSnapshot();
    return () => {
      cancelled = true;
    };
  }, [bootstrapLoading, committedStreamId, desiredStreamId, sourceReady, unavailableMessage]);

  useEffect(() => {
    if (isSwitchingStreams || !showSwitchingIndicator) return;

    const timeoutId = window.setTimeout(() => {
      setShowSwitchingIndicator(false);
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isSwitchingStreams, showSwitchingIndicator]);

  const bootstrapFailed = !bootstrapLoading && !committedStreamId;

  if (!sourceReady || bootstrapLoading) {
    return (
      <div className="min-h-full p-4 sm:p-6 lg:p-8">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              Operator Overview
            </h1>
          </div>
          <div className="flex min-h-64 items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <Spinner size="lg" className="h-10 w-10" />
              <p className="text-sm text-muted-foreground">Loading overview…</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (bootstrapFailed) {
    return (
      <div className="min-h-full p-4 sm:p-6 lg:p-8">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              Operator Overview
            </h1>
          </div>
          <Alert variant="destructive">
            <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{error ?? "Failed to load overview"} — Check your connection and try again.</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="sm:self-start"
                onClick={() => window.location.reload()}
              >
                Retry loading overview
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full p-4 sm:p-6 lg:p-8">
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
          <WatchlistConfig sourceId={effectiveSource} onChanged={handleWatchlistChanged} />
        </div>
        <RealtimeOverviewWrapper
          initialChannels={channels}
          initialAnomalies={anomalies}
          hasError={!!error}
          sources={sources}
          sourceId={effectiveSource || DEFAULT_SOURCE_ID}
          feedSourceId={committedStreamId ?? undefined}
          defaultSourceId={DEFAULT_SOURCE_ID}
          initialSimulatorSourceId={initialSimulatorSourceId}
          initialSimulatorStatus={initialSimulatorStatus}
          simulatorStatus={simulatorRuntime.status}
          isSwitchingStreams={isSwitchingStreams}
          showSwitchingIndicator={showSwitchingIndicator || isSwitchingStreams}
          onWatchlistChanged={handleWatchlistChanged}
          watchlistVersion={watchlistVersion}
        />
      </div>
    </div>
  );
}
