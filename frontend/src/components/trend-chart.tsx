"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";

interface DataPoint {
  timestamp: string;
  value: number;
}

interface Bounds {
  p5: number;
  p50: number;
  p95: number;
  redLow?: number;
  redHigh?: number;
  minValue: number;
  maxValue: number;
}

export function TrendChart({
  data,
  bounds,
}: {
  data: DataPoint[];
  bounds?: Bounds;
}) {
  const chartData = data.map((d) => ({
    ...d,
    time: new Date(d.timestamp).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  }));

  const hasBounds = bounds != null;
  const p5 = bounds?.p5 ?? 0;
  const p95 = bounds?.p95 ?? 0;
  const redLow = bounds?.redLow;
  const redHigh = bounds?.redHigh;
  const minVal = bounds?.minValue;
  const maxVal = bounds?.maxValue;

  const allYValues: number[] = [
    ...chartData.map((d) => d.value),
    ...(hasBounds && minVal != null && maxVal != null ? [p5, p95, minVal, maxVal] : []),
    ...(redLow != null ? [redLow] : []),
    ...(redHigh != null ? [redHigh] : []),
  ];
  const yMin = allYValues.length > 0 ? Math.min(...allYValues) : 0;
  const yMax = allYValues.length > 0 ? Math.max(...allYValues) : 1;
  const padding = Math.max((yMax - yMin) * 0.05, 1e-6);
  const domain: [number, number] = [yMin - padding, yMax + padding];

  const isInNominalBand = (value: number) => value >= p5 && value <= p95;

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="time" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} domain={domain} />
          <Tooltip
            formatter={(value: number | undefined) =>
              value != null ? [value.toFixed(4), "Value"] : ["", "Value"]
            }
            labelFormatter={(label, payload) => {
              if (payload?.length && payload[0].payload?.timestamp) {
                return new Date(payload[0].payload.timestamp).toLocaleString(
                  undefined,
                  {
                    dateStyle: "medium",
                    timeStyle: "medium",
                  }
                );
              }
              return typeof label === "string" ? label : (label ?? "");
            }}
            contentStyle={{
              backgroundColor: "var(--card)",
              color: "var(--card-foreground)",
              border: "1px solid var(--input)",
              borderRadius: "6px",
            }}
            labelStyle={{ color: "var(--card-foreground)" }}
          />
          {hasBounds && (
            <>
              {redLow != null && (
                <ReferenceArea
                  y1={domain[0]}
                  y2={redLow}
                  fill="rgba(239, 68, 68, 0.15)"
                  stroke="none"
                />
              )}
              {redHigh != null && (
                <ReferenceArea
                  y1={redHigh}
                  y2={domain[1]}
                  fill="rgba(239, 68, 68, 0.15)"
                  stroke="none"
                />
              )}
              {redLow != null && (
                <ReferenceArea
                  y1={redLow}
                  y2={p5}
                  fill="rgba(234, 179, 8, 0.2)"
                  stroke="none"
                />
              )}
              {redHigh != null && (
                <ReferenceArea
                  y1={p95}
                  y2={redHigh}
                  fill="rgba(234, 179, 8, 0.2)"
                  stroke="none"
                />
              )}
              {redLow == null && redHigh == null && minVal != null && maxVal != null && (
                <>
                  <ReferenceArea
                    y1={minVal}
                    y2={p5}
                    fill="rgba(234, 179, 8, 0.2)"
                    stroke="none"
                  />
                  <ReferenceArea
                    y1={p95}
                    y2={maxVal}
                    fill="rgba(234, 179, 8, 0.2)"
                    stroke="none"
                  />
                </>
              )}
              <ReferenceArea
                y1={p5}
                y2={p95}
                fill="rgba(34, 197, 94, 0.2)"
                stroke="none"
              />
            </>
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--primary)"
            strokeWidth={2}
            dot={(props) => {
              const { cx, cy, payload } = props;
              if (cx == null || cy == null) return null;
              const inBand = hasBounds ? isInNominalBand(payload.value) : true;
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={inBand ? 3 : 5}
                  fill={inBand ? "var(--primary)" : "rgb(239, 68, 68)"}
                />
              );
            }}
            activeDot={{ r: 5, fill: "var(--primary)" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
