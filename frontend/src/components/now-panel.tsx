"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface OpsEventSchema {
  id: string;
  source_id: string;
  event_time: string;
  event_type: string;
  severity: string;
  summary: string;
  entity_type: string;
  entity_id?: string | null;
  payload?: Record<string, unknown> | null;
  created_at: string;
}

interface NowPanelProps {
  sourceId: string;
  sinceMinutes?: number;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  "alert.opened": "Alert opened",
  "alert.cleared": "Alert cleared",
  "alert.acked": "Acked",
  "alert.resolved": "Resolved",
  "system.feed_status": "Feed status",
};

function formatTimeAgo(iso: string): string {
  const ts = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - ts.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins === 1) return "1 min ago";
  if (diffMins < 60) return `${diffMins} min ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours === 1) return "1 hr ago";
  return `${diffHours} hr ago`;
}

export function NowPanel({ sourceId, sinceMinutes = 15 }: NowPanelProps) {
  const [filter, setFilter] = useState<string>("all");
  const requestKey = `${sourceId}:${sinceMinutes}:${filter}`;
  const [result, setResult] = useState<{
    requestKey: string;
    events: OpsEventSchema[];
  }>({ requestKey: "", events: [] });
  const loading = result.requestKey !== requestKey;
  const events = loading ? [] : result.events;

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      source_id: sourceId,
      since_minutes: String(sinceMinutes),
      limit: "20",
    });
    if (filter !== "all") {
      if (filter === "alerts") {
        params.set(
          "event_types",
          "alert.opened,alert.cleared,alert.acked,alert.resolved"
        );
      } else if (filter === "system") {
        params.set("event_types", "system.feed_status");
      }
    }
    fetch(`${API_URL}/ops/events?${params}`)
      .then((r) => (r.ok ? r.json() : { events: [], total: 0 }))
      .then((data) => {
        if (!cancelled) {
          setResult({
            requestKey,
            events: data.events || [],
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResult({
            requestKey,
            events: [],
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filter, requestKey, sinceMinutes, sourceId]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Recent events</CardTitle>
          <Link href={`/timeline?source=${encodeURIComponent(sourceId)}`}>
            <Button variant="outline" size="sm" className="h-7 text-xs">
              Timeline
            </Button>
          </Link>
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {["all", "alerts", "system"].map((f) => (
            <Button
              key={f}
              variant={filter === f ? "default" : "ghost"}
              size="sm"
              className="h-6 text-xs px-2"
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "alerts" ? "Alerts" : "System"}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner size="sm" />
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No events in the last {sinceMinutes} minutes.
          </p>
        ) : (
          <ul className="space-y-2 max-h-[200px] overflow-y-auto">
            {events.map((e) => (
              <li
                key={e.id}
                className="text-xs border-b border-border/50 pb-2 last:border-0 last:pb-0"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant={
                      e.severity === "warning" ? "destructive" : "secondary"
                    }
                    className="text-[10px]"
                  >
                    {EVENT_TYPE_LABELS[e.event_type] ?? e.event_type}
                  </Badge>
                  <span className="text-muted-foreground">
                    {formatTimeAgo(e.event_time)}
                  </span>
                </div>
                <p className="mt-0.5 truncate" title={e.summary}>
                  {e.summary}
                </p>
                {e.entity_id && (
                  <Link
                    href={`/telemetry/${encodeURIComponent(e.entity_id)}?source=${encodeURIComponent(sourceId)}`}
                    className="text-primary hover:underline text-xs mt-0.5 inline-block"
                  >
                    {e.entity_id}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
