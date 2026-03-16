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
  telemetry_definition_path?: string;
}

interface SimulatorStatus {
  connected: boolean;
  state?: "idle" | "running" | "paused";
}

export default function SourcesPage() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);
  const [wizardType, setWizardType] = useState<"vehicle" | "simulator">("simulator");
  const [wizardName, setWizardName] = useState("");
  const [wizardBaseUrl, setWizardBaseUrl] = useState("");
  const [wizardDefinitionPath, setWizardDefinitionPath] = useState("");
  const [wizardSubmitting, setWizardSubmitting] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [editDefinitionPath, setEditDefinitionPath] = useState("");
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
      setWizardError("Name and telemetry definition path are required");
      return;
    }
    if (wizardType === "simulator" && !wizardBaseUrl.trim()) {
      setWizardError("Simulator base URL is required");
      return;
    }
    setWizardSubmitting(true);
    setWizardError(null);
    try {
      await createSourceMutation.mutateAsync({
        source_type: wizardType,
        name: wizardName.trim(),
        base_url: wizardType === "simulator" ? wizardBaseUrl.trim() : undefined,
        telemetry_definition_path: wizardDefinitionPath.trim(),
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
    setEditDefinitionPath(source.telemetry_definition_path || "");
    setEditError(null);
  }

  async function handleEditSubmit() {
    if (!editingSourceId) return;
    const source = sources.find((entry) => entry.id === editingSourceId);
    const isSimulator = source?.source_type === "simulator";
    try {
      setEditError(null);
      await updateSourceMutation.mutateAsync({
        sourceId: editingSourceId,
        name: editName.trim(),
        base_url: editBaseUrl.trim() || undefined,
        telemetry_definition_path: isSimulator ? undefined : editDefinitionPath.trim() || undefined,
      });
      setEditingSourceId(null);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Failed to update source");
    }
  }

  if (loading) {
    return (
      <div className="min-h-full p-4 sm:p-6 lg:p-8 flex items-center justify-center">
        <Spinner size="lg" className="h-10 w-10" />
      </div>
    );
  }

  return (
    <div className="min-h-full p-4 sm:p-6 lg:p-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Sources</h1>
          <Button onClick={openWizard}>Add source</Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Vehicles</CardTitle>
            <p className="text-sm text-muted-foreground">
              Telemetry sources from physical or external ingest.
            </p>
          </CardHeader>
          <CardContent>
            {vehicles.length === 0 ? (
              <p className="text-sm text-muted-foreground">No vehicles registered.</p>
            ) : (
              <ul className="space-y-2">
                {vehicles.map((s) => {
                  const isEditing = editingSourceId === s.id;
                  return (
                    <li
                      key={s.id}
                      className="flex flex-col gap-2 py-3 border-b last:border-0"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <span className="font-medium">{s.name}</span>
                          {s.description && (
                            <span className="ml-2 text-sm text-muted-foreground">
                              {s.description}
                            </span>
                          )}
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
                        <p className="text-xs text-muted-foreground font-mono">
                          {s.telemetry_definition_path || "—"}
                        </p>
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
                              <Label htmlFor={`edit-defpath-${s.id}`}>Definition path</Label>
                              <Input
                                id={`edit-defpath-${s.id}`}
                                value={editDefinitionPath}
                                onChange={(e) => setEditDefinitionPath(e.target.value)}
                                className="mt-1"
                              />
                            </div>
                          </div>
                          {editError ? <p className="text-sm text-destructive">{editError}</p> : null}
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
            <p className="text-sm text-muted-foreground">
              In-app or remote simulator instances. Add one to connect.
            </p>
          </CardHeader>
          <CardContent>
            {simulators.length === 0 ? (
              <p className="text-sm text-muted-foreground">No simulators. Add one to get started.</p>
            ) : (
              <ul className="space-y-3">
                {simulators.map((s) => {
                  const status = simulatorStatuses[s.id];
                  const connected = status?.connected === true;
                  const isEditing = editingSourceId === s.id;
                  return (
                    <li
                      key={s.id}
                      className="flex flex-col gap-2 py-3 border-b last:border-0"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{s.name}</span>
                          <SimulatorStatusBadge
                            connected={connected}
                            state={status?.state}
                          />
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
                        <div className="space-y-1 text-xs text-muted-foreground font-mono">
                          <p>{s.base_url || "—"}</p>
                          <p>{s.telemetry_definition_path || "—"}</p>
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
                          </div>
                          {editError ? <p className="text-sm text-destructive">{editError}</p> : null}
                        </div>
                      )}
                      {isEditing ? (
                        <p className="text-xs text-muted-foreground font-mono">
                          Definition path is fixed by the simulator runtime: {s.telemetry_definition_path || "—"}
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
                : "Enter the source details. The telemetry definition path must resolve inside the backend definitions directory."}
            </DialogDescription>
          </DialogHeader>
          {wizardStep === 1 ? (
            <div className="grid gap-3 py-4">
              <button
                type="button"
                onClick={() => {
                  setWizardType("vehicle");
                  handleWizardNext();
                }}
                className="flex items-start gap-4 rounded-lg border border-input bg-background p-4 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <SatelliteIcon className="size-6 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Vehicle</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Register a physical spacecraft or external telemetry stream using a shared telemetry definition file.
                  </p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setWizardType("simulator");
                  handleWizardNext();
                }}
                className="flex items-start gap-4 rounded-lg border border-input bg-background p-4 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <CpuIcon className="size-6 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Simulator</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Add an in-app or remote simulator instance backed by a source-specific telemetry definition file.
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
                <Label htmlFor="wizard-definition-path">Telemetry definition path</Label>
                <Input
                  id="wizard-definition-path"
                  value={wizardDefinitionPath}
                  onChange={(e) => setWizardDefinitionPath(e.target.value)}
                  placeholder={wizardType === "simulator" ? "simulators/drogonsat.yaml" : "vehicles/aegon-relay.yaml"}
                  className="mt-1"
                />
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
                  <p className="text-xs text-muted-foreground mt-1">
                    URL the server uses to reach the simulator (e.g. http://simulator:8001).
                  </p>
                </div>
              ) : null}
              {wizardError && (
                <p className="text-sm text-destructive">{wizardError}</p>
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
