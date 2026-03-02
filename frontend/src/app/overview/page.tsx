import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WatchlistCard } from "@/components/watchlist-card";
import { AnomaliesPanel } from "@/components/anomalies-panel";
import { WatchlistConfig } from "@/components/watchlist-config";
import { EmptyState } from "@/components/empty-state";

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

async function fetchOverview(): Promise<{ channels: OverviewChannel[]; error: boolean }> {
  try {
    const res = await fetch(`${API_URL}/telemetry/overview`, { cache: "no-store" });
    if (!res.ok) return { channels: [], error: true };
    const data = await res.json();
    return { channels: data.channels || [], error: false };
  } catch {
    return { channels: [], error: true };
  }
}

async function fetchAnomalies(): Promise<{ data: AnomaliesData; error: boolean }> {
  try {
    const res = await fetch(`${API_URL}/telemetry/anomalies`, { cache: "no-store" });
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

export default async function OverviewPage() {
  const [overviewResult, anomaliesResult] = await Promise.all([
    fetchOverview(),
    fetchAnomalies(),
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Watchlist / Console</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Key channels: power, thermal, ADCS, comms
                </p>
              </CardHeader>
              <CardContent>
                {channels.length === 0 ? (
                  <EmptyState
                    title="No channels in watchlist"
                    description="Configure your watchlist to see key metrics here."
                  />
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {channels.map((ch) => (
                      <WatchlistCard
                        key={ch.name}
                        name={ch.name}
                        units={ch.units}
                        currentValue={ch.current_value}
                        lastTimestamp={ch.last_timestamp}
                        state={ch.state}
                        stateReason={ch.state_reason}
                        sparklineData={ch.sparkline_data}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          <div>
            <AnomaliesPanel
              power={anomalies.power}
              thermal={anomalies.thermal}
              adcs={anomalies.adcs}
              comms={anomalies.comms}
              other={anomalies.other}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
