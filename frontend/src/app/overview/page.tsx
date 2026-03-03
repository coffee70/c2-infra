import { WatchlistConfig } from "@/components/watchlist-config";
import { RealtimeOverviewWrapper } from "@/components/realtime-overview-wrapper";

const API_URL =
  process.env.API_SERVER_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000";

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

async function fetchSources(): Promise<{ id: string; name: string; description?: string | null }[]> {
  try {
    const res = await fetch(`${API_URL}/telemetry/sources`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function fetchOverview(sourceId: string = "default"): Promise<{ channels: OverviewChannel[]; error: boolean }> {
  try {
    const res = await fetch(
      `${API_URL}/telemetry/overview?source_id=${encodeURIComponent(sourceId)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return { channels: [], error: true };
    const data = await res.json();
    return { channels: data.channels || [], error: false };
  } catch {
    return { channels: [], error: true };
  }
}

async function fetchAnomalies(sourceId: string = "default"): Promise<{ data: AnomaliesData; error: boolean }> {
  try {
    const res = await fetch(
      `${API_URL}/telemetry/anomalies?source_id=${encodeURIComponent(sourceId)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return { data: { power: [], thermal: [], adcs: [], comms: [] }, error: true };
    const data = await res.json();
    return {
      data: {
        power: data.power || [],
        thermal: data.thermal || [],
        adcs: data.adcs || [],
        comms: data.comms || [],
        other: data.other || [],
      },
      error: false,
    };
  } catch {
    return { data: { power: [], thermal: [], adcs: [], comms: [] }, error: true };
  }
}

const DEFAULT_SOURCE_ID = "simulator";

export default async function OverviewPage() {
  const [sources, overviewResult, anomaliesResult] = await Promise.all([
    fetchSources(),
    fetchOverview(DEFAULT_SOURCE_ID),
    fetchAnomalies(DEFAULT_SOURCE_ID),
  ]);
  const channels = overviewResult.channels;
  const anomalies = anomaliesResult.data;
  const hasError = overviewResult.error || anomaliesResult.error;

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {hasError && (
          <div
            className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            Unable to load some data. The API may be unavailable. Check your connection and try again.
          </div>
        )}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Operator Overview</h1>
          <WatchlistConfig />
        </div>

        <RealtimeOverviewWrapper
          initialChannels={channels}
          initialAnomalies={anomalies}
          hasError={hasError}
          sources={sources}
          initialSourceId={DEFAULT_SOURCE_ID}
        />
      </div>
    </div>
  );
}
