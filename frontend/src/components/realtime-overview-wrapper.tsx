"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { auditLog } from "@/lib/audit-log";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WatchlistCard } from "@/components/watchlist-card";
import { EventConsole } from "@/components/event-console";
import {
  ContextBanner,
  type AlertSummary,
} from "@/components/context-banner";
import { NowPanel } from "@/components/now-panel";
import { EmptyState } from "@/components/empty-state";
import {
  RealtimeWsClient,
  RealtimeChannelUpdate,
  TelemetryAlert,
} from "@/lib/realtime-ws-client";

const API_URL =
  process.env.API_SERVER_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000";

interface OverviewChannel {
  name: string;
  units?: string | null;
  description?: string | null;
  subsystem_tag: string;
  current_value: number;
  last_timestamp: string;
  state: string;
  state_reason?: string | null;
  z_score?: number | null;
  sparkline_data: { timestamp: string; value: number }[];
}

interface AnomalyEntry {
  name: string;
  units?: string | null;
  current_value: number;
  last_timestamp: string;
  z_score?: number | null;
  state_reason?: string | null;
  id?: string;
  status?: string;
  severity?: string;
  resolution_text?: string;
}

interface AnomaliesData {
  power: AnomalyEntry[];
  thermal: AnomalyEntry[];
  adcs: AnomalyEntry[];
  comms: AnomalyEntry[];
  other?: AnomalyEntry[];
}

function alertToEntry(a: TelemetryAlert): AnomalyEntry & { id: string } {
  return {
    name: a.channel_name,
    units: a.units ?? undefined,
    current_value: a.current_value,
    last_timestamp: a.opened_at,
    z_score: a.z_score ?? undefined,
    state_reason: a.reason ?? undefined,
    id: a.id,
    status: a.status,
    severity: a.severity,
    resolution_text: a.resolution_text ?? undefined,
  };
}

const SUBSYSTEM_LABELS: Record<string, string> = {
  power: "Power",
  thermal: "Thermal",
  adcs: "ADCS",
  comms: "Comms",
  other: "Other",
};

function alertsToAnomaliesData(active: TelemetryAlert[]): AnomaliesData {
  const known = ["power", "thermal", "adcs", "comms"] as const;
  const result: AnomaliesData = {
    power: [],
    thermal: [],
    adcs: [],
    comms: [],
    other: [],
  };
  for (const a of active) {
    const entry = alertToEntry(a);
    const sub = a.subsystem?.toLowerCase() ?? "other";
    const key = (
      known.includes(sub as (typeof known)[number]) ? sub : "other"
    ) as keyof AnomaliesData;
    const arr = result[key];
    if (arr) arr.push(entry);
  }
  return result;
}

const ALERT_PREVIEW_MAX = 5;

function anomaliesToAlertSummaries(data: AnomaliesData): AlertSummary[] {
  const groups: { entries: AnomalyEntry[]; label: string }[] = [
    { entries: data.power, label: SUBSYSTEM_LABELS.power },
    { entries: data.thermal, label: SUBSYSTEM_LABELS.thermal },
    { entries: data.adcs, label: SUBSYSTEM_LABELS.adcs },
    { entries: data.comms, label: SUBSYSTEM_LABELS.comms },
    { entries: data.other ?? [], label: SUBSYSTEM_LABELS.other },
  ];
  const out: AlertSummary[] = [];
  for (const { entries, label } of groups) {
    for (const e of entries) {
      if (out.length >= ALERT_PREVIEW_MAX) return out;
      out.push({ channelName: e.name, subsystem: label });
    }
  }
  return out;
}

function channelUpdateToOverview(ch: RealtimeChannelUpdate): OverviewChannel {
  return {
    name: ch.name,
    units: ch.units,
    description: ch.description,
    subsystem_tag: ch.subsystem_tag,
    current_value: ch.current_value,
    last_timestamp: ch.generation_time,
    state: ch.state,
    state_reason: ch.state_reason,
    z_score: ch.z_score,
    sparkline_data: ch.sparkline_data,
  };
}

interface TelemetrySource {
  id: string;
  name: string;
  description?: string | null;
}

interface SimulatorStatus {
  connected: boolean;
  state?: "idle" | "running" | "paused";
}

interface RealtimeOverviewWrapperProps {
  initialChannels: OverviewChannel[];
  initialAnomalies: AnomaliesData;
  hasError: boolean;
  sources: TelemetrySource[];
  initialSourceId: string;
  /** Current run id for feed status and live subscription (when source has multiple runs). */
  feedSourceId?: string;
  /** When set, we never sync sourceId to initialSourceId when it equals this (avoids reverting user selection to fallback while data loads). */
  defaultSourceId?: string;
  /** Pre-fetched simulator status for the initial source to avoid "Disconnected" flash. */
  initialSimulatorSourceId?: string | null;
  initialSimulatorStatus?: SimulatorStatus | null;
}

