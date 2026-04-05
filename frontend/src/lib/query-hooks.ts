"use client";

import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { auditLog } from "@/lib/audit-log";
import { fetchJson, fetchVoid } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import type { SimulatorRuntimeStatus } from "@/lib/simulator-runtime";
import { buildTelemetryApiBase } from "@/lib/telemetry-routes";

export interface WatchlistEntry {
  name: string;
  aliases?: string[];
  display_order: number;
  channel_origin?: string;
  discovery_namespace?: string | null;
}

export interface TelemetryListEntry {
  name: string;
  aliases?: string[];
  channel_origin?: string;
  discovery_namespace?: string | null;
}

export interface TelemetrySource {
  id: string;
  name: string;
  description?: string | null;
  source_type?: string;
  base_url?: string | null;
  vehicle_config_path?: string;
}

export interface VehicleConfigListItem {
  path: string;
  filename: string;
  name?: string | null;
  category: string;
  format: string;
  modified_at?: string | null;
}

export interface VehicleConfigParsedSummary {
  version: number;
  name?: string | null;
  channel_count: number;
  scenario_names: string[];
  has_position_mapping: boolean;
  has_ingestion: boolean;
}

export interface VehicleConfigValidationError {
  loc: string[];
  message: string;
  type: string;
}

export interface VehicleConfigDocument {
  path: string;
  content: string;
  format: string;
  parsed?: VehicleConfigParsedSummary | null;
  validation_errors: VehicleConfigValidationError[];
}

export interface SearchResult {
  name: string;
  aliases?: string[];
  match_confidence: number;
  description?: string | null;
  subsystem_tag?: string | null;
  units: string;
  channel_origin?: string;
  discovery_namespace?: string | null;
  current_value?: number | null;
  current_status?: string | null;
  last_timestamp?: string | null;
}

export interface ChannelSource {
  stream_id: string;
  label: string;
}

export interface HistoryPoint {
  timestamp: string;
  value: number;
}

export interface TelemetryRecentResponse {
  data: HistoryPoint[];
  requested_since?: string | null;
  requested_until?: string | null;
  effective_since?: string | null;
  effective_until?: string | null;
  applied_time_filter?: boolean;
  fallback_to_recent?: boolean;
}

export interface OpsEventSchema {
  id: string;
  source_id: string;
  stream_id?: string | null;
  event_time: string;
  event_type: string;
  severity: string;
  summary: string;
  entity_type: string;
  entity_id?: string | null;
  payload?: Record<string, unknown> | null;
  created_at: string;
}

export interface ExplainResponse {
  name?: string;
  aliases?: string[];
  channel_origin?: string;
  discovery_namespace?: string | null;
  what_this_means: string;
  llm_explanation: string;
  what_to_check_next: {
    name: string;
    subsystem_tag: string;
    link_reason: string;
    current_value?: number | null;
    current_status?: string | null;
    last_timestamp?: string | null;
    units?: string | null;
  }[];
  confidence_indicator?: string | null;
}

interface SearchParams {
  q: string;
  sourceId: string;
  subsystem?: string;
  units?: string;
  anomalousOnly?: boolean;
  recentMinutes?: number;
}

interface SourceMutationInput {
  source_type: string;
  name: string;
  description?: string;
  base_url?: string;
  vehicle_config_path: string;
}

interface SourceUpdateInput {
  sourceId: string;
  name: string;
  description?: string;
  base_url?: string;
  vehicle_config_path?: string;
}

interface VehicleConfigValidateInput {
  content: string;
  path?: string;
  filename?: string;
  format?: string;
}

interface VehicleConfigSaveInput {
  path: string;
  content: string;
}

interface SimulatorActionInput {
  sourceId: string;
  scenario?: string;
  duration?: number;
  speed?: number;
  drop_prob?: number;
  jitter?: number;
}

function toSearchQueryParams(params: SearchParams): URLSearchParams {
  const query = new URLSearchParams({ q: params.q.trim(), source_id: params.sourceId });
  if (params.subsystem) query.set("subsystem", params.subsystem);
  if (params.units) query.set("units", params.units);
  if (params.anomalousOnly) query.set("anomalous_only", "true");
  if (params.recentMinutes && params.recentMinutes > 0) {
    query.set("recent_minutes", String(params.recentMinutes));
  }
  return query;
}

