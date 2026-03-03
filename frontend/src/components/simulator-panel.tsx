"use client";

import { useState, useEffect, useCallback } from "react";
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

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const SCENARIOS = [
  { value: "nominal", label: "Nominal" },
  { value: "power_sag", label: "Power Sag" },
  { value: "thermal_runaway", label: "Thermal Runaway" },
  { value: "comm_dropout", label: "Comm Dropout" },
  { value: "safe_mode", label: "Safe Mode" },
] as const;

interface SimulatorStatus {
  state: "idle" | "running" | "paused";
  config: {
    scenario: string;
    duration: number;
    speed: number;
    drop_prob: number;
    jitter: number;
    source_id: string;
    base_url: string;
  } | null;
  sim_elapsed: number;
}

export function SimulatorPanel() {
  const [status, setStatus] = useState<SimulatorStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [scenario, setScenario] = useState("nominal");
  const [duration, setDuration] = useState(300);
  const [runForever, setRunForever] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [dropProb, setDropProb] = useState(0);
  const [jitter, setJitter] = useState(0.1);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/simulator/status`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch (e) {
      setError("Simulator unavailable");
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 2000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  async function handleStart() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/simulator/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario,
          duration: runForever ? 0 : duration,
          speed,
          drop_prob: dropProb,
          jitter,
          source_id: "simulator",
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start");
    } finally {
      setLoading(false);
    }
  }

  async function handlePause() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/simulator/pause`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to pause");
    } finally {
      setLoading(false);
    }
  }

  async function handleResume() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/simulator/resume`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to resume");
    } finally {
      setLoading(false);
    }
  }

  async function handleStop() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/simulator/stop`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to stop");
    } finally {
      setLoading(false);
    }
  }

  const state = status?.state ?? "idle";
  const canEdit = state === "idle";

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Telemetry Simulator</h1>
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
                  state === "running"
                    ? "text-green-500 dark:text-green-400"
                    : state === "paused"
                    ? "text-amber-500 dark:text-amber-400"
                    : "text-muted-foreground"
                }`}
              >
                {state}
              </span>
            </div>
            {state !== "idle" && status?.sim_elapsed != null && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Elapsed:</span>
                <span className="font-mono">{status.sim_elapsed.toFixed(1)}s</span>
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
              disabled={loading || state !== "idle"}
              variant="default"
            >
              {loading && state === "idle" ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Starting...
                </>
              ) : (
                "Play"
              )}
            </Button>
            <Button
              onClick={handlePause}
              disabled={loading || state !== "running"}
              variant="outline"
            >
              Pause
            </Button>
            <Button
              onClick={handleResume}
              disabled={loading || state !== "paused"}
              variant="outline"
            >
              Resume
            </Button>
            <Button
              onClick={handleStop}
              disabled={loading || state === "idle"}
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
