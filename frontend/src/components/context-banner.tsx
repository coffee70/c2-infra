"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { SimulatorStatusBadge } from "@/components/simulator-status-badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDownIcon } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface FeedStatus {
  source_id: string;
  connected: boolean;
  state?: "connected" | "degraded" | "disconnected";
  last_reception_time: number | null;
  approx_rate_hz: number | null;
}

interface SimulatorStatus {
  connected: boolean;
  state?: "idle" | "running" | "paused";
}

interface TelemetrySource {
  id: string;
  name: string;
  description?: string | null;
  source_type?: string;
}

export interface AlertSummary {
  channelName: string;
  subsystem: string;
}

interface ContextBannerProps {
  sourceId: string;
  /** When set (e.g. current run id), feed-status polling uses this for live indicator; otherwise sourceId. */
  feedSourceId?: string;
  onSourceChange?: (sourceId: string) => void;
  sources?: TelemetrySource[];
  activeAlertCount?: number;
  alertCountBySeverity?: { warning?: number; caution?: number };
  /** When set, Alerts block becomes clickable and scrolls to this element id (e.g. events-console). */
  scrollToAlertsId?: string;
  /** Optional short list of alert summaries for dropdown preview (e.g. first 5). */
  alertSummaries?: AlertSummary[];
  /** Pre-fetched simulator status for the initial source to avoid "Disconnected" flash. */
  initialSimulatorSourceId?: string;
  initialSimulatorStatus?: SimulatorStatus | null;
}

