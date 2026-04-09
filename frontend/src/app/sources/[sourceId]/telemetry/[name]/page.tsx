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
    mean: number | null;
    std_dev: number | null;
    min_value: number | null;
    max_value: number | null;
    p5: number | null;
    p50: number | null;
    p95: number | null;
    n_samples?: number;
  };
  recent_value: number | null;
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

interface SummaryFetchResult {
  explain: ExplainResponse | null;
  channelUnavailable: boolean;
}

async function fetchSummary(
  name: string,
  sourceId: string,
  streamId?: string | null,
): Promise<SummaryFetchResult> {
  try {
    const params = new URLSearchParams();
    if (streamId) params.set("stream_id", streamId);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const res = await fetch(
      `${API_URL}/telemetry/sources/${encodeURIComponent(sourceId)}/channels/${encodeURIComponent(name)}/summary${suffix}`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const detail = typeof body?.detail === "string" ? body.detail : "";
      return {
        explain: null,
        channelUnavailable:
          res.status === 404 && detail.startsWith("Telemetry not found"),
      };
    }
    return { explain: await res.json(), channelUnavailable: false };
  } catch {
    return { explain: null, channelUnavailable: false };
  }
}

async function fetchRecent(
  name: string,
  sourceId: string,
  streamId?: string | null,
): Promise<RecentPoint[]> {
  try {
    const params = new URLSearchParams({ limit: "100" });
    if (streamId) params.set("stream_id", streamId);
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
  const requestedStreamParam = resolvedSearchParams.stream_id;
  const requestedStreamId =
    typeof requestedStreamParam === "string" && requestedStreamParam
      ? requestedStreamParam
      : null;
  const sourceId = requestedSourceId;

  const [summary, recentData] = await Promise.all([
    fetchSummary(decodedName, sourceId, requestedStreamId),
    fetchRecent(decodedName, sourceId, requestedStreamId),
  ]);
  const explain = summary.explain;

  if (summary.channelUnavailable) {
    redirect(`/overview?source=${encodeURIComponent(sourceId)}&channel_unavailable=${encodeURIComponent(decodedName)}`);
  }
  if (!explain) notFound();
  if (explain.name !== decodedName) {
    const redirectParams = new URLSearchParams();
    const selectedStream = resolvedSearchParams.stream_id;
    if (typeof selectedStream === "string" && selectedStream) {
      redirectParams.set("stream_id", selectedStream);
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
      currentStreamId={requestedStreamId}
      decodedName={decodedName}
    />
  );
}
