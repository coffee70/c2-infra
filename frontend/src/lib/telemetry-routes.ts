"use client";

export function buildTelemetryDetailHref(sourceId: string, channelName: string): string {
  return `/sources/${encodeURIComponent(sourceId)}/telemetry/${encodeURIComponent(channelName)}`;
}

export function buildTelemetryApiBase(sourceId: string, channelName: string): string {
  return `/telemetry/sources/${encodeURIComponent(sourceId)}/channels/${encodeURIComponent(channelName)}`;
}
