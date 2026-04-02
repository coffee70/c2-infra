"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buildTelemetryDetailHref } from "@/lib/telemetry-routes";

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

function statusVariant(s: string | null | undefined): "default" | "secondary" | "destructive" | "success" {
  if (!s) return "secondary";
  if (s === "warning") return "destructive";
  if (s === "caution") return "secondary";
  return "success";
}

export interface RelatedChannel {
  name: string;
  subsystem_tag: string;
  link_reason: string;
  current_value?: number | null;
  current_status?: string | null;
  last_timestamp?: string | null;
  units?: string | null;
}

interface SimilarTelemetryCardProps {
  detailSourceId: string;
  channels: RelatedChannel[];
}

export function SimilarTelemetryCard({ detailSourceId, channels }: SimilarTelemetryCardProps) {
  if (channels.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Similar / Related Telemetry</CardTitle>
        <p className="text-muted-foreground text-sm">
          Same subsystem or semantically related — triage without extra clicks
        </p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {channels.map((r) => (
            <li key={r.name}>
              <Link
                href={buildTelemetryDetailHref(detailSourceId, r.name)}
                className="hover:bg-accent focus-visible:ring-ring text-primary block rounded-md border p-2 text-sm underline-offset-4 transition-colors duration-200 hover:underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{r.name}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {r.current_value != null && (
                      <span className="tabular-nums">
                        {formatWithUnits(r.current_value, r.units)}
                      </span>
                    )}
                    {r.current_status && (
                      <Badge variant={statusVariant(r.current_status)} className="text-xs">
                        {r.current_status}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span>{r.link_reason}</span>
                  {r.last_timestamp && (
                    <>
                      <span>·</span>
                      <span>{formatTimeAgo(r.last_timestamp)}</span>
                    </>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
