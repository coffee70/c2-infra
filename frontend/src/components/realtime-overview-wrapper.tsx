"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { auditLog } from "@/lib/audit-log";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { WatchlistCard } from "@/components/watchlist-card";
import { EventConsole } from "@/components/event-console";
import {
  ContextBanner,
  type AlertSummary,
} from "@/components/context-banner";
import { EmptyState } from "@/components/empty-state";
import { OverviewSearch } from "@/components/overview-search";
import { OpsEventHistory } from "@/components/ops-event-history";
import { TelemetryAlert, type RealtimeMessage } from "@/lib/realtime-ws-client";
import {
  RealtimeTelemetryProvider,
  useRealtimeTelemetry,
  type InitialChannelInput,
} from "@/lib/realtime-telemetry-context";
import { fetchOrbitStatus, type OrbitStatus } from "@/lib/orbit-client";
import { type SimulatorRuntimeStatus } from "@/lib/simulator-runtime";

interface OverviewChannel {
  name: string;
  units?: string | null;
  description?: string | null;
  subsystem_tag: string;
  current_value: number | null;
  last_timestamp: string | null;
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
  orbit?: AnomalyEntry[];
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

interface TelemetrySourceForOrbit {
  id: string;
  name: string;
}

function orbitAnomalyEntries(
  orbitStatusBySource: Record<string, OrbitStatus>,
  sources: TelemetrySourceForOrbit[]
): AnomalyEntry[] {
  const entries: AnomalyEntry[] = [];
  for (const src of sources) {
    const st = orbitStatusBySource[src.id];
    if (!st) continue;
    if (st.status === "VALID" || st.status === "INSUFFICIENT_DATA") continue;
    entries.push({
      name: `Orbit: ${src.name}`,
      current_value: 0,
      last_timestamp: new Date().toISOString(),
      state_reason: st.reason || st.status,
    });
  }
  return entries;
}

function alertsToAnomaliesData(
  active: TelemetryAlert[],
  orbitAnomalies: AnomalyEntry[] = []
): AnomaliesData {
  const known = ["power", "thermal", "adcs", "comms"] as const;
  const result: AnomaliesData = {
    power: [],
    thermal: [],
    adcs: [],
    comms: [],
    other: [],
    orbit: orbitAnomalies,
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
    { entries: data.orbit ?? [], label: "Orbit" },
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

/** Map LiveChannelState to OverviewChannel for the grid. */
function liveStateToOverviewChannel(c: {
  name: string;
  value: number | null;
  lastTimestamp: string | null;
  state: string;
  stateReason: string | null;
  zScore: number | null;
  units?: string | null;
  description?: string | null;
  subsystem_tag: string;
  liveData: { timestamp: string; value: number }[];
  sparkline_data: { timestamp: string; value: number }[];
}): OverviewChannel {
  return {
    name: c.name,
    units: c.units,
    description: c.description,
    subsystem_tag: c.subsystem_tag,
    current_value: c.value,
    last_timestamp: c.lastTimestamp,
    state: c.state,
    state_reason: c.stateReason,
    z_score: c.zScore,
    sparkline_data: c.liveData.length > 0 ? c.liveData : c.sparkline_data,
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
  /** Current run id for feed status and live subscription (when source has multiple runs). */
  feedSourceId?: string;
  /** When set, we never sync sourceId to initialSourceId when it equals this (avoids reverting user selection to fallback while data loads). */
  defaultSourceId?: string;
  /** Pre-fetched simulator status for the initial source to avoid "Disconnected" flash. */
  initialSimulatorSourceId?: string | null;
  initialSimulatorStatus?: SimulatorRuntimeStatus | null;
  simulatorStatus?: SimulatorRuntimeStatus | null;
  isSwitchingRuns?: boolean;
  showSwitchingIndicator?: boolean;
  onWatchlistChanged?: () => void | Promise<void>;
  watchlistVersion?: number;
}

type OverviewTabId = "watchlist" | "events-console" | "event-history";

function isOverviewTabId(value: string | null): value is OverviewTabId {
  return value === "watchlist" || value === "events-console" || value === "event-history";
}

export function RealtimeOverviewWrapper(props: RealtimeOverviewWrapperProps) {
  const {
    initialChannels,
    initialSourceId,
    feedSourceId,
  } = props;
  const effectiveRunId = feedSourceId ?? initialSourceId;
  const channelNames = useMemo(
    () => initialChannels.map((ch) => ch.name),
    [initialChannels]
  );
  const initialChannelsForProvider: InitialChannelInput[] = useMemo(
    () =>
      initialChannels.map((ch) => ({
        name: ch.name,
        current_value: ch.current_value,
        last_timestamp: ch.last_timestamp,
        state: ch.state,
        state_reason: ch.state_reason ?? null,
        z_score: ch.z_score ?? null,
        units: ch.units,
        description: ch.description,
        subsystem_tag: ch.subsystem_tag,
        sparkline_data: ch.sparkline_data,
      })),
    [initialChannels]
  );

  return (
    <RealtimeTelemetryProvider
      channelNames={channelNames}
      sourceId={effectiveRunId}
      vehicleId={initialSourceId}
      initialChannels={initialChannelsForProvider}
    >
      <RealtimeOverviewContent {...props} />
    </RealtimeTelemetryProvider>
  );
}

function RealtimeOverviewContent({
  initialAnomalies,
  sources,
  initialSourceId,
  feedSourceId,
  initialSimulatorSourceId = null,
  initialSimulatorStatus = null,
  simulatorStatus = null,
  isSwitchingRuns = false,
  showSwitchingIndicator = false,
  onWatchlistChanged,
  watchlistVersion = 0,
}: RealtimeOverviewWrapperProps) {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [currentHash, setCurrentHash] = useState<string>(
    typeof window !== "undefined" ? window.location.hash : ""
  );
  const effectiveRunId = feedSourceId ?? initialSourceId;
  const activeRunRef = useRef(effectiveRunId);
  const [alertStore, setAlertStore] = useState<{
    runId: string;
    alerts: TelemetryAlert[];
    hasLoaded: boolean;
  }>({
    runId: effectiveRunId,
    alerts: [],
    hasLoaded: false,
  });
  const [orbitStatusBySource, setOrbitStatusBySource] = useState<Record<string, OrbitStatus>>({});
  const [hasLoadedOrbitStatus, setHasLoadedOrbitStatus] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { channelsArray, isLive: live, client } = useRealtimeTelemetry();
  const sourceId = initialSourceId;
  const visibleAlertStore =
    alertStore.runId === effectiveRunId
      ? alertStore
      : {
          runId: effectiveRunId,
          alerts: [],
          hasLoaded: false,
        };

  const channels = useMemo(
    () => channelsArray.map(liveStateToOverviewChannel),
    [channelsArray]
  );
  const hashTab: OverviewTabId | null =
    currentHash === "#events-console"
      ? "events-console"
      : currentHash === "#event-history"
        ? "event-history"
        : currentHash === "#watchlist"
          ? "watchlist"
          : null;
  const activeTab: OverviewTabId = hashTab
    ?? (isOverviewTabId(requestedTab) ? requestedTab : "watchlist");

  useEffect(() => {
    activeRunRef.current = effectiveRunId;
  }, [effectiveRunId]);

  const selectTab = useCallback(
    (tab: OverviewTabId, options?: { preserveHash?: boolean }) => {
      const params = new URLSearchParams(window.location.search);
      params.set("tab", tab);
      const query = params.toString();
      const hash = options?.preserveHash ? window.location.hash : "";
      setCurrentHash(hash);
      router.replace(`${pathname}${query ? `?${query}` : ""}${hash}`);
    },
    [pathname, router, setCurrentHash]
  );

  useEffect(() => {
    const syncHash = () => {
      setCurrentHash(window.location.hash);
    };

    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [setAlertStore, setOrbitStatusBySource, setHasLoadedOrbitStatus]);

  useEffect(() => {
    if (!hashTab || requestedTab === hashTab) return;

    const params = new URLSearchParams(window.location.search);
    params.set("tab", hashTab);
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}${currentHash}`);
  }, [currentHash, hashTab, pathname, requestedTab, router]);

  const handleSourceChange = useCallback(
    (newId: string) => {
      if (pathname === "/overview") {
        if (typeof window !== "undefined") {
          try {
            sessionStorage.setItem("overviewSourceId", newId);
          } catch {
            // ignore when storage unavailable (e.g. private browsing)
          }
        }
        const params = new URLSearchParams(window.location.search);
        params.set("source", newId);
        const next = params.toString();
        router.replace(next ? `${pathname}?${next}` : pathname);
      }
    },
    [pathname, router]
  );

  const handleAlertsAndOrbit = useCallback((msg: RealtimeMessage) => {
    const runId = activeRunRef.current;
    if (msg.type === "snapshot_alerts" && msg.active) {
      setAlertStore({
        runId,
        alerts: msg.active,
        hasLoaded: true,
      });
    } else if (msg.type === "alert_event" && msg.alert) {
      const a = msg.alert;
      setAlertStore((prev) => {
        const baseAlerts = prev.runId === runId ? prev.alerts : [];
        const filtered = baseAlerts.filter((x) => x.id !== a.id);
        return {
          runId,
          alerts: [...filtered, a],
          hasLoaded: true,
        };
      });
    } else if (msg.type === "orbit_status") {
      setOrbitStatusBySource((prev) => ({
        ...prev,
        [msg.vehicle_id]: {
          source_id: msg.vehicle_id,
          status: msg.status,
          reason: msg.reason,
          orbit_type: msg.orbit_type ?? null,
          perigee_km: msg.perigee_km ?? null,
          apogee_km: msg.apogee_km ?? null,
          eccentricity: msg.eccentricity ?? null,
          velocity_kms: msg.velocity_kms ?? null,
          period_sec: msg.period_sec ?? null,
        },
      }));
      setHasLoadedOrbitStatus(true);
    }
  }, [setAlertStore, setOrbitStatusBySource, setHasLoadedOrbitStatus]);

  useEffect(() => {
    if (!client) return;
    const unsub = client.subscribe(handleAlertsAndOrbit);
    client.subscribeAlerts(feedSourceId ?? sourceId);
    return () => {
      unsub();
    };
  }, [client, feedSourceId, sourceId, handleAlertsAndOrbit]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await fetchOrbitStatus();
        if (cancelled) return;
        setOrbitStatusBySource(data ?? {});
        setHasLoadedOrbitStatus(true);
      } catch {
        if (!cancelled) {
          setOrbitStatusBySource({});
          setHasLoadedOrbitStatus(true);
        }
      }
    }
    load();
    const interval = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const anomalies = useMemo(() => {
    const activeAlerts = visibleAlertStore.alerts.filter(
      (x) => !x.resolved_at && !x.cleared_at
    );
    const orbitEntries = orbitAnomalyEntries(orbitStatusBySource, sources);
    if (!visibleAlertStore.hasLoaded && !hasLoadedOrbitStatus) {
      return initialAnomalies;
    }
    return alertsToAnomaliesData(activeAlerts, orbitEntries);
  }, [
    hasLoadedOrbitStatus,
    initialAnomalies,
    orbitStatusBySource,
    sources,
    visibleAlertStore.alerts,
    visibleAlertStore.hasLoaded,
  ]);

  const totalAlerts =
    anomalies.power.length +
    anomalies.thermal.length +
    anomalies.adcs.length +
    anomalies.comms.length +
    (anomalies.other?.length ?? 0) +
    (anomalies.orbit?.length ?? 0);

  const alertSummaries = anomaliesToAlertSummaries(anomalies);
  const handleAlertsClick = useCallback(() => {
    selectTab("events-console");
    window.requestAnimationFrame(() => {
      document.getElementById("events-console")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [selectTab]);

  return (
    <div className="space-y-4">
      <ContextBanner
        sourceId={sourceId}
        onSourceChange={handleSourceChange}
        sources={sources}
        activeAlertCount={totalAlerts}
        scrollToAlertsId="events-console"
        onAlertsClick={handleAlertsClick}
        alertSummaries={alertSummaries}
        initialSimulatorSourceId={initialSimulatorSourceId ?? undefined}
        initialSimulatorStatus={initialSimulatorStatus ?? undefined}
        simulatorStatus={simulatorStatus ?? undefined}
        isSwitchingRuns={showSwitchingIndicator}
      />
      <OverviewSearch
        sourceId={sourceId}
        sources={sources}
        onWatchlistChanged={onWatchlistChanged}
        watchlistVersion={watchlistVersion}
      />
      <div className="flex min-h-0 flex-col gap-6 md:flex-row md:gap-12">
        <aside className="shrink-0 md:sticky md:top-20 md:self-start">
          <nav
            className="flex gap-2 overflow-x-auto pb-1 text-sm text-muted-foreground md:flex-col md:gap-1 md:overflow-visible md:pb-0"
            aria-label="Overview sections"
            role="tablist"
          >
            {[
              { id: "watchlist" as const, label: "Watchlist" },
              { id: "events-console" as const, label: "Event Console" },
              { id: "event-history" as const, label: "Event History" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`rounded-md px-3 py-2 text-left whitespace-nowrap transition-colors md:-ml-3 ${
                  activeTab === tab.id
                    ? "bg-muted text-foreground font-medium"
                    : "hover:bg-muted/50 hover:text-foreground"
                }`}
                onClick={() => selectTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 justify-center">
          <div className="flex w-full max-w-5xl flex-col space-y-8">
            {activeTab === "watchlist" && (
              <div role="tabpanel" aria-label="Watchlist" className="w-full">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle>Watchlist</CardTitle>
                      <div className="flex items-center gap-2">
                        {live && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-500/30 dark:text-green-400">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 dark:bg-green-400" />
                            Live
                          </span>
                        )}
                        {showSwitchingIndicator && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            <Spinner className="size-3" />
                            Switching…
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Key channels: power, thermal, ADCS, comms
                    </p>
                  </CardHeader>
                  <CardContent className={isSwitchingRuns ? "opacity-80 transition-opacity" : undefined}>
                    {channels.length === 0 ? (
                      <EmptyState
                        icon="chart"
                        title="No channels in watchlist"
                        description="Configure your watchlist to see key metrics here."
                      />
                    ) : (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {channels.map((ch) => (
                          <WatchlistCard
                            key={ch.name}
                            name={ch.name}
                            units={ch.units}
                            currentValue={ch.current_value ?? Number.NaN}
                            lastTimestamp={ch.last_timestamp ?? ""}
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
            )}

            {activeTab === "events-console" && (
              <div role="tabpanel" aria-label="Event Console" className="w-full">
                <EventConsole
                  anomalies={anomalies}
                  alerts={visibleAlertStore.alerts}
                  sourceId={sourceId}
                  onAck={
                    client && !isSwitchingRuns
                      ? (id) => {
                          auditLog("alert.acked", { alert_id: id });
                          client.ackAlert(id);
                        }
                      : undefined
                  }
                  onResolve={
                    client && !isSwitchingRuns
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
            )}

            {activeTab === "event-history" && (
              <div role="tabpanel" aria-label="Event History" className="w-full">
                <OpsEventHistory vehicleId={sourceId} streamId={effectiveRunId} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
