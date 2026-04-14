"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TelemetryDetailHeader } from "@/components/telemetry-detail-header";
import {
  RealtimeTelemetryProvider,
  useRealtimeChannel,
  useRealtimeTelemetry,
} from "@/lib/realtime-telemetry-context";
import { TrendChartAnalysis } from "@/components/trend-chart-analysis";
import { ExplanationBlock } from "@/components/explanation-block";
import { ChannelRecentEvents } from "@/components/channel-recent-events";
import { ContextBanner } from "@/components/context-banner";
import { TelemetryHistoryTable } from "@/components/telemetry-history-table";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { ChevronDownIcon } from "lucide-react";
import { formatSmartValue } from "@/lib/format-value";
import { useTelemetrySourcesQuery } from "@/lib/query-hooks";
import { buildTelemetryDetailHref, type TelemetryDetailView } from "@/lib/telemetry-routes";
import {
  isRealtimeEligible,
  LATEST_SCOPE,
  telemetryScopeKey,
  telemetryScopeSubtitle,
  type TelemetryDetailScope,
} from "@/lib/telemetry-detail-scope";
import {
  formatAppliedScopeSummaryLine,
  type TelemetryAppliedScope,
} from "@/lib/telemetry-applied-scope";

interface ExplainResponse {
  name: string;
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
}

interface RecentPoint {
  timestamp: string;
  value: number;
  stream_id?: string | null;
}

interface TelemetryDetailTabsProps {
  explain: ExplainResponse;
  recentData: RecentPoint[];
  sourceId: string;
  scope: TelemetryDetailScope;
  decodedName: string;
  pageScope: TelemetryAppliedScope | null;
  initialView: TelemetryDetailView;
}

interface TelemetrySource {
  id: string;
  name: string;
  description?: string | null;
  source_type?: string;
}

function hasNumericStatistics(stats: ExplainResponse["statistics"]) {
  return (
    (stats.n_samples ?? 0) > 0 &&
    stats.p5 != null &&
    stats.p50 != null &&
    stats.p95 != null &&
    stats.min_value != null &&
    stats.max_value != null
  );
}

export function TelemetryDetailTabs({
  explain,
  recentData,
  sourceId,
  scope,
  decodedName,
  pageScope,
  initialView,
}: TelemetryDetailTabsProps) {
  const realtimeEnabled = isRealtimeEligible(scope);
  const initialChannels = [
    {
      name: decodedName,
      current_value: explain.recent_value,
      last_timestamp: explain.last_timestamp ?? "",
      state: explain.state,
      state_reason: explain.state_reason ?? null,
      z_score: explain.z_score ?? null,
      units: explain.units,
      description: explain.description,
      subsystem_tag: "",
      sparkline_data: recentData,
    },
  ];

  return (
    <RealtimeTelemetryProvider
      key={`${sourceId}:${telemetryScopeKey(scope)}`}
      channelNames={[decodedName]}
      sourceId={sourceId}
      enabled={realtimeEnabled}
      initialChannels={initialChannels}
    >
      <TelemetryDetailTabsContent
        explain={explain}
        recentData={recentData}
        sourceId={sourceId}
        scope={scope}
        decodedName={decodedName}
        pageScope={pageScope}
        initialView={initialView}
      />
    </RealtimeTelemetryProvider>
  );
}

