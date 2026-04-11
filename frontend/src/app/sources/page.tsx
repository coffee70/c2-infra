"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SimulatorStatusBadge } from "@/components/simulator-status-badge";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { SatelliteIcon, CpuIcon } from "lucide-react";
import {
  useCreateTelemetrySourceMutation,
  useSimulatorStatusesMap,
  useTelemetrySourcesQuery,
  useUpdateTelemetrySourceMutation,
} from "@/lib/query-hooks";

interface TelemetrySource {
  id: string;
  name: string;
  description?: string | null;
  source_type: string;
  base_url?: string | null;
  vehicle_config_path?: string;
  monitoring_start_time?: string;
  last_reconciled_at?: string | null;
  history_mode?: "live_only" | "time_window_replay" | "cursor_replay";
  live_state?: "idle" | "active" | "error";
  backfill_state?: "idle" | "running" | "complete" | "error";
}

interface SimulatorStatus {
  connected: boolean;
  state?: "idle" | "running" | "paused";
}

type HistoryMode = "live_only" | "time_window_replay" | "cursor_replay";

function toDateTimeLocalValue(value: Date = new Date()) {
  const offsetMs = value.getTimezoneOffset() * 60 * 1000;
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16);
}

function dateTimeLocalToIso(value: string) {
  return new Date(value).toISOString();
}

