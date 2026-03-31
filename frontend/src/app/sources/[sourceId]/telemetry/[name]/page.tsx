import { notFound, redirect } from "next/navigation";
import { TelemetryDetailTabs } from "@/components/telemetry-detail-tabs";

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
  aliases?: string[];
  description: string | null;
  units?: string | null;
  channel_origin?: string | null;
  discovery_namespace?: string | null;
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

async function fetchSummary(
  name: string,
  sourceId: string,
  runId?: string | null,
): Promise<ExplainResponse | null> {
  try {
    const params = new URLSearchParams();
    if (runId) params.set("run_id", runId);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const res = await fetch(
      `${API_URL}/telemetry/sources/${encodeURIComponent(sourceId)}/channels/${encodeURIComponent(name)}/summary${suffix}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchRecent(
  name: string,
  sourceId: string,
  runId?: string | null,
): Promise<RecentPoint[]> {
  try {
    const params = new URLSearchParams({ limit: "100" });
    if (runId) params.set("run_id", runId);
    const res = await fetch(
      `${API_URL}/telemetry/sources/${encodeURIComponent(sourceId)}/channels/${encodeURIComponent(name)}/recent?${params.toString()}`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || [];
  } catch {
    return [];
  }
}

async function fetchLatestRunId(name: string, sourceId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${API_URL}/telemetry/sources/${encodeURIComponent(sourceId)}/channels/${encodeURIComponent(name)}/runs`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = await res.json() as { sources?: Array<{ stream_id?: string }> };
    const latestRun = Array.isArray(data.sources) ? data.sources[0] : null;
    return typeof latestRun?.stream_id === "string" && latestRun.stream_id
      ? latestRun.stream_id
      : null;
  } catch {
    return null;
  }
}

export default async function TelemetryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ sourceId: string; name: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { sourceId: rawSourceId, name } = await params;
  const resolvedSearchParams = await searchParams;
  const requestedSourceId = decodeURIComponent(rawSourceId);
  const decodedName = decodeURIComponent(name);
  const requestedRunParam = resolvedSearchParams.run ?? resolvedSearchParams.run_id;
  const requestedRunId =
    typeof requestedRunParam === "string" && requestedRunParam
      ? requestedRunParam
      : null;
  const sourceId = requestedSourceId;

  const currentRunId = requestedRunId ?? (await fetchLatestRunId(decodedName, sourceId));

  const [explain, recentData] = await Promise.all([
    fetchSummary(decodedName, sourceId, currentRunId),
    fetchRecent(decodedName, sourceId, currentRunId),
  ]);

  if (!explain) {
    redirect(`/overview?source=${encodeURIComponent(sourceId)}&channel_unavailable=${encodeURIComponent(decodedName)}`);
  }
  if (!explain) notFound();
  if (explain.name !== decodedName) {
    const redirectParams = new URLSearchParams();
    const selectedRun =
      resolvedSearchParams.run ??
      resolvedSearchParams.run_id;
    if (typeof selectedRun === "string" && selectedRun) {
      redirectParams.set("run", selectedRun);
    }
    const suffix = redirectParams.toString();
    redirect(
      `/sources/${encodeURIComponent(requestedSourceId)}/telemetry/${encodeURIComponent(explain.name)}${suffix ? `?${suffix}` : ""}`
    );
  }

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
