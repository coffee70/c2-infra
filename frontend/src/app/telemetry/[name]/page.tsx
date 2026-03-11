import { notFound } from "next/navigation";
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

async function fetchSummary(name: string, sourceId: string = "default"): Promise<ExplainResponse | null> {
  try {
    const res = await fetch(
      `${API_URL}/telemetry/${encodeURIComponent(name)}/summary?source_id=${encodeURIComponent(sourceId)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchRecent(name: string, sourceId: string = "default"): Promise<RecentPoint[]> {
  try {
    const res = await fetch(
      `${API_URL}/telemetry/${encodeURIComponent(name)}/recent?limit=100&source_id=${encodeURIComponent(sourceId)}`,
      { cache: "no-store" }
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
  const sourceId = source ?? "default";
  const decodedName = decodeURIComponent(name);

  const [explain, recentData] = await Promise.all([
    fetchSummary(decodedName, sourceId),
    fetchRecent(decodedName, sourceId),
  ]);

  if (!explain) notFound();

  return (
    <TelemetryDetailTabs
      explain={explain}
      recentData={recentData}
      sourceId={sourceId}
      decodedName={decodedName}
    />
  );
}
