"use client";

import { useEffect, useRef, useState } from "react";
import { CurrentValueBlock } from "@/components/current-value-block";
import { RealtimeWsClient } from "@/lib/realtime-ws-client";

const LIVE_STALE_MS = 15000;

interface TelemetryDetailLiveProps {
  channelName: string;
  sourceId?: string;
  initialValue: number;
  initialUnits?: string | null;
  initialLastTimestamp?: string | null;
  initialP50: number;
  initialState: string;
  initialStateReason?: string | null;
  initialZScore?: number | null;
  recentData: { timestamp: string; value: number }[];
}

export function TelemetryDetailLive({
  channelName,
  sourceId = "default",
  initialValue,
  initialUnits,
  initialLastTimestamp,
  initialP50,
  initialState,
  initialStateReason,
  initialZScore,
  recentData,
}: TelemetryDetailLiveProps) {
  const [value, setValue] = useState(initialValue);
  const [lastTimestamp, setLastTimestamp] = useState(initialLastTimestamp ?? "");
  const [state, setState] = useState(initialState);
  const [stateReason, setStateReason] = useState(initialStateReason ?? null);
  const [zScore, setZScore] = useState(initialZScore ?? null);
  const [liveData, setLiveData] = useState(recentData);
  const [live, setLive] = useState(false);
  const lastUpdateAtRef = useRef<number | null>(null);

  useEffect(() => {
    const client = new RealtimeWsClient();
    client.subscribe((msg) => {
      if (msg.type === "telemetry_update" && msg.channel?.name === channelName) {
        lastUpdateAtRef.current = Date.now();
        setLive(true);
        const ch = msg.channel;
        setValue(ch.current_value);
        setLastTimestamp(ch.generation_time);
        setState(ch.state);
        setStateReason(ch.state_reason ?? null);
        setZScore(ch.z_score ?? null);
        setLiveData((prev) => {
          const next = [...prev, { timestamp: ch.generation_time, value: ch.current_value }];
          return next.slice(-100);
        });
      }
    });
    client.connect();
    client.subscribeWatchlist([channelName], sourceId);
    return () => client.disconnect();
  }, [channelName, sourceId]);

  useEffect(() => {
    const interval = setInterval(() => {
      const at = lastUpdateAtRef.current;
      if (at !== null && Date.now() - at > LIVE_STALE_MS) {
        setLive(false);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative">
      {live && (
        <span className="absolute top-2 right-2 inline-flex items-center gap-1.5 rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          Live
        </span>
      )}
      <CurrentValueBlock
        value={value}
        units={initialUnits}
        lastTimestamp={lastTimestamp}
        p50={initialP50}
        state={state}
        stateReason={stateReason}
        zScore={zScore}
        recentData={liveData}
      />
    </div>
  );
}
