"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { buildTelemetryDetailHref } from "@/lib/telemetry-routes";

const SUBSYSTEM_LABELS: Record<string, string> = {
  power: "Power",
  thermal: "Thermal",
  adcs: "ADCS",
  comms: "Comms",
  other: "Other",
};

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

interface AnomalyEntry {
  name: string;
  units?: string | null;
  current_value: number;
  last_timestamp: string;
  z_score?: number | null;
  state_reason?: string | null;
}

interface AnomaliesPanelProps {
  sourceId: string;
  power: AnomalyEntry[];
  thermal: AnomalyEntry[];
  adcs: AnomalyEntry[];
  comms: AnomalyEntry[];
  other?: AnomalyEntry[];
}

export function AnomaliesPanel({
  sourceId,
  power,
  thermal,
  adcs,
  comms,
  other = [],
}: AnomaliesPanelProps) {
  const groups = [
    { key: "power", entries: power, label: SUBSYSTEM_LABELS.power },
    { key: "thermal", entries: thermal, label: SUBSYSTEM_LABELS.thermal },
    { key: "adcs", entries: adcs, label: SUBSYSTEM_LABELS.adcs },
    { key: "comms", entries: comms, label: SUBSYSTEM_LABELS.comms },
    { key: "other", entries: other, label: SUBSYSTEM_LABELS.other },
  ];

  const totalCount =
    power.length + thermal.length + adcs.length + comms.length + other.length;

  return (
    <Card
      className={
        totalCount > 0
          ? "border-l-destructive/50 border-l-4"
          : undefined
      }
    >
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Anomalies Queue</CardTitle>
          {totalCount > 0 && (
            <span className="bg-destructive/20 text-destructive rounded-full px-2 py-0.5 text-xs font-medium">
              {totalCount}
            </span>
          )}
        </div>
        <p className="text-muted-foreground text-sm">
          {totalCount} anomaly{totalCount !== 1 ? "ies" : ""} (newest first)
        </p>
      </CardHeader>
      <CardContent>
        {totalCount === 0 ? (
          <EmptyState
            icon="inbox"
            title="No anomalies detected"
            description="All systems are operating within normal parameters."
          />
        ) : (
          <div className="space-y-4">
            {groups.map(
              ({ key, entries, label }) =>
                entries.length > 0 && (
                  <div key={key}>
                    <h4 className="text-muted-foreground mb-2 text-sm font-medium">
                      {label}
                    </h4>
                    <ul className="space-y-2">
                      {entries.map((entry) => (
                        <li key={entry.name}>
                          <Link
                            href={buildTelemetryDetailHref(sourceId, entry.name)}
                            className="hover:bg-accent focus-visible:ring-ring text-primary block rounded-md border p-2 underline-offset-4 transition-colors duration-200 hover:underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium">
                                {entry.name}
                              </span>
                              <span className="text-sm">
                                {formatWithUnits(
                                  entry.current_value,
                                  entry.units
                                )}
                              </span>
                            </div>
                            <div className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
                              <span>{formatTimeAgo(entry.last_timestamp)}</span>
                              {entry.state_reason && (
                                <span>
                                  ({entry.state_reason.replace("_", " ")})
                                </span>
                              )}
                              {entry.z_score != null && (
                                <span>z={entry.z_score.toFixed(2)}</span>
                              )}
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
