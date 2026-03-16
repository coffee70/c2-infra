"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TelemetryDetailHeader } from "@/components/telemetry-detail-header";
import { TelemetryDetailLive } from "@/components/telemetry-detail-live";
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
import { ChevronDownIcon } from "lucide-react";
import { formatSmartValue } from "@/lib/format-value";
import { useTelemetrySourcesQuery } from "@/lib/query-hooks";
import { buildTelemetryDetailHref } from "@/lib/telemetry-routes";

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
}

interface RecentPoint {
  timestamp: string;
  value: number;
}

type TabId = "summary" | "live" | "history" | "explanation";

interface TelemetryDetailTabsProps {
  explain: ExplainResponse;
  recentData: RecentPoint[];
  /** Source (from banner / URL); only telemetry_sources ids. */
  sourceId: string;
  /** Run id used for Summary/Live/Explain and default for History (newest run for source). */
  currentRunId: string;
  decodedName: string;
}

interface TelemetrySource {
  id: string;
  name: string;
  description?: string | null;
  source_type?: string;
}

export function TelemetryDetailTabs({
  explain,
  recentData,
  sourceId,
  currentRunId,
  decodedName,
}: TelemetryDetailTabsProps) {
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
      key={currentRunId}
      channelNames={[decodedName]}
      sourceId={currentRunId}
      initialChannels={initialChannels}
    >
      <TelemetryDetailTabsContent
        explain={explain}
        recentData={recentData}
        sourceId={sourceId}
        currentRunId={currentRunId}
        decodedName={decodedName}
      />
    </RealtimeTelemetryProvider>
  );
}

function TelemetryDetailTabsContent({
  explain,
  recentData,
  sourceId,
  currentRunId,
  decodedName,
}: TelemetryDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>("summary");
  const router = useRouter();
  const liveChannel = useRealtimeChannel(decodedName);
  const { isLive } = useRealtimeTelemetry();
  const sourcesQuery = useTelemetrySourcesQuery<TelemetrySource[]>();
  const sources = sourcesQuery.data ?? [];
  const sourceName = sources.find((source) => source.id === sourceId)?.name ?? sourceId;

  const handleSourceChange = (newSourceId: string) => {
    if (newSourceId === sourceId) return;
    router.replace(buildTelemetryDetailHref(newSourceId, decodedName));
  };

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
                  href="/sources"
                  className="text-primary hover:underline underline-offset-4"
                >
                  Sources
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage
                className="truncate max-w-[200px]"
                title={sourceName}
              >
                {sourceName}
              </BreadcrumbPage>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage
                className="truncate max-w-[200px]"
                title={decodedName}
              >
                {decodedName}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex min-h-0 gap-12">
          <aside className="sticky top-20 shrink-0 self-start">
            <nav
              className="flex flex-col gap-1 text-sm text-muted-foreground"
              aria-label="Telemetry detail sections"
              role="tablist"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "summary"}
                className={`block rounded-md px-3 py-2 -ml-3 text-left transition-colors ${
                  activeTab === "summary"
                    ? "bg-muted text-foreground font-medium"
                    : "hover:bg-muted/50 hover:text-foreground"
                }`}
                onClick={() => setActiveTab("summary")}
              >
                Summary
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "live"}
                className={`block rounded-md px-3 py-2 -ml-3 text-left transition-colors ${
                  activeTab === "live"
                    ? "bg-muted text-foreground font-medium"
                    : "hover:bg-muted/50 hover:text-foreground"
                }`}
                onClick={() => setActiveTab("live")}
              >
                Live &amp; trends
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "history"}
                className={`block rounded-md px-3 py-2 -ml-3 text-left transition-colors ${
                  activeTab === "history"
                    ? "bg-muted text-foreground font-medium"
                    : "hover:bg-muted/50 hover:text-foreground"
                }`}
                onClick={() => setActiveTab("history")}
              >
                History
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "explanation"}
                className={`block rounded-md px-3 py-2 -ml-3 text-left transition-colors ${
                  activeTab === "explanation"
                    ? "bg-muted text-foreground font-medium"
                    : "hover:bg-muted/50 hover:text-foreground"
                }`}
                onClick={() => setActiveTab("explanation")}
              >
                Explanation &amp; events
              </button>
            </nav>
          </aside>

          <div className="flex min-w-0 flex-1 justify-center">
            <div className="flex w-full max-w-5xl flex-col space-y-8">
              {activeTab === "summary" && (
                <div
                  className="space-y-8 w-full"
                  role="tabpanel"
                  aria-label="Summary"
                >
                <TelemetryDetailHeader
                  name={explain.name}
                  sourceId={sourceId}
                  value={liveChannel?.value ?? explain.recent_value}
                  units={explain.units}
                  state={liveChannel?.state ?? explain.state}
                  stateReason={liveChannel?.stateReason ?? explain.state_reason}
                  zScore={liveChannel?.zScore ?? explain.z_score}
                  lastTimestamp={liveChannel?.lastTimestamp ?? explain.last_timestamp}
                  description={explain.description}
                  live={isLive}
                />

                <Card className="mt-2 border-muted">
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
                          {formatSmartValue(explain.statistics.p5, explain.units)}{" "}
                          to{" "}
                          {formatSmartValue(explain.statistics.p95, explain.units)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Spread</dt>
                        <dd className="mt-0.5 font-medium">
                          {formatSmartValue(
                            explain.statistics.max_value -
                              explain.statistics.min_value,
                            explain.units,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Extremes
                        </dt>
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
                        <dt className="text-xs text-muted-foreground">
                          N samples
                        </dt>
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
                            <dt className="text-xs text-muted-foreground">
                              Mean
                            </dt>
                            <dd>
                              {formatSmartValue(
                                explain.statistics.mean,
                                explain.units,
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted-foreground">
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
                  </CardContent>
                </Card>
                </div>
              )}

              {activeTab === "live" && (
                <div
                  className="space-y-6 w-full"
                  role="tabpanel"
                  aria-label="Live telemetry and trends"
                >
                <TelemetryDetailLive
                  channelName={decodedName}
                  initialValue={explain.recent_value}
                  initialUnits={explain.units}
                  initialLastTimestamp={explain.last_timestamp}
                  initialP50={explain.statistics.p50}
                  initialState={explain.state}
                  initialStateReason={explain.state_reason}
                  initialZScore={explain.z_score}
                  recentData={recentData}
                />

                <Card className="overflow-visible">
                  <CardHeader>
                    <CardTitle>Trend analysis</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <TrendChartAnalysis
                      channelName={decodedName}
                      sourceId={currentRunId}
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
                </div>
              )}

              {activeTab === "history" && (
                <div
                  className="space-y-6 w-full"
                  role="tabpanel"
                  aria-label="Telemetry history table"
                >
                <TelemetryHistoryTable
                  channelName={decodedName}
                  sourceId={sourceId}
                  defaultRunId={currentRunId}
                  units={explain.units}
                />
                </div>
              )}

              {activeTab === "explanation" && (
                <div
                  className="space-y-6 w-full"
                  role="tabpanel"
                  aria-label="Explanation and related events"
                >
                <ExplanationBlock
                  channelName={decodedName}
                  sourceId={sourceId}
                  runId={currentRunId}
                />
                <ChannelRecentEvents
                  channelName={decodedName}
                  sourceId={currentRunId}
                  sinceMinutes={60}
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
