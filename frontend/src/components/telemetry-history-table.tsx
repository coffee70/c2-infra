"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, CheckIcon, CopyIcon, FlagIcon, FlagOffIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type TimePreset = 15 | 60 | 360 | 1440;

const RANGE_PRESETS: { label: string; minutes: TimePreset }[] = [
  { label: "15 min", minutes: 15 },
  { label: "1 hr", minutes: 60 },
  { label: "6 hr", minutes: 360 },
  { label: "24 hr", minutes: 1440 },
];

interface HistoryPoint {
  timestamp: string;
  value: number;
}

interface TelemetryHistoryTableProps {
  channelName: string;
  sourceId: string;
  units?: string | null;
}

interface DownloadMeta {
  sinceIso?: string;
  untilIso?: string;
  requestedSince?: string | null;
  requestedUntil?: string | null;
  effectiveSince?: string | null;
  effectiveUntil?: string | null;
  appliedTimeFilter?: boolean;
  fallbackToRecent?: boolean;
}

function toIsoMinutesAgo(minutes: number): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - minutes);
  return d.toISOString();
}

function formatTimestamp(iso: string, useUTC: boolean): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    timeZone: useUTC ? "UTC" : undefined,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function buildCsv(
  rows: HistoryPoint[],
  channelName: string,
  sourceId: string,
): string {
  const header = "channel_name,source_id,timestamp_utc,value\n";
  const lines = rows.map((r) =>
    [
      JSON.stringify(channelName),
      JSON.stringify(sourceId),
      JSON.stringify(r.timestamp),
      r.value,
    ].join(","),
  );
  return header + lines.join("\n");
}

