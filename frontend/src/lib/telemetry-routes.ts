"use client";

export function buildTelemetryDetailHref(
  sourceId: string,
  channelName: string,
  runId?: string,
): string {
  const href = `/sources/${encodeURIComponent(sourceId)}/telemetry/${encodeURIComponent(channelName)}`;
  return runId ? `${href}?run=${encodeURIComponent(runId)}` : href;
}

export function buildTelemetryApiBase(sourceId: string, channelName: string): string {
  return `/telemetry/sources/${encodeURIComponent(sourceId)}/channels/${encodeURIComponent(channelName)}`;
}
