import { notFound, redirect } from "next/navigation";
import { runIdToSourceId } from "@/components/context-banner";
import { TelemetryDetailTabs } from "@/components/telemetry-detail-tabs";

// Server-side: use API_SERVER_URL (backend container hostname in Docker)
// Client-side fallback: NEXT_PUBLIC_API_URL or localhost
const API_URL =
  process.env.API_SERVER_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000";

interface RelatedChannel {
  name: string;
  subsystem_tag: string;
  link_reason: string;
  current_value?: number | null;
  current_status?: string | null;
  last_timestamp?: string | null;
  units?: string | null;
}

interface ExplainResponse {
  name: string;
  description: string | null;
  units?: string | null;
  statistics: {
    mean: number;
    std_dev: number;
    min_value: number;
    max_value: number;
    p5: number;
    p50: number;
    p95: number;
    n_samples?: number;
  };
  recent_value: number;
  z_score: number | null;
  is_anomalous: boolean;
  state: string;
  state_reason?: string | null;
  last_timestamp?: string | null;
  red_low?: number | null;
  red_high?: number | null;
  what_this_means: string;
  what_to_check_next: RelatedChannel[];
  confidence_indicator?: string | null;
  llm_explanation: string;
}

interface RecentPoint {
  timestamp: string;
  value: number;
}

async function fetchRunsForSource(
  name: string,
  sourceId: string,
): Promise<{ source_id: string; label: string }[]> {
  try {
    const res = await fetch(
      `${API_URL}/telemetry/${encodeURIComponent(name)}/runs?source_id=${encodeURIComponent(sourceId)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.sources ?? [];
  } catch {
    return [];
  }
}

async function fetchSummary(name: string, runId: string = "default"): Promise<ExplainResponse | null> {
  try {
    const res = await fetch(
      `${API_URL}/telemetry/${encodeURIComponent(name)}/summary?source_id=${encodeURIComponent(runId)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchRecent(name: string, runId: string = "default"): Promise<RecentPoint[]> {
  try {
    const res = await fetch(
      `${API_URL}/telemetry/${encodeURIComponent(name)}/recent?limit=100&source_id=${encodeURIComponent(runId)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || [];
  } catch {
    return [];
  }
}

export default async function TelemetryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ source?: string }>;
}) {
  const { name } = await params;
  const { source } = await searchParams;
  let sourceId = source ?? "default";
  const decodedName = decodeURIComponent(name);

  // Normalize: URL is source-only; if a run id was passed, redirect to source.
  if (sourceId && /-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z?$/.test(sourceId)) {
    const resolved = runIdToSourceId(sourceId);
    redirect(`/telemetry/${encodeURIComponent(name)}?source=${encodeURIComponent(resolved)}`);
  }

  // Resolve current run for this source (newest run; for vehicles the run is the source id).
  const runs = await fetchRunsForSource(decodedName, sourceId);
  const currentRunId = runs[0]?.source_id ?? sourceId;

  const [explain, recentData] = await Promise.all([
    fetchSummary(decodedName, currentRunId),
    fetchRecent(decodedName, currentRunId),
  ]);

  if (!explain) notFound();

  return (
    <TelemetryDetailTabs
      explain={explain}
      recentData={recentData}
      sourceId={sourceId}
      currentRunId={currentRunId}
      decodedName={decodedName}
    />
  );
}
