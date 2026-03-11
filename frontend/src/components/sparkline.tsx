"use client";

import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

interface DataPoint {
  timestamp: string;
  value: number;
}

interface SparklineProps {
  data: DataPoint[];
  state?: "normal" | "caution" | "warning";
  width?: number;
  height?: number;
}

const stateColors = {
  normal: "var(--primary)",
  caution: "hsl(45 93% 47%)",
  warning: "hsl(0 84% 60%)",
};

export function Sparkline({
  data,
  state = "normal",
  width = 120,
  height = 40,
}: SparklineProps) {
  if (data.length === 0) return null;

  const chartData = data.map((d) => ({
    ...d,
    time: new Date(d.timestamp).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }),
  }));

  const strokeColor = stateColors[state];

  return (
    <div style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        <LineChart data={chartData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Tooltip
            formatter={(value: number | undefined) =>
              value != null ? [value.toFixed(4), "Value"] : ["", "Value"]
            }
            contentStyle={{
              backgroundColor: "var(--card)",
              border: "1px solid var(--input)",
              borderRadius: "6px",
              fontSize: 12,
            }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={strokeColor}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
