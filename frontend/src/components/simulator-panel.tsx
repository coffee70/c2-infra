"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
import { Badge } from "@/components/ui/badge";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const API_FALLBACK_URL = process.env.NEXT_PUBLIC_API_FALLBACK_URL || "";

async function fetchApiWithFallback(
  path: string,
  init: RequestInit
): Promise<{ response: Response; baseUrl: string }> {
  const bases = [API_URL, API_FALLBACK_URL].filter(
    (v, i, arr) => arr.indexOf(v) === i
  );
  let lastError: unknown = null;
  for (const base of bases) {
    try {
      const response = await fetch(`${base}${path}`, {
        ...init,
      });
      if (response.ok) {
        return { response, baseUrl: base };
      }
      lastError = new Error(`HTTP ${response.status} from ${base}${path}`);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error("All API paths failed");
}

const SCENARIOS = [
  { value: "nominal", label: "Nominal" },
  { value: "power_sag", label: "Power Sag" },
  { value: "thermal_runaway", label: "Thermal Runaway" },
  { value: "comm_dropout", label: "Comm Dropout" },
  { value: "safe_mode", label: "Safe Mode" },
] as const;

interface SimulatorStatus {
  connected: boolean;
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
  const [status, setStatus] = useState<SimulatorStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [scenario, setScenario] = useState("nominal");
  const [duration, setDuration] = useState(300);
  const [runForever, setRunForever] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [dropProb, setDropProb] = useState(0);
  const [jitter, setJitter] = useState(0.1);
  const statusInFlightRef = useRef(false);
  const consecutiveStatusFailuresRef = useRef(0);
  const lastLoggedStateRef = useRef<string | null>(null);
  const lastSimElapsedRef = useRef<number>(0);
  const lastFetchTimeRef = useRef<number>(0);
  const [displayElapsed, setDisplayElapsed] = useState<number | null>(null);

  const fetchStatus = useCallback(async () => {
    if (statusInFlightRef.current) {
      return;
    }
    statusInFlightRef.current = true;
    try {
      const { response: res } = await fetchApiWithFallback(
        `/simulator/status?source_id=${encodeURIComponent(sourceId)}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(res.statusText);
      const data: SimulatorStatus = await res.json();
      setStatus(data);
      consecutiveStatusFailuresRef.current = 0;
      setError(null);
      if (data.connected && data.sim_elapsed != null) {
        lastSimElapsedRef.current = data.sim_elapsed;
        lastFetchTimeRef.current = Date.now();
      }
      if (data.connected && data.state && lastLoggedStateRef.current !== data.state) {
        lastLoggedStateRef.current = data.state;
        auditLog("simulator.status.fetched", {
          state: data.state,
          sim_elapsed: data.sim_elapsed,
        });
      }
    } catch (e) {
      consecutiveStatusFailuresRef.current += 1;
      setStatus({ connected: false });
      if (consecutiveStatusFailuresRef.current >= 2) {
        setError("Simulator unavailable");
      }
    } finally {
      statusInFlightRef.current = false;
    }
  }, [sourceId]);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 2000);
    return () => clearInterval(id);
  }, [fetchStatus]);

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
    setLoading(true);
    setError(null);
    auditLog("simulator.start.sent", {
      scenario,
      duration: runForever ? 0 : duration,
      speed,
      drop_prob: dropProb,
      jitter,
    });
    try {
      const { response: res } = await fetchApiWithFallback(
        "/simulator/start",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scenario,
            duration: runForever ? 0 : duration,
            speed,
            drop_prob: dropProb,
            jitter,
            source_id: sourceId,
          }),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      auditLog("simulator.start", {
        scenario,
        duration: runForever ? 0 : duration,
        speed,
        drop_prob: dropProb,
        jitter,
      });
      fetchStatus(); // fire-and-forget; polling will update state
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start";
      auditLog("simulator.start", { error: msg });
      setError(msg.includes("abort") ? "Request timed out — simulator may be unavailable" : msg);
    } finally {
      setLoading(false);
    }
  }

  async function handlePause() {
    setLoading(true);
    setError(null);
    try {
      const { response: res } = await fetchApiWithFallback(
        `/simulator/pause?source_id=${encodeURIComponent(sourceId)}`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(await res.text());
      auditLog("simulator.pause");
      await fetchStatus();
    } catch (e) {
      auditLog("simulator.pause", { error: e instanceof Error ? e.message : "Failed to pause" });
      setError(e instanceof Error ? e.message : "Failed to pause");
    } finally {
      setLoading(false);
    }
  }

  async function handleResume() {
    setLoading(true);
    setError(null);
    try {
      const { response: res } = await fetchApiWithFallback(
        `/simulator/resume?source_id=${encodeURIComponent(sourceId)}`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(await res.text());
      auditLog("simulator.resume");
      await fetchStatus();
    } catch (e) {
      auditLog("simulator.resume", { error: e instanceof Error ? e.message : "Failed to resume" });
      setError(e instanceof Error ? e.message : "Failed to resume");
    } finally {
      setLoading(false);
    }
  }

  async function handleStop() {
    setLoading(true);
    setError(null);
    try {
      const { response: res } = await fetchApiWithFallback(
        `/simulator/stop?source_id=${encodeURIComponent(sourceId)}`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(await res.text());
      auditLog("simulator.stop");
      await fetchStatus();
    } catch (e) {
      auditLog("simulator.stop", { error: e instanceof Error ? e.message : "Failed to stop" });
      setError(e instanceof Error ? e.message : "Failed to stop");
    } finally {
      setLoading(false);
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
            <Badge
              variant={connected ? "success" : "destructive"}
            >
              {connected ? "Connected" : "Disconnected"}
            </Badge>
            {onClose && (
              <Button variant="outline" size="sm" onClick={onClose}>
                Close
              </Button>
            )}
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">State:</span>
              <span
                className={`font-medium capitalize ${
                  !connected
                    ? "text-muted-foreground"
                    : state === "running"
                    ? "text-green-500 dark:text-green-400"
                    : state === "paused"
                    ? "text-amber-500 dark:text-amber-400"
                    : state === "unknown"
                    ? "text-yellow-500 dark:text-yellow-400"
                    : "text-muted-foreground"
                }`}
              >
                {connected ? state : "—"}
              </span>
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
                value={scenario}
                onValueChange={setScenario}
                disabled={!canEdit}
              >
                <SelectTrigger id="scenario">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCENARIOS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
