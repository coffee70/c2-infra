"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  Settings2Icon,
} from "lucide-react";

import {
  fetchLatestPositions,
  fetchPositionConfig,
  formatPositionMappingSummary,
  type PositionSample,
  type PositionChannelMapping,
  type PositionHistoryEntry,
} from "@/lib/position-client";
import { fetchOrbitStatus, type OrbitStatus } from "@/lib/orbit-client";
import {
  fetchSimulatorRuntimeStatus,
  type SimulatorRuntimeStatus,
} from "@/lib/simulator-runtime";
import {
  fetchFeedStatus,
  type FeedState,
  type FeedStatus,
} from "@/lib/feed-status";
import { RealtimeWsClient } from "@/lib/realtime-ws-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FeedStatusBadge } from "@/components/feed-status-badge";
import {
  UpcomingObservationPreview,
  UpcomingObservationsCard,
} from "@/components/upcoming-observations-card";
import { PositionMappingConfig } from "@/components/position-mapping-config";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const EarthOverviewGlobe = dynamic(
  () => import("./earth-overview-globe").then((m) => m.EarthOverviewGlobe),
  { ssr: false }
);

interface TelemetrySource {
  id: string;
  name: string;
  description?: string | null;
  source_type?: string;
}

interface EarthOverviewViewProps {
  sources: TelemetrySource[];
  initialSelectedSourceId?: string;
  variant?: "panel" | "background";
}

const POLL_MS = 5000;
const MAX_POSITION_HISTORY_POINTS = 600;
const PLANNING_SHOW_ON_GLOBE_KEY = "planningShowOnGlobeIds";

type PlanningPanelTab = "view" | "observations";

