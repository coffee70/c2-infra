"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  channels: RelatedChannel[];
}

export function SimilarTelemetryCard({ channels }: SimilarTelemetryCardProps) {
  if (channels.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Similar / Related Telemetry</CardTitle>
        <p className="text-sm text-muted-foreground">
          Same subsystem or semantically related — triage without extra clicks
        </p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {channels.map((r) => (
            <li key={r.name}>
              <Link
                href={`/telemetry/${encodeURIComponent(r.name)}`}
                className="block p-2 rounded-md border hover:bg-accent transition-colors duration-150 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-medium">{r.name}</span>
                  <div className="flex items-center gap-2 flex-wrap">
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
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
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
