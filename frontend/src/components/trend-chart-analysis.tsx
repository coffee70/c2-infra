"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RealtimeWsClient } from "@/lib/realtime-ws-client";
import { buildTelemetryApiBase } from "@/lib/telemetry-routes";
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
  ComposedChart,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { CustomTimestampPicker } from "@/components/custom-timestamp-picker";
import { ChevronDownIcon } from "lucide-react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface DataPoint {
  timestamp: string;
  value: number;
  /** When we received this point (from live stream). Used for gap detection. */
  receptionTime?: string;
}

interface Bounds {
  p5?: number | null;
  p50?: number | null;
  p95?: number | null;
  mean?: number | null;
  redLow?: number | null;
  redHigh?: number | null;
  minValue?: number | null;
  maxValue?: number | null;
}

const RANGE_PRESETS = [
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "6h", minutes: 360 },
  { label: "24h", minutes: 1440 },
] as const;

function formatWithUnits(
  value: number | null | undefined,
  units: string | null | undefined
): string {
  if (value == null || !Number.isFinite(value)) return "No data";

  const formatted = value.toFixed(4);
  if (!units?.trim()) return formatted;
  const displayUnit = units === "C" ? "°C" : ` ${units}`;
  return `${formatted}${displayUnit}`;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function medianInterval(points: { timestamp: string }[]): number | null {
  if (points.length < 2) return null;
  const diffs = points
    .slice(1)
    .map(
      (p, i) =>
        new Date(p.timestamp).getTime() -
        new Date(points[i].timestamp).getTime()
    );
  return median(diffs);
}

function formatInterval(ms: number): string {
  if (ms < 1000) return `~${Math.round(ms)}ms`;
  if (ms < 60000) return `~${(ms / 1000).toFixed(1)}s`;
  return `~${(ms / 60000).toFixed(1)} min`;
}

const POINTS_PER_PIXEL = 2;
const MIN_DISPLAY_POINTS = 100;

/** Auto-downsample by target pixel width. Preserves shape with min-max decimation. */
function downsampleByWidth<T extends { timestamp: string; value: number }>(
  data: T[],
  chartWidth: number
): T[] {
  const targetPoints = Math.min(
    data.length,
    Math.max(MIN_DISPLAY_POINTS, Math.floor(chartWidth * POINTS_PER_PIXEL))
  );
  if (data.length <= targetPoints) return data;
  const bucketSize = data.length / targetPoints;
  const result: T[] = [];
  for (let i = 0; i < targetPoints; i++) {
    const startIdx = Math.floor(i * bucketSize);
    const endIdx = Math.min(Math.floor((i + 1) * bucketSize), data.length);
    const bucket = data.slice(startIdx, endIdx);
    if (bucket.length === 1) {
      result.push(bucket[0]);
    } else {
      const minPoint = bucket.reduce((a, b) => (a.value < b.value ? a : b));
      const maxPoint = bucket.reduce((a, b) => (a.value > b.value ? a : b));
      result.push(minPoint);
      if (minPoint.timestamp !== maxPoint.timestamp) result.push(maxPoint);
    }
  }
  return result.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

export function TrendChartAnalysis({
  channelName,
  vehicleId,
  streamId = null,
  units,
  bounds,
  lastTimestamp,
}: {
  channelName: string;
  vehicleId: string;
  streamId?: string | null;
  units?: string | null;
  bounds?: Bounds;
  lastTimestamp?: string | null;
}) {
  const [useUTC, setUseUTC] = useState(true);
  const [showMeanP50, setShowMeanP50] = useState(true);
  const [showP5P95, setShowP5P95] = useState(true);
  const [compareChannel, setCompareChannel] = useState<string | null>(null);
  const [channelList, setChannelList] = useState<string[]>([]);
  const [rangeMinutes, setRangeMinutes] = useState<number>(60);
  const [customStart, setCustomStart] = useState<string | null>(null);
  const [customEnd, setCustomEnd] = useState<string | null>(null);
  const [useCustomRange, setUseCustomRange] = useState(false);
  const [timeRangePct, setTimeRangePct] = useState<[number, number]>([0, 100]);
  const [zoomRefetch, setZoomRefetch] = useState<{ since: string; until: string } | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(800);

  const [data, setData] = useState<DataPoint[]>([]);
  const [compareData, setCompareData] = useState<DataPoint[]>([]);
  const [loadState, setLoadState] = useState<{
    requestKey: string;
    error: string | null;
  }>({ requestKey: "", error: null });
  const [nowTs, setNowTs] = useState(() => Date.now());

  const { sinceDate, untilDate } = useMemo(() => {
    if (zoomRefetch) {
      return {
        sinceDate: zoomRefetch.since,
        untilDate: zoomRefetch.until,
      };
    }
    if (useCustomRange && customStart) {
      const start = new Date(customStart);
      const end = customEnd ? new Date(customEnd) : null;
      return {
        sinceDate: isNaN(start.getTime()) ? null : start.toISOString(),
        untilDate: end && !isNaN(end.getTime()) ? end.toISOString() : null,
      };
    }
    if (useCustomRange && !customStart) {
      const since = new Date();
      since.setMinutes(since.getMinutes() - 60);
      return { sinceDate: since.toISOString(), untilDate: customEnd ?? null };
    }
    const since = new Date();
    since.setMinutes(since.getMinutes() - rangeMinutes);
    return { sinceDate: since.toISOString(), untilDate: null };
  }, [useCustomRange, customStart, customEnd, rangeMinutes, zoomRefetch]);
  const loadRequestKey = `${channelName}:${compareChannel ?? ""}:${sinceDate ?? ""}:${untilDate ?? ""}`;
  const loading = loadState.requestKey !== loadRequestKey;
  const error = loading ? null : loadState.error;

  const fetchLimit = useMemo(() => {
    if (zoomRefetch) return 1000;
    const mins = useCustomRange ? 60 : rangeMinutes;
    if (mins <= 15) return 150;
    if (mins <= 60) return 300;
    if (mins <= 360) return 600;
    return 1000;
  }, [zoomRefetch, useCustomRange, rangeMinutes]);

  const fetchData = useCallback(
    async (name: string, since: string, until: string | null) => {
      const params = new URLSearchParams({
        limit: `${fetchLimit}`,
        since,
      });
      if (until) params.set("until", until);
      if (streamId) params.set("stream_id", streamId);
      const url = `${API_URL}${buildTelemetryApiBase(vehicleId, name)}/recent?${params.toString()}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to fetch ${name}`);
      const json = await res.json();
      return (json.data || []) as DataPoint[];
    },
    [fetchLimit, streamId, vehicleId]
  );

  useEffect(() => {
    if (!sinceDate) return;
    Promise.all([
      fetchData(channelName, sinceDate, untilDate),
      compareChannel
        ? fetchData(compareChannel, sinceDate, untilDate)
        : Promise.resolve([]),
    ])
      .then(([main, compare]) => {
        setData((prev) => {
          const merged = new Map<string, DataPoint>();
          [...main, ...prev].forEach((p) => merged.set(p.timestamp, p));
          return Array.from(merged.values()).sort(
            (a, b) =>
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
        });
        setCompareData(compare);
        setTimeRangePct([0, 100]);
        setZoomRefetch(null);
        setLoadState({ requestKey: loadRequestKey, error: null });
      })
      .catch((e) =>
        setLoadState({
          requestKey: loadRequestKey,
          error: e instanceof Error ? e.message : "Failed to load",
        })
      );
  }, [channelName, compareChannel, fetchData, loadRequestKey, sinceDate, untilDate]);

  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setChartWidth(el.clientWidth));
    ro.observe(el);
    setChartWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    fetch(`${API_URL}/telemetry/list?source_id=${encodeURIComponent(vehicleId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => setChannelList(json.names || []))
      .catch(() => setChannelList([]));
  }, [vehicleId]);

  useEffect(() => {
    const client = new RealtimeWsClient();
    client.subscribe((msg) => {
      if (msg.type === "telemetry_update" && msg.channel?.name === channelName) {
        const ch = msg.channel;
        const newPoint: DataPoint = {
          timestamp: ch.generation_time,
          value: ch.current_value,
          receptionTime: ch.reception_time,
        };
        setData((prev) => {
          const merged = [...prev];
          const existingIdx = merged.findIndex(
            (p) => p.timestamp === newPoint.timestamp
          );
          if (existingIdx >= 0) {
            merged[existingIdx] = newPoint;
          } else {
            merged.push(newPoint);
            merged.sort(
              (a, b) =>
                new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
          }
          return merged.slice(-fetchLimit);
        });
        setTimeRangePct([0, 100]);
      }
    });
    client.connect();
    client.subscribeWatchlist([channelName], vehicleId, streamId);
    return () => client.disconnect();
  }, [channelName, fetchLimit, streamId, vehicleId]);

  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const timeOpts = useMemo(
    () => ({
      timeZone: useUTC ? "UTC" : undefined,
      month: "short" as const,
      day: "numeric" as const,
      hour: "2-digit" as const,
      minute: "2-digit" as const,
      second: "2-digit" as const,
    }),
    [useUTC]
  );

  const chartData = useMemo(() => {
    const merged = new Map<
      string,
      { timestamp: string; value: number; compareValue?: number; receptionTime?: string }
    >();
    data.forEach((d) => merged.set(d.timestamp, { ...d }));
    if (compareData.length > 0) {
      compareData.forEach((d) => {
        const existing = merged.get(d.timestamp);
        if (existing) existing.compareValue = d.value;
        else merged.set(d.timestamp, { ...d, value: NaN, compareValue: d.value });
      });
    }
    const arr = Array.from(merged.values()).sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    return arr.map((d) => ({
      ...d,
      time: new Date(d.timestamp).toLocaleString(undefined, {
        ...timeOpts,
        second: undefined,
      }),
      timeFull: new Date(d.timestamp).toLocaleString(undefined, timeOpts),
    }));
  }, [data, compareData, timeOpts]);

  const displayData = useMemo(() => {
    const [startPct, endPct] = timeRangePct;
    let filtered = chartData;
    if (startPct > 0 || endPct < 100) {
      const len = chartData.length;
      const startIdx = Math.floor((startPct / 100) * len);
      const endIdx = Math.min(Math.ceil((endPct / 100) * len), len);
      filtered = chartData.slice(Math.max(0, startIdx), endIdx);
    }
    return downsampleByWidth(filtered, chartWidth);
  }, [chartData, timeRangePct, chartWidth]);

  const isNumber = (value: number | null | undefined): value is number =>
    typeof value === "number" && Number.isFinite(value);
  const p5 = isNumber(bounds?.p5) ? bounds.p5 : null;
  const p95 = isNumber(bounds?.p95) ? bounds.p95 : null;
  const p50 = isNumber(bounds?.p50) ? bounds.p50 : null;
  const mean = isNumber(bounds?.mean) ? bounds.mean : p50;
  const redLow = isNumber(bounds?.redLow) ? bounds.redLow : null;
  const redHigh = isNumber(bounds?.redHigh) ? bounds.redHigh : null;
  const minVal = isNumber(bounds?.minValue) ? bounds.minValue : null;
  const maxVal = isNumber(bounds?.maxValue) ? bounds.maxValue : null;
  const hasPercentileBounds = p5 != null && p95 != null && p50 != null;
  const hasBounds = hasPercentileBounds || redLow != null || redHigh != null || minVal != null || maxVal != null;

  const allYValues = useMemo(() => {
    const vals = [
      ...displayData.map((d) => d.value).filter((v) => !Number.isNaN(v)),
      ...displayData.map((d) => d.compareValue).filter((v) => v != null && !Number.isNaN(v)) as number[],
    ];
    [p5, p95, p50, mean, minVal, maxVal].forEach((value) => {
      if (value != null) vals.push(value);
    });
    if (redLow != null) vals.push(redLow);
    if (redHigh != null) vals.push(redHigh);
    return vals;
  }, [displayData, p5, p95, p50, mean, minVal, maxVal, redLow, redHigh]);

  const yMin = allYValues.length > 0 ? Math.min(...allYValues) : 0;
  const yMax = allYValues.length > 0 ? Math.max(...allYValues) : 1;
  const padding = Math.max((yMax - yMin) * 0.05, 1e-6);
  const domain: [number, number] = [yMin - padding, yMax + padding];

  const compareYValues = displayData
    .map((d) => d.compareValue)
    .filter((v): v is number => v != null && !Number.isNaN(v));
  const compareYMin = compareYValues.length > 0 ? Math.min(...compareYValues) : 0;
  const compareYMax = compareYValues.length > 0 ? Math.max(...compareYValues) : 1;
  const comparePadding = Math.max((compareYMax - compareYMin) * 0.05, 1e-6);
  const compareDomain: [number, number] = [
    compareYMin - comparePadding,
    compareYMax + comparePadding,
  ];

  const isInNominalBand = (value: number) =>
    p5 == null || p95 == null || (value >= p5 && value <= p95);

  const rightMargin = useMemo(() => {
    if (compareChannel) return 90;
    if (hasBounds && (showMeanP50 || showP5P95)) return 105;
    return 24;
  }, [compareChannel, hasBounds, showMeanP50, showP5P95]);

  const sampleInterval = useMemo(() => medianInterval(data), [data]);
  const lastPoint = displayData.length > 0 ? displayData[displayData.length - 1] : null;
  const lastReceivedAt =
    lastPoint?.receptionTime
      ? new Date(lastPoint.receptionTime).getTime()
      : lastPoint
        ? new Date(lastPoint.timestamp).getTime()
        : lastTimestamp
          ? new Date(lastTimestamp).getTime()
          : null;
  const gapMs = lastReceivedAt != null ? nowTs - lastReceivedAt : null;
  const possibleGap = sampleInterval != null && gapMs != null && gapMs > 2 * sampleInterval;

  const tooltipContent = useCallback(
    (props: { active?: boolean; payload?: ReadonlyArray<{ payload: { timeFull: string; value: number; compareValue?: number }; name: string }> }) => {
      const { active, payload } = props;
      if (!active || !payload?.length) return null;
      const p = payload[0].payload;
      return (
        <div
          className="bg-card rounded-md border p-3 text-sm shadow-md"
          style={{
            backgroundColor: "var(--card)",
            color: "var(--card-foreground)",
            border: "1px solid var(--input)",
          }}
        >
          <div className="font-medium">{p.timeFull}</div>
          <div className="mt-1 space-y-0.5">
            <div>
              {channelName}: {formatWithUnits(p.value, units)}
            </div>
            {p.compareValue != null && compareChannel && (
              <div>
                {compareChannel}: {formatWithUnits(p.compareValue, null)}
              </div>
            )}
          </div>
        </div>
      );
    },
    [channelName, units, compareChannel]
  );

  if (loading && data.length === 0) {
    return (
      <div className="text-muted-foreground flex h-[300px] items-center justify-center gap-2">
        <Spinner size="default" />
        <span className="text-sm">Loading chart…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[300px] items-center justify-center">
        <Alert variant="destructive" className="max-w-md">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const rangeAriaLabels: Record<string, string> = {
    "15m": "Last 15 minutes",
    "1h": "Last 1 hour",
    "6h": "Last 6 hours",
    "24h": "Last 24 hours",
  };

  const isZoomed = timeRangePct[0] > 0 || timeRangePct[1] < 100;
  const dataMaxTime = chartData.length > 0 ? new Date(chartData[chartData.length - 1].timestamp).getTime() : 0;
  const isLiveData = lastPoint && dataMaxTime > 0 && nowTs - dataMaxTime < 60_000;

  return (
    <div className="space-y-3 overflow-visible">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-muted-foreground w-14 shrink-0 text-xs font-medium tracking-wider uppercase">
            Range
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
          {RANGE_PRESETS.map(({ label, minutes }) => (
            <Button
              key={label}
              variant={!useCustomRange && rangeMinutes === minutes ? "default" : "outline"}
              size="sm"
              aria-label={rangeAriaLabels[label] ?? `Last ${label}`}
              onClick={() => {
                setUseCustomRange(false);
                setRangeMinutes(minutes);
              }}
            >
              {label}
            </Button>
          ))}
          <Button
            variant={useCustomRange ? "default" : "outline"}
            size="sm"
            aria-label="Custom time range"
            onClick={() => {
              setUseCustomRange(true);
              const now = new Date();
              const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
              setCustomStart(oneHourAgo.toISOString());
              setCustomEnd(now.toISOString());
            }}
          >
            Custom
          </Button>
          {useCustomRange && (
            <span className="inline-flex items-center gap-2 text-sm">
              <CustomTimestampPicker
                value={customStart}
                onChange={setCustomStart}
                placeholder="Start"
                id="trend-custom-start"
                aria-label="Custom range start"
                className="h-8 w-48 justify-start text-left text-xs font-normal"
              />
              <span className="text-muted-foreground">to</span>
              <CustomTimestampPicker
                value={customEnd}
                onChange={setCustomEnd}
                placeholder="End"
                id="trend-custom-end"
                aria-label="Custom range end"
                className="h-8 w-48 justify-start text-left text-xs font-normal"
              />
            </span>
          )}
          </div>
        </div>
        <Collapsible className="border-border border-t pt-3">
          <div className="flex flex-col gap-2">
            <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex w-fit cursor-pointer items-center gap-2 text-xs font-medium tracking-wider uppercase data-[state=open]:[&_svg]:rotate-180">
              Display options
              <ChevronDownIcon className="size-3.5 transition-transform duration-200" />
            </CollapsibleTrigger>
            <CollapsibleContent className="w-full">
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <div className="flex gap-1">
                  <Button
                    variant={useUTC ? "default" : "outline"}
                    size="sm"
                    aria-label="Show times in UTC"
                    onClick={() => setUseUTC(true)}
                  >
                    UTC
                  </Button>
                  <Button
                    variant={!useUTC ? "default" : "outline"}
                    size="sm"
                    aria-label="Show times in local timezone"
                    onClick={() => setUseUTC(false)}
                  >
                    Local
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="show-mean-p50"
                    checked={showMeanP50}
                    onCheckedChange={(c) => setShowMeanP50(!!c)}
                    aria-label="Show mean and P50 overlay lines"
                  />
                  <Label htmlFor="show-mean-p50" className="cursor-pointer text-sm font-normal">
                    Mean/P50
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="show-p5-p95"
                    checked={showP5P95}
                    onCheckedChange={(c) => setShowP5P95(!!c)}
                    aria-label="Show P5 and P95 overlay lines"
                  />
                  <Label htmlFor="show-p5-p95" className="cursor-pointer text-sm font-normal">
                    P5/P95
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={compareChannel ?? "__none__"}
                    onValueChange={(v) => setCompareChannel(v === "__none__" ? null : v)}
                  >
                    <SelectTrigger className="h-9 min-w-[180px]" aria-label="Compare with another channel">
                      <SelectValue placeholder="Add channel to compare" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Add channel to compare</SelectItem>
                      {channelList
                        .filter((n) => n !== channelName)
                        .map((n) => (
                          <SelectItem key={n} value={n}>
                            {n}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  {compareChannel && (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Clear compare channel (currently ${compareChannel})`}
                      onClick={() => setCompareChannel(null)}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>

        {chartData.length > 10 && (
          <div className="border-border flex flex-wrap items-center gap-3 border-t pt-3">
            <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              Time window
            </span>
            <Slider
              min={0}
              max={100}
              step={1}
              value={timeRangePct}
              onValueChange={(v) => setTimeRangePct([v[0] ?? 0, v[1] ?? 100])}
              className="w-48"
              aria-label="Select time range to view"
            />
            {isZoomed && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="Zoom to selected range (refetch)"
                  onClick={() => {
                    const len = chartData.length;
                    const startIdx = Math.floor((timeRangePct[0] / 100) * len);
                    const endIdx = Math.min(Math.ceil((timeRangePct[1] / 100) * len), len);
                    const startPt = chartData[startIdx];
                    const endPt = chartData[endIdx];
                    if (startPt && endPt) {
                      setZoomRefetch({
                        since: startPt.timestamp,
                        until: endPt.timestamp,
                      });
                    }
                  }}
                >
                  Zoom
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Reset to full range"
                  onClick={() => setTimeRangePct([0, 100])}
                >
                  Reset
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {sampleInterval != null && (
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span>Sample interval: {formatInterval(sampleInterval)}</span>
          {lastPoint && (
            <>
              <span className="text-muted-foreground/80">·</span>
              <span>
                Current: {formatWithUnits(lastPoint.value, units)} at {lastPoint.timeFull}
              </span>
            </>
          )}
          {possibleGap && gapMs != null && (
            <Badge variant="destructive" className="ml-1 shrink-0">
              Possible gap: last sample {formatInterval(gapMs)} ago
            </Badge>
          )}
        </div>
      )}

      <div
        ref={chartContainerRef}
        className="h-[380px] w-full min-w-0 overflow-visible px-8"
        role="img"
        aria-label={`Trend chart for ${channelName} over selected time range`}
      >
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon="chart"
              title="No data in selected time range"
              description="Try a different time range (e.g. 24h) or check if the channel has recent data."
            />
          </div>
        ) : (
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <ComposedChart
            data={displayData}
            margin={{
              top: 8,
              right: rightMargin,
              bottom: 70,
              left: 60,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => {
                const idx = displayData.findIndex((d) => d.time === v);
                if (idx < 0) return v;
                return new Date(displayData[idx].timestamp).toLocaleString(undefined, {
                  ...timeOpts,
                  second: undefined,
                });
              }}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 12 }}
              domain={domain}
              tickFormatter={(v) => formatWithUnits(v, units)}
            />
            {compareChannel && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11 }}
                domain={compareDomain}
                width={70}
                tickMargin={8}
              />
            )}
            <Tooltip content={tooltipContent} />
            {hasBounds && (
              <>
                {redLow != null && (
                  <ReferenceArea
                    yAxisId="left"
                    y1={domain[0]}
                    y2={redLow}
                    fill="rgba(239, 68, 68, 0.15)"
                    stroke="none"
                  />
                )}
                {redHigh != null && (
                  <ReferenceArea
                    yAxisId="left"
                    y1={redHigh}
                    y2={domain[1]}
                    fill="rgba(239, 68, 68, 0.15)"
                    stroke="none"
                  />
                )}
                {redLow != null && p5 != null && (
                  <ReferenceArea
                    yAxisId="left"
                    y1={redLow}
                    y2={p5}
                    fill="rgba(234, 179, 8, 0.2)"
                    stroke="none"
                  />
                )}
                {redHigh != null && p95 != null && (
                  <ReferenceArea
                    yAxisId="left"
                    y1={p95}
                    y2={redHigh}
                    fill="rgba(234, 179, 8, 0.2)"
                    stroke="none"
                  />
                )}
                {redLow == null && redHigh == null && minVal != null && maxVal != null && p5 != null && p95 != null && (
                  <>
                    <ReferenceArea
                      yAxisId="left"
                      y1={minVal}
                      y2={p5}
                      fill="rgba(234, 179, 8, 0.2)"
                      stroke="none"
                    />
                    <ReferenceArea
                      yAxisId="left"
                      y1={p95}
                      y2={maxVal}
                      fill="rgba(234, 179, 8, 0.2)"
                      stroke="none"
                    />
                  </>
                )}
                {hasPercentileBounds && (
                  <ReferenceArea
                    yAxisId="left"
                    y1={p5}
                    y2={p95}
                    fill="rgba(34, 197, 94, 0.2)"
                    stroke="none"
                  />
                )}
                {showMeanP50 && p50 != null && (
                  <ReferenceLine
                    yAxisId="left"
                    y={p50}
                    stroke="var(--primary)"
                    strokeDasharray="4 4"
                    label={{ value: "P50", position: "right", offset: 8 }}
                  />
                )}
                {showMeanP50 && mean != null && p50 != null && mean !== p50 && (
                  <ReferenceLine
                    yAxisId="left"
                    y={mean}
                    stroke="var(--muted-foreground)"
                    strokeDasharray="2 2"
                    label={{ value: "Mean", position: "right", offset: 8 }}
                  />
                )}
                {showP5P95 && p5 != null && p95 != null && (
                  <>
                    <ReferenceLine
                      yAxisId="left"
                      y={p5}
                      stroke="var(--muted-foreground)"
                      strokeDasharray="2 2"
                      label={{ value: "P5", position: "right", offset: 8 }}
                    />
                    <ReferenceLine
                      yAxisId="left"
                      y={p95}
                      stroke="var(--muted-foreground)"
                      strokeDasharray="2 2"
                      label={{ value: "P95", position: "right", offset: 8 }}
                    />
                  </>
                )}
              </>
            )}
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="value"
              stroke="var(--primary)"
              strokeWidth={2}
              isAnimationActive={displayData.length <= 200}
              dot={
                displayData.length > 150
                  ? false
                  : (props) => {
                      const { cx, cy, payload } = props;
                      if (cx == null || cy == null) return null;
                      const isLast = lastPoint && payload.timestamp === lastPoint.timestamp;
                      const inBand = hasBounds ? isInNominalBand(payload.value) : true;
                      return (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={isLast ? 6 : inBand ? 3 : 5}
                          fill={isLast ? "var(--primary)" : inBand ? "var(--primary)" : "rgb(239, 68, 68)"}
                          stroke={isLast ? "var(--background)" : undefined}
                          strokeWidth={isLast ? 2 : 0}
                        />
                      );
                    }
              }
              activeDot={displayData.length > 150 ? false : { r: 5, fill: "var(--primary)" }}
              connectNulls
            />
            {compareChannel && (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="compareValue"
                stroke="hsl(262, 83%, 58%)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls
                isAnimationActive={displayData.length <= 200}
              />
            )}
            {isLiveData && displayData.length > 0 && (
              <ReferenceLine
                x={displayData[displayData.length - 1]?.time}
                stroke="var(--primary)"
                strokeDasharray="4 4"
                strokeOpacity={0.6}
                label={{ value: "Now", position: "top", fontSize: 10 }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
