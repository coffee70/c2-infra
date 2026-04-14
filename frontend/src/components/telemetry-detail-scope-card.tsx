"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CustomTimestampPicker } from "@/components/custom-timestamp-picker";
import { TelemetryStreamSelector } from "@/components/telemetry-stream-selector";
import {
  LATEST_SCOPE,
  telemetryScopeSummary,
  telemetryScopesEqual,
  type TelemetryDetailScope,
} from "@/lib/telemetry-detail-scope";
import { buildTelemetryDetailHref } from "@/lib/telemetry-routes";
import {
  useTelemetryChannelStreamsQuery,
  type TelemetryChannelStreamOption,
} from "@/lib/query-hooks";
import { cn } from "@/lib/utils";

interface TelemetryDetailScopeCardProps {
  sourceId: string;
  channelName: string;
  scope: TelemetryDetailScope;
}

type ScopeMode = TelemetryDetailScope["mode"];
type Preset = "1h" | "6h" | "24h" | "7d" | "custom";

const PRESETS: { id: Preset; label: string; hours?: number }[] = [
  { id: "1h", label: "1 hr", hours: 1 },
  { id: "6h", label: "6 hr", hours: 6 },
  { id: "24h", label: "24 hr", hours: 24 },
  { id: "7d", label: "7 d", hours: 24 * 7 },
  { id: "custom", label: "Custom" },
];

function applyPreset(hours: number): { since: string; until: null } {
  const date = new Date();
  date.setHours(date.getHours() - hours);
  return { since: date.toISOString(), until: null };
}

function initialStreams(scope: TelemetryDetailScope): string[] {
  return scope.mode === "streams" ? scope.streamIds : [];
}

function initialSince(scope: TelemetryDetailScope): string | null {
  return scope.mode === "streams" || scope.mode === "date_range"
    ? scope.since ?? null
    : null;
}

function initialUntil(scope: TelemetryDetailScope): string | null {
  return scope.mode === "streams" || scope.mode === "date_range"
    ? scope.until ?? null
    : null;
}

export function TelemetryDetailScopeCard({
  sourceId,
  channelName,
  scope,
}: TelemetryDetailScopeCardProps) {
  const router = useRouter();
  const [mode, setMode] = useState<ScopeMode>(scope.mode);
  const [selectedStreamIds, setSelectedStreamIds] = useState<string[]>(
    initialStreams(scope),
  );
  const [since, setSince] = useState<string | null>(initialSince(scope));
  const [until, setUntil] = useState<string | null>(initialUntil(scope));
  const [preset, setPreset] = useState<Preset>("custom");
  const streamsQuery = useTelemetryChannelStreamsQuery(channelName, sourceId);
  const streams: TelemetryChannelStreamOption[] = streamsQuery.data ?? [];

  const draftScope = useMemo<TelemetryDetailScope>(() => {
    if (mode === "latest") return LATEST_SCOPE;
    if (mode === "streams") {
      return {
        mode: "streams",
        streamIds: selectedStreamIds,
        since,
        until,
      };
    }
    return {
      mode: "date_range",
      since,
      until,
    };
  }, [mode, selectedStreamIds, since, until]);

  const canApply =
    mode === "latest" ||
    (mode === "streams" && selectedStreamIds.length > 0) ||
    (mode === "date_range" && Boolean(since || until));
  const dirty = !telemetryScopesEqual(scope, draftScope);

  const navigate = (nextScope: TelemetryDetailScope) => {
    const href = buildTelemetryDetailHref(sourceId, channelName, nextScope, "analysis");
    router.replace(href);
  };

  const reset = () => {
    setMode("latest");
    setSelectedStreamIds([]);
    setSince(null);
    setUntil(null);
    setPreset("custom");
    navigate(LATEST_SCOPE);
  };

  const selectPreset = (nextPreset: Preset) => {
    setPreset(nextPreset);
    const presetConfig = PRESETS.find((item) => item.id === nextPreset);
    if (presetConfig?.hours) {
      const next = applyPreset(presetConfig.hours);
      setSince(next.since);
      setUntil(next.until);
    }
  };

  return (
    <Card className="border-muted">
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>Data scope</CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">
              Choose which data this page is using for summary, trends, history,
              explanation, and events.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={reset}>
            Reset to latest
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="bg-muted inline-flex rounded-md p-1">
          {[
            ["latest", "Latest"],
            ["streams", "Streams"],
            ["date_range", "Date range"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={cn(
                "rounded-sm px-3 py-1.5 text-sm font-medium",
                mode === id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setMode(id as ScopeMode)}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "latest" && (
          <div className="text-muted-foreground space-y-1 text-sm">
            <p>Using the newest available stream for this channel.</p>
            <p>This mode supports live updates.</p>
          </div>
        )}

        {mode === "streams" && (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">
              A stream is a captured telemetry segment for this channel. Select
              one or more streams.
            </p>
            <TelemetryStreamSelector
              streams={streams}
              selectedStreamIds={selectedStreamIds}
              onChange={setSelectedStreamIds}
              loading={streamsQuery.isLoading}
            />
            <DateControls
              since={since}
              until={until}
              setSince={setSince}
              setUntil={setUntil}
              preset={preset}
              selectPreset={selectPreset}
              optional
            />
          </div>
        )}

        {mode === "date_range" && (
          <DateControls
            since={since}
            until={until}
            setSince={setSince}
            setUntil={setUntil}
            preset={preset}
            selectPreset={selectPreset}
          />
        )}

        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground text-sm">
            {telemetryScopeSummary(scope)}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => navigate(draftScope)}
              disabled={!canApply || !dirty}
            >
              Apply
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DateControls({
  since,
  until,
  setSince,
  setUntil,
  preset,
  selectPreset,
  optional = false,
}: {
  since: string | null;
  until: string | null;
  setSince: (value: string | null) => void;
  setUntil: (value: string | null) => void;
  preset: Preset;
  selectPreset: (preset: Preset) => void;
  optional?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-muted-foreground text-sm">
          {optional
            ? "Optionally limit selected streams by time."
            : "Select an open-ended or bounded time range."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="sm"
            variant={preset === item.id ? "default" : "outline"}
            onClick={() => selectPreset(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <CustomTimestampPicker
          value={since}
          onChange={(value) => {
            setSince(value);
            selectPreset("custom");
          }}
          placeholder="Start time"
          id="scope-since"
          aria-label="Scope start time"
          className="justify-start text-left font-normal"
        />
        <CustomTimestampPicker
          value={until}
          onChange={(value) => {
            setUntil(value);
            selectPreset("custom");
          }}
          placeholder="End time"
          id="scope-until"
          aria-label="Scope end time"
          className="justify-start text-left font-normal"
        />
      </div>
    </div>
  );
}