export function RealtimeOverviewWrapper({
  initialChannels,
  initialAnomalies,
  hasError,
  sources,
  initialSourceId,
  feedSourceId,
  defaultSourceId,
  initialSimulatorSourceId = null,
  initialSimulatorStatus = null,
}: RealtimeOverviewWrapperProps) {
  const [channels, setChannels] = useState(initialChannels);
  const [anomalies, setAnomalies] = useState(initialAnomalies);
  const [alerts, setAlerts] = useState<TelemetryAlert[]>([]);
  const [live, setLive] = useState(false);
  const [sourceId, setSourceId] = useState(initialSourceId);
  const lastUpdateAtRef = useRef<number | null>(null);
  const [client, setClient] = useState<RealtimeWsClient | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const effectiveRunId = feedSourceId ?? sourceId;

  useEffect(() => {
    if (defaultSourceId !== undefined && initialSourceId === defaultSourceId) return;
    setSourceId(initialSourceId);
  }, [initialSourceId, defaultSourceId]);

  const handleSourceChange = useCallback(
    (newId: string) => {
      setSourceId(newId);
      if (pathname === "/overview") {
        if (typeof window !== "undefined") {
          try {
            sessionStorage.setItem("overviewSourceId", newId);
          } catch {
            // ignore when storage unavailable (e.g. private browsing)
          }
        }
        router.replace(`${pathname}?source=${encodeURIComponent(newId)}`);
      }
    },
    [pathname, router]
  );

  const LIVE_STALE_MS = 15000;

  const handleMessage = useCallback(
    (msg: { type: string; channels?: RealtimeChannelUpdate[]; channel?: RealtimeChannelUpdate; active?: TelemetryAlert[]; event_type?: string; alert?: TelemetryAlert }) => {
      if (msg.type === "snapshot_watchlist" && msg.channels) {
        setChannels(msg.channels.map(channelUpdateToOverview));
      } else if (msg.type === "telemetry_update" && msg.channel) {
        lastUpdateAtRef.current = Date.now();
        setLive(true);
        setChannels((prev) => {
          const idx = prev.findIndex((c) => c.name === msg.channel!.name);
          const next = [...prev];
          if (idx >= 0) {
            next[idx] = channelUpdateToOverview(msg.channel!);
          } else {
            next.push(channelUpdateToOverview(msg.channel!));
          }
          return next;
        });
      } else if (msg.type === "snapshot_alerts" && msg.active) {
        setAlerts(msg.active);
        setAnomalies(alertsToAnomaliesData(msg.active));
      } else if (msg.type === "alert_event" && msg.alert) {
        lastUpdateAtRef.current = Date.now();
        setLive(true);
        const a = msg.alert;
        setAlerts((prev) => {
          const filtered = prev.filter((x) => x.id !== a.id);
          const next = [...filtered, a];
          const active = next.filter(
            (x) => !x.resolved_at && !x.cleared_at
          );
          setAnomalies(alertsToAnomaliesData(active));
          return next;
        });
      }
    },
    []
  );

  useEffect(() => {
    const c = new RealtimeWsClient();
    setClient(c);
    c.subscribe((msg) => handleMessage(msg as Parameters<typeof handleMessage>[0]));
    c.connect();
    return () => c.disconnect();
  }, []);

  useEffect(() => {
    if (!client) return;
    const channelNames = initialChannels.map((ch) => ch.name);
    // Subscribe to current run so live updates match overview data
    client.subscribeWatchlist(channelNames, effectiveRunId);
    client.subscribeAlerts(effectiveRunId);
  }, [client, effectiveRunId, initialChannels]);

  useEffect(() => {
    const interval = setInterval(() => {
      const at = lastUpdateAtRef.current;
      if (at !== null && Date.now() - at > LIVE_STALE_MS) {
        setLive(false);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const totalAlerts =
    anomalies.power.length +
    anomalies.thermal.length +
    anomalies.adcs.length +
    anomalies.comms.length +
    (anomalies.other?.length ?? 0);

  const alertSummaries = anomaliesToAlertSummaries(anomalies);

  return (
    <div className="space-y-4">
      <ContextBanner
        sourceId={sourceId}
        feedSourceId={feedSourceId}
        onSourceChange={handleSourceChange}
        sources={sources}
        activeAlertCount={totalAlerts}
        scrollToAlertsId="events-console"
        alertSummaries={alertSummaries}
        initialSimulatorSourceId={initialSimulatorSourceId ?? undefined}
        initialSimulatorStatus={initialSimulatorStatus ?? undefined}
      />
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Watchlist / Console</CardTitle>
              <div className="flex items-center gap-2">
                {live && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/20 dark:bg-green-500/30 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 dark:bg-green-400" />
                    Live
                  </span>
                )}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Key channels: power, thermal, ADCS, comms
            </p>
          </CardHeader>
          <CardContent>
            {channels.length === 0 ? (
              <EmptyState
                icon="chart"
                title="No channels in watchlist"
                description="Configure your watchlist to see key metrics here."
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {channels.map((ch) => (
                  <WatchlistCard
                    key={ch.name}
                    name={ch.name}
                    units={ch.units}
                    currentValue={ch.current_value}
                    lastTimestamp={ch.last_timestamp}
                    state={ch.state}
                    stateReason={ch.state_reason}
                    sparklineData={ch.sparkline_data}
                    sourceId={sourceId}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <NowPanel sourceId={sourceId} sinceMinutes={15} />
        <EventConsole
          anomalies={anomalies}
          alerts={alerts}
          sourceId={sourceId}
          onAck={
            client
              ? (id) => {
                  auditLog("alert.acked", { alert_id: id });
                  client.ackAlert(id);
                }
              : undefined
          }
          onResolve={
            client
              ? (id, text, code) => {
                  auditLog("alert.resolved", {
                    alert_id: id,
                    resolution_text: text,
                    resolution_code: code,
                  });
                  client.resolveAlert(id, text, code);
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}