function scrollToAlerts(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

/** Resolve run id to source id for URL/banner. simulator-{scenario}-{ts} -> simulator; {source_id}-{ts} -> source_id. */
export function runIdToSourceId(runId: string): string {
  const match = runId.match(/^(.+)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z?$/);
  if (!match) return runId;
  const prefix = match[1]!;
  if (prefix.startsWith("simulator-")) return "simulator";
  return prefix;
}

/** Label when sourceId is not in sources list (e.g. legacy run id); prefer resolving to source. */
function fallbackSourceLabel(sourceId: string): string {
  const source = runIdToSourceId(sourceId);
  return source !== sourceId ? `${source} (run)` : sourceId;
}

export function ContextBanner({
  sourceId,
  feedSourceId,
  onSourceChange,
  sources = [],
  activeAlertCount = 0,
  alertCountBySeverity = {},
  scrollToAlertsId,
  alertSummaries = [],
  initialSimulatorSourceId,
  initialSimulatorStatus,
}: ContextBannerProps) {
  const [feedStatus, setFeedStatus] = useState<FeedStatus | null>(null);
  const [simulatorStatus, setSimulatorStatus] = useState<SimulatorStatus | null>(
    () =>
      initialSimulatorSourceId === sourceId && initialSimulatorStatus != null
        ? initialSimulatorStatus
        : null
  );

  const effectiveFeedId = feedSourceId ?? sourceId;
  useEffect(() => {
    let cancelled = false;
    function fetchStatus() {
      fetch(`${API_URL}/ops/feed-status?source_id=${encodeURIComponent(effectiveFeedId)}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (!cancelled && data) setFeedStatus(data);
        })
        .catch(() => {});
    }
    fetchStatus();
    const id = setInterval(fetchStatus, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [effectiveFeedId]);

  const isSimulator =
    sources.find((s) => s.id === sourceId)?.source_type === "simulator";

  useEffect(() => {
    if (!isSimulator) {
      setSimulatorStatus(null);
      return;
    }
    const useInitial =
      sourceId === initialSimulatorSourceId && initialSimulatorStatus != null;
    if (useInitial) {
      setSimulatorStatus(initialSimulatorStatus);
    } else {
      setSimulatorStatus(null);
    }
    let cancelled = false;
    function fetchSimulator() {
      fetch(
        `${API_URL}/simulator/status?source_id=${encodeURIComponent(sourceId)}`,
        { cache: "no-store" }
      )
        .then((r) => (r.ok ? r.json() : { connected: false }))
        .then((data) => {
          if (!cancelled && data) setSimulatorStatus(data);
        })
        .catch(() => {
          if (!cancelled) setSimulatorStatus({ connected: false });
        });
    }
    fetchSimulator();
    const id = setInterval(fetchSimulator, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sourceId, isSimulator, initialSimulatorSourceId, initialSimulatorStatus]);

  const sourceLabel =
    sources.find((s) => s.id === sourceId)?.name ?? fallbackSourceLabel(sourceId);
  const feedState =
    (feedStatus?.state as "connected" | "degraded" | "disconnected" | undefined) ??
    (feedStatus?.connected
      ? "connected"
      : feedStatus?.last_reception_time != null
        ? "degraded"
        : "disconnected");

  return (
    <div className="flex flex-wrap items-center gap-3 py-2 px-4 border-b bg-muted/30 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground font-medium">Source:</span>
        {sources.length > 1 && onSourceChange ? (
          <Select
            value={sources.some((s) => s.id === sourceId) ? sourceId : runIdToSourceId(sourceId)}
            onValueChange={onSourceChange}
          >
            <SelectTrigger className="h-8 w-auto min-w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(() => {
                const vehicles = sources.filter(
                  (s) => (s.source_type ?? "vehicle") === "vehicle"
                );
                const simulators = sources.filter(
                  (s) => s.source_type === "simulator"
                );
                return (
                  <>
                    {vehicles.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Vehicles</SelectLabel>
                        {vehicles.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {simulators.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Simulators</SelectLabel>
                        {simulators.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </>
                );
              })()}
            </SelectContent>
          </Select>
        ) : (
          <span className="font-medium">{sourceLabel}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Feed:</span>
        <Badge
          variant={
            feedState === "connected"
              ? "success"
              : feedState === "degraded"
                ? "secondary"
                : "destructive"
          }
          className="text-xs"
        >
          {feedState === "connected" ? (
            <>
              <span className="mr-1 inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
              Live
            </>
          ) : feedState === "degraded" ? (
            "Degraded"
          ) : (
            "No data"
          )}
        </Badge>
        {feedStatus?.approx_rate_hz != null && feedStatus.approx_rate_hz > 0 && (
          <span className="text-muted-foreground text-xs">
            ~{feedStatus.approx_rate_hz.toFixed(1)} Hz
          </span>
        )}
      </div>
      {isSimulator && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Simulator:</span>
          <SimulatorStatusBadge
            connected={simulatorStatus?.connected ?? false}
            state={simulatorStatus?.state}
          />
        </div>
      )}
      {activeAlertCount > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Alerts:</span>
          {alertSummaries.length > 0 && scrollToAlertsId ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex cursor-pointer items-center gap-1 rounded-md outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  aria-label="View alerts"
                >
                  <Badge variant="destructive" className="text-xs">
                    {activeAlertCount}
                  </Badge>
                  <ChevronDownIcon className="size-3.5 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-w-[280px]">
                {alertSummaries.map((s, i) => (
                  <DropdownMenuItem key={i} disabled className="truncate">
                    {s.subsystem}: {s.channelName.length > 32 ? `${s.channelName.slice(0, 32)}…` : s.channelName}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => scrollToAlerts(scrollToAlertsId)}
                >
                  View all in Events Console
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : scrollToAlertsId ? (
            <a
              href={`#${scrollToAlertsId}`}
              onClick={(e) => {
                e.preventDefault();
                scrollToAlerts(scrollToAlertsId);
              }}
              className="inline-flex cursor-pointer items-center outline-none ring-offset-background hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              aria-label="Scroll to Events Console"
            >
              <Badge variant="destructive" className="text-xs">
                {activeAlertCount}
              </Badge>
            </a>
          ) : (
            <Badge variant="destructive" className="text-xs">
              {activeAlertCount}
            </Badge>
          )}
          {alertCountBySeverity.warning != null &&
            alertCountBySeverity.warning > 0 && (
              <span className="text-destructive text-xs">
                {alertCountBySeverity.warning} warning
              </span>
            )}
        </div>
      )}
    </div>
  );
}
