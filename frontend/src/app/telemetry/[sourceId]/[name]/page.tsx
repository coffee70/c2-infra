import { notFound, redirect } from "next/navigation";
import { TelemetryDetailTabs } from "@/components/telemetry-detail-tabs";
import { TelemetryDetailFetchError } from "@/components/telemetry-detail-fetch-error";
import {
  parseTelemetryDetailScope,
  telemetryScopeToQueryParams,
  type TelemetryDetailScope,
} from "@/lib/telemetry-detail-scope";
import { parseTelemetryDetailView } from "@/lib/telemetry-routes";
import type { TelemetryAppliedScope } from "@/lib/telemetry-applied-scope";

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
  scope?: TelemetryAppliedScope | null;
}

interface RecentPoint {
  timestamp: string;
  value: number;
  stream_id?: string | null;
}

interface SummaryFetchResult {
  explain: ExplainResponse | null;
  channelUnavailable: boolean;
  summaryError: boolean;
}

async function fetchSummary(
  name: string,
  sourceId: string,
  scope: TelemetryDetailScope,
): Promise<SummaryFetchResult> {
  try {
    const params = telemetryScopeToQueryParams(scope);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const res = await fetch(
      `${API_URL}/telemetry/sources/${encodeURIComponent(sourceId)}/channels/${encodeURIComponent(name)}/summary${suffix}`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const detail = typeof body?.detail === "string" ? body.detail : "";
      if (res.status === 404 && detail.startsWith("Telemetry not found")) {
        return {
          explain: null,
          channelUnavailable: true,
          summaryError: false,
        };
      }
      return {
        explain: null,
        channelUnavailable: false,
        summaryError: true,
      };
    }
    return {
      explain: await res.json(),
      channelUnavailable: false,
      summaryError: false,
    };
  } catch {
    return {
      explain: null,
      channelUnavailable: false,
      summaryError: true,
    };
  }
}

async function fetchRecent(
  name: string,
  sourceId: string,
  scope: TelemetryDetailScope,
): Promise<RecentPoint[]> {
  try {
    const params = telemetryScopeToQueryParams(scope);
    params.set("limit", "100");
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
  const scope = parseTelemetryDetailScope(resolvedSearchParams);
  const sourceId = requestedSourceId;

  const rawView = resolvedSearchParams.view;
  const viewFlat = Array.isArray(rawView) ? rawView[0] : rawView;
  if (viewFlat === undefined || viewFlat === "") {
    const p = telemetryScopeToQueryParams(scope);
    p.set("view", "analysis");
    redirect(
      `/telemetry/${encodeURIComponent(requestedSourceId)}/${encodeURIComponent(name)}?${p.toString()}`,
    );
  }

  const initialView = parseTelemetryDetailView(resolvedSearchParams);

  const [summary, recentData] = await Promise.all([
    fetchSummary(decodedName, sourceId, scope),
    fetchRecent(decodedName, sourceId, scope),
  ]);
  const explain = summary.explain;

  if (summary.channelUnavailable) {
    redirect(
      `/telemetry?source=${encodeURIComponent(sourceId)}&channel_unavailable=${encodeURIComponent(decodedName)}`,
    );
  }
  if (summary.summaryError) {
    return (
      <TelemetryDetailFetchError
        sourceId={sourceId}
        channelName={decodedName}
      />
    );
  }
  if (!explain) {
    notFound();
  }
  if (explain.name !== decodedName) {
    const redirectParams = telemetryScopeToQueryParams(scope);
    redirectParams.set("view", initialView);
    const suffix = redirectParams.toString();
    redirect(
      `/telemetry/${encodeURIComponent(requestedSourceId)}/${encodeURIComponent(explain.name)}${suffix ? `?${suffix}` : ""}`,
    );
  }

  return (
    <TelemetryDetailTabs
      explain={explain}
      recentData={recentData}
      sourceId={sourceId}
      scope={scope}
      decodedName={decodedName}
      pageScope={explain.scope ?? null}
      initialView={initialView}
    />
  );
}
