"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TelemetryAlert } from "@/lib/realtime-ws-client";
import { buildTelemetryDetailHref } from "@/lib/telemetry-routes";
import { DEFAULT_SOURCE_ID } from "@/lib/source-ids";

const SUBSYSTEM_LABELS: Record<string, string> = {
  power: "Power",
  thermal: "Thermal",
  adcs: "ADCS",
  comms: "Comms",
  other: "Other",
};

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

interface AnomalyEntry {
  name: string;
  units?: string | null;
  current_value: number;
  last_timestamp: string;
  z_score?: number | null;
  state_reason?: string | null;
  id?: string;
  status?: string;
  severity?: string;
  resolution_text?: string;
}

interface AnomaliesData {
  power: AnomalyEntry[];
  thermal: AnomalyEntry[];
  adcs: AnomalyEntry[];
  comms: AnomalyEntry[];
  other?: AnomalyEntry[];
  orbit?: AnomalyEntry[];
}

interface EventConsoleProps {
  anomalies: AnomaliesData;
  alerts: TelemetryAlert[];
  sourceId?: string;
  onAck?: (alertId: string) => void;
  onResolve?: (
    alertId: string,
    resolutionText: string,
    resolutionCode?: string
  ) => void;
}

export function EventConsole({
  anomalies,
  alerts,
  sourceId,
  onAck,
  onResolve,
}: EventConsoleProps) {
  const [resolveModal, setResolveModal] = useState<{
    alertId: string;
    channelName: string;
  } | null>(null);
  const [resolveText, setResolveText] = useState("");
  const [resolveCode, setResolveCode] = useState("");

  const totalCount =
    anomalies.power.length +
    anomalies.thermal.length +
    anomalies.adcs.length +
    anomalies.comms.length +
    (anomalies.other?.length ?? 0) +
    (anomalies.orbit?.length ?? 0);

  const handleResolve = () => {
    if (resolveModal && onResolve) {
      onResolve(resolveModal.alertId, resolveText, resolveCode || undefined);
      setResolveModal(null);
      setResolveText("");
      setResolveCode("");
    }
  };

  const alertById = new Map(alerts.map((a) => [a.id, a]));

  const groups = [
    { key: "power", entries: anomalies.power, label: SUBSYSTEM_LABELS.power },
    { key: "thermal", entries: anomalies.thermal, label: SUBSYSTEM_LABELS.thermal },
    { key: "adcs", entries: anomalies.adcs, label: SUBSYSTEM_LABELS.adcs },
    { key: "comms", entries: anomalies.comms, label: SUBSYSTEM_LABELS.comms },
    { key: "other", entries: anomalies.other ?? [], label: SUBSYSTEM_LABELS.other },
    { key: "orbit", entries: anomalies.orbit ?? [], label: "Orbit" },
  ];

  return (
    <>
      <Card
        id="events-console"
        className={
          totalCount > 0 ? "border-l-destructive/50 border-l-4" : undefined
        }
      >
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Events Console</CardTitle>
            {totalCount > 0 && (
              <span className="bg-destructive/20 text-destructive rounded-full px-2 py-0.5 text-xs font-medium">
                {totalCount}
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            {totalCount} active alert{totalCount !== 1 ? "s" : ""} (newest first)
          </p>
        </CardHeader>
        <CardContent>
          {totalCount === 0 ? (
            <EmptyState
              icon="inbox"
              title="No active alerts"
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
                        {entries.map((entry) => {
                          const alert = entry.id
                            ? alertById.get(entry.id)
                            : undefined;
                          const canAck =
                            onAck &&
                            alert &&
                            alert.status === "new" &&
                            !alert.resolved_at;
                          const canResolve =
                            onResolve &&
                            alert &&
                            !alert.resolved_at;

                          return (
                            <li key={entry.name + (entry.id ?? "")}>
                              <div className="hover:bg-accent/50 rounded-md border p-2 transition-colors">
                                <div className="flex items-center justify-between gap-2">
                                  <Link
                                    href={
                                      entry.name.startsWith("Orbit: ")
                                        ? "/planning"
                                        : buildTelemetryDetailHref(sourceId || DEFAULT_SOURCE_ID, entry.name)
                                    }
                                    className="text-primary min-w-0 flex-1 truncate text-sm font-medium underline-offset-4 hover:underline"
                                  >
                                    {entry.name}
                                  </Link>
                                  <span className="shrink-0 text-sm">
                                    {formatWithUnits(
                                      entry.current_value,
                                      entry.units
                                    )}
                                  </span>
                                </div>
                                <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-xs">
                                  <span>{formatTimeAgo(entry.last_timestamp)}</span>
                                  {entry.state_reason && (
                                    <span>
                                      ({entry.state_reason.replace("_", " ")})
                                    </span>
                                  )}
                                  {entry.z_score != null && (
                                    <span>z={entry.z_score.toFixed(2)}</span>
                                  )}
                                  {entry.status === "acked" && (
                                    <span className="text-amber-500 dark:text-amber-400">Acked</span>
                                  )}
                                </div>
                                {canAck && (
                                  <div className="mt-2 flex gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs"
                                      onClick={() =>
                                        entry.id && onAck(entry.id)
                                      }
                                    >
                                      Ack
                                    </Button>
                                    {canResolve && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs"
                                        onClick={() =>
                                          entry.id &&
                                          setResolveModal({
                                            alertId: entry.id,
                                            channelName: entry.name,
                                          })
                                        }
                                      >
                                        Resolve
                                      </Button>
                                    )}
                                  </div>
                                )}
                                {canResolve && !canAck && (
                                  <div className="mt-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs"
                                      onClick={() =>
                                        entry.id &&
                                        setResolveModal({
                                          alertId: entry.id,
                                          channelName: entry.name,
                                        })
                                      }
                                    >
                                      Resolve
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!resolveModal}
        onOpenChange={(open) => !open && setResolveModal(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve Alert</DialogTitle>
            <DialogDescription>
              {resolveModal
                ? `Document resolution for ${resolveModal.channelName}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="resolve-text">Resolution notes</Label>
              <Input
                id="resolve-text"
                value={resolveText}
                onChange={(e) => setResolveText(e.target.value)}
                placeholder="Describe what was done..."
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="resolve-code">Resolution code (optional)</Label>
              <Input
                id="resolve-code"
                value={resolveCode}
                onChange={(e) => setResolveCode(e.target.value)}
                placeholder="e.g. NOMINAL, FALSE_ALARM"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveModal(null)}>
              Cancel
            </Button>
            <Button onClick={handleResolve}>Resolve</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