function TelemetryDetailTabsContent({
  explain,
  recentData,
  sourceId,
  scope,
  decodedName,
  pageScope,
  initialView,
}: TelemetryDetailTabsProps) {
  const router = useRouter();
  const [analysisPane, setAnalysisPane] = useState<"chart" | "table">("chart");
  const liveChannel = useRealtimeChannel(decodedName);
  const { isLive } = useRealtimeTelemetry();
  const realtimeEnabled = isRealtimeEligible(scope);
  const sourcesQuery = useTelemetrySourcesQuery<TelemetrySource[]>();
  const sources = sourcesQuery.data ?? [];
  const sourceName = sources.find((source) => source.id === sourceId)?.name ?? sourceId;
  const hasStats = hasNumericStatistics(explain.statistics);
  const activeView = initialView;

  const handleSourceChange = (newSourceId: string) => {
    if (newSourceId === sourceId) return;
    router.replace(
      buildTelemetryDetailHref(newSourceId, decodedName, LATEST_SCOPE, "analysis"),
    );
  };

  const goView = (view: TelemetryDetailView) => {
    router.replace(buildTelemetryDetailHref(sourceId, decodedName, scope, view));
  };

  const statsScopeLine = pageScope
    ? formatAppliedScopeSummaryLine(pageScope)
    : telemetryScopeSubtitle(scope);

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <ContextBanner
          sourceId={sourceId}
          onSourceChange={handleSourceChange}
          sources={sources}
        />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link
                  href={`/telemetry?source=${encodeURIComponent(sourceId)}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Telemetry
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage
                className="max-w-50 truncate"
                title={sourceName}
              >
                {sourceName}
              </BreadcrumbPage>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage
                className="max-w-50 truncate"
                title={decodedName}
              >
                {decodedName}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <TelemetryDetailHeader
          name={explain.name}
          sourceId={sourceId}
          value={liveChannel?.value ?? explain.recent_value}
          units={explain.units}
          channelOrigin={explain.channel_origin}
          state={liveChannel?.state ?? explain.state}
          stateReason={liveChannel?.stateReason ?? explain.state_reason}
          zScore={liveChannel?.zScore ?? explain.z_score}
          lastTimestamp={liveChannel?.lastTimestamp ?? explain.last_timestamp}
          description={explain.description}
          live={realtimeEnabled && isLive}
          scopeControl={{
            pageScope,
            scope,
            channelName: decodedName,
            currentView: activeView,
          }}
        />

        <div className="flex min-h-0 gap-12">
          <aside className="sticky top-4 shrink-0 self-start">
            <nav
              className="text-muted-foreground flex flex-col gap-1 text-sm"
              aria-label="Telemetry detail sections"
              role="tablist"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeView === "analysis"}
                className={`-ml-3 block rounded-md px-3 py-2 text-left transition-colors ${
                  activeView === "analysis"
                    ? "bg-muted text-foreground font-medium"
                    : "hover:bg-muted/50 hover:text-foreground"
                }`}
                onClick={() => goView("analysis")}
              >
                Analysis
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeView === "summary"}
                className={`-ml-3 block rounded-md px-3 py-2 text-left transition-colors ${
                  activeView === "summary"
                    ? "bg-muted text-foreground font-medium"
                    : "hover:bg-muted/50 hover:text-foreground"
                }`}
                onClick={() => goView("summary")}
              >
                Summary
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeView === "explanation"}
                className={`-ml-3 block rounded-md px-3 py-2 text-left transition-colors ${
                  activeView === "explanation"
                    ? "bg-muted text-foreground font-medium"
                    : "hover:bg-muted/50 hover:text-foreground"
                }`}
                onClick={() => goView("explanation")}
              >
                Explanation &amp; events
              </button>
            </nav>
          </aside>

          <div className="flex min-w-0 flex-1 justify-center">
            <div className="flex w-full max-w-5xl flex-col space-y-8">
              {activeView === "analysis" && (
                <div
                  className="w-full space-y-6"
                  role="tabpanel"
                  aria-label="Analysis"
                >
                  {!realtimeEnabled && (
                    <div className="rounded-md border px-3 py-2 text-sm">
                      Live updates are only available in Latest mode.
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                      View
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant={analysisPane === "chart" ? "default" : "outline"}
                      onClick={() => setAnalysisPane("chart")}
                    >
                      Chart
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={analysisPane === "table" ? "default" : "outline"}
                      onClick={() => setAnalysisPane("table")}
                    >
                      Table
                    </Button>
                  </div>

                  {analysisPane === "chart" ? (
                    <Card className="overflow-visible">
                      <CardHeader>
                        <CardTitle>Trend analysis</CardTitle>
                        <p className="text-muted-foreground text-xs">
                          Compare overlay uses the same UTC window as this channel; it does
                          not restrict the other channel to the same streams.
                        </p>
                      </CardHeader>
                      <CardContent>
                        <TrendChartAnalysis
                          channelName={decodedName}
                          vehicleId={sourceId}
                          scope={scope}
                          units={explain.units}
                          bounds={{
                            p5: hasStats ? explain.statistics.p5 : null,
                            p50: hasStats ? explain.statistics.p50 : null,
                            p95: hasStats ? explain.statistics.p95 : null,
                            mean: hasStats ? explain.statistics.mean : null,
                            redLow: explain.red_low ?? undefined,
                            redHigh: explain.red_high ?? undefined,
                            minValue: hasStats ? explain.statistics.min_value : null,
                            maxValue: hasStats ? explain.statistics.max_value : null,
                          }}
                          lastTimestamp={explain.last_timestamp}
                        />
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="min-w-0">
                      <TelemetryHistoryTable
                        channelName={decodedName}
                        sourceId={sourceId}
                        scope={scope}
                        units={explain.units}
                        compactHeight
                      />
                    </div>
                  )}
                </div>
              )}

              {activeView === "summary" && (
                <div
                  className="w-full space-y-8"
                  role="tabpanel"
                  aria-label="Summary"
                >
                  <Card className="border-muted mt-2">
                    <CardHeader>
                      <CardTitle className="text-muted-foreground text-sm font-medium">
                        Statistics
                      </CardTitle>
                      <p className="text-muted-foreground text-xs">{statsScopeLine}</p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {!hasStats ? (
                        <p className="text-muted-foreground text-sm">
                          No statistics yet. This channel is registered, but no samples have
                          been received.
                        </p>
                      ) : (
                        <>
                          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                              <dt className="text-muted-foreground text-xs">
                                Typical range (P5–P95)
                              </dt>
                              <dd className="mt-0.5 font-medium">
                                {formatSmartValue(explain.statistics.p5, explain.units)}{" "}
                                to{" "}
                                {formatSmartValue(explain.statistics.p95, explain.units)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground text-xs">Spread</dt>
                              <dd className="mt-0.5 font-medium">
                                {formatSmartValue(
                                  explain.statistics.max_value! -
                                    explain.statistics.min_value!,
                                  explain.units,
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground text-xs">Extremes</dt>
                              <dd className="mt-0.5 font-medium">
                                Min:{" "}
                                {formatSmartValue(
                                  explain.statistics.min_value,
                                  explain.units,
                                )}{" "}
                                · Max:{" "}
                                {formatSmartValue(
                                  explain.statistics.max_value,
                                  explain.units,
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground text-xs">N samples</dt>
                              <dd className="mt-0.5 font-medium">
                                {(explain.statistics.n_samples ?? 0).toLocaleString()}
                              </dd>
                            </div>
                          </dl>
                          <Separator className="my-3" />
                          <div className="text-muted-foreground space-y-1.5 text-sm">
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
                            <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-2 text-xs data-[state=open]:[&_svg]:rotate-180">
                              Mean, Std Dev
                              <ChevronDownIcon className="size-3.5 transition-transform duration-200" />
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                                <div>
                                  <dt className="text-muted-foreground text-xs">Mean</dt>
                                  <dd>
                                    {formatSmartValue(
                                      explain.statistics.mean,
                                      explain.units,
                                    )}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-muted-foreground text-xs">
                                    Std Dev
                                  </dt>
                                  <dd>
                                    {formatSmartValue(
                                      explain.statistics.std_dev,
                                      explain.units,
                                    )}
                                  </dd>
                                </div>
                              </dl>
                            </CollapsibleContent>
                          </Collapsible>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}

              {activeView === "explanation" && (
                <div
                  className="w-full space-y-6"
                  role="tabpanel"
                  aria-label="Explanation and related events"
                >
                  <ChannelRecentEvents
                    channelName={decodedName}
                    vehicleId={sourceId}
                    scope={scope}
                  />
                  <ExplanationBlock
                    channelName={decodedName}
                    sourceId={sourceId}
                    scope={scope}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
