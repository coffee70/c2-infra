"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useOpsEventsQuery } from "@/lib/query-hooks";

interface ChannelRecentEventsProps {
  channelName: string;
  vehicleId?: string;
  streamId?: string;
  sinceMinutes?: number;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  "alert.opened": "Alert opened",
  "alert.cleared": "Alert cleared",
  "alert.acked": "Acked",
  "alert.resolved": "Resolved",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ChannelRecentEvents({
  channelName,
  vehicleId = "default",
  streamId,
  sinceMinutes = 60,
}: ChannelRecentEventsProps) {
  const params = {
    source_id: vehicleId,
    since_minutes: String(sinceMinutes),
    channel_name: channelName,
    limit: "20",
    ...(streamId ? { stream_id: streamId } : {}),
  };
  const eventsQuery = useOpsEventsQuery(params);
  const loading = eventsQuery.isLoading;
  const events = eventsQuery.data?.events ?? [];

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Recent events for this channel
          </CardTitle>
        </CardHeader>
        <CardContent className="flex justify-center py-8">
          <Spinner size="sm" />
        </CardContent>
      </Card>
    );
  }

  if (events.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Recent events for this channel
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No events in the last {sinceMinutes} minutes.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Recent events for this channel
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {events.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center gap-2 text-sm border-b border-border/50 pb-2 last:border-0 last:pb-0"
            >
              <Badge
                variant={e.severity === "warning" ? "destructive" : "secondary"}
                className="text-[10px]"
              >
                {EVENT_TYPE_LABELS[e.event_type] ?? e.event_type}
              </Badge>
              <span className="text-muted-foreground text-xs">
                {formatTime(e.event_time)}
              </span>
              <span className="truncate">{e.summary}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
