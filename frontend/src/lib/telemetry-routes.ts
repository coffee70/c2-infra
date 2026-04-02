"use client";

export function buildTelemetryDetailHref(
  sourceId: string,
  channelName: string,
  streamId?: string,
): string {
  const href = `/sources/${encodeURIComponent(sourceId)}/telemetry/${encodeURIComponent(channelName)}`;
  return streamId ? `${href}?stream_id=${encodeURIComponent(streamId)}` : href;
}

export function buildTelemetryApiBase(sourceId: string, channelName: string): string {
  return `/telemetry/sources/${encodeURIComponent(sourceId)}/channels/${encodeURIComponent(channelName)}`;
}
