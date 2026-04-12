import {
  telemetryScopeToQueryParams,
  type TelemetryDetailScope,
} from "@/lib/telemetry-detail-scope";

export function buildTelemetryDetailHref(
  sourceId: string,
  channelName: string,
  scope?: TelemetryDetailScope,
): string {
  const href = `/telemetry/${encodeURIComponent(sourceId)}/${encodeURIComponent(channelName)}`;
  if (!scope) return href;
  const params = telemetryScopeToQueryParams(scope);
  const suffix = params.toString();
  return suffix ? `${href}?${suffix}` : href;
}

export function buildTelemetryApiBase(sourceId: string, channelName: string): string {
  return `/telemetry/sources/${encodeURIComponent(sourceId)}/channels/${encodeURIComponent(channelName)}`;
}
