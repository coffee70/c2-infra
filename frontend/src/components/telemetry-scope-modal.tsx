"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CustomTimestampPicker } from "@/components/custom-timestamp-picker";
import { TelemetryStreamSelector } from "@/components/telemetry-stream-selector";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  LATEST_SCOPE,
  telemetryScopesEqual,
  type TelemetryDetailScope,
} from "@/lib/telemetry-detail-scope";
import { buildTelemetryDetailHref, type TelemetryDetailView } from "@/lib/telemetry-routes";
import {
  useTelemetryChannelStreamsQuery,
  type TelemetryChannelStreamOption,
} from "@/lib/query-hooks";
import { cn } from "@/lib/utils";

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
      <p className="text-muted-foreground text-sm">
        {optional
          ? "Optionally limit selected streams by time (UTC)."
          : "Select an open-ended or bounded time range (UTC)."}
      </p>
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
          placeholder="Start time (UTC)"
          id="modal-scope-since"
          aria-label="Scope start time"
          className="justify-start text-left font-normal"
        />
        <CustomTimestampPicker
          value={until}
          onChange={(value) => {
            setUntil(value);
            selectPreset("custom");
          }}
          placeholder="End time (UTC)"
          id="modal-scope-until"
          aria-label="Scope end time"
          className="justify-start text-left font-normal"
        />
      </div>
    </div>
  );
}

interface TelemetryScopeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceId: string;
  channelName: string;
  scope: TelemetryDetailScope;
  currentView: TelemetryDetailView;
}

export function TelemetryScopeModal({
  open,
  onOpenChange,
  sourceId,
  channelName,
  scope,
  currentView,
}: TelemetryScopeModalProps) {
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

  useEffect(() => {
    if (!open) return;
    setMode(scope.mode);
    setSelectedStreamIds(initialStreams(scope));
    setSince(initialSince(scope));
    setUntil(initialUntil(scope));
    setPreset("custom");
  }, [open, scope]);

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
    router.replace(
      buildTelemetryDetailHref(sourceId, channelName, nextScope, currentView),
    );
    onOpenChange(false);
  };

  const resetDraftToLatest = () => {
    setMode("latest");
    setSelectedStreamIds([]);
    setSince(null);
    setUntil(null);
    setPreset("custom");
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!flex max-h-[90vh] max-w-lg flex-col gap-4 overflow-hidden p-6 sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>Edit data scope</DialogTitle>
          <p className="text-muted-foreground text-sm font-normal">
            Changes apply only after you click Apply. Cancel discards edits.
          </p>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto py-2 pr-1">
          <div>
            <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
              Mode
            </p>
            <div className="bg-muted inline-flex rounded-md p-1">
              {(
                [
                  ["latest", "Latest"],
                  ["streams", "Streams"],
                  ["date_range", "Date range"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={cn(
                    "rounded-sm px-3 py-1.5 text-sm font-medium",
                    mode === id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setMode(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {mode === "streams" && (
              <p className="text-muted-foreground mt-2 text-xs">
                All samples in the UTC window across the selected captures only — not
                every stream for the vehicle.
              </p>
            )}
            {mode === "date_range" && (
              <p className="text-muted-foreground mt-2 text-xs">
                All samples in the UTC window for this channel, regardless of capture
                segment.
              </p>
            )}
          </div>

          {mode === "latest" && (
            <div className="text-muted-foreground space-y-1 text-sm">
              <p>
                Uses the newest stream that contains this channel for the selected source.
                Live updates are available in this mode.
              </p>
            </div>
          )}

          {mode === "streams" && (
            <div className="space-y-4">
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                Streams
              </p>
              <p className="text-muted-foreground text-sm">
                A stream is a captured telemetry segment for this channel. Select one or
                more streams.
              </p>
              <TelemetryStreamSelector
                streams={streams}
                selectedStreamIds={selectedStreamIds}
                onChange={setSelectedStreamIds}
                loading={streamsQuery.isLoading}
              />
              <div>
                <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
                  Time window
                </p>
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
            </div>
          )}

          {mode === "date_range" && (
            <div>
              <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
                Time window
              </p>
              <DateControls
                since={since}
                until={until}
                setSince={setSince}
                setUntil={setUntil}
                preset={preset}
                selectPreset={selectPreset}
              />
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 flex-col gap-2 border-t border-border pt-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="outline" onClick={resetDraftToLatest}>
            Reset draft to latest
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => navigate(draftScope)}
              disabled={!canApply || !dirty}
            >
              Apply
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
