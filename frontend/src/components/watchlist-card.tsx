"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "@/components/sparkline";
import { buildTelemetryDetailHref } from "@/lib/telemetry-routes";

const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

function formatWithUnits(
  value: number | null,
  units: string | null | undefined
): string {
  if (value == null || !Number.isFinite(value)) return "No data";
  const formatted = value.toFixed(4);
  if (!units?.trim()) return formatted;
  const displayUnit = units === "C" ? "°C" : ` ${units}`;
  return `${formatted}${displayUnit}`;
}

function formatTimeAgo(timestamp: string | null): string {
  if (!timestamp) return "Waiting for telemetry";
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

function isStale(timestamp: string | null): boolean {
  if (!timestamp) return false;
  const ts = new Date(timestamp);
  const now = new Date();
  return now.getTime() - ts.getTime() > STALE_THRESHOLD_MS;
}

interface WatchlistCardProps {
  name: string;
  units?: string | null;
  currentValue: number | null;
  lastTimestamp: string | null;
  state: string;
  stateReason?: string | null;
  sparklineData: { timestamp: string; value: number }[];
  sourceId?: string;
}

export function WatchlistCard({
  name,
  units,
  currentValue,
  lastTimestamp,
  state,
  stateReason,
  sparklineData,
  sourceId,
}: WatchlistCardProps) {
  const hasData =
    currentValue != null
    && Number.isFinite(currentValue)
    && lastTimestamp != null
    && lastTimestamp !== "";
  const stale = isStale(lastTimestamp);
  const stateVariant = !hasData
    ? "secondary"
    : state === "warning"
      ? "destructive"
      : state === "caution"
        ? "secondary"
        : "success";
  const stateLabel = !hasData
    ? "No data"
    : state === "warning"
      ? "Warning"
      : state === "caution"
        ? "Caution"
        : "Normal";

  const tooltipTitle = !hasData
    ? "Configured on the watchlist, waiting for telemetry for this source or stream"
    :
    stateReason === "out_of_limits"
      ? "Value outside mission-defined limits"
      : stateReason === "out_of_family"
        ? "Statistical anomaly (out of family)"
        : undefined;

  const href = sourceId ? buildTelemetryDetailHref(sourceId, name) : "#";

  return (
    <Link
      href={href}
      className="focus-visible:ring-ring block rounded-lg focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      <Card
        className={`hover:bg-accent/50 active:bg-accent/70 h-full cursor-pointer transition-colors duration-200 ${
          stale ? "border-destructive/30" : ""
        }`}
      >
        <CardHeader className="min-w-0 overflow-hidden pb-2">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-medium">{name}</span>
            <Badge
              variant={stateVariant}
              className="max-w-[130px] min-w-0 overflow-hidden text-xs"
              title={tooltipTitle}
            >
              <span className="block truncate">
                {stateLabel}
                {hasData && stateReason && (
                  <span className="ml-1 opacity-80">
                    ({stateReason.replace("_", " ")})
                  </span>
                )}
              </span>
            </Badge>
          </div>
        </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-2xl font-bold">
              {formatWithUnits(currentValue, units)}
            </div>
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <span>Last update: {formatTimeAgo(lastTimestamp)}</span>
              {hasData && stale && (
                <span
                  className="bg-destructive/20 text-destructive inline-flex items-center gap-1 rounded px-1.5 py-0.5"
                  title="Data is stale (no update in 15+ minutes)"
                >
                  <span className="bg-destructive inline-block h-1.5 w-1.5 rounded-full" />
                  Stale
                </span>
              )}
            </div>
            <Sparkline
              data={sparklineData}
              state={
                state === "warning"
                  ? "warning"
                  : state === "caution"
                    ? "caution"
                    : "normal"
              }
              width={140}
              height={36}
            />
          </CardContent>
        </Card>
      </Link>
  );
}