function formatIngestionTime(value?: string | null) {
  if (!value) return "Not reconciled";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function historyModeLabel(value?: HistoryMode) {
  if (value === "live_only") return "Live only";
  if (value === "cursor_replay") return "Cursor replay";
  return "Time window replay";
}

export default function SourcesPage() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);
  const [wizardType, setWizardType] = useState<"vehicle" | "simulator">("simulator");
  const [wizardName, setWizardName] = useState("");
  const [wizardBaseUrl, setWizardBaseUrl] = useState("");
  const [wizardDefinitionPath, setWizardDefinitionPath] = useState("");
  const [wizardMonitoringStart, setWizardMonitoringStart] = useState(toDateTimeLocalValue());
  const [wizardHistoryMode, setWizardHistoryMode] = useState<HistoryMode>("live_only");
  const [wizardSubmitting, setWizardSubmitting] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [editDefinitionPath, setEditDefinitionPath] = useState("");
  const [editMonitoringStart, setEditMonitoringStart] = useState("");
  const [editHistoryMode, setEditHistoryMode] = useState<HistoryMode>("time_window_replay");
  const [editError, setEditError] = useState<string | null>(null);
  const sourcesQuery = useTelemetrySourcesQuery<TelemetrySource[]>();
  const createSourceMutation = useCreateTelemetrySourceMutation();
  const updateSourceMutation = useUpdateTelemetrySourceMutation();
  const sources = sourcesQuery.data ?? [];
  const loading = sourcesQuery.isLoading;

  const vehicles = sources.filter((s) => s.source_type === "vehicle");
  const simulators = sources.filter((s) => s.source_type === "simulator");
  const simulatorStatuses = useSimulatorStatusesMap(
    useMemo(() => simulators.map((simulator) => simulator.id), [simulators]),
    simulators.length > 0,
    5000
  ) as Record<string, SimulatorStatus>;

  function openWizard() {
    setWizardStep(1);
    setWizardType("simulator");
    setWizardName("");
    setWizardBaseUrl("");
    setWizardDefinitionPath("");
    setWizardMonitoringStart(toDateTimeLocalValue());
    setWizardHistoryMode("live_only");
    setWizardError(null);
    setWizardOpen(true);
  }

  function handleWizardNext() {
    if (wizardStep === 1) {
      setWizardStep(2);
    }
  }

  async function handleWizardSubmit() {
    if (!wizardName.trim() || !wizardDefinitionPath.trim()) {
      setWizardError("Name and vehicle configuration path are required");
      return;
    }
    if (wizardType === "simulator" && !wizardBaseUrl.trim()) {
      setWizardError("Simulator base URL is required");
      return;
    }
    if (!wizardMonitoringStart) {
      setWizardError("Monitoring start time is required");
      return;
    }
    setWizardSubmitting(true);
    setWizardError(null);
    try {
      await createSourceMutation.mutateAsync({
        source_type: wizardType,
        name: wizardName.trim(),
        base_url: wizardType === "simulator" ? wizardBaseUrl.trim() : undefined,
        vehicle_config_path: wizardDefinitionPath.trim(),
        monitoring_start_time: dateTimeLocalToIso(wizardMonitoringStart),
        history_mode: wizardHistoryMode,
      });
      setWizardOpen(false);
    } catch (e) {
      setWizardError(e instanceof Error ? e.message : "Failed to create source");
    } finally {
      setWizardSubmitting(false);
    }
  }

  function openEdit(source: TelemetrySource) {
    setEditingSourceId(source.id);
    setEditName(source.name);
    setEditBaseUrl(source.base_url || "");
    setEditDefinitionPath(source.vehicle_config_path || "");
    setEditMonitoringStart(
      source.monitoring_start_time ? toDateTimeLocalValue(new Date(source.monitoring_start_time)) : toDateTimeLocalValue()
    );
    setEditHistoryMode(source.history_mode || (source.source_type === "simulator" ? "live_only" : "time_window_replay"));
    setEditError(null);
  }

  async function handleEditSubmit() {
    if (!editingSourceId) return;
    const source = sources.find((entry) => entry.id === editingSourceId);
    const isSimulator = source?.source_type === "simulator";
    if (!editMonitoringStart) {
      setEditError("Monitoring start time is required");
      return;
    }
    try {
      setEditError(null);
      await updateSourceMutation.mutateAsync({
        sourceId: editingSourceId,
        name: editName.trim(),
        base_url: editBaseUrl.trim() || undefined,
        vehicle_config_path: isSimulator ? undefined : editDefinitionPath.trim() || undefined,
        monitoring_start_time: dateTimeLocalToIso(editMonitoringStart),
        history_mode: editHistoryMode,
      });
      setEditingSourceId(null);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Failed to update source");
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center p-4 sm:p-6 lg:p-8">
        <Spinner size="lg" className="h-10 w-10" />
      </div>
    );
  }

  return (
    <div className="min-h-full p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-2xl space-y-8">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Sources</h1>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/sources/configs">Vehicle Configurations</Link>
            </Button>
            <Button onClick={openWizard}>Add source</Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Vehicles</CardTitle>
            <p className="text-muted-foreground text-sm">
              Telemetry sources from physical or external ingest.
            </p>
          </CardHeader>
          <CardContent>
            {vehicles.length === 0 ? (
              <p className="text-muted-foreground text-sm">No vehicles registered.</p>
            ) : (
              <ul className="space-y-2">
                {vehicles.map((s) => {
                  const isEditing = editingSourceId === s.id;
                  return (
                    <li
                      key={s.id}
                      className="flex flex-col gap-2 border-b py-3 last:border-0"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-medium">{s.name}</span>
                          {s.description && (
                            <span className="text-muted-foreground ml-2 text-sm">
                              {s.description}
                            </span>
                          )}
                          <p className="text-muted-foreground mt-1 text-xs">
                            Live {s.live_state || "idle"} · Backfill {s.backfill_state || "idle"} · {historyModeLabel(s.history_mode)}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {!isEditing ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEdit(s)}
                            >
                              Edit
                            </Button>
                          ) : (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setEditingSourceId(null);
                                  setEditError(null);
                                }}
                              >
                                Cancel
                              </Button>
                              <Button size="sm" onClick={handleEditSubmit}>
                                Save
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                      {!isEditing ? (
                        <div className="text-muted-foreground space-y-1 text-xs">
                          <p className="font-mono">{s.vehicle_config_path || "—"}</p>
                          <p>Last reconciled: {formatIngestionTime(s.last_reconciled_at)}</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <div>
                              <Label htmlFor={`edit-name-${s.id}`}>Name</Label>
                              <Input
                                id={`edit-name-${s.id}`}
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="mt-1"
                              />
                            </div>
                            <div>
                              <Label htmlFor={`edit-defpath-${s.id}`}>Vehicle Configuration Path</Label>
                              <Input
                                id={`edit-defpath-${s.id}`}
                                value={editDefinitionPath}
                                onChange={(e) => setEditDefinitionPath(e.target.value)}
                                className="mt-1"
                              />
                            </div>
                            <div>
                              <Label htmlFor={`edit-monitoring-${s.id}`}>Monitoring Start</Label>
                              <Input
                                id={`edit-monitoring-${s.id}`}
                                type="datetime-local"
                                value={editMonitoringStart}
                                onChange={(e) => setEditMonitoringStart(e.target.value)}
                                className="mt-1"
                              />
                            </div>
                            <div>
                              <Label htmlFor={`edit-history-${s.id}`}>History Mode</Label>
                              <Select value={editHistoryMode} onValueChange={(value) => setEditHistoryMode(value as HistoryMode)}>
                                <SelectTrigger id={`edit-history-${s.id}`} className="mt-1 w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="live_only">Live only</SelectItem>
                                  <SelectItem value="time_window_replay">Time window replay</SelectItem>
                                  <SelectItem value="cursor_replay">Cursor replay</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          {editError ? <p className="text-destructive text-sm">{editError}</p> : null}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Simulators</CardTitle>
            <p className="text-muted-foreground text-sm">
              In-app or remote simulator instances. Add one to connect.
            </p>
          </CardHeader>
          <CardContent>
            {simulators.length === 0 ? (
              <p className="text-muted-foreground text-sm">No simulators. Add one to get started.</p>
            ) : (
              <ul className="space-y-3">
                {simulators.map((s) => {
                  const status = simulatorStatuses[s.id];
                  const connected = status?.connected === true;
                  const isEditing = editingSourceId === s.id;
                  return (
                    <li
                      key={s.id}
                      className="flex flex-col gap-2 border-b py-3 last:border-0"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{s.name}</span>
                              <SimulatorStatusBadge
                                connected={connected}
                                state={status?.state}
                              />
                            </div>
                            <p className="text-muted-foreground mt-1 text-xs">
                              Live {s.live_state || "idle"} · Backfill {s.backfill_state || "complete"} · {historyModeLabel(s.history_mode)}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {!isEditing ? (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openEdit(s)}
                              >
                                Edit
                              </Button>
                              <Button variant="default" size="sm" asChild>
                                <Link href={`/sources/simulator/${encodeURIComponent(s.id)}`}>
                                  Manage
                                </Link>
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setEditingSourceId(null);
                                  setEditError(null);
                                }}
                              >
                                Cancel
                              </Button>
                              <Button size="sm" onClick={handleEditSubmit}>
                                Save
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                      {!isEditing ? (
                        <div className="text-muted-foreground space-y-1 font-mono text-xs">
                          <p>{s.base_url || "—"}</p>
                          <p>{s.vehicle_config_path || "—"}</p>
                          <p className="font-sans">Last reconciled: {formatIngestionTime(s.last_reconciled_at)}</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <div>
                              <Label htmlFor={`edit-name-${s.id}`}>Name</Label>
                              <Input
                                id={`edit-name-${s.id}`}
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="mt-1"
                              />
                            </div>
                            <div>
                              <Label htmlFor={`edit-baseurl-${s.id}`}>Base URL</Label>
                              <Input
                                id={`edit-baseurl-${s.id}`}
                                value={editBaseUrl}
                                onChange={(e) => setEditBaseUrl(e.target.value)}
                                placeholder="http://simulator:8001"
                                className="mt-1"
                              />
                            </div>
                            <div>
                              <Label htmlFor={`edit-monitoring-${s.id}`}>Monitoring Start</Label>
                              <Input
                                id={`edit-monitoring-${s.id}`}
                                type="datetime-local"
                                value={editMonitoringStart}
                                onChange={(e) => setEditMonitoringStart(e.target.value)}
                                className="mt-1"
                              />
                            </div>
                            <div>
                              <Label htmlFor={`edit-history-${s.id}`}>History Mode</Label>
                              <Select value={editHistoryMode} onValueChange={(value) => setEditHistoryMode(value as HistoryMode)}>
                                <SelectTrigger id={`edit-history-${s.id}`} className="mt-1 w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="live_only">Live only</SelectItem>
                                  <SelectItem value="time_window_replay">Time window replay</SelectItem>
                                  <SelectItem value="cursor_replay">Cursor replay</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          {editError ? <p className="text-destructive text-sm">{editError}</p> : null}
                        </div>
                      )}
                      {isEditing ? (
                        <p className="text-muted-foreground font-mono text-xs">
                          Vehicle configuration path is fixed by the simulator runtime: {s.vehicle_config_path || "—"}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {wizardStep === 1 ? "Add source" : `Add ${wizardType}`}
            </DialogTitle>
            <DialogDescription>
              {wizardStep === 1
                ? "Choose the type of source you want to add. Vehicles connect to physical or external telemetry streams; simulators run synthetic data for testing."
                : "Enter the source details. The vehicle configuration path must resolve inside the backend vehicle configuration directory."}
            </DialogDescription>
          </DialogHeader>
          {wizardStep === 1 ? (
            <div className="grid gap-3 py-4">
              <button
                type="button"
                onClick={() => {
                  setWizardType("vehicle");
                  setWizardHistoryMode("time_window_replay");
                  handleWizardNext();
                }}
                className="border-input bg-background hover:bg-accent hover:text-accent-foreground flex items-start gap-4 rounded-lg border p-4 text-left transition-colors"
              >
                <div className="bg-primary/10 flex size-12 shrink-0 items-center justify-center rounded-lg">
                  <SatelliteIcon className="text-primary size-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Vehicle</p>
                  <p className="text-muted-foreground mt-0.5 text-sm">
                    Register a physical spacecraft or external telemetry stream using a shared vehicle configuration file.
                  </p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setWizardType("simulator");
                  setWizardHistoryMode("live_only");
                  handleWizardNext();
                }}
                className="border-input bg-background hover:bg-accent hover:text-accent-foreground flex items-start gap-4 rounded-lg border p-4 text-left transition-colors"
              >
                <div className="bg-primary/10 flex size-12 shrink-0 items-center justify-center rounded-lg">
                  <CpuIcon className="text-primary size-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Simulator</p>
                  <p className="text-muted-foreground mt-0.5 text-sm">
                    Add an in-app or remote simulator instance backed by a source-specific vehicle configuration file.
                  </p>
                </div>
              </button>
            </div>
          ) : (
            <div className="grid gap-4 py-4">
              <div>
                <Label htmlFor="wizard-name">Name</Label>
                <Input
                  id="wizard-name"
                  value={wizardName}
                  onChange={(e) => setWizardName(e.target.value)}
                  placeholder="My Simulator"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="wizard-definition-path">Vehicle Configuration Path</Label>
                <Input
                  id="wizard-definition-path"
                  value={wizardDefinitionPath}
                  onChange={(e) => setWizardDefinitionPath(e.target.value)}
                  placeholder={wizardType === "simulator" ? "simulators/drogonsat.yaml" : "vehicles/aegon-relay.yaml"}
                  className="mt-1"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="wizard-monitoring-start">Monitoring Start</Label>
                  <Input
                    id="wizard-monitoring-start"
                    type="datetime-local"
                    value={wizardMonitoringStart}
                    onChange={(e) => setWizardMonitoringStart(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="wizard-history-mode">History Mode</Label>
                  <Select value={wizardHistoryMode} onValueChange={(value) => setWizardHistoryMode(value as HistoryMode)}>
                    <SelectTrigger id="wizard-history-mode" className="mt-1 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="live_only">Live only</SelectItem>
                      <SelectItem value="time_window_replay">Time window replay</SelectItem>
                      <SelectItem value="cursor_replay">Cursor replay</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {wizardType === "simulator" ? (
                <div>
                  <Label htmlFor="wizard-baseurl">Base URL</Label>
                  <Input
                    id="wizard-baseurl"
                    value={wizardBaseUrl}
                    onChange={(e) => setWizardBaseUrl(e.target.value)}
                    placeholder="http://simulator:8001"
                    className="mt-1"
                  />
                  <p className="text-muted-foreground mt-1 text-xs">
                    URL the server uses to reach the simulator (e.g. http://simulator:8001).
                  </p>
                </div>
              ) : null}
              {wizardError && (
                <p className="text-destructive text-sm">{wizardError}</p>
              )}
            </div>
          )}
          <DialogFooter>
            {wizardStep === 2 ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setWizardStep(1)}
                  disabled={wizardSubmitting}
                >
                  Back
                </Button>
                <Button onClick={handleWizardSubmit} disabled={wizardSubmitting}>
                  {wizardSubmitting ? "Creating…" : "Create"}
                </Button>
              </>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
