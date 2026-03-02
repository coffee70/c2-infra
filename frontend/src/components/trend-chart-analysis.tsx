"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
  Brush,
  ComposedChart,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/empty-state";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface DataPoint {
  timestamp: string;
  value: number;
}

interface Bounds {
  p5: number;
  p50: number;
  p95: number;
  mean?: number;
  redLow?: number;
  redHigh?: number;
  minValue: number;
  maxValue: number;
}

const RANGE_PRESETS = [
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "6h", minutes: 360 },
  { label: "24h", minutes: 1440 },
] as const;

function formatWithUnits(
  value: number,
  units: string | null | undefined
): string {
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

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const MIN_POINTS = 100;
const MAX_POINTS = 600;
const DEFAULT_POINTS = 300;

function downsample<T extends { timestamp: string; value: number }>(
  data: T[],
  maxPoints: number
): T[] {
  if (data.length <= maxPoints) return data;
  const step = data.length / maxPoints;
  const result: T[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.min(Math.floor(i * step), data.length - 1);
    result.push(data[idx]);
  }
  return result;
}

export function TrendChartAnalysis({
  channelName,
  units,
  bounds,
  lastTimestamp,
}: {
  channelName: string;
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
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [useCustomRange, setUseCustomRange] = useState(false);
  const [brushSelection, setBrushSelection] = useState<[number, number] | null>(null);
  const [brushRefetch, setBrushRefetch] = useState<{ since: string; until: string } | null>(null);
  const [maxDisplayPoints, setMaxDisplayPoints] = useState(DEFAULT_POINTS);

  const [data, setData] = useState<DataPoint[]>([]);
  const [compareData, setCompareData] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { sinceDate, untilDate } = useMemo(() => {
    if (brushRefetch) {
      return {
        sinceDate: brushRefetch.since,
        untilDate: brushRefetch.until,
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
      return { sinceDate: since.toISOString(), untilDate: null };
    }
    const since = new Date();
    since.setMinutes(since.getMinutes() - rangeMinutes);
    return { sinceDate: since.toISOString(), untilDate: null };
  }, [useCustomRange, customStart, customEnd, rangeMinutes, brushRefetch]);

  const fetchLimit = useMemo(() => {
    if (brushRefetch) return 1000;
    const mins = useCustomRange ? 60 : rangeMinutes;
    if (mins <= 15) return 150;
    if (mins <= 60) return 300;
    if (mins <= 360) return 600;
    return 1000;
  }, [brushRefetch, useCustomRange, rangeMinutes]);

  const fetchData = useCallback(
    async (name: string, since: string, until: string | null) => {
      let url = `${API_URL}/telemetry/${encodeURIComponent(name)}/recent?limit=${fetchLimit}&since=${encodeURIComponent(since)}`;
      if (until) url += `&until=${encodeURIComponent(until)}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to fetch ${name}`);
      const json = await res.json();
      return (json.data || []) as DataPoint[];
    },
    [fetchLimit]
  );

  useEffect(() => {
    if (!sinceDate) return;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchData(channelName, sinceDate, untilDate),
      compareChannel
        ? fetchData(compareChannel, sinceDate, untilDate)
        : Promise.resolve([]),
    ])
      .then(([main, compare]) => {
        setData(main);
        setCompareData(compare);
        setBrushSelection(null);
        setBrushRefetch(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [channelName, compareChannel, sinceDate, untilDate, fetchData]);

  useEffect(() => {
    fetch(`${API_URL}/telemetry/list`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => setChannelList(json.names || []))
      .catch(() => setChannelList([]));
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
    const merged = new Map<string, { timestamp: string; value: number; compareValue?: number }>();
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

  const displayData = useMemo(
    () => downsample(chartData, maxDisplayPoints),
    [chartData, maxDisplayPoints]
  );

  const hasBounds = bounds != null;
  const p5 = bounds?.p5 ?? 0;
  const p95 = bounds?.p95 ?? 0;
  const p50 = bounds?.p50 ?? 0;
  const mean = bounds?.mean ?? p50;
  const redLow = bounds?.redLow;
  const redHigh = bounds?.redHigh;
  const minVal = bounds?.minValue;
  const maxVal = bounds?.maxValue;

  const allYValues = useMemo(() => {
    const vals = [
      ...displayData.map((d) => d.value).filter((v) => !Number.isNaN(v)),
      ...displayData.map((d) => d.compareValue).filter((v) => v != null && !Number.isNaN(v)) as number[],
    ];
    if (hasBounds) vals.push(p5, p95, p50, mean, minVal ?? 0, maxVal ?? 0);
    if (redLow != null) vals.push(redLow);
    if (redHigh != null) vals.push(redHigh);
    return vals;
  }, [displayData, hasBounds, p5, p95, p50, mean, minVal, maxVal, redLow, redHigh]);

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

  const isInNominalBand = (value: number) => value >= p5 && value <= p95;

  const rightMargin = useMemo(() => {
    if (compareChannel) return 90;
    if (hasBounds && (showMeanP50 || showP5P95)) return 105;
    return 24;
  }, [compareChannel, hasBounds, showMeanP50, showP5P95]);

  const sampleInterval = useMemo(() => medianInterval(data), [data]);
  const lastPoint = displayData.length > 0 ? displayData[displayData.length - 1] : null;
  const now = Date.now();
  const lastTs = lastTimestamp ? new Date(lastTimestamp).getTime() : (lastPoint ? new Date(lastPoint.timestamp).getTime() : null);
  const gapMs = lastTs != null ? now - lastTs : null;
  const possibleGap = sampleInterval != null && gapMs != null && gapMs > 2 * sampleInterval;

  const tooltipContent = useCallback(
    (props: { active?: boolean; payload?: ReadonlyArray<{ payload: { timeFull: string; value: number; compareValue?: number }; name: string }> }) => {
      const { active, payload } = props;
      if (!active || !payload?.length) return null;
      const p = payload[0].payload;
      return (
        <div
          className="rounded-md border bg-card p-3 text-sm shadow-md"
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
      <div className="flex h-[300px] items-center justify-center text-muted-foreground">
        Loading chart...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[300px] items-center justify-center text-destructive">
        {error}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center">
        <EmptyState
          title="No data in selected time range"
          description="Try a different time range or check if the channel has recent data."
        />
      </div>
    );
  }

  const rangeAriaLabels: Record<string, string> = {
    "15m": "Last 15 minutes",
    "1h": "Last 1 hour",
    "6h": "Last 6 hours",
    "24h": "Last 24 hours",
  };

  return (
    <div className="space-y-3 overflow-visible">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="w-14 shrink-0 text-xs font-medium text-muted-foreground uppercase tracking-wider">
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
              setCustomStart(toDatetimeLocal(oneHourAgo));
              setCustomEnd(toDatetimeLocal(now));
            }}
          >
            Custom
          </Button>
          {useCustomRange && (
            <span className="inline-flex items-center gap-2 text-sm">
              <Input
                type="datetime-local"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="h-9 w-40 text-sm"
                aria-label="Custom range start"
              />
              <span className="text-muted-foreground">to</span>
              <Input
                type="datetime-local"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="h-9 w-40 text-sm"
                aria-label="Custom range end"
              />
            </span>
          )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3">
          <span className="w-14 shrink-0 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Display
          </span>
          <div className="flex flex-wrap items-center gap-3">
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
          <label className="flex cursor-pointer items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={showMeanP50}
              onChange={(e) => setShowMeanP50(e.target.checked)}
              className="rounded"
              aria-label="Show mean and P50 overlay lines"
            />
            Mean/P50
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={showP5P95}
              onChange={(e) => setShowP5P95(e.target.checked)}
              className="rounded"
              aria-label="Show P5 and P95 overlay lines"
            />
            P5/P95
          </label>
          <div className="flex items-center gap-2">
            <select
              className="h-9 min-h-[44px] rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={compareChannel ?? ""}
              onChange={(e) => setCompareChannel(e.target.value || null)}
              aria-label="Compare with another channel"
            >
              <option value="">Add channel to compare</option>
              {channelList
                .filter((n) => n !== channelName)
                .map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
            </select>
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
          {brushSelection && (
            <Button
              size="sm"
              aria-label="Zoom to selected range"
              onClick={() => {
                const [s, e] = brushSelection;
                if (displayData[s] && displayData[e]) {
                  setBrushRefetch({
                    since: displayData[s].timestamp,
                    until: displayData[e].timestamp,
                  });
                }
              }}
            >
              Zoom
            </Button>
          )}
          <div className="flex items-center gap-2">
            <label htmlFor="points-slider" className="text-sm">
              Points: {maxDisplayPoints}
            </label>
            <input
              id="points-slider"
              type="range"
              min={MIN_POINTS}
              max={MAX_POINTS}
              step={50}
              value={maxDisplayPoints}
              onChange={(e) => setMaxDisplayPoints(Number(e.target.value))}
              className="h-2 w-32 cursor-pointer accent-primary"
              aria-label="Maximum points to display on chart"
            />
          </div>
          </div>
        </div>
      </div>

      {sampleInterval != null && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
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
            <Badge variant="destructive" className="shrink-0 ml-1">
              Possible gap: last sample {formatInterval(gapMs)} ago
            </Badge>
          )}
        </div>
      )}

      <div
        className="h-[380px] w-full min-w-0 overflow-visible px-8"
        role="img"
        aria-label={`Trend chart for ${channelName} over selected time range`}
      >
        <ResponsiveContainer width="100%" height="100%">
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
              tickFormatter={(v, i) => {
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
                {redLow != null && (
                  <ReferenceArea
                    yAxisId="left"
                    y1={redLow}
                    y2={p5}
                    fill="rgba(234, 179, 8, 0.2)"
                    stroke="none"
                  />
                )}
                {redHigh != null && (
                  <ReferenceArea
                    yAxisId="left"
                    y1={p95}
                    y2={redHigh}
                    fill="rgba(234, 179, 8, 0.2)"
                    stroke="none"
                  />
                )}
                {redLow == null && redHigh == null && minVal != null && maxVal != null && (
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
                <ReferenceArea
                  yAxisId="left"
                  y1={p5}
                  y2={p95}
                  fill="rgba(34, 197, 94, 0.2)"
                  stroke="none"
                />
                {showMeanP50 && (
                  <ReferenceLine
                    yAxisId="left"
                    y={p50}
                    stroke="var(--primary)"
                    strokeDasharray="4 4"
                    label={{ value: "P50", position: "right", offset: 8 }}
                  />
                )}
                {showMeanP50 && mean !== p50 && (
                  <ReferenceLine
                    yAxisId="left"
                    y={mean}
                    stroke="var(--muted-foreground)"
                    strokeDasharray="2 2"
                    label={{ value: "Mean", position: "right", offset: 8 }}
                  />
                )}
                {showP5P95 && (
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
            {displayData.length > 10 && (
              <Brush
                dataKey="time"
                height={30}
                stroke="var(--primary)"
                fill="var(--muted)"
                onChange={(range) => {
                  if (range && typeof range === "object" && "startIndex" in range && "endIndex" in range) {
                    const startIdx = range.startIndex as number;
                    const endIdx = range.endIndex as number;
                    if (startIdx !== endIdx) {
                      setBrushSelection([startIdx, endIdx]);
                    }
                  }
                }}
                startIndex={brushSelection?.[0] ?? 0}
                endIndex={brushSelection?.[1] ?? Math.max(0, displayData.length - 1)}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
