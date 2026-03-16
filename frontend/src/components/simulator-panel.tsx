"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { auditLog } from "@/lib/audit-log";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SimulatorStatusBadge } from "@/components/simulator-status-badge";
import {
  useSimulatorPauseMutation,
  useSimulatorResumeMutation,
  useSimulatorStartMutation,
  useSimulatorStatusQuery,
  useSimulatorStopMutation,
} from "@/lib/query-hooks";

function formatScenarioLabel(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

interface SimulatorStatus {
  connected: boolean;
  supported_scenarios?: {
    name: string;
    description: string;
  }[];
  state?: "idle" | "running" | "paused";
  config?: {
    scenario: string;
    duration: number;
    speed: number;
    drop_prob: number;
    jitter: number;
    source_id: string;
    base_url: string;
  } | null;
  sim_elapsed?: number;
}

interface SimulatorPanelProps {
  sourceId: string;
  onClose?: () => void;
}

export function SimulatorPanel({ sourceId, onClose }: SimulatorPanelProps) {
  const [error, setError] = useState<string | null>(null);

  const [scenario, setScenario] = useState("nominal");
  const [duration, setDuration] = useState(300);
  const [runForever, setRunForever] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [dropProb, setDropProb] = useState(0);
  const [jitter, setJitter] = useState(0.1);
  const lastLoggedStateRef = useRef<string | null>(null);
  const lastSimElapsedRef = useRef<number>(0);
  const lastFetchTimeRef = useRef<number>(0);
  const [displayElapsed, setDisplayElapsed] = useState<number | null>(null);
  const statusQuery = useSimulatorStatusQuery(sourceId, {
    refetchInterval: 2000,
  });
  const startMutation = useSimulatorStartMutation();
  const pauseMutation = useSimulatorPauseMutation();
  const resumeMutation = useSimulatorResumeMutation();
  const stopMutation = useSimulatorStopMutation();
  const status = useMemo(
    () => ((statusQuery.data as SimulatorStatus | undefined) ?? { connected: false }),
    [statusQuery.data]
  );
  const supportedScenarios = useMemo(
    () => (status.supported_scenarios ?? []).map((entry) => ({
      value: entry.name,
      label: formatScenarioLabel(entry.name),
      description: entry.description,
    })),
    [status.supported_scenarios]
  );
  const effectiveScenario = useMemo(() => {
    if (supportedScenarios.some((entry) => entry.value === scenario)) {
      return scenario;
    }
    return supportedScenarios[0]?.value ?? scenario;
  }, [scenario, supportedScenarios]);
  const selectedScenario = supportedScenarios.find((entry) => entry.value === effectiveScenario) ?? null;
  const loading =
    startMutation.isPending
    || pauseMutation.isPending
    || resumeMutation.isPending
    || stopMutation.isPending;
  const combinedError = error ?? (statusQuery.isError ? "Simulator unavailable" : null);

  useEffect(() => {
    if (status.connected && status.sim_elapsed != null) {
      lastSimElapsedRef.current = status.sim_elapsed;
      lastFetchTimeRef.current = Date.now();
    }
    if (status.connected && status.state && lastLoggedStateRef.current !== status.state) {
      lastLoggedStateRef.current = status.state;
      auditLog("simulator.status.fetched", {
        state: status.state,
        sim_elapsed: status.sim_elapsed,
      });
    }
  }, [status]);

  useEffect(() => {
    if (!status?.connected || status.state !== "running" || status.sim_elapsed == null) {
      return;
    }
    const speed = status.config?.speed ?? 1;
    const tick = () => {
      const elapsed =
        lastSimElapsedRef.current +
        ((Date.now() - lastFetchTimeRef.current) / 1000) * speed;
      setDisplayElapsed(elapsed);
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [status?.connected, status?.state, status?.sim_elapsed, status?.config?.speed]);

  async function handleStart() {
    setError(null);
    auditLog("simulator.start.sent", {
      scenario: effectiveScenario,
      duration: runForever ? 0 : duration,
      speed,
      drop_prob: dropProb,
      jitter,
    });
    try {
      const data = await startMutation.mutateAsync({
        sourceId,
        scenario: effectiveScenario,
        duration: runForever ? 0 : duration,
        speed,
        drop_prob: dropProb,
        jitter,
      }) as { source_id?: string; run_label?: string; status?: string };
      const resolvedSourceId = data?.source_id;
      auditLog("simulator.start", {
        scenario: effectiveScenario,
        duration: runForever ? 0 : duration,
        speed,
        drop_prob: dropProb,
        jitter,
        resolvedSourceId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start";
      auditLog("simulator.start", { error: msg });
      setError(msg.includes("abort") ? "Request timed out — simulator may be unavailable" : msg);
    }
  }

  async function handlePause() {
    setError(null);
    try {
      await pauseMutation.mutateAsync({ sourceId });
    } catch (e) {
      auditLog("simulator.pause", { error: e instanceof Error ? e.message : "Failed to pause" });
      setError(e instanceof Error ? e.message : "Failed to pause");
    }
  }

  async function handleResume() {
    setError(null);
    try {
      await resumeMutation.mutateAsync({ sourceId });
    } catch (e) {
      auditLog("simulator.resume", { error: e instanceof Error ? e.message : "Failed to resume" });
      setError(e instanceof Error ? e.message : "Failed to resume");
    }
  }

  async function handleStop() {
    setError(null);
    try {
      await stopMutation.mutateAsync({ sourceId });
    } catch (e) {
      auditLog("simulator.stop", { error: e instanceof Error ? e.message : "Failed to stop" });
      setError(e instanceof Error ? e.message : "Failed to stop");
    }
  }

  const connected = status?.connected === true;
  const state = status?.state ?? (connected ? "idle" : "unknown");
  const canEdit = connected && (state === "idle" || state === "unknown");
  const elapsedDisplay =
    state === "running"
      ? (displayElapsed ?? status?.sim_elapsed ?? 0)
      : status?.sim_elapsed;

  const isEmbedded = onClose != null;

  return (
    <div className={isEmbedded ? "space-y-6 border rounded-lg p-6 bg-card" : "space-y-6"}>
      <div className={isEmbedded ? "space-y-6" : "space-y-8"}>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold tracking-tight">Telemetry Simulator</h2>
          <div className="flex items-center gap-2">
            <SimulatorStatusBadge
              connected={connected}
              state={status?.state}
            />
            {onClose && (
              <Button variant="outline" size="sm" onClick={onClose}>
                Close
              </Button>
            )}
          </div>
        </div>

        {combinedError && (
          <Alert variant="destructive">
            <AlertDescription>{combinedError}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">State:</span>
              <SimulatorStatusBadge
                connected={connected}
                state={status?.state}
              />
            </div>
            {connected && state !== "idle" && elapsedDisplay != null && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Elapsed:</span>
                <span className="font-mono">{elapsedDisplay.toFixed(1)}s</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="scenario">Scenario</Label>
              <Select
                value={effectiveScenario}
                onValueChange={setScenario}
                disabled={!canEdit || supportedScenarios.length === 0}
              >
                <SelectTrigger id="scenario">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {supportedScenarios.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedScenario ? (
                <p className="text-sm text-muted-foreground">{selectedScenario.description}</p>
              ) : null}
            </div>
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="run-forever"
                  checked={runForever}
                  onCheckedChange={(c) => setRunForever(!!c)}
                  disabled={!canEdit}
                />
                <Label htmlFor="run-forever" className="font-normal cursor-pointer">
                  Run forever
                </Label>
              </div>
              {!runForever && (
                <>
                  <Label htmlFor="duration">Duration (seconds)</Label>
                  <Input
                    id="duration"
                    type="number"
                    min={1}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value) || 300)}
                    disabled={!canEdit}
                  />
                </>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="speed">Speed factor</Label>
              <Input
                id="speed"
                type="number"
                min={0.1}
                step={0.1}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value) || 1)}
                disabled={!canEdit}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="drop-prob">Drop probability (0–1)</Label>
              <Input
                id="drop-prob"
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={dropProb}
                onChange={(e) => setDropProb(Number(e.target.value) || 0)}
                disabled={!canEdit}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="jitter">Jitter (0–1)</Label>
              <Input
                id="jitter"
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={jitter}
                onChange={(e) => setJitter(Number(e.target.value) || 0.1)}
                disabled={!canEdit}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Controls</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              onClick={handleStart}
              disabled={!connected || loading || (state !== "idle" && state !== "unknown")}
              variant="default"
            >
              {loading && state === "idle" ? (
                <>
                  <Spinner size="sm" className="mr-2 border-primary-foreground border-t-transparent" />
                  Starting...
                </>
              ) : (
                "Play"
              )}
            </Button>
            <Button
              onClick={handlePause}
              disabled={!connected || loading || state !== "running"}
              variant="outline"
            >
              Pause
            </Button>
            <Button
              onClick={handleResume}
              disabled={!connected || loading || state !== "paused"}
              variant="outline"
            >
              Resume
            </Button>
            <Button
              onClick={handleStop}
              disabled={!connected || loading || state === "idle"}
              variant="outline"
            >
              Stop
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
