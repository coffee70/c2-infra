"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import {
  fetchLatestPositions,
  fetchPositionConfig,
  upsertPositionConfig,
  deletePositionConfig,
  type PositionSample,
  type PositionChannelMapping,
  type PositionHistoryEntry,
} from "@/lib/position-client";
import {
  fetchOrbitStatus,
  type OrbitStatus,
} from "@/lib/orbit-client";
import {
  fetchSimulatorRuntimeStatus,
  type SimulatorRuntimeStatus,
} from "@/lib/simulator-runtime";
import { RealtimeWsClient } from "@/lib/realtime-ws-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const EarthOverviewGlobe = dynamic(
  () => import("./earth-overview-globe").then((m) => m.EarthOverviewGlobe),
  { ssr: false }
);

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface TelemetrySource {
  id: string;
  name: string;
  description?: string | null;
  source_type?: string;
}

interface EarthOverviewViewProps {
  sources: TelemetrySource[];
  initialSelectedSourceId: string;
  variant?: "panel" | "background";
}

const POLL_MS = 5000;
const MAX_POSITION_HISTORY_POINTS = 600;
const SUGGESTIONS_ID = "earth-view-position-channel-suggestions";
const PLANNING_SHOW_ON_GLOBE_KEY = "planningShowOnGlobeIds";

function mappingSummary(m: PositionChannelMapping): string {
  if (m.frame_type === "gps_lla") {
    const parts = [m.lat_channel_name, m.lon_channel_name].filter(Boolean);
    if (m.alt_channel_name) parts.push(m.alt_channel_name);
    return parts.length ? `GPS: ${parts.join(", ")}` : "GPS (no channels)";
  }
  const parts = [m.x_channel_name, m.y_channel_name, m.z_channel_name].filter(Boolean);
  return parts.length ? `${m.frame_type.toUpperCase()}: ${parts.join(", ")}` : `${m.frame_type.toUpperCase()} (no channels)`;
}

