"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface FeedStatus {
  source_id: string;
  connected: boolean;
  state?: "connected" | "degraded" | "disconnected";
  last_reception_time: number | null;
  approx_rate_hz: number | null;
}

interface TelemetrySource {
  id: string;
  name: string;
  description?: string | null;
}

interface ContextBannerProps {
  sourceId: string;
  onSourceChange?: (sourceId: string) => void;
  sources?: TelemetrySource[];
  activeAlertCount?: number;
  alertCountBySeverity?: { warning?: number; caution?: number };
}

export function ContextBanner({
  sourceId,
  onSourceChange,
  sources = [],
  activeAlertCount = 0,
  alertCountBySeverity = {},
}: ContextBannerProps) {
  const [feedStatus, setFeedStatus] = useState<FeedStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    function fetchStatus() {
      fetch(`${API_URL}/ops/feed-status?source_id=${encodeURIComponent(sourceId)}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (!cancelled && data) setFeedStatus(data);
        })
        .catch(() => {});
    }
    fetchStatus();
    const id = setInterval(fetchStatus, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sourceId]);

  const sourceLabel =
    sources.find((s) => s.id === sourceId)?.name || sourceId;
  const feedState =
    (feedStatus?.state as "connected" | "degraded" | "disconnected" | undefined) ??
    (feedStatus?.connected
      ? "connected"
      : feedStatus?.last_reception_time != null
        ? "degraded"
        : "disconnected");

  return (
    <div className="flex flex-wrap items-center gap-3 py-2 px-4 border-b bg-muted/30 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground font-medium">Source:</span>
        {sources.length > 1 && onSourceChange ? (
          <Select value={sourceId} onValueChange={onSourceChange}>
            <SelectTrigger className="h-8 w-auto min-w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sources.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="font-medium">{sourceLabel}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Feed:</span>
        <Badge
          variant={
            feedState === "connected"
              ? "success"
              : feedState === "degraded"
                ? "secondary"
                : "destructive"
          }
          className="text-xs"
        >
          {feedState === "connected" ? (
            <>
              <span className="mr-1 inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
              Live
            </>
          ) : feedState === "degraded" ? (
            "Degraded"
          ) : (
            "No data"
          )}
        </Badge>
        {feedStatus?.approx_rate_hz != null && feedStatus.approx_rate_hz > 0 && (
          <span className="text-muted-foreground text-xs">
            ~{feedStatus.approx_rate_hz.toFixed(1)} Hz
          </span>
        )}
      </div>
      {activeAlertCount > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Alerts:</span>
          <Badge variant="destructive" className="text-xs">
            {activeAlertCount}
          </Badge>
          {alertCountBySeverity.warning != null &&
            alertCountBySeverity.warning > 0 && (
              <span className="text-destructive text-xs">
                {alertCountBySeverity.warning} warning
              </span>
            )}
        </div>
      )}
    </div>
  );
}