export function EarthOverviewView({
  sources,
  initialSelectedSourceId,
}: EarthOverviewViewProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    const fallback =
      initialSelectedSourceId &&
      sources.some((s) => s.id === initialSelectedSourceId)
        ? [initialSelectedSourceId]
        : sources.map((s) => s.id);
    if (typeof window === "undefined") return fallback;
    try {
      const raw = sessionStorage.getItem(PLANNING_SHOW_ON_GLOBE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (
          Array.isArray(parsed) &&
          parsed.every((id): id is string => typeof id === "string")
        ) {
          const valid = parsed.filter((id) =>
            sources.some((s) => s.id === id)
          );
          if (valid.length > 0) return valid;
        }
      }
    } catch {
      // ignore
    }
    return fallback;
  });
  const [positions, setPositions] = useState<PositionSample[]>([]);
  const [positionHistoryBySource, setPositionHistoryBySource] = useState<
    Record<string, PositionHistoryEntry[]>
  >({});
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mappingsBySource, setMappingsBySource] = useState<
    Record<string, PositionChannelMapping | null>
  >({});
  const [allMappingsLoading, setAllMappingsLoading] = useState(true);
  const [panelTab, setPanelTab] = useState<PlanningPanelTab>("view");
  const [mappingDialogOpen, setMappingDialogOpen] = useState(false);
  const [expandedObservationSourceId, setExpandedObservationSourceId] =
    useState<string | null>(null);
  const [orbitStatusBySource, setOrbitStatusBySource] = useState<
    Record<string, OrbitStatus>
  >({});
  const [simulatorRuntimeBySource, setSimulatorRuntimeBySource] = useState<
    Record<string, SimulatorRuntimeStatus>
  >({});
  const [feedStatusBySource, setFeedStatusBySource] = useState<
    Record<string, FeedStatus>
  >({});

  const loadAllMappings = useCallback(async () => {
    setAllMappingsLoading(true);
    try {
      const configs = await fetchPositionConfig();
      const bySource: Record<string, PositionChannelMapping | null> = {};
      for (const source of sources) bySource[source.id] = null;
      for (const mapping of configs) {
        const sourceKey = mapping.vehicle_id;
        if (sourceKey && sourceKey in bySource) {
          bySource[sourceKey] = mapping;
        }
      }
      setMappingsBySource(bySource);
    } catch {
      // Keep the globe usable even when mapping metadata is temporarily unavailable.
    } finally {
      setAllMappingsLoading(false);
    }
  }, [sources]);

  useEffect(() => {
    if (sources.length === 0) return;
    loadAllMappings();
  }, [sources.length, loadAllMappings]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (selectedIds.length === 0) {
        setFeedStatusBySource({});
        return;
      }

      const entries = await Promise.all(
        selectedIds.map(async (sourceId) => {
          try {
            const status = await fetchFeedStatus(sourceId);
            return [sourceId, status] as const;
          } catch {
            return [sourceId, null] as const;
          }
        })
      );
      if (cancelled) return;
      const next: Record<string, FeedStatus> = {};
      for (const [sourceId, status] of entries) {
        if (status) next[sourceId] = status;
      }
      setFeedStatusBySource(next);
    }
    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedIds]);

  useEffect(() => {
    setFeedStatusBySource((prev) => {
      const next = { ...prev };
      const selected = new Set(selectedIds);
      for (const sourceId of Object.keys(next)) {
        if (!selected.has(sourceId)) delete next[sourceId];
      }
      return next;
    });
  }, [selectedIds]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const simulatorIds = selectedIds.filter(
        (id) =>
          sources.find((source) => source.id === id)?.source_type ===
          "simulator"
      );
      if (simulatorIds.length === 0) {
        if (!cancelled) setSimulatorRuntimeBySource({});
        return;
      }

      const entries = await Promise.all(
        simulatorIds.map(async (sourceId) => {
          try {
            const status = await fetchSimulatorRuntimeStatus(sourceId);
            return [sourceId, status] as const;
          } catch {
            return [sourceId, { connected: false }] as const;
          }
        })
      );
      if (cancelled) return;
      setSimulatorRuntimeBySource(
        Object.fromEntries(entries) as Record<string, SimulatorRuntimeStatus>
      );
    }
    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedIds, sources]);

  const effectiveStreamIdBySource = useMemo(() => {
    const next: Record<string, string> = {};
    for (const source of sources) {
      const runtime = simulatorRuntimeBySource[source.id];
      const activeStreamId =
        source.source_type === "simulator" &&
        runtime?.connected === true &&
        runtime.state != null &&
        runtime.state !== "idle"
          ? runtime.config?.stream_id ?? null
          : null;
      next[source.id] = activeStreamId ?? source.id;
    }
    return next;
  }, [sources, simulatorRuntimeBySource]);

  const logicalSourceIdByOrbitSourceId = useMemo(() => {
    const next: Record<string, string> = {};
    for (const sourceId of selectedIds) {
      next[sourceId] = sourceId;
      const effectiveStreamId = effectiveStreamIdBySource[sourceId] ?? sourceId;
      next[effectiveStreamId] = sourceId;
    }
    return next;
  }, [effectiveStreamIdBySource, selectedIds]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (selectedIds.length === 0) {
        setOrbitStatusBySource({});
        return;
      }

      const entries = await Promise.all(
        selectedIds.map(async (sourceId) => {
          try {
            const data = await fetchOrbitStatus(sourceId);
            const status = data?.[sourceId];
            if (!status) {
              return [sourceId, null] as const;
            }
            return [
              sourceId,
              {
                ...status,
                vehicle_id: sourceId,
              },
            ] as const;
          } catch {
            return [sourceId, null] as const;
          }
        })
      );
      if (cancelled) return;
      const next: Record<string, OrbitStatus> = {};
      for (const [sourceId, status] of entries) {
        if (status) next[sourceId] = status;
      }
      setOrbitStatusBySource(next);
    }
    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedIds]);

  useEffect(() => {
    const client = new RealtimeWsClient();
    const handler = (msg: {
      type: string;
      vehicle_id?: string;
      status?: string;
      reason?: string;
      orbit_type?: string | null;
      perigee_km?: number | null;
      apogee_km?: number | null;
      eccentricity?: number | null;
      velocity_kms?: number | null;
      period_sec?: number | null;
    }) => {
      if (msg.type === "orbit_status" && msg.vehicle_id != null) {
        const logicalSourceId = logicalSourceIdByOrbitSourceId[msg.vehicle_id];
        if (!logicalSourceId) return;
        setOrbitStatusBySource((prev) => ({
          ...prev,
          [logicalSourceId]: {
            vehicle_id: logicalSourceId,
            status: msg.status ?? "",
            reason: msg.reason ?? "",
            orbit_type: msg.orbit_type ?? null,
            perigee_km: msg.perigee_km ?? null,
            apogee_km: msg.apogee_km ?? null,
            eccentricity: msg.eccentricity ?? null,
            velocity_kms: msg.velocity_kms ?? null,
            period_sec: msg.period_sec ?? null,
          },
        }));
      }
    };
    client.subscribe(handler);
    client.connect();
    return () => client.disconnect();
  }, [logicalSourceIdByOrbitSourceId]);

  useEffect(() => {
    let cancelled = false;
    async function loadOnce() {
      try {
        if (selectedIds.length === 0) {
          setPositions([]);
          return;
        }
        const data = await fetchLatestPositions(selectedIds);
        if (cancelled) return;
        setPositions(data);
        setPositionHistoryBySource((prev) => {
          const next = { ...prev };
          for (const position of data) {
            if (
              position.valid &&
              position.lat_deg != null &&
              position.lon_deg != null &&
              typeof position.lat_deg === "number" &&
              typeof position.lon_deg === "number"
            ) {
              const entry: PositionHistoryEntry = {
                lat_deg: position.lat_deg,
                lon_deg: position.lon_deg,
                alt_m:
                  typeof position.alt_m === "number" ? position.alt_m : 0,
                timestamp: position.timestamp ?? undefined,
              };
              const sourceKey = position.vehicle_id;
              if (!sourceKey) continue;
              const history = [...(next[sourceKey] ?? []), entry];
              next[sourceKey] = history.slice(-MAX_POSITION_HISTORY_POINTS);
            }
          }
          return next;
        });
        setLastUpdated(new Date());
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Failed to load latest positions"
          );
        }
      }
    }
    loadOnce();
    const interval = setInterval(loadOnce, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedIds]);

  useEffect(() => {
    setPositionHistoryBySource((prev) => {
      const selected = new Set(selectedIds);
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        if (!selected.has(id)) delete next[id];
      }
      return next;
    });
  }, [selectedIds]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(
        PLANNING_SHOW_ON_GLOBE_KEY,
        JSON.stringify(selectedIds)
      );
    } catch {
      // ignore when storage unavailable (e.g. private browsing)
    }
  }, [selectedIds]);

  const effectivePositions = useMemo(() => {
    if (selectedIds.length === 0) return [];
    const selected = new Set(selectedIds);
    return positions.filter((position) => selected.has(position.vehicle_id));
  }, [positions, selectedIds]);

  const effectivePositionHistory = useMemo(() => {
    const acc: Record<string, PositionHistoryEntry[]> = {};
    for (const id of selectedIds) {
      const history = positionHistoryBySource[id];
      if (history?.length) acc[id] = history;
    }
    return acc;
  }, [selectedIds, positionHistoryBySource]);

  const toggleSource = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const isSourceSelected = useCallback(
    (id: string) => selectedIds.includes(id),
    [selectedIds]
  );

  const feedStateBySource = useMemo<Record<string, FeedState>>(() => {
    const next: Record<string, FeedState> = {};
    for (const source of sources) {
      const runtime = simulatorRuntimeBySource[source.id];
      if (
        source.source_type === "simulator" &&
        (runtime?.connected === false || runtime?.state === "idle")
      ) {
        next[source.id] = "disconnected";
        continue;
      }
      next[source.id] = feedStatusBySource[source.id]?.state ?? "disconnected";
    }
    return next;
  }, [feedStatusBySource, simulatorRuntimeBySource, sources]);

  return (
    <div className="absolute inset-0 h-full min-h-0 w-full min-w-0">
      <div className="relative h-full min-h-0 w-full min-w-0">
        {sources.length > 0 && (
          <div className="pointer-events-auto absolute top-4 left-4 z-20 max-w-lg">
            <Card className="bg-background/90 border-border/70 border shadow-lg backdrop-blur-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm">Earth view</CardTitle>
                  <div className="flex items-center gap-2">
                    {lastUpdated && (
                      <div className="text-muted-foreground text-[11px]">
                        {lastUpdated.toLocaleTimeString()}
                      </div>
                    )}
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => setMappingDialogOpen(true)}
                            aria-label="Configure position mappings"
                            data-testid="planning-position-mapping-configure"
                          >
                            <Settings2Icon className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          Configure position mappings
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="max-h-[calc(100dvh-6rem)] space-y-4 overflow-y-auto pt-0">
                {(() => {
                  const anomalySources = selectedIds.filter((id) => {
                    const mapping = mappingsBySource[id];
                    const status = orbitStatusBySource[id];
                    if (!mapping || !status) return false;
                    return (
                      status.status !== "VALID" &&
                      status.status !== "INSUFFICIENT_DATA"
                    );
                  });
                  if (anomalySources.length === 0) return null;
                  const first = anomalySources[0];
                  const source = sources.find((s) => s.id === first);
                  const status = orbitStatusBySource[first];
                  return (
                    <Alert variant="destructive" className="py-2">
                      <AlertDescription className="text-xs">
                        <span className="font-medium">Orbit anomaly</span>
                        {source && status && (
                          <> - {source.name}: {status.reason || status.status}</>
                        )}
                      </AlertDescription>
                    </Alert>
                  );
                })()}

                <div
                  role="tablist"
                  aria-label="Planning panel sections"
                  className="bg-muted/50 grid grid-cols-2 rounded-md p-1"
                >
                  {(
                    [
                      ["view", "View"],
                      ["observations", "Observations"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      id={`planning-tab-${value}`}
                      type="button"
                      role="tab"
                      aria-selected={panelTab === value}
                      aria-controls={`planning-tabpanel-${value}`}
                      onClick={() => setPanelTab(value as PlanningPanelTab)}
                      className={`rounded-sm px-3 py-1.5 text-xs font-medium ${
                        panelTab === value
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="contents">
                  <div className="min-h-0 overflow-hidden">
                    <div
                      className="space-y-2"
                      role="tabpanel"
                      id="planning-tabpanel-view"
                      aria-labelledby="planning-tab-view"
                      hidden={panelTab !== "view"}
                    >
                      <div>
                        <p className="text-muted-foreground text-xs font-medium">
                          Vehicles visible on globe
                        </p>
                        <p className="text-muted-foreground text-[11px]">
                          Click a row to toggle its marker and recent trail.
                        </p>
                      </div>

                      {error && (
                        <p className="text-destructive text-[11px]">
                          Positions: {error}
                        </p>
                      )}

                      {allMappingsLoading ? (
                        <div className="text-muted-foreground flex items-center gap-2 py-3 text-xs">
                          <Spinner size="sm" />
                          Loading mappings...
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {sources.map((source) => {
                            const mapping = mappingsBySource[source.id] ?? null;
                            const visible = isSourceSelected(source.id);
                            const typeLabel =
                              source.source_type === "simulator"
                                ? "Simulator"
                                : "Vehicle";
                            const status = mapping
                              ? orbitStatusBySource[source.id]
                              : null;
                            const isAnomaly =
                              status != null &&
                              status.status !== "VALID" &&
                              status.status !== "INSUFFICIENT_DATA";

                            return (
                              <button
                                key={source.id}
                                type="button"
                                data-testid={`planning-source-row-${source.id}`}
                                aria-pressed={visible}
                                onClick={() => toggleSource(source.id)}
                                className={`hover:bg-accent/60 flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-xs transition ${
                                  visible
                                    ? "border-primary/60 bg-primary/10"
                                    : "border-border/70 bg-background/60 opacity-75"
                                }`}
                              >
                                {visible ? (
                                  <EyeIcon className="text-primary mt-0.5 size-3.5 shrink-0" />
                                ) : (
                                  <EyeOffIcon className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                                )}
                                <span className="min-w-0 flex-1">
                                  <span className="flex min-w-0 items-center gap-1.5">
                                    <span className="truncate font-medium">
                                      {source.name}
                                    </span>
                                    <Badge
                                      variant="outline"
                                      className="shrink-0 text-[9px] uppercase"
                                    >
                                      {typeLabel}
                                    </Badge>
                                    {visible && (
                                      <FeedStatusBadge
                                        state={
                                          feedStateBySource[source.id] ??
                                          "disconnected"
                                        }
                                        className="shrink-0"
                                      />
                                    )}
                                  </span>
                                  <span className="text-muted-foreground mt-1 block truncate text-[11px]">
                                    {mapping
                                      ? formatPositionMappingSummary(mapping)
                                      : "Not configured"}
                                  </span>
                                </span>
                                {status && (
                                  <Badge
                                    variant={isAnomaly ? "destructive" : "secondary"}
                                    className="mt-0.5 shrink-0 text-[9px]"
                                    title={status.reason || status.status}
                                  >
                                    {isAnomaly
                                      ? status.status.replace(/_/g, " ")
                                      : status.orbit_type ?? "OK"}
                                  </Badge>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="min-h-0 overflow-hidden">
                    <div
                      className="space-y-2"
                      role="tabpanel"
                      id="planning-tabpanel-observations"
                      aria-labelledby="planning-tab-observations"
                      hidden={panelTab !== "observations"}
                    >
                      <div>
                        <p className="text-muted-foreground text-xs font-medium">
                          Upcoming observations
                        </p>
                        <p className="text-muted-foreground text-[11px]">
                          Expand a vehicle to inspect expected contact windows.
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        {sources.map((source) => {
                          const isExpanded =
                            expandedObservationSourceId === source.id;
                          const typeLabel =
                            source.source_type === "simulator"
                              ? "Simulator"
                              : "Vehicle";
                          return (
                            <div
                              key={source.id}
                              className="bg-muted/30 border-border/40 rounded-md border"
                            >
                              <button
                                type="button"
                                data-testid={`planning-observations-row-${source.id}`}
                                aria-expanded={isExpanded}
                                onClick={() =>
                                  setExpandedObservationSourceId((prev) =>
                                    prev === source.id ? null : source.id
                                  )
                                }
                                className="hover:bg-accent/50 flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-xs transition"
                              >
                                {isExpanded ? (
                                  <ChevronDownIcon className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                                ) : (
                                  <ChevronRightIcon className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                                )}
                                <span className="min-w-0 flex-1">
                                  <span className="flex min-w-0 items-center gap-1.5">
                                    <span className="truncate font-medium">
                                      {source.name}
                                    </span>
                                    <Badge
                                      variant="outline"
                                      className="shrink-0 text-[9px] uppercase"
                                    >
                                      {typeLabel}
                                    </Badge>
                                  </span>
                                  <span className="text-muted-foreground mt-1 block truncate text-[11px]">
                                    <UpcomingObservationPreview
                                      sourceId={source.id}
                                    />
                                  </span>
                                </span>
                              </button>
                              <div
                                className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                                style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
                              >
                                <div className="min-h-0 overflow-hidden">
                                  <div className="px-3 pb-3">
                                    <UpcomingObservationsCard
                                      sourceId={source.id}
                                      title={`${source.name} observations`}
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <PositionMappingConfig
              sources={sources}
              open={mappingDialogOpen}
              onOpenChange={setMappingDialogOpen}
              initialSourceId={selectedIds[0] ?? sources[0]?.id ?? null}
              onMappingsChange={loadAllMappings}
            />
          </div>
        )}

        <div className="absolute inset-0 min-h-0 min-w-0">
          <EarthOverviewGlobe
            positions={effectivePositions}
            positionHistoryBySource={effectivePositionHistory}
          />
        </div>
      </div>
    </div>
  );
}
