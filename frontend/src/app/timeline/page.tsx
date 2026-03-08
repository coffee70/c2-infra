"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

interface TelemetrySource {
  id: string;
  name: string;
  source_type?: string;
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

function TimelineContent() {
  const searchParams = useSearchParams();
  const sourceFromUrl = searchParams.get("source") ?? "default";

  const [sourceId, setSourceId] = useState(sourceFromUrl);
  const [sources, setSources] = useState<TelemetrySource[]>([]);
  const [rangeMinutes, setRangeMinutes] = useState(60);
  const [events, setEvents] = useState<OpsEventSchema[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all");

  const fetchEvents = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({
      source_id: sourceId,
      since_minutes: String(rangeMinutes),
      limit: "100",
      offset: "0",
    });
    if (eventTypeFilter !== "all") {
      if (eventTypeFilter === "alerts") {
        params.set(
          "event_types",
          "alert.opened,alert.cleared,alert.acked,alert.resolved"
        );
      } else if (eventTypeFilter === "system") {
        params.set("event_types", "system.feed_status");
      }
    }
    fetch(`${API_URL}/ops/events?${params}`)
      .then((r) => (r.ok ? r.json() : { events: [], total: 0 }))
      .then((data) => {
        setEvents(data.events || []);
        setTotal(data.total ?? 0);
      })
      .catch(() => {
        setEvents([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [sourceId, rangeMinutes, eventTypeFilter]);

  useEffect(() => {
    setSourceId(sourceFromUrl);
  }, [sourceFromUrl]);

  useEffect(() => {
    fetch(`${API_URL}/telemetry/sources`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setSources(Array.isArray(data) ? data : []))
      .catch(() => setSources([]));
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-semibold">Timeline</h1>
          <Link href="/overview">
            <Button variant="outline" size="sm">
              Back to Overview
            </Button>
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Filters</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4 items-end">
            <div className="space-y-2">
              <label className="text-sm font-medium">Source</label>
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger className="w-[180px]">
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
                        {sources.length === 0 && (
                          <SelectItem value="default">Default</SelectItem>
                        )}
                      </>
                    );
                  })()}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Time range</label>
              <div className="flex gap-1">
                {RANGE_OPTIONS.map(({ label, minutes }) => (
                  <Button
                    key={minutes}
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
              <label className="text-sm font-medium">Event type</label>
              <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="alerts">Alerts</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Events</CardTitle>
              <span className="text-sm text-muted-foreground">
                {total} total
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Spinner size="default" />
              </div>
            ) : events.length === 0 ? (
              <p className="text-muted-foreground py-8 text-center">
                No events in the selected range.
              </p>
            ) : (
              <ul
                className="space-y-0 divide-y divide-border"
                role="list"
                aria-label="Timeline events"
              >
                {events.map((e) => (
                  <li
                    key={e.id}
                    className="py-3 px-2 hover:bg-muted/50 transition-colors focus-within:bg-muted/50"
                    tabIndex={0}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          e.severity === "warning" ? "destructive" : "secondary"
                        }
                        className="text-xs shrink-0"
                      >
                        {EVENT_TYPE_LABELS[e.event_type] ?? e.event_type}
                      </Badge>
                      <span className="text-sm text-muted-foreground tabular-nums shrink-0">
                        {formatTime(e.event_time)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm">{e.summary}</p>
                    {e.entity_id && (
                      <Link
                        href={`/telemetry/${encodeURIComponent(e.entity_id)}?source=${encodeURIComponent(sourceId)}`}
                        className="text-xs text-primary hover:underline mt-1 inline-block"
                      >
                        View {e.entity_id}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function TimelinePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen p-4 sm:p-6 lg:p-8 flex items-center justify-center">
        <Spinner size="default" />
      </div>
    }>
      <TimelineContent />
    </Suspense>
  );
}
