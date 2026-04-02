"use client";

import { CurrentValueBlock } from "@/components/current-value-block";
import { Badge } from "@/components/ui/badge";
import {
  useRealtimeChannel,
  useRealtimeTelemetry,
} from "@/lib/realtime-telemetry-context";

interface TelemetryDetailLiveProps {
  channelName: string;
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
  initialValue,
  initialUnits,
  initialLastTimestamp,
  initialP50,
  initialState,
  initialStateReason,
  initialZScore,
  recentData,
}: TelemetryDetailLiveProps) {
  const liveChannel = useRealtimeChannel(channelName);
  const { isLive } = useRealtimeTelemetry();

  const displayValue = liveChannel?.value ?? initialValue;
  const displayLastTimestamp = liveChannel?.lastTimestamp ?? initialLastTimestamp ?? "";
  const displayState = liveChannel?.state ?? initialState;
  const displayStateReason = liveChannel?.stateReason ?? initialStateReason ?? null;
  const displayZScore = liveChannel?.zScore ?? initialZScore ?? null;
  const displayLiveData =
    liveChannel && liveChannel.liveData.length > 0
      ? liveChannel.liveData
      : recentData;

  return (
    <div className="relative">
      {isLive && (
        <Badge
          variant="success"
          className="absolute top-2 right-2 gap-1.5"
        >
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current opacity-80" />
          Live
        </Badge>
      )}
      <CurrentValueBlock
        value={displayValue}
        units={initialUnits}
        lastTimestamp={displayLastTimestamp}
        p50={initialP50}
        state={displayState}
        stateReason={displayStateReason}
        zScore={displayZScore}
        recentData={displayLiveData}
      />
    </div>
  );
}
