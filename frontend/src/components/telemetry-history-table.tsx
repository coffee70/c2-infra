"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { CheckIcon, CopyIcon, FlagIcon, FlagOffIcon } from "lucide-react";
import {
  useTelemetryScopedRecentQuery,
  type HistoryPoint,
} from "@/lib/query-hooks";
import { telemetryScopeSummary, type TelemetryDetailScope } from "@/lib/telemetry-detail-scope";

interface TelemetryHistoryTableProps {
  channelName: string;
  /** Source (banner source id); streams dropdown is scoped to this source. */
  sourceId: string;
  scope: TelemetryDetailScope;
  units?: string | null;
  /** When true, table body uses a fixed viewport height to align with the trend chart pane. */
  compactHeight?: boolean;
}

interface DownloadMeta {
  requestedSince?: string | null;
  requestedUntil?: string | null;
  effectiveSince?: string | null;
  effectiveUntil?: string | null;
  appliedTimeFilter?: boolean;
  fallbackToRecent?: boolean;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    timeZone: "UTC",
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
  includeStream: boolean,
): string {
  const header = `channel_name,source_id${includeStream ? ",stream_id" : ""},timestamp_utc,value\n`;
  const lines = rows.map((r) =>
    [
      JSON.stringify(channelName),
      JSON.stringify(sourceId),
      ...(includeStream ? [JSON.stringify(r.stream_id ?? "")] : []),
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
  scope,
  units,
  compactHeight = false,
}: TelemetryHistoryTableProps) {
  const [valueFilter, setValueFilter] = useState("");
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const limit = scope.mode === "latest" ? "500" : "2000";
  const historyQuery = useTelemetryScopedRecentQuery(
    channelName,
    sourceId,
    scope,
    limit,
  );
  const rows = useMemo(() => historyQuery.data?.data ?? [], [historyQuery.data]);
  const loading = historyQuery.isLoading || historyQuery.isFetching;
  const error = historyQuery.isError ? historyQuery.error.message : null;

  const downloadMeta = useMemo<DownloadMeta>(
    () =>
      historyQuery.data
        ? {
            requestedSince: historyQuery.data.requested_since ?? null,
            requestedUntil: historyQuery.data.requested_until ?? null,
            effectiveSince: historyQuery.data.effective_since ?? null,
            effectiveUntil: historyQuery.data.effective_until ?? null,
            appliedTimeFilter: Boolean(historyQuery.data.applied_time_filter),
            fallbackToRecent: Boolean(historyQuery.data.fallback_to_recent),
        }
        : {},
    [historyQuery.data]
  );

  /** Parse ">10", "< 0", ">=5", "<=", "42" etc. and filter rows by numeric comparison or substring. */
  const filteredRows = useMemo(() => {
    let next = rows;
    const raw = valueFilter.trim();
    if (!raw) return next;

    const opMatch = raw.match(/^\s*(>=|<=|>|<|==?)\s*(-?\d*\.?\d+)\s*$/);
    if (opMatch) {
      const op = opMatch[1];
      const num = Number(opMatch[2]);
      if (Number.isFinite(num)) {
        next = next.filter((r) => {
          const v = Number(r.value);
          if (!Number.isFinite(v)) return false;
          switch (op) {
            case ">":
              return v > num;
            case "<":
              return v < num;
            case ">=":
              return v >= num;
            case "<=":
              return v <= num;
            case "=":
            case "==":
              return v === num;
            default:
              return false;
          }
        });
        return next;
      }
    }

    const q = raw.toLowerCase();
    next = next.filter((r) => String(r.value).toLowerCase().includes(q));
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
    const csv = buildCsv(filteredRows, channelName, sourceId, showStreamColumn);
    const { requestedSince, requestedUntil, effectiveSince, effectiveUntil } = downloadMeta;
    const safeChannel = channelName.replace(/[^a-zA-Z0-9_-]+/g, "_");
    const safeSource = sourceId.replace(/[^a-zA-Z0-9_-]+/g, "_");
    const sinceIso = requestedSince ?? effectiveSince ?? undefined;
    const untilIso = requestedUntil ?? effectiveUntil ?? undefined;
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
      scope,
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

  const total = rows.length;
  const visible = filteredRows.length;
  const fallbackToRecent = downloadMeta.fallbackToRecent ?? false;
  const streamCount = new Set(rows.map((row) => row.stream_id).filter(Boolean)).size;
  const showStreamColumn = !compactHeight && (streamCount > 1 || scope.mode === "streams");

  const handleCopyRow = async (point: HistoryPoint) => {
    const line = `channel=${channelName} source=${sourceId}${point.stream_id ? ` stream=${point.stream_id}` : ""} timestamp=${point.timestamp} value=${point.value}`;
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
            <CardTitle className="text-muted-foreground text-sm font-medium">
              History
            </CardTitle>
            <p className="text-muted-foreground mt-1 text-xs">
              Logged samples for this telemetry channel from the archive.
            </p>
          </div>
          <p className="text-muted-foreground text-xs">Timestamps shown in UTC.</p>
        </div>
        <p className="text-muted-foreground mt-3 text-xs">
          {telemetryScopeSummary(scope)}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="history-value-filter" className="text-muted-foreground text-[11px]">
              Filter by value
            </Label>
            <Input
              id="history-value-filter"
              placeholder="e.g. &lt;0, &gt;10, 42"
              value={valueFilter}
              onChange={(e) => setValueFilter(e.target.value)}
              className="h-8 w-full max-w-[180px] text-xs"
            />
          </div>
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
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading && !rows.length ? (
          <div className="text-muted-foreground flex h-[200px] items-center justify-center gap-2">
            <Spinner size="default" />
            <span className="text-sm">Loading history…</span>
          </div>
        ) : error ? (
          <div className="text-destructive text-sm">{error}</div>
        ) : !rows.length ? (
          <p className="text-muted-foreground text-sm">
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
              <div className="text-muted-foreground mb-2 text-xs">
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
            <div
              className={
                compactHeight
                  ? "max-h-[min(520px,calc(100vh-14rem))] min-h-[200px] overflow-auto rounded-md border"
                  : "max-h-[320px] overflow-auto rounded-md border"
              }
            >
              <table className="min-w-full text-left text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>
	                    <th className="px-3 py-2 font-medium">
	                      Timestamp (UTC)
	                    </th>
                      {showStreamColumn && (
                        <th className="px-3 py-2 font-medium">Stream</th>
                      )}
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
                          className={`border-border/60 border-t ${
                            isFlagged ? "bg-muted/40" : ""
                          }`}
                        >
	                          <td className="px-3 py-1.5 align-middle">
	                            {formatTimestamp(r.timestamp)}
	                          </td>
                            {showStreamColumn && (
                              <td className="max-w-48 truncate px-3 py-1.5 align-middle" title={r.stream_id ?? ""}>
                                {r.stream_id ?? "Unknown"}
                              </td>
                            )}
	                          <td className="px-3 py-1.5 align-middle">
                            {r.value}
                          </td>
                          <td className="px-3 py-1.5 text-right align-middle">
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
