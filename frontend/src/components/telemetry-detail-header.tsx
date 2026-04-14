"use client";

import { useState, useCallback } from "react";
import { PencilIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TelemetryDetailActions } from "@/components/telemetry-detail-actions";
import { TelemetryScopeModal } from "@/components/telemetry-scope-modal";
import type { TelemetryDetailView } from "@/lib/telemetry-routes";
import {
  appliedScopeBadge,
  formatAppliedScopeSummaryLine,
  type TelemetryAppliedScope,
} from "@/lib/telemetry-applied-scope";
import type { TelemetryDetailScope } from "@/lib/telemetry-detail-scope";

function formatWithUnits(
  value: number | null | undefined,
  units: string | null | undefined
): string {
  if (value == null || !Number.isFinite(value)) return "No data";

  const formatted = value.toFixed(4);
  if (!units?.trim()) return formatted;
  const displayUnit = units === "C" ? "°C" : ` ${units}`;
  return `${formatted}${displayUnit}`;
}

function formatTimeAgo(timestamp: string): string {
  const ts = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - ts.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins === 1) return "1 min ago";
  if (diffMins < 60) return `${diffMins} min ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours === 1) return "1 hour ago";
  return `${diffHours} hours ago`;
}

function formatOperationalStatus(
  state: string,
  stateReason?: string | null,
  zScore?: number | null
): string {
  if (state === "no_data") return "No data";
  if (state === "normal") return "Within expected range";
  if (stateReason === "out_of_limits") return "Out of limits";
  if (stateReason === "out_of_family" && zScore != null)
    return `Out of family: ${zScore >= 0 ? "+" : ""}${zScore.toFixed(1)}σ`;
  return state === "warning" ? "Warning" : "Caution";
}

interface TelemetryDetailHeaderProps {
  name: string;
  sourceId: string;
  value: number | null;
  units?: string | null;
  channelOrigin?: string | null;
  state: string;
  stateReason?: string | null;
  zScore?: number | null;
  lastTimestamp?: string | null;
  description?: string | null;
  /** When true, show a Live badge (value is updating from stream). */
  live?: boolean;
  /** URL-backed scope + structured summary for the compact scope pill and edit modal. */
  scopeControl: {
    pageScope: TelemetryAppliedScope | null;
    scope: TelemetryDetailScope;
    channelName: string;
    currentView: TelemetryDetailView;
  };
}

export function TelemetryDetailHeader({
  name,
  sourceId,
  value,
  units,
  channelOrigin,
  state,
  stateReason,
  zScore,
  lastTimestamp,
  description,
  live = false,
  scopeControl,
}: TelemetryDetailHeaderProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailedKey, setCopyFailedKey] = useState<string | null>(null);
  const [scopeModalOpen, setScopeModalOpen] = useState(false);

  const copyToClipboard = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFailedKey(null);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopyFailedKey(key);
      setTimeout(() => setCopyFailedKey(null), 2000);
    }
  }, []);

  const statusLabel = formatOperationalStatus(state, stateReason, zScore);
  const stateVariant =
    state === "warning" ? "destructive" : state === "normal" ? "success" : "secondary";

  const copyValueText = `${name}: ${formatWithUnits(value, units)}`;
  const copyTimestampText = lastTimestamp
    ? `${name} @ ${lastTimestamp} UTC`
    : "";

  const scopeSummaryLine = formatAppliedScopeSummaryLine(scopeControl.pageScope);
  const scopePillLabel = appliedScopeBadge(scopeControl.pageScope);

  return (
    <header className="bg-background/95 supports-backdrop-filter:bg-background/80 sticky top-0 z-10 border-b py-3 backdrop-blur">
      <div className="space-y-2">
        {/* Row 1: channel identity and live reading */}
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1 className="truncate text-lg font-semibold" title={name}>
              {name}
              {units ? ` (${units})` : ""}
            </h1>
            <Badge variant={stateVariant} className="shrink-0 text-xs">
              {statusLabel}
            </Badge>
            {channelOrigin === "discovered" && (
              <Badge variant="outline" className="shrink-0 text-xs">
                Discovered
              </Badge>
            )}
            {live && (
              <Badge variant="default" className="shrink-0 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-600">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current opacity-80" />
                Live
              </Badge>
            )}
            <span className="shrink-0 text-lg font-medium tabular-nums" data-value={value ?? ""}>
              {formatWithUnits(value, units)}
            </span>
            {lastTimestamp != null && lastTimestamp !== "" && (
              <span className="text-muted-foreground shrink-0 text-sm" data-last-timestamp={lastTimestamp}>
                {formatTimeAgo(lastTimestamp)}
              </span>
            )}
          </div>
          {description && (
            <p className="text-muted-foreground line-clamp-2 text-sm">
              {description}
            </p>
          )}
        </div>

        {/* Row 2: data scope + channel actions */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="max-w-[min(100vw-8rem,20rem)] min-w-0 cursor-default sm:max-w-[14rem]">
                  <Badge
                    variant="secondary"
                    className="text-muted-foreground max-w-full truncate border text-xs font-normal"
                  >
                    {scopePillLabel}
                  </Badge>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-md text-left">
                {scopeSummaryLine}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="size-7 shrink-0"
                  aria-label="Edit scope"
                  onClick={() => setScopeModalOpen(true)}
                >
                  <PencilIcon className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit scope</TooltipContent>
            </Tooltip>
          </div>
          <div
            className="border-border flex shrink-0 flex-wrap items-center gap-2 sm:border-l sm:pl-3"
            role="group"
            aria-label="Channel actions"
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => copyToClipboard(name, "name")}
                  aria-label="Copy channel name"
                  aria-live="polite"
                >
                  {copyFailedKey === "name" ? "Copy failed" : copied === "name" ? "Copied!" : "Copy name"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy channel name</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => copyToClipboard(copyValueText, "value")}
                  aria-label="Copy channel name and value"
                  aria-live="polite"
                  disabled={value == null}
                >
                  {value == null ? "No value" : copyFailedKey === "value" ? "Copy failed" : copied === "value" ? "Copied!" : "Copy value"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{value == null ? "No value has been received yet" : "Copy channel name and value"}</TooltipContent>
            </Tooltip>
            {lastTimestamp && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => copyToClipboard(copyTimestampText, "timestamp")}
                    aria-label="Copy channel name and timestamp"
                    aria-live="polite"
                  >
                    {copyFailedKey === "timestamp" ? "Copy failed" : copied === "timestamp" ? "Copied!" : "Copy timestamp"}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy channel name and timestamp</TooltipContent>
              </Tooltip>
            )}
            <TelemetryDetailActions name={name} sourceId={sourceId} />
          </div>
        </div>
      </div>
      <TelemetryScopeModal
        open={scopeModalOpen}
        onOpenChange={setScopeModalOpen}
        sourceId={sourceId}
        channelName={scopeControl.channelName}
        scope={scopeControl.scope}
        currentView={scopeControl.currentView}
      />
    </header>
  );
}
