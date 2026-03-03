"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "@/components/sparkline";

const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

function formatWithUnits(value: number, units: string | null | undefined): string {
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

function isStale(timestamp: string): boolean {
  const ts = new Date(timestamp);
  const now = new Date();
  return now.getTime() - ts.getTime() > STALE_THRESHOLD_MS;
}

interface WatchlistCardProps {
  name: string;
  units?: string | null;
  currentValue: number;
  lastTimestamp: string;
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
  const stale = isStale(lastTimestamp);
  const stateVariant =
    state === "warning" ? "destructive" : state === "caution" ? "secondary" : "success";
  const stateLabel = state === "warning" ? "Warning" : state === "caution" ? "Caution" : "Normal";

  const tooltipTitle =
    stateReason === "out_of_limits"
      ? "Value outside mission-defined limits"
      : stateReason === "out_of_family"
        ? "Statistical anomaly (out of family)"
        : undefined;

  const href =
    sourceId && sourceId !== "default"
      ? `/telemetry/${encodeURIComponent(name)}?source=${encodeURIComponent(sourceId)}`
      : `/telemetry/${encodeURIComponent(name)}`;

  return (
    <Link
      href={href}
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
    >
      <Card
        className={`hover:bg-accent/50 active:bg-accent/70 transition-colors duration-200 cursor-pointer h-full ${
          stale ? "border-destructive/30" : ""
        }`}
      >
        <CardHeader className="pb-2 min-w-0 overflow-hidden">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <span className="font-medium text-sm truncate min-w-0">{name}</span>
            <Badge
              variant={stateVariant}
              className="text-xs max-w-[130px] min-w-0 overflow-hidden"
              title={tooltipTitle}
            >
              <span className="truncate block">
                {stateLabel}
                {stateReason && (
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
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Last update: {formatTimeAgo(lastTimestamp)}</span>
              {stale && (
                <span
                  className="inline-flex items-center gap-1 rounded bg-destructive/20 px-1.5 py-0.5 text-destructive"
                  title="Data is stale (no update in 15+ minutes)"
                >
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-destructive" />
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
