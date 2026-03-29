"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useOpsEventsQuery } from "@/lib/query-hooks";
import { buildTelemetryDetailHref } from "@/lib/telemetry-routes";

interface OpsEventHistoryProps {
  vehicleId: string;
  streamId?: string | null;
}

const RANGE_OPTIONS = [
  { label: "15 min", minutes: 15 },
  { label: "1 hr", minutes: 60 },
  { label: "6 hr", minutes: 360 },
  { label: "24 hr", minutes: 1440 },
];

const EVENT_TYPE_LABELS: Record<string, string> = {
  "alert.opened": "Alert opened",
  "alert.cleared": "Alert cleared",
  "alert.acked": "Acked",
  "alert.resolved": "Resolved",
  "system.feed_status": "Feed status",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function OpsEventHistory({ vehicleId, streamId }: OpsEventHistoryProps) {
  const [rangeMinutes, setRangeMinutes] = useState(15);
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all");
  const params: Record<string, string> = {
    vehicle_id: vehicleId,
    since_minutes: String(rangeMinutes),
    limit: "100",
    offset: "0",
  };
  if (streamId) {
    params.stream_id = streamId;
  }
  if (eventTypeFilter !== "all") {
    if (eventTypeFilter === "alerts") {
      params.event_types = "alert.opened,alert.cleared,alert.acked,alert.resolved";
    } else if (eventTypeFilter === "system") {
      params.event_types = "system.feed_status";
    }
  }
  const eventsQuery = useOpsEventsQuery(params);
  const loading = eventsQuery.isLoading;
  const events = eventsQuery.data?.events ?? [];
  const total = eventsQuery.data?.total ?? 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Event history</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Recent and historical ops events for the current Overview source.
            </p>
          </div>
          <span className="text-sm text-muted-foreground">{total} total</span>
        </div>
        <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <span className="text-sm font-medium">Time range</span>
            <div className="flex flex-wrap gap-1">
              {RANGE_OPTIONS.map(({ label, minutes }) => (
                <Button
                  key={minutes}
                  type="button"
                  variant={rangeMinutes === minutes ? "default" : "outline"}
                  size="sm"
                  onClick={() => setRangeMinutes(minutes)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <span className="text-sm font-medium">Event type</span>
            <div className="flex flex-wrap gap-1">
              {["all", "alerts", "system"].map((filter) => (
                <Button
                  key={filter}
                  type="button"
                  variant={eventTypeFilter === filter ? "default" : "outline"}
                  size="sm"
                  onClick={() => setEventTypeFilter(filter)}
                >
                  {filter === "all"
                    ? "All"
                    : filter === "alerts"
                      ? "Alerts"
                      : "System"}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size="default" />
          </div>
        ) : events.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">
            No events in the selected range.
          </p>
        ) : (
          <ul
            className="divide-y divide-border"
            role="list"
            aria-label="Overview event history"
          >
            {events.map((event) => (
              <li
                key={event.id}
                className="px-2 py-3 transition-colors hover:bg-muted/40 focus-within:bg-muted/40"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      event.severity === "warning" ? "destructive" : "secondary"
                    }
                    className="shrink-0 text-xs"
                  >
                    {EVENT_TYPE_LABELS[event.event_type] ?? event.event_type}
                  </Badge>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {formatTime(event.event_time)}
                  </span>
                </div>
                <p className="mt-1 text-sm">{event.summary}</p>
                {event.entity_id && (
                  <Link
                    href={buildTelemetryDetailHref(
                      vehicleId,
                      event.entity_id,
                      event.stream_id ?? streamId ?? undefined,
                    )}
                    className="mt-1 inline-block text-xs text-primary hover:underline"
                  >
                    View {event.entity_id}
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
