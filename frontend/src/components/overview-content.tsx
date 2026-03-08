"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { WatchlistConfig } from "@/components/watchlist-config";
import { RealtimeOverviewWrapper } from "@/components/realtime-overview-wrapper";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

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
  current_value: number;
  last_timestamp: string;
  state: string;
  state_reason?: string | null;
  z_score?: number | null;
  sparkline_data: { timestamp: string; value: number }[];
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
}

const OVERVIEW_SOURCE_STORAGE_KEY = "overviewSourceId";

export function OverviewContent() {
  const searchParams = useSearchParams();
  const sourceFromUrl = searchParams.get("source");

  const [storedSource, setStoredSource] = useState<string | null>(null);
  const [storageChecked, setStorageChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<OverviewChannel[]>([]);
  const [anomalies, setAnomalies] = useState<AnomaliesData>({
    power: [],
    thermal: [],
    adcs: [],
    comms: [],
    other: [],
  });
  const [sources, setSources] = useState<TelemetrySource[]>([]);

  const effectiveSource =
    sourceFromUrl ?? storedSource ?? DEFAULT_SOURCE_ID;
  const sourceReady = sourceFromUrl !== null || storageChecked;

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

    async function load() {
      try {
        const sourcesPromise = fetchWithTimeoutAndFallback(
          "/telemetry/sources"
        );
        const overviewPromise = fetchWithTimeoutAndFallback(
          `/telemetry/overview?source_id=${encodeURIComponent(effectiveSource)}`
        );
        const anomaliesPromise = fetchWithTimeoutAndFallback(
          `/telemetry/anomalies?source_id=${encodeURIComponent(effectiveSource)}`
        );

        const [sourcesRes, overviewRes, anomaliesRes] = await Promise.all([
          sourcesPromise,
          overviewPromise,
          anomaliesPromise,
        ]);

        if (cancelled) return;

        const sourcesData = sourcesRes.ok ? await sourcesRes.json() : [];
        const overviewData = overviewRes.ok ? await overviewRes.json() : { channels: [] };
        const anomaliesData = anomaliesRes.ok ? await anomaliesRes.json() : { power: [], thermal: [], adcs: [], comms: [], other: [] };

        setSources(Array.isArray(sourcesData) ? sourcesData : []);
        setChannels(overviewData.channels || []);
        setAnomalies({
          power: anomaliesData.power || [],
          thermal: anomaliesData.thermal || [],
          adcs: anomaliesData.adcs || [],
          comms: anomaliesData.comms || [],
          other: anomaliesData.other || [],
        });
        if (!overviewRes.ok || !anomaliesRes.ok) {
          setError("Some data failed to load");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load overview");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [effectiveSource, sourceReady]);

  if (!sourceReady || loading) {
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
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Operator Overview</h1>
          </div>
          <WatchlistConfig />
        </div>

        <RealtimeOverviewWrapper
          initialChannels={channels}
          initialAnomalies={anomalies}
          hasError={!!error}
          sources={sources}
          initialSourceId={
            sources.some((s) => s.id === effectiveSource)
              ? effectiveSource
              : DEFAULT_SOURCE_ID
          }
          defaultSourceId={DEFAULT_SOURCE_ID}
        />
      </div>
    </div>
  );
}
