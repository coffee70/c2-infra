"use client";

import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useUpcomingObservationsQuery, type SourceObservation } from "@/lib/query-hooks";

interface UpcomingObservationsCardProps {
  sourceId: string | null;
  limit?: number;
}

function formatWindowTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "Unknown duration";
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function formatCountdown(observation: SourceObservation): string {
  const now = Date.now();
  const start = new Date(observation.start_time).getTime();
  const end = new Date(observation.end_time).getTime();
  if (observation.status === "in_progress" || (start <= now && end >= now)) {
    return "Observing now";
  }
  const minutes = Math.max(0, Math.round((start - now) / 60000));
  if (minutes < 1) return "Starts now";
  if (minutes < 60) return `Starts in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `Starts in ${hours}h ${remainder}m` : `Starts in ${hours}h`;
}

function ObservationRow({ observation }: { observation: SourceObservation }) {
  return (
    <div className="border-border/70 flex items-start justify-between gap-3 border-t pt-2 text-xs">
      <div className="min-w-0">
        <p className="truncate font-medium">{formatWindowTime(observation.start_time)}</p>
        <p className="text-muted-foreground truncate">
          {formatDuration(observation.start_time, observation.end_time)}
          {observation.station_name ? ` · ${observation.station_name}` : ""}
        </p>
      </div>
      <span className="text-muted-foreground shrink-0">{formatCountdown(observation)}</span>
    </div>
  );
}

export function UpcomingObservationsCard({ sourceId, limit = 5 }: UpcomingObservationsCardProps) {
  const query = useUpcomingObservationsQuery(sourceId, limit);

  if (!sourceId) {
    return (
      <section className="border-border/70 rounded-md border p-3 text-xs">
        <p className="font-medium">Upcoming observations</p>
        <p className="text-muted-foreground mt-1">Select a source to view upcoming observations.</p>
      </section>
    );
  }

  if (query.isLoading) {
    return (
      <section className="border-border/70 rounded-md border p-3 text-xs">
        <p className="font-medium">Upcoming observations</p>
        <div className="text-muted-foreground mt-2 flex items-center gap-2">
          <Spinner size="sm" />
          Loading expected contact windows...
        </div>
      </section>
    );
  }

  if (query.isError) {
    return (
      <section className="border-border/70 rounded-md border p-3 text-xs">
        <p className="font-medium">Upcoming observations</p>
        <p className="text-destructive mt-1">Failed to load expected contact windows.</p>
      </section>
    );
  }

  const observations = query.data ?? [];
  const next = observations[0];
  const remaining = observations.slice(1);

  if (!next) {
    return (
      <section className="border-border/70 rounded-md border p-3 text-xs">
        <p className="font-medium">Upcoming observations</p>
        <p className="text-muted-foreground mt-1">No upcoming observations available.</p>
      </section>
    );
  }

  return (
    <section className="border-border/70 rounded-md border p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">Next observation</p>
          <p className="text-muted-foreground mt-1 truncate">
            {formatWindowTime(next.start_time)} - {formatWindowTime(next.end_time)}
          </p>
        </div>
        <Badge variant={next.status === "in_progress" ? "default" : "secondary"} className="shrink-0 text-[9px]">
          {formatCountdown(next)}
        </Badge>
      </div>
      <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-3 gap-y-1">
        <span>{formatDuration(next.start_time, next.end_time)}</span>
        {next.station_name && <span>{next.station_name}</span>}
        {typeof next.max_elevation_deg === "number" && (
          <span>{Math.round(next.max_elevation_deg)} deg max elevation</span>
        )}
      </div>
      {remaining.length > 0 && (
        <div className="mt-3 space-y-2">
          {remaining.map((observation) => (
            <ObservationRow key={observation.id} observation={observation} />
          ))}
        </div>
      )}
    </section>
  );
}
