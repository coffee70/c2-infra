"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface TelemetrySource {
  id: string;
  name: string;
  description?: string | null;
  source_type: string;
  base_url?: string | null;
}

interface SimulatorStatus {
  connected: boolean;
  state?: "idle" | "running" | "paused";
}

export default function SourcesPage() {
  const [sources, setSources] = useState<TelemetrySource[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);
  const [wizardType, setWizardType] = useState<"vehicle" | "simulator">("simulator");
  const [wizardName, setWizardName] = useState("");
  const [wizardBaseUrl, setWizardBaseUrl] = useState("");
  const [wizardSubmitting, setWizardSubmitting] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [simulatorStatuses, setSimulatorStatuses] = useState<Record<string, SimulatorStatus>>({});
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editBaseUrl, setEditBaseUrl] = useState("");

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/telemetry/sources`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setSources(Array.isArray(data) ? data : []);
      }
    } catch {
      setSources([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  useEffect(() => {
    const sims = sources.filter((s) => s.source_type === "simulator");
    if (sims.length === 0) return;
    let cancelled = false;
    function fetchStatuses() {
      sims.forEach(async (s) => {
        try {
          const res = await fetch(
            `${API_URL}/simulator/status?source_id=${encodeURIComponent(s.id)}`,
            { cache: "no-store" }
          );
          if (!cancelled && res.ok) {
            const data = await res.json();
            setSimulatorStatuses((prev) => ({ ...prev, [s.id]: data }));
          }
        } catch {
          if (!cancelled) {
            setSimulatorStatuses((prev) => ({ ...prev, [s.id]: { connected: false } }));
          }
        }
      });
    }
    fetchStatuses();
    const id = setInterval(fetchStatuses, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sources]);

  const vehicles = sources.filter((s) => s.source_type === "vehicle");
  const simulators = sources.filter((s) => s.source_type === "simulator");

  function openWizard() {
    setWizardStep(1);
    setWizardType("simulator");
    setWizardName("");
    setWizardBaseUrl("");
    setWizardError(null);
    setWizardOpen(true);
  }

  function handleWizardNext() {
    if (wizardStep === 1) {
      setWizardStep(2);
    }
  }

  async function handleWizardSubmit() {
    if (wizardType !== "simulator" || !wizardName.trim() || !wizardBaseUrl.trim()) {
      setWizardError("Name and Base URL are required");
      return;
    }
    setWizardSubmitting(true);
    setWizardError(null);
    try {
      const res = await fetch(`${API_URL}/telemetry/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_type: "simulator",
          name: wizardName.trim(),
          base_url: wizardBaseUrl.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || res.statusText);
      }
      await fetchSources();
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
  }

  async function handleEditSubmit() {
    if (!editingSourceId) return;
    try {
      const res = await fetch(`${API_URL}/telemetry/sources/${encodeURIComponent(editingSourceId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          base_url: editBaseUrl.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      await fetchSources();
      setEditingSourceId(null);
    } catch {
      // TODO: show error
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen p-4 sm:p-6 lg:p-8 flex items-center justify-center">
        <Spinner size="lg" className="h-10 w-10" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8">
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
                {vehicles.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <div>
                      <span className="font-medium">{s.name}</span>
                      {s.description && (
                        <span className="ml-2 text-sm text-muted-foreground">
                          {s.description}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
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
                          <Badge variant={connected ? "success" : "destructive"} className="text-xs">
                            {connected ? "Connected" : "Disconnected"}
                          </Badge>
                          {connected && status?.state && (
                            <span className="text-xs text-muted-foreground capitalize">
                              {status.state}
                            </span>
                          )}
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
                                onClick={() => setEditingSourceId(null)}
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
                          {s.base_url || "—"}
                        </p>
                      ) : (
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
                      )}
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
              {wizardStep === 1 ? "Add source" : "Add simulator"}
            </DialogTitle>
            <DialogDescription>
              {wizardStep === 1
                ? "Choose the type of source you want to add. Vehicles connect to physical or external telemetry streams; simulators run synthetic data for testing."
                : "Enter the simulator connection details. The base URL is used by the server to reach the simulator."}
            </DialogDescription>
          </DialogHeader>
          {wizardStep === 1 ? (
            <div className="grid gap-3 py-4">
              <button
                type="button"
                disabled
                className="flex items-start gap-4 rounded-lg border border-input bg-muted/30 p-4 text-left opacity-60 cursor-not-allowed"
              >
                <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <SatelliteIcon className="size-6 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Vehicle</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Connect to a physical spacecraft or external telemetry stream. Coming soon.
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
                    Add an in-app or remote simulator instance to generate synthetic telemetry for testing and demos.
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
