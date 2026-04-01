"use client";

import { Badge } from "@/components/ui/badge";
import { SimulatorStatusBadge } from "@/components/simulator-status-badge";
import { useRealtimeFeedStatus } from "@/lib/realtime-telemetry-context";
import { resolveSourceAlias } from "@/lib/source-ids";
import {
  useSimulatorRuntime,
  type SimulatorRuntimeStatus,
} from "@/lib/simulator-runtime";
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
  onSourceChange?: (sourceId: string) => void;
  sources?: TelemetrySource[];
  activeAlertCount?: number;
  alertCountBySeverity?: { warning?: number; caution?: number };
  /** When set, Alerts block becomes clickable and scrolls to this element id (e.g. events-console). */
  scrollToAlertsId?: string;
  onAlertsClick?: () => void;
  /** Optional short list of alert summaries for dropdown preview (e.g. first 5). */
  alertSummaries?: AlertSummary[];
  /** Pre-fetched simulator status for the initial source to avoid "Disconnected" flash. */
  initialSimulatorSourceId?: string;
  initialSimulatorStatus?: SimulatorRuntimeStatus | null;
  simulatorStatus?: SimulatorRuntimeStatus | null;
  isSwitchingRuns?: boolean;
}

function scrollToAlerts(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

/** Label when sourceId is not in sources list; prefer resolving configured aliases. */
function fallbackSourceLabel(sourceId: string): string {
  return resolveSourceAlias(sourceId);
}

export function ContextBanner({
  sourceId,
  onSourceChange,
  sources = [],
  activeAlertCount = 0,
  alertCountBySeverity = {},
  scrollToAlertsId,
  onAlertsClick,
  alertSummaries = [],
  initialSimulatorSourceId,
  initialSimulatorStatus,
  simulatorStatus,
  isSwitchingRuns = false,
}: ContextBannerProps) {
  const feedStatus = useRealtimeFeedStatus();
  const isSimulator =
    sources.find((s) => s.id === sourceId)?.source_type === "simulator";
  const initialSimulatorStatusForSource =
    sourceId === initialSimulatorSourceId && initialSimulatorStatus != null
      ? initialSimulatorStatus
      : null;
  const polledSimulatorRuntime = useSimulatorRuntime({
    sourceId,
    enabled: isSimulator && simulatorStatus == null,
    initialStatus: initialSimulatorStatusForSource,
  });
  const resolvedSimulatorStatus =
    simulatorStatus
    ?? polledSimulatorRuntime.status
    ?? initialSimulatorStatusForSource;

  const sourceLabel =
    sources.find((s) => s.id === sourceId)?.name ?? fallbackSourceLabel(sourceId);
  const feedState = isSimulator && resolvedSimulatorStatus?.state === "idle"
    ? "disconnected"
    :
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
            value={sources.some((s) => s.id === sourceId) ? sourceId : resolveSourceAlias(sourceId)}
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
        {isSwitchingRuns && (
          <Badge variant="outline" className="text-xs">
            Switching stream…
          </Badge>
        )}
      </div>
      {isSimulator && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Simulator:</span>
          <SimulatorStatusBadge
            connected={resolvedSimulatorStatus?.connected ?? false}
            state={resolvedSimulatorStatus?.state}
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
                  onSelect={() => {
                    onAlertsClick?.();
                    scrollToAlerts(scrollToAlertsId);
                  }}
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
                onAlertsClick?.();
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
