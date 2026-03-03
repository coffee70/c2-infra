"use client";

import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TelemetryDetailActions } from "@/components/telemetry-detail-actions";

function formatWithUnits(
  value: number,
  units: string | null | undefined
): string {
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
  if (state === "normal") return "In family";
  if (stateReason === "out_of_limits") return "Out of limits";
  if (stateReason === "out_of_family" && zScore != null)
    return `Out of family: ${zScore >= 0 ? "+" : ""}${zScore.toFixed(1)}σ`;
  return state === "warning" ? "Warning" : "Caution";
}

interface TelemetryDetailHeaderProps {
  name: string;
  value: number;
  units?: string | null;
  state: string;
  stateReason?: string | null;
  zScore?: number | null;
  lastTimestamp?: string | null;
}

export function TelemetryDetailHeader({
  name,
  value,
  units,
  state,
  stateReason,
  zScore,
  lastTimestamp,
}: TelemetryDetailHeaderProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailedKey, setCopyFailedKey] = useState<string | null>(null);

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
    state === "warning" ? "destructive" : state === "caution" ? "secondary" : "success";

  const valueWithUnits = formatWithUnits(value, units);
  const copyValueText = `${name}: ${valueWithUnits}`;
  const copyTimestampText = lastTimestamp
    ? `${name} @ ${lastTimestamp} UTC`
    : "";

  return (
    <header className="sticky top-14 z-10 py-4 mb-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b">
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <h1 className="text-lg font-semibold truncate" title={name}>
            {name}
            {units ? ` (${units})` : ""}
          </h1>
          <Badge variant={stateVariant} className="shrink-0 text-xs">
            {statusLabel}
          </Badge>
          <span className="text-lg font-medium tabular-nums shrink-0">
            {valueWithUnits}
          </span>
          {lastTimestamp && (
            <span className="text-sm text-muted-foreground shrink-0">
              {formatTimeAgo(lastTimestamp)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
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
              >
                {copyFailedKey === "value" ? "Copy failed" : copied === "value" ? "Copied!" : "Copy value"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy channel name and value</TooltipContent>
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
          <TelemetryDetailActions name={name} />
        </div>
      </div>
    </header>
  );
}