function triggerDownload(filename: string, mime: string, data: BlobPart) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function TelemetryHistoryTable({
  channelName,
  sourceId,
  units,
}: TelemetryHistoryTableProps) {
  const [rangeMinutes, setRangeMinutes] = useState<TimePreset>(60);
  const [customSince, setCustomSince] = useState<string | null>(null);
  const [useCustom, setUseCustom] = useState(false);
  const [useUTC, setUseUTC] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<HistoryPoint[]>([]);
  const [valueFilter, setValueFilter] = useState("");
  const [downloadMeta, setDownloadMeta] = useState<DownloadMeta>({});
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const sinceIso =
          useCustom && customSince ? customSince : toIsoMinutesAgo(rangeMinutes);

        let limit: number;
        if (useCustom && customSince) {
          const now = new Date();
          const sinceDate = new Date(customSince);
          const minutesBack = Math.max(
            0,
            Math.round((now.getTime() - sinceDate.getTime()) / 60000),
          );
          if (minutesBack <= 60) {
            limit = 500;
          } else if (minutesBack <= 1440) {
            limit = 1000;
          } else {
            // Longer custom ranges (e.g., multiple days) get a higher cap.
            limit = 2000;
          }
        } else {
          limit = rangeMinutes <= 60 ? 500 : 1000;
        }

        const url = new URL(
          `${API_URL}/telemetry/${encodeURIComponent(channelName)}/recent`,
        );
        url.searchParams.set("limit", String(limit));
        url.searchParams.set("since", sinceIso);
        url.searchParams.set("source_id", sourceId);

        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`Failed to load history (${res.status})`);
        }
        const json = await res.json();
        const data = Array.isArray(json.data) ? (json.data as HistoryPoint[]) : [];

        if (!isCancelled) {
          setRows(data);
          setDownloadMeta({
            sinceIso,
            untilIso: undefined,
            requestedSince: json.requested_since ?? null,
            requestedUntil: json.requested_until ?? null,
            effectiveSince: json.effective_since ?? null,
            effectiveUntil: json.effective_until ?? null,
            appliedTimeFilter: Boolean(json.applied_time_filter),
            fallbackToRecent: Boolean(json.fallback_to_recent),
          });
        }
      } catch (e) {
        if (!isCancelled) {
          setError(
            e instanceof Error ? e.message : "Failed to load history",
          );
          setRows([]);
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      isCancelled = true;
    };
  }, [channelName, sourceId, rangeMinutes, useCustom, customSince]);

  const filteredRows = useMemo(() => {
    let next = rows;
    if (valueFilter.trim()) {
      const q = valueFilter.trim().toLowerCase();
      next = next.filter((r) =>
        String(r.value).toLowerCase().includes(q),
      );
    }
    return next;
  }, [rows, valueFilter]);

  const handleCopyAll = async () => {
    const header = "timestamp_utc\tvalue\n";
    const body = filteredRows
      .map((r) => `${r.timestamp}\t${r.value}`)
      .join("\n");
    await navigator.clipboard.writeText(header + body);
  };

  const handleExportCsv = () => {
    if (!filteredRows.length) return;
    const csv = buildCsv(filteredRows, channelName, sourceId);
    const { sinceIso, untilIso } = downloadMeta;
    const safeChannel = channelName.replace(/[^a-zA-Z0-9_-]+/g, "_");
    const safeSource = sourceId.replace(/[^a-zA-Z0-9_-]+/g, "_");
    const suffix =
      sinceIso && untilIso
        ? `${sinceIso}_${untilIso}`
        : sinceIso
          ? `${sinceIso}`
          : "history";
    const filename = `${safeChannel}_${safeSource}_${suffix}.csv`;
    triggerDownload(filename, "text/csv;charset=utf-8", csv);
  };

  const handleExportJson = () => {
    if (!filteredRows.length) return;
    const payload = {
      channel_name: channelName,
      source_id: sourceId,
      points: filteredRows,
    };
    const safeChannel = channelName.replace(/[^a-zA-Z0-9_-]+/g, "_");
    const safeSource = sourceId.replace(/[^a-zA-Z0-9_-]+/g, "_");
    const filename = `${safeChannel}_${safeSource}_history.json`;
    triggerDownload(
      filename,
      "application/json;charset=utf-8",
      JSON.stringify(payload, null, 2),
    );
  };

  const handleExportParquet = () => {
    const safeChannel = channelName.replace(/[^a-zA-Z0-9_-]+/g, "_");
    const safeSource = sourceId.replace(/[^a-zA-Z0-9_-]+/g, "_");
    const filename = `${safeChannel}_${safeSource}_history.parquet.txt`;
    const note =
      "# Parquet export\n" +
      "# To generate a real Parquet file, load the JSON or CSV into your data tooling (e.g. pandas, pyarrow) and write to Parquet.\n";
    triggerDownload(
      filename,
      "text/plain;charset=utf-8",
      note,
    );
  };

  const total = rows.length;
  const visible = filteredRows.length;
  const appliedTimeFilter = downloadMeta.appliedTimeFilter ?? false;
  const fallbackToRecent = downloadMeta.fallbackToRecent ?? false;

  const handleCopyRow = async (point: HistoryPoint) => {
    const line = `channel=${channelName} source=${sourceId} timestamp=${point.timestamp} value=${point.value}`;
    await navigator.clipboard.writeText(line);
    setCopiedKey(point.timestamp);
    setTimeout(() => {
      setCopiedKey((current) => (current === point.timestamp ? null : current));
    }, 1500);
  };

  const toggleFlag = (point: HistoryPoint) => {
    setFlagged((prev) => {
      const next = new Set(prev);
      if (next.has(point.timestamp)) {
        next.delete(point.timestamp);
      } else {
        next.add(point.timestamp);
      }
      return next;
    });
  };

  return (
    <Card className="border-muted">
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              History
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Logged samples for this telemetry channel from the archive.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant={useUTC ? "default" : "outline"}
                onClick={() => setUseUTC(true)}
              >
                UTC
              </Button>
              <Button
                size="sm"
                variant={!useUTC ? "default" : "outline"}
                onClick={() => setUseUTC(false)}
              >
                Local
              </Button>
            </div>
            <Select
              value={useCustom ? "custom" : String(rangeMinutes)}
              onValueChange={(v) => {
                if (v === "custom") {
                  setUseCustom(true);
                  const iso = toIsoMinutesAgo(60);
                  setCustomSince(iso);
                } else {
                  setUseCustom(false);
                  setRangeMinutes(Number(v) as TimePreset);
                }
              }}
            >
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue placeholder="Range" />
              </SelectTrigger>
              <SelectContent>
                {RANGE_PRESETS.map((p) => (
                  <SelectItem key={p.minutes} value={String(p.minutes)}>
                    {p.label}
                  </SelectItem>
                ))}
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
            {useCustom && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                      "h-8 w-48 justify-start text-left font-normal text-xs",
                      !customSince && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                    {customSince
                      ? new Date(customSince).toLocaleString(undefined, {
                          timeZone: "UTC",
                          year: "numeric",
                          month: "short",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Custom start time"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="flex flex-col gap-3 p-3" align="start">
                  <Calendar
                    selected={customSince ? new Date(customSince) : undefined}
                    onSelect={(date) => {
                      if (!date) {
                        setCustomSince(null);
                        return;
                      }
                      const iso = new Date(date.getTime()).toISOString().slice(0, 10);
                      const existing = customSince
                        ? new Date(customSince)
                        : new Date();
                      const combined = new Date(
                        `${iso}T${existing.toISOString().slice(11, 19)}Z`,
                      );
                      setCustomSince(combined.toISOString());
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <Label htmlFor="history-custom-time" className="text-[11px] text-muted-foreground">
                      Time (UTC)
                    </Label>
                    <Input
                      id="history-custom-time"
                      type="time"
                      className="h-8 w-28 text-xs"
                      value={
                        customSince
                          ? new Date(customSince).toISOString().slice(11, 16)
                          : ""
                      }
                      onChange={(e) => {
                        const time = e.target.value;
                        if (!time) {
                          setCustomSince(null);
                          return;
                        }
                        const base = customSince ? new Date(customSince) : new Date();
                        const isoDate = base.toISOString().slice(0, 10);
                        const combined = new Date(`${isoDate}T${time}:00Z`);
                        setCustomSince(combined.toISOString());
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 text-[11px]"
                      onClick={() => setCustomSince(null)}
                    >
                      Clear
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="history-value-filter" className="text-[11px] text-muted-foreground">
              Filter by value
            </Label>
            <Input
              id="history-value-filter"
              placeholder="e.g. &gt; 10, 42, 0.5"
              value={valueFilter}
              onChange={(e) => setValueFilter(e.target.value)}
              className="h-8 w-full max-w-[180px] text-xs"
            />
          </div>
          {/* Only one “since” concept now: range presets + optional Custom start time.
              The value filter remains as a simple client-side refinement. */}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!filteredRows.length}
                >
                  Export / Copy
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={!filteredRows.length}
                  onClick={handleCopyAll}
                >
                  Copy table (visible rows)
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!filteredRows.length}
                  onClick={handleExportCsv}
                >
                  Export CSV
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!filteredRows.length}
                  onClick={handleExportJson}
                >
                  Export JSON
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!rows.length}
                  onClick={handleExportParquet}
                >
                  Parquet helper stub
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading && !rows.length ? (
          <div className="flex h-[200px] items-center justify-center gap-2 text-muted-foreground">
            <Spinner size="default" />
            <span className="text-sm">Loading history…</span>
          </div>
        ) : error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : !rows.length ? (
          <p className="text-sm text-muted-foreground">
            No history available in the selected range.
          </p>
        ) : (
          <>
            {fallbackToRecent && (
              <div className="mb-2 rounded-md border border-amber-500/50 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                <p className="font-medium">
                  No archived samples in the selected time window; showing the most
                  recent {total.toLocaleString()} samples instead.
                </p>
                {downloadMeta.requestedSince && (
                  <p className="mt-0.5 text-amber-100/80">
                    Requested since{" "}
                    {new Date(downloadMeta.requestedSince).toLocaleString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    . This often means no downlinks or the feed was offline during that
                    window.
                  </p>
                )}
              </div>
            )}
            {!fallbackToRecent && (downloadMeta.effectiveSince || downloadMeta.effectiveUntil) && (
              <div className="mb-2 text-xs text-muted-foreground">
                Showing{" "}
                <strong className="text-foreground">{visible}</strong> of{" "}
                <strong className="text-foreground">{total}</strong> samples between{" "}
                {downloadMeta.effectiveSince
                  ? new Date(downloadMeta.effectiveSince).toLocaleString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "start"}{" "}
                and{" "}
                {downloadMeta.effectiveUntil
                  ? new Date(downloadMeta.effectiveUntil).toLocaleString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "latest"}
                .
              </div>
            )}
            <div className="max-h-[320px] overflow-auto rounded-md border">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">
                      Timestamp ({useUTC ? "UTC" : "local"})
                    </th>
                    <th className="px-3 py-2 font-medium">
                      Value{units ? ` (${units})` : ""}
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows
                    .slice()
                    .sort(
                      (a, b) =>
                        new Date(b.timestamp).getTime() -
                        new Date(a.timestamp).getTime(),
                    )
                    .map((r) => {
                      const isFlagged = flagged.has(r.timestamp);
                      return (
                        <tr
                          key={r.timestamp}
                          className={`border-t border-border/60 ${
                            isFlagged ? "bg-muted/40" : ""
                          }`}
                        >
                          <td className="px-3 py-1.5 align-middle">
                            {formatTimestamp(r.timestamp, useUTC)}
                          </td>
                          <td className="px-3 py-1.5 align-middle">
                            {r.value}
                          </td>
                          <td className="px-3 py-1.5 align-middle text-right">
                            <div className="inline-flex items-center gap-1">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    aria-label="Copy sample details"
                                    onClick={() => handleCopyRow(r)}
                                  >
                                    {copiedKey === r.timestamp ? (
                                      <CheckIcon className="h-3.5 w-3.5" />
                                    ) : (
                                      <CopyIcon className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Copy sample details</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant={isFlagged ? "default" : "ghost"}
                                    className="h-7 w-7"
                                    aria-label={
                                      isFlagged
                                        ? "Unflag sample"
                                        : "Flag sample for review"
                                    }
                                    onClick={() => toggleFlag(r)}
                                  >
                                    {isFlagged ? (
                                      <FlagOffIcon className="h-3.5 w-3.5" />
                                    ) : (
                                      <FlagIcon className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {isFlagged ? "Unflag sample" : "Flag sample for review"}
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

