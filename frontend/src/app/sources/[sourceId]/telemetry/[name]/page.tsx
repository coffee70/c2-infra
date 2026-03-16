import { notFound, redirect } from "next/navigation";
import { TelemetryDetailTabs } from "@/components/telemetry-detail-tabs";
import { canonicalizeRunId, runIdToSourceId } from "@/lib/source-ids";

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
      `${API_URL}/telemetry/sources/${encodeURIComponent(sourceId)}/channels/${encodeURIComponent(name)}/runs`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.sources ?? [];
  } catch {
    return [];
  }
}

async function fetchSummary(name: string, sourceId: string, runId: string): Promise<ExplainResponse | null> {
  try {
    const res = await fetch(
      `${API_URL}/telemetry/sources/${encodeURIComponent(sourceId)}/channels/${encodeURIComponent(name)}/summary?run_id=${encodeURIComponent(runId)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchRecent(name: string, sourceId: string, runId: string): Promise<RecentPoint[]> {
  try {
    const res = await fetch(
      `${API_URL}/telemetry/sources/${encodeURIComponent(sourceId)}/channels/${encodeURIComponent(name)}/recent?limit=100&run_id=${encodeURIComponent(runId)}`,
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
}: {
  params: Promise<{ sourceId: string; name: string }>;
}) {
  const { sourceId: rawSourceId, name } = await params;
  const requestedSourceId = decodeURIComponent(rawSourceId);
  const decodedName = decodeURIComponent(name);
  const isHistoricalRunId = /-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z?$/.test(requestedSourceId);
  const requestedRunId = isHistoricalRunId ? canonicalizeRunId(requestedSourceId) : null;
  const sourceId = requestedRunId ? runIdToSourceId(requestedRunId) : requestedSourceId;

  const runs = await fetchRunsForSource(decodedName, sourceId);
  const currentRunId = requestedRunId ?? runs[0]?.source_id ?? sourceId;

  const [explain, recentData] = await Promise.all([
    fetchSummary(decodedName, sourceId, currentRunId),
    fetchRecent(decodedName, sourceId, currentRunId),
  ]);

  if (!explain) {
    redirect(`/overview?source=${encodeURIComponent(sourceId)}&channel_unavailable=${encodeURIComponent(decodedName)}`);
  }
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