export function EarthOverviewView({
  sources,
  initialSelectedSourceId,
}: EarthOverviewViewProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    const fallback = sources.some((s) => s.id === initialSelectedSourceId)
      ? [initialSelectedSourceId]
      : sources.map((s) => s.id);
    if (typeof window === "undefined") return fallback;
    try {
      const raw = sessionStorage.getItem(PLANNING_SHOW_ON_GLOBE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every((id): id is string => typeof id === "string")) {
          const valid = parsed.filter((id) => sources.some((s) => s.id === id));
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

  const [mappingsBySource, setMappingsBySource] = useState<Record<string, PositionChannelMapping | null>>({});
  const [allMappingsLoading, setAllMappingsLoading] = useState(true);
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);
  const [frameType, setFrameType] = useState<string>("gps_lla");
  const [latChannel, setLatChannel] = useState("");
  const [lonChannel, setLonChannel] = useState("");
  const [altChannel, setAltChannel] = useState("");
  const [xChannel, setXChannel] = useState("");
  const [yChannel, setYChannel] = useState("");
  const [zChannel, setZChannel] = useState("");
  const [allChannelNames, setAllChannelNames] = useState<string[]>([]);
  const [savingSourceId, setSavingSourceId] = useState<string | null>(null);
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [orbitStatusBySource, setOrbitStatusBySource] = useState<Record<string, OrbitStatus>>({});
  const [simulatorRuntimeBySource, setSimulatorRuntimeBySource] = useState<
    Record<string, SimulatorRuntimeStatus>
  >({});

  const loadAllMappings = useCallback(async () => {
    setAllMappingsLoading(true);
    try {
      const configs = await fetchPositionConfig();
      const bySource: Record<string, PositionChannelMapping | null> = {};
      for (const s of sources) bySource[s.id] = null;
      for (const m of configs) {
        const sourceKey = m.vehicle_id;
        if (sourceKey && sourceKey in bySource) bySource[sourceKey] = m;
      }
      setMappingsBySource(bySource);
    } catch {
      // ignore
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
      const simulatorIds = selectedIds.filter(
        (id) => sources.find((source) => source.id === id)?.source_type === "simulator"
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
    const handler = (msg: { type: string; vehicle_id?: string; status?: string; reason?: string; orbit_type?: string | null; perigee_km?: number | null; apogee_km?: number | null; eccentricity?: number | null; velocity_kms?: number | null; period_sec?: number | null }) => {
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
          for (const p of data) {
            if (
              p.valid &&
              p.lat_deg != null &&
              p.lon_deg != null &&
              typeof p.lat_deg === "number" &&
              typeof p.lon_deg === "number"
            ) {
              const entry: PositionHistoryEntry = {
                lat_deg: p.lat_deg,
                lon_deg: p.lon_deg,
                alt_m: typeof p.alt_m === "number" ? p.alt_m : 0,
                timestamp: p.timestamp ?? undefined,
              };
              const sourceKey = p.vehicle_id;
              if (!sourceKey) continue;
              const arr = [...(next[sourceKey] ?? []), entry];
              next[sourceKey] = arr.slice(-MAX_POSITION_HISTORY_POINTS);
            }
          }
          return next;
        });
        setLastUpdated(new Date());
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load latest positions");
      }
    }
    loadOnce();
    const interval = setInterval(loadOnce, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedIds, sources]);

  useEffect(() => {
    setPositionHistoryBySource((prev) => {
      const set = new Set(selectedIds);
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        if (!set.has(id)) delete next[id];
      }
      return next;
    });
  }, [selectedIds]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(PLANNING_SHOW_ON_GLOBE_KEY, JSON.stringify(selectedIds));
    } catch {
      // ignore when storage unavailable (e.g. private browsing)
    }
  }, [selectedIds]);

  useEffect(() => {
    if (!expandedSourceId) return;
    const m = mappingsBySource[expandedSourceId] ?? null;
    const ft = m?.frame_type ?? "gps_lla";
    setFrameType(ft);
    setLatChannel(m?.lat_channel_name ?? "");
    setLonChannel(m?.lon_channel_name ?? "");
    setAltChannel(m?.alt_channel_name ?? "");
    setXChannel(m?.x_channel_name ?? "");
    setYChannel(m?.y_channel_name ?? "");
    setZChannel(m?.z_channel_name ?? "");
  }, [expandedSourceId, mappingsBySource]);

  useEffect(() => {
    const catalogSourceId = expandedSourceId ?? sources[0]?.id;
    if (!catalogSourceId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_URL}/telemetry/list?source_id=${encodeURIComponent(catalogSourceId)}`,
          { cache: "no-store" }
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setAllChannelNames(Array.isArray(data?.names) ? data.names : []);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [expandedSourceId, sources]);

  const liveStatus = useMemo(() => {
    return positions.some((p) => p.valid) ? "live" : "stale";
  }, [positions]);

  const effectivePositions = useMemo(() => {
    if (selectedIds.length === 0) return [];
    const set = new Set(selectedIds);
    return positions.filter((p) => set.has(p.vehicle_id));
  }, [positions, selectedIds]);

  const effectivePositionHistory = useMemo(() => {
    const acc: Record<string, PositionHistoryEntry[]> = {};
    for (const id of selectedIds) {
      const hist = positionHistoryBySource[id];
      if (hist?.length) acc[id] = hist;
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

  const canSaveMapping = useMemo(() => {
    if (frameType === "gps_lla") {
      const lat = latChannel.trim();
      const lon = lonChannel.trim();
      return lat.length > 0 && lon.length > 0;
    }
    const x = xChannel.trim();
    const y = yChannel.trim();
    const z = zChannel.trim();
    return x.length > 0 && y.length > 0 && z.length > 0;
  }, [frameType, latChannel, lonChannel, xChannel, yChannel, zChannel]);

  async function handleSaveMapping(sourceId: string) {
    const src = sources.find((s) => s.id === sourceId);
    if (!src) return;
    if (!canSaveMapping) {
      setMappingError(
        frameType === "gps_lla"
          ? "Latitude and longitude channel names are required."
          : "X, Y, and Z channel names are required."
      );
      return;
    }
    setSavingSourceId(sourceId);
    setMappingError(null);
    try {
      const lat = latChannel.trim() || null;
      const lon = lonChannel.trim() || null;
      const alt = altChannel.trim() || null;
      const x = xChannel.trim() || null;
      const y = yChannel.trim() || null;
      const z = zChannel.trim() || null;
      const saved = await upsertPositionConfig({
        vehicle_id: src.id,
        frame_type: frameType,
        lat_channel_name: frameType === "gps_lla" ? lat : null,
        lon_channel_name: frameType === "gps_lla" ? lon : null,
        alt_channel_name: frameType === "gps_lla" ? alt : null,
        x_channel_name: frameType !== "gps_lla" ? x : null,
        y_channel_name: frameType !== "gps_lla" ? y : null,
        z_channel_name: frameType !== "gps_lla" ? z : null,
      });
      setMappingsBySource((prev) => ({ ...prev, [sourceId]: saved }));
    } catch (e) {
      setMappingError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingSourceId(null);
    }
  }

  async function handleRemoveMapping(sourceId: string, mapping: PositionChannelMapping) {
    setDeletingSourceId(sourceId);
    setMappingError(null);
    try {
      await deletePositionConfig(mapping.id);
      setMappingsBySource((prev) => ({ ...prev, [sourceId]: null }));
      if (expandedSourceId === sourceId) {
        setLatChannel("");
        setLonChannel("");
        setAltChannel("");
        setXChannel("");
        setYChannel("");
        setZChannel("");
        setFrameType("gps_lla");
      }
    } catch (e) {
      setMappingError(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setDeletingSourceId(null);
    }
  }

  const showOnGlobeLabel = useMemo(() => {
    if (sources.length === 0) return "No sources";
    if (selectedIds.length === 0) return "No sources";
    if (selectedIds.length === sources.length) return "All sources";
    if (selectedIds.length === 1) {
      const s = sources.find((x) => x.id === selectedIds[0]);
      return s ? s.name : "1 source";
    }
    return `${selectedIds.length} sources`;
  }, [sources, selectedIds]);

  return (
    <div className="absolute inset-0 w-full h-full min-h-0 min-w-0">
      <div className="relative w-full h-full min-h-0 min-w-0">
        {sources.length > 0 && (
          <div className="pointer-events-auto absolute top-4 left-4 z-20 max-w-md">
            <Card className="bg-background/90 backdrop-blur-sm border border-border/70 shadow-lg">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm">Earth view</CardTitle>
                  <div className="flex items-center gap-2 text-[11px]">
                    {liveStatus === "live" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/20 dark:bg-green-500/30 px-2 py-0.5 font-medium text-green-700 dark:text-green-400">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 dark:bg-green-400" />
                        Live
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 dark:bg-amber-500/30 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-300" />
                        Stale
                      </span>
                    )}
                    {lastUpdated && (
                      <span className="text-muted-foreground">{lastUpdated.toLocaleTimeString()}</span>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-5">
                {/* Orbit anomaly banner: when any visible + mapped source has orbit anomaly */}
                {(() => {
                  const anomalySources = selectedIds.filter((id) => {
                    const m = mappingsBySource[id];
                    const st = orbitStatusBySource[id];
                    if (!m || !st) return false;
                    const s = st.status;
                    return s !== "VALID" && s !== "INSUFFICIENT_DATA";
                  });
                  if (anomalySources.length === 0) return null;
                  const first = anomalySources[0];
                  const src = sources.find((s) => s.id === first);
                  const st = orbitStatusBySource[first];
                  return (
                    <Alert variant="destructive" className="py-2">
                      <AlertDescription className="text-xs">
                        <span className="font-medium">Orbit anomaly</span>
                        {src && st && (
                          <> — {src.name}: {st.reason || st.status}</>
                        )}
                      </AlertDescription>
                    </Alert>
                  );
                })()}

                {/* Section 1: Which sources are shown on the globe (independent of config) */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Show on globe</p>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-full justify-between text-xs font-normal px-3"
                      >
                        <span className="truncate">{showOnGlobeLabel}</span>
                        <ChevronDownIcon className="size-3.5 opacity-50 shrink-0" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-(--radix-popper-anchor-width)">
                      {sources.map((src) => {
                        const typeLabel = src.source_type === "simulator" ? "Simulator" : "Vehicle";
                        return (
                          <DropdownMenuCheckboxItem
                            key={src.id}
                            checked={isSourceSelected(src.id)}
                            onSelect={(e) => {
                              e.preventDefault();
                              toggleSource(src.id);
                            }}
                            className="text-xs"
                          >
                            <span className="truncate">{src.name}</span>
                            <Badge variant="outline" className="ml-1 text-[9px] uppercase shrink-0">
                              {typeLabel}
                            </Badge>
                          </DropdownMenuCheckboxItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {error && <p className="text-[11px] text-destructive">Positions: {error}</p>}
                </div>

                {/* Section 2: Position mapping per source (independent of visibility) */}
                <div className="border-t pt-5">
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Position mapping
                  </p>
                  <p className="text-[11px] text-muted-foreground mb-3">
                    Configure frame and channels for each source. Visibility above is separate.
                  </p>
                  {allMappingsLoading ? (
                    <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                      <Spinner size="sm" />
                      Loading mappings…
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {sources.map((src) => {
                        const m = mappingsBySource[src.id] ?? null;
                        const typeLabel = src.source_type === "simulator" ? "Simulator" : "Vehicle";
                        const open = expandedSourceId === src.id;
                        return (
                          <Collapsible
                            key={src.id}
                            open={open}
                            onOpenChange={(o) => setExpandedSourceId(o ? src.id : null)}
                          >
                            <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md border border-transparent px-3 py-2 text-left text-xs hover:bg-accent/50 hover:border-border data-[state=open]:border-border data-[state=open]:bg-accent/50">
                              {open ? (
                                <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
                              ) : (
                                <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                              )}
                              <span className="truncate font-medium">{src.name}</span>
                              <Badge variant="outline" className="text-[9px] uppercase shrink-0">
                                {typeLabel}
                              </Badge>
                              <span className="ml-auto truncate text-[11px] text-muted-foreground">
                                {m ? mappingSummary(m) : "Not configured"}
                              </span>
                              {m && (() => {
                                const st = orbitStatusBySource[src.id];
                                if (!st) return null;
                                const isAnomaly = st.status !== "VALID" && st.status !== "INSUFFICIENT_DATA";
                                return (
                                  <Badge
                                    variant={isAnomaly ? "destructive" : "secondary"}
                                    className="ml-1.5 text-[9px] shrink-0"
                                    title={st.reason || st.status}
                                  >
                                    {isAnomaly ? st.status.replace(/_/g, " ") : (st.orbit_type ?? "OK")}
                                  </Badge>
                                );
                              })()}
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="mt-3 space-y-3 rounded-md border border-border bg-muted/30 p-3">
                                <div className="space-y-1.5">
                                  <Label className="text-xs">Frame</Label>
                                  <Select value={frameType} onValueChange={setFrameType}>
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="gps_lla">GPS (lat / lon / alt)</SelectItem>
                                      <SelectItem value="ecef">ECEF (X / Y / Z)</SelectItem>
                                      <SelectItem value="eci">ECI (X / Y / Z)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                {frameType === "gps_lla" ? (
                                  <div className="grid grid-cols-3 gap-3">
                                    <div className="space-y-1">
                                      <Label className="text-xs">Lat</Label>
                                      <Input
                                        list={SUGGESTIONS_ID}
                                        placeholder="GPS_LAT"
                                        value={latChannel}
                                        onChange={(e) => setLatChannel(e.target.value)}
                                        className="h-8 text-xs"
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs">Lon</Label>
                                      <Input
                                        list={SUGGESTIONS_ID}
                                        placeholder="GPS_LON"
                                        value={lonChannel}
                                        onChange={(e) => setLonChannel(e.target.value)}
                                        className="h-8 text-xs"
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs">Alt</Label>
                                      <Input
                                        list={SUGGESTIONS_ID}
                                        placeholder="GPS_ALT"
                                        value={altChannel}
                                        onChange={(e) => setAltChannel(e.target.value)}
                                        className="h-8 text-xs"
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <div className="grid grid-cols-3 gap-3">
                                    <div className="space-y-1">
                                      <Label className="text-xs">X</Label>
                                      <Input
                                        list={SUGGESTIONS_ID}
                                        placeholder="POS_X"
                                        value={xChannel}
                                        onChange={(e) => setXChannel(e.target.value)}
                                        className="h-8 text-xs"
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs">Y</Label>
                                      <Input
                                        list={SUGGESTIONS_ID}
                                        value={yChannel}
                                        onChange={(e) => setYChannel(e.target.value)}
                                        className="h-8 text-xs"
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs">Z</Label>
                                      <Input
                                        list={SUGGESTIONS_ID}
                                        value={zChannel}
                                        onChange={(e) => setZChannel(e.target.value)}
                                        className="h-8 text-xs"
                                      />
                                    </div>
                                  </div>
                                )}
                                {mappingError && (
                                  <p className="text-xs text-destructive">{mappingError}</p>
                                )}
                                <div className="flex flex-wrap gap-2 pt-0.5">
                                  {m && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 text-xs"
                                      onClick={() => handleRemoveMapping(src.id, m)}
                                      disabled={deletingSourceId === src.id}
                                    >
                                      {deletingSourceId === src.id ? "Removing…" : "Remove mapping"}
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    className="h-8 text-xs"
                                    onClick={() => handleSaveMapping(src.id)}
                                    disabled={savingSourceId === src.id || !canSaveMapping}
                                  >
                                    {savingSourceId === src.id ? "Saving…" : "Save mapping"}
                                  </Button>
                                </div>
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        );
                      })}
                    </div>
                  )}
                  {allChannelNames.length > 0 && (
                    <datalist id={SUGGESTIONS_ID}>
                      {allChannelNames.map((n) => (
                        <option key={n} value={n} />
                      ))}
                    </datalist>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="absolute inset-0 min-w-0 min-h-0">
          <EarthOverviewGlobe
            positions={effectivePositions}
            positionHistoryBySource={effectivePositionHistory}
          />
        </div>
      </div>
    </div>
  );
}
