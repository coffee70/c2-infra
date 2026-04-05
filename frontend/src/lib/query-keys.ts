export const queryKeys = {
  watchlist: (sourceId: string) => ["watchlist", sourceId] as const,
  telemetryList: (sourceId: string) => ["telemetry-list", sourceId] as const,
  telemetrySources: ["telemetry-sources"] as const,
  vehicleConfigs: ["vehicle-configs"] as const,
  vehicleConfig: (path: string) => ["vehicle-config", path] as const,
  telemetrySourceRuns: (sourceId: string) => ["telemetry-source-runs", sourceId] as const,
  telemetryChannelRuns: (channelName: string, sourceId: string) =>
    ["telemetry-channel-runs", channelName, sourceId] as const,
  telemetrySearch: (params: Record<string, string>) => ["telemetry-search", params] as const,
  telemetryExplanation: (channelName: string, sourceId: string) =>
    ["telemetry-explanation", channelName, sourceId] as const,
  telemetryRecent: (params: Record<string, string>) => ["telemetry-recent", params] as const,
  telemetrySourcesStatus: (sourceId: string) => ["simulator-status", sourceId] as const,
  telemetryEvents: (params: Record<string, string>) => ["ops-events", params] as const,
  subsystems: (sourceId: string) => ["telemetry-subsystems", sourceId] as const,
  units: (sourceId: string) => ["telemetry-units", sourceId] as const,
} as const;
