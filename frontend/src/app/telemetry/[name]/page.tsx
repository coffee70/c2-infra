import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { TrendChartAnalysis } from "@/components/trend-chart-analysis";
import { TelemetryDetailActions } from "@/components/telemetry-detail-actions";
import { TelemetryDetailLive } from "@/components/telemetry-detail-live";
import { TelemetryDetailHeader } from "@/components/telemetry-detail-header";
import { ExplanationBlock } from "@/components/explanation-block";
import { ContextBanner } from "@/components/context-banner";
import { ChannelRecentEvents } from "@/components/channel-recent-events";
import { formatSmartValue } from "@/lib/format-value";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { ChevronDownIcon } from "lucide-react";

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
    <div className="min-h-screen p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <ContextBanner sourceId={sourceId} />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/overview" className="text-primary hover:underline underline-offset-4">
                  Overview
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="truncate max-w-[200px]" title={decodedName}>
                {decodedName}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <TelemetryDetailHeader
          name={explain.name}
          value={explain.recent_value}
          units={explain.units}
          state={explain.state}
          stateReason={explain.state_reason}
          zScore={explain.z_score}
          lastTimestamp={explain.last_timestamp}
        />

        <TelemetryDetailLive
          channelName={explain.name}
          sourceId={sourceId}
          initialValue={explain.recent_value}
          initialUnits={explain.units}
          initialLastTimestamp={explain.last_timestamp}
          initialP50={explain.statistics.p50}
          initialState={explain.state}
          initialStateReason={explain.state_reason}
          initialZScore={explain.z_score}
          recentData={recentData}
        />

        <div>
          <h2 className="text-xl font-semibold text-muted-foreground">
            {explain.name}
            {explain.units ? ` (${explain.units})` : ""}
          </h2>
          {explain.description && (
            <p className="mt-1 text-sm text-muted-foreground">{explain.description}</p>
          )}
        </div>

        <Card className="overflow-visible">
          <CardHeader>
            <CardTitle>Trend Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChartAnalysis
              channelName={decodedName}
              sourceId={sourceId}
              units={explain.units}
              bounds={{
                p5: explain.statistics.p5,
                p50: explain.statistics.p50,
                p95: explain.statistics.p95,
                mean: explain.statistics.mean,
                redLow: explain.red_low ?? undefined,
                redHigh: explain.red_high ?? undefined,
                minValue: explain.statistics.min_value,
                maxValue: explain.statistics.max_value,
              }}
              lastTimestamp={explain.last_timestamp}
            />
          </CardContent>
        </Card>

        <ExplanationBlock channelName={decodedName} sourceId={sourceId} />

        <ChannelRecentEvents
          channelName={decodedName}
          sourceId={sourceId}
          sinceMinutes={60}
        />

        <Card className="border-muted">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Statistics
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">
                  Typical range (P5–P95)
                </dt>
                <dd className="mt-0.5 font-medium">
                  {formatSmartValue(explain.statistics.p5, explain.units)} to{" "}
                  {formatSmartValue(explain.statistics.p95, explain.units)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Spread</dt>
                <dd className="mt-0.5 font-medium">
                  {formatSmartValue(
                    explain.statistics.max_value - explain.statistics.min_value,
                    explain.units
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Extremes</dt>
                <dd className="mt-0.5 font-medium">
                  Min: {formatSmartValue(explain.statistics.min_value, explain.units)}{" "}
                  · Max: {formatSmartValue(explain.statistics.max_value, explain.units)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">N samples</dt>
                <dd className="mt-0.5 font-medium">
                  {(explain.statistics.n_samples ?? 0).toLocaleString()}
                </dd>
              </div>
            </dl>
            <Separator className="my-3" />
            <div className="space-y-1.5 text-sm text-muted-foreground">
              <p>
                5% of the time it&apos;s below{" "}
                {formatSmartValue(explain.statistics.p5, explain.units)}
              </p>
              <p>
                Median: 50% of the time it&apos;s below{" "}
                {formatSmartValue(explain.statistics.p50, explain.units)}
              </p>
              <p>
                95% of the time it&apos;s below{" "}
                {formatSmartValue(explain.statistics.p95, explain.units)}
              </p>
            </div>
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer data-[state=open]:[&_svg]:rotate-180">
                Mean, Std Dev
                <ChevronDownIcon className="size-3.5 transition-transform duration-200" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Mean</dt>
                    <dd>{formatSmartValue(explain.statistics.mean, explain.units)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Std Dev</dt>
                    <dd>
                      {formatSmartValue(explain.statistics.std_dev, explain.units)}
                    </dd>
                  </div>
                </dl>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
