"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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

/** Simple linear regression on (timestamp_ms, value). Returns slope in value per minute. */
function computeSlope(
  data: { timestamp: string; value: number }[],
  lastN: number = 20
): number | null {
  const points = data.slice(-lastN);
  if (points.length < 2) return null;
  const n = points.length;
  const xs = points.map((p) => new Date(p.timestamp).getTime());
  const ys = points.map((p) => p.value);
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((acc, x, i) => acc + x * ys[i], 0);
  const sumX2 = xs.reduce((a, b) => a + b * b, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-15) return null;
  const slopePerMs = (n * sumXY - sumX * sumY) / denom;
  return slopePerMs * 60000; // value per minute
}

interface CurrentValueBlockProps {
  value: number;
  units?: string | null;
  lastTimestamp?: string | null;
  p50: number;
  state: string;
  stateReason?: string | null;
  zScore?: number | null;
  recentData: { timestamp: string; value: number }[];
}

export function CurrentValueBlock({
  value,
  units,
  lastTimestamp,
  p50,
  state,
  stateReason,
  zScore,
  recentData,
}: CurrentValueBlockProps) {
  const delta = value - p50;
  const slope = computeSlope(recentData);
  const statusLabel = formatOperationalStatus(state, stateReason, zScore);
  const stateVariant =
    state === "warning" ? "destructive" : state === "caution" ? "secondary" : "success";

  return (
    <Card className="border-2">
      <CardContent className="pt-6 pb-6">
        <div className="flex flex-col gap-4">
          <div className="text-6xl font-bold tabular-nums">
            {formatWithUnits(value, units)}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {lastTimestamp && (
              <>
                <span>
                  {new Date(lastTimestamp).toLocaleString(undefined, {
                    timeZone: "UTC",
                    dateStyle: "medium",
                    timeStyle: "medium",
                  })}{" "}
                  UTC
                </span>
                <span>·</span>
                <span>{formatTimeAgo(lastTimestamp)}</span>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span>
              {delta >= 0 ? "+" : ""}
              {formatWithUnits(delta, units)} vs P50
            </span>
            {slope != null && (
              <>
                <span className="text-muted-foreground">·</span>
                <span>
                  Slope: {slope >= 0 ? "+" : ""}
                  {slope.toFixed(4)}/min
                </span>
              </>
            )}
          </div>
          <div>
            <Badge variant={stateVariant} className="text-sm font-medium">
              {statusLabel}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