function encodePathSegments(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function useWatchlistQuery(sourceId: string, enabled = true) {
  return useQuery<WatchlistEntry[]>({
    queryKey: queryKeys.watchlist(sourceId),
    enabled,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const data = await fetchJson<{ entries?: WatchlistEntry[] }>(
        `/telemetry/watchlist?source_id=${encodeURIComponent(sourceId)}`,
        {
        signal,
        }
      );
      return Array.isArray(data.entries) ? data.entries : [];
    },
  });
}

export function useWatchlistNames(sourceId: string, enabled = true) {
  const watchlistQuery = useWatchlistQuery(sourceId, enabled);
  return {
    ...watchlistQuery,
    names: (watchlistQuery.data ?? []).map((entry) => entry.name),
  };
}

export function useAddToWatchlistMutation(
  sourceId: string,
  options?: { onSuccess?: () => void | Promise<void> }
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) =>
      fetchJson("/telemetry/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_id: sourceId, telemetry_name: name }),
      }),
    onMutate: async (name) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.watchlist(sourceId) });
      const previous = queryClient.getQueryData<WatchlistEntry[]>(queryKeys.watchlist(sourceId)) ?? [];
      if (!previous.some((entry) => entry.name === name)) {
        queryClient.setQueryData<WatchlistEntry[]>(queryKeys.watchlist(sourceId), [
          ...previous,
          { name, display_order: previous.length },
        ]);
      }
      return { previous, name };
    },
    onError: (_error, name, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.watchlist(sourceId), context.previous);
      }
      auditLog("watchlist.add", { source_id: sourceId, telemetry_name: name, error: "Failed to add" });
    },
    onSuccess: async (_data, name) => {
      auditLog("watchlist.add", { source_id: sourceId, telemetry_name: name });
      await options?.onSuccess?.();
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.watchlist(sourceId) });
    },
  });
}

export function useRemoveFromWatchlistMutation(
  sourceId: string,
  options?: { onSuccess?: () => void | Promise<void> }
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) =>
      fetchVoid(`/telemetry/watchlist/${encodeURIComponent(name)}?source_id=${encodeURIComponent(sourceId)}`, {
        method: "DELETE",
      }),
    onMutate: async (name) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.watchlist(sourceId) });
      const previous = queryClient.getQueryData<WatchlistEntry[]>(queryKeys.watchlist(sourceId)) ?? [];
      queryClient.setQueryData<WatchlistEntry[]>(
        queryKeys.watchlist(sourceId),
        previous.filter((entry) => entry.name !== name)
      );
      return { previous, name };
    },
    onError: (_error, name, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.watchlist(sourceId), context.previous);
      }
      auditLog("watchlist.remove", { source_id: sourceId, name, error: "Failed to remove" });
    },
    onSuccess: async (_data, name) => {
      auditLog("watchlist.remove", { source_id: sourceId, name });
      await options?.onSuccess?.();
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.watchlist(sourceId) });
    },
  });
}

export function useTelemetryListQuery(sourceId: string, enabled = true) {
  return useQuery<TelemetryListEntry[]>({
    queryKey: queryKeys.telemetryList(sourceId),
    enabled,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const data = await fetchJson<{ channels?: TelemetryListEntry[]; names?: string[] }>(
        `/telemetry/list?source_id=${encodeURIComponent(sourceId)}`,
        {
        signal,
        }
      );
      if (Array.isArray(data.channels)) return data.channels;
      if (Array.isArray(data.names)) {
        return data.names.map((name) => ({ name, channel_origin: "catalog", discovery_namespace: null }));
      }
      return [];
    },
  });
}

export function useTelemetrySourcesQuery<T = TelemetrySource[]>(
  options?: Omit<UseQueryOptions<TelemetrySource[], Error, T>, "queryKey" | "queryFn">
) {
  return useQuery<TelemetrySource[], Error, T>({
    queryKey: queryKeys.telemetrySources,
    staleTime: 5 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const data = await fetchJson<TelemetrySource[]>("/telemetry/sources", {
        signal,
        useFallback: true,
        cache: "no-store",
      });
      return Array.isArray(data) ? data : [];
    },
    ...(options ?? {}),
  });
}

export function useCreateTelemetrySourceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SourceMutationInput) =>
      fetchJson("/telemetry/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.telemetrySources });
    },
  });
}

export function useUpdateTelemetrySourceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ sourceId, ...input }: SourceUpdateInput) =>
      fetchJson(`/telemetry/sources/${encodeURIComponent(sourceId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSettled: async (_data, _error, variables) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.telemetrySources });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.telemetrySourcesStatus(variables.sourceId),
      });
    },
  });
}

export function useVehicleConfigsQuery(enabled = true) {
  return useQuery<VehicleConfigListItem[]>({
    queryKey: queryKeys.vehicleConfigs,
    enabled,
    staleTime: 30 * 1000,
    queryFn: async ({ signal }) => {
      const data = await fetchJson<VehicleConfigListItem[]>("/vehicle-configs", {
        signal,
        cache: "no-store",
      });
      return Array.isArray(data) ? data : [];
    },
  });
}

export function useVehicleConfigQuery(path: string, enabled = true) {
  return useQuery<VehicleConfigDocument>({
    queryKey: queryKeys.vehicleConfig(path),
    enabled: enabled && path.trim().length > 0,
    queryFn: async ({ signal }) =>
      fetchJson<VehicleConfigDocument>(`/vehicle-configs/${encodePathSegments(path)}`, {
        signal,
        cache: "no-store",
      }),
  });
}

export function useValidateVehicleConfigMutation() {
  return useMutation({
    mutationFn: async (input: VehicleConfigValidateInput) =>
      fetchJson<{
        valid: boolean;
        parsed?: VehicleConfigParsedSummary | null;
        errors: VehicleConfigValidationError[];
      }>("/vehicle-configs/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
  });
}

export function useCreateVehicleConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: VehicleConfigSaveInput) =>
      fetchJson<{ path: string; parsed: VehicleConfigParsedSummary; saved: boolean }>("/vehicle-configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.vehicleConfigs });
    },
  });
}

export function useUpdateVehicleConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: VehicleConfigSaveInput) =>
      fetchJson<{ path: string; parsed: VehicleConfigParsedSummary; saved: boolean }>(
        `/vehicle-configs/${encodePathSegments(input.path)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }
      ),
    onSettled: async (_data, _error, variables) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.vehicleConfigs });
      await queryClient.invalidateQueries({ queryKey: queryKeys.vehicleConfig(variables.path) });
    },
  });
}

export function useTelemetrySubsystemsQuery(sourceId: string, enabled = true) {
  return useQuery<string[]>({
    queryKey: queryKeys.subsystems(sourceId),
    enabled,
    staleTime: 10 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const data = await fetchJson<{ subsystems?: string[] }>(`/telemetry/subsystems?source_id=${encodeURIComponent(sourceId)}`, {
        signal,
      });
      return Array.isArray(data.subsystems) ? data.subsystems : [];
    },
  });
}

export function useTelemetryUnitsQuery(sourceId: string, enabled = true) {
  return useQuery<string[]>({
    queryKey: queryKeys.units(sourceId),
    enabled,
    staleTime: 10 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const data = await fetchJson<{ units?: string[] }>(
        `/telemetry/units?source_id=${encodeURIComponent(sourceId)}`,
        { signal }
      );
      return Array.isArray(data.units) ? data.units : [];
    },
  });
}

export function useTelemetrySearchQuery(params: SearchParams, enabled: boolean) {
  const queryParams = toSearchQueryParams(params);
  return useQuery<SearchResult[]>({
    queryKey: queryKeys.telemetrySearch(Object.fromEntries(queryParams.entries())),
    enabled: enabled && params.q.trim().length > 0,
    staleTime: 30 * 1000,
    queryFn: async ({ signal }) => {
      const data = await fetchJson<{ results?: SearchResult[] }>(
        `/telemetry/search?${queryParams.toString()}`,
        { signal }
      );
      return Array.isArray(data.results) ? data.results : [];
    },
  });
}

export function useTelemetryChannelStreamsQuery(channelName: string, sourceId: string, enabled = true) {
  return useQuery<ChannelSource[]>({
    queryKey: queryKeys.telemetryChannelRuns(channelName, sourceId),
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const data = await fetchJson<{ sources?: ChannelSource[] }>(
        `${buildTelemetryApiBase(sourceId, channelName)}/streams`,
        { signal }
      );
      return Array.isArray(data.sources) ? data.sources : [];
    },
  });
}

export function useTelemetryRecentQuery(
  params: Record<string, string>,
  enabled = true
) {
  const queryEntries = Object.entries(params).filter(
    ([key]) => key !== "channelName" && key !== "catalogSourceId"
  );
  return useQuery<TelemetryRecentResponse>({
    queryKey: queryKeys.telemetryRecent(params),
    enabled,
    queryFn: async ({ signal }) =>
      fetchJson<TelemetryRecentResponse>(
        `${buildTelemetryApiBase(params.catalogSourceId ?? params.source_id, params.channelName)}/recent?${new URLSearchParams(
          queryEntries
        ).toString()}`,
        { signal }
      ),
  });
}

