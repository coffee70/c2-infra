"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WatchlistCard } from "@/components/watchlist-card";
import { EventConsole } from "@/components/event-console";
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

interface RealtimeOverviewWrapperProps {
  initialChannels: OverviewChannel[];
  initialAnomalies: AnomaliesData;
  hasError: boolean;
  sources: TelemetrySource[];
  initialSourceId: string;
}

export function RealtimeOverviewWrapper({
  initialChannels,
  initialAnomalies,
  hasError,
  sources,
  initialSourceId,
}: RealtimeOverviewWrapperProps) {
  const [channels, setChannels] = useState(initialChannels);
  const [anomalies, setAnomalies] = useState(initialAnomalies);
  const [alerts, setAlerts] = useState<TelemetryAlert[]>([]);
  const [live, setLive] = useState(false);
  const [sourceId, setSourceId] = useState(initialSourceId);
  const lastUpdateAtRef = useRef<number | null>(null);
  const [client, setClient] = useState<RealtimeWsClient | null>(null);

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
    if (channelNames.length > 0) {
      client.subscribeWatchlist(channelNames, sourceId);
    }
    client.subscribeAlerts(sourceId);
  }, [client, sourceId, initialChannels]);

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
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Watchlist / Console</CardTitle>
              <div className="flex items-center gap-2">
                {sources.length > 1 && (
                  <select
                    value={sourceId}
                    onChange={(e) => setSourceId(e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 py-1 text-xs"
                  >
                    {sources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
                {live && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
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
      </div>
      <div>
        <EventConsole
          anomalies={anomalies}
          alerts={alerts}
          sourceId={sourceId}
          onAck={client ? (id) => client.ackAlert(id) : undefined}
          onResolve={
            client
              ? (id, text, code) => client.resolveAlert(id, text, code)
              : undefined
          }
        />
      </div>
    </div>
  );
}