export function useTelemetryExplanationQuery(
  channelName: string,
  sourceId: string,
  streamId?: string,
  enabled = true
) {
  const suffix = streamId ? `?stream_id=${encodeURIComponent(streamId)}` : "";
  return useQuery<ExplainResponse>({
    queryKey: queryKeys.telemetryExplanation(channelName, streamId ?? sourceId),
    enabled,
    retry: 0,
    queryFn: async ({ signal }) =>
      fetchJson<ExplainResponse>(
        `${buildTelemetryApiBase(sourceId, channelName)}/explain${suffix}`,
        { signal, cache: "no-store" }
      ),
  });
}

export function useOpsEventsQuery(params: Record<string, string>, enabled = true) {
  return useQuery<{ events: OpsEventSchema[]; total: number }>({
    queryKey: queryKeys.telemetryEvents(params),
    enabled,
    staleTime: 15 * 1000,
    queryFn: async ({ signal }) => {
      const data = await fetchJson<{ events?: OpsEventSchema[]; total?: number }>(
        `/ops/events?${new URLSearchParams(params).toString()}`,
        { signal }
      );
      return {
        events: Array.isArray(data.events) ? data.events : [],
        total: typeof data.total === "number" ? data.total : 0,
      };
    },
  });
}

export async function fetchSimulatorRuntimeStatus(sourceId: string): Promise<SimulatorRuntimeStatus> {
  const data = await fetchJson<SimulatorRuntimeStatus>(
    `/simulator/status?vehicle_id=${encodeURIComponent(sourceId)}`,
    { cache: "no-store", useFallback: true }
  );
  return data ?? { connected: false };
}

export function useSimulatorStatusQuery(
  sourceId: string,
  options?: {
    enabled?: boolean;
    refetchInterval?: number;
    initialData?: SimulatorRuntimeStatus | null;
  }
) {
  const query = useQuery<SimulatorRuntimeStatus>({
    queryKey: queryKeys.telemetrySourcesStatus(sourceId),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
    initialData: options?.initialData ?? undefined,
    queryFn: async () => fetchSimulatorRuntimeStatus(sourceId),
  });

  if (query.isError) {
    return {
      ...query,
      data: { connected: false } as SimulatorRuntimeStatus,
    };
  }

  return query;
}

export function useSimulatorStatusesMap(sourceIds: string[], enabled = true, refetchInterval = 5000) {
  const results = useQueries({
    queries: sourceIds.map((sourceId) => ({
      queryKey: queryKeys.telemetrySourcesStatus(sourceId),
      enabled,
      refetchInterval,
      queryFn: async () => fetchSimulatorRuntimeStatus(sourceId),
    })),
  });

  return sourceIds.reduce<Record<string, SimulatorRuntimeStatus>>((acc, sourceId, index) => {
    const result = results[index];
    const data = result?.isError ? ({ connected: false } as SimulatorRuntimeStatus) : result?.data;
    if (data) {
      acc[sourceId] = data;
    }
    return acc;
  }, {});
}

function invalidateSimulatorStatus(queryClient: ReturnType<typeof useQueryClient>, sourceId: string) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.telemetrySourcesStatus(sourceId) });
}

export function useSimulatorStartMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ sourceId, ...payload }: SimulatorActionInput) =>
      fetchJson("/simulator/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, vehicle_id: sourceId }),
        useFallback: true,
      }),
    onSettled: async (_data, _error, variables) => {
      await invalidateSimulatorStatus(queryClient, variables.sourceId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.telemetrySources });
    },
  });
}

function createSimulatorActionMutation(path: string, actionName: string) {
  return function useAction() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async ({ sourceId }: SimulatorActionInput) =>
        fetchJson(
          `${path}?vehicle_id=${encodeURIComponent(sourceId)}`,
          { method: "POST", useFallback: true }
        ),
      onSuccess: (_data, variables) => {
        auditLog(actionName);
        return invalidateSimulatorStatus(queryClient, variables.sourceId);
      },
      onSettled: async (_data, _error, variables) => {
        await invalidateSimulatorStatus(queryClient, variables.sourceId);
      },
    });
  };
}

export const useSimulatorPauseMutation = createSimulatorActionMutation("/simulator/pause", "simulator.pause");
export const useSimulatorResumeMutation = createSimulatorActionMutation("/simulator/resume", "simulator.resume");
export const useSimulatorStopMutation = createSimulatorActionMutation("/simulator/stop", "simulator.stop");
