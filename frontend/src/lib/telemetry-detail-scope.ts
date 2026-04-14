export type TelemetryDetailScope =
  | { mode: "latest" }
  | {
      mode: "streams";
      streamIds: string[];
      since?: string | null;
      until?: string | null;
    }
  | {
      mode: "date_range";
      since?: string | null;
      until?: string | null;
    };

type SearchParamsInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

export const LATEST_SCOPE: TelemetryDetailScope = { mode: "latest" };

function valuesFor(params: SearchParamsInput, key: string): string[] {
  if (params instanceof URLSearchParams) {
    return params.getAll(key).filter(Boolean);
  }
  const value = params[key];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function firstValue(params: SearchParamsInput, key: string): string | null {
  return valuesFor(params, key)[0] ?? null;
}

function isIsoLike(value: string | null): value is string {
  if (!value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

export function parseTelemetryDetailScope(
  params: SearchParamsInput,
): TelemetryDetailScope {
  const modeRaw = firstValue(params, "scope");
  if (
    modeRaw === "latest" ||
    modeRaw === null ||
    modeRaw === "" ||
    (modeRaw !== "streams" && modeRaw !== "date_range")
  ) {
    return LATEST_SCOPE;
  }

  const streamIds = valuesFor(params, "stream_ids");
  const since = firstValue(params, "since");
  const until = firstValue(params, "until");
  const validSince = isIsoLike(since) ? since : null;
  const validUntil = isIsoLike(until) ? until : null;

  if (modeRaw === "streams" && streamIds.length > 0) {
    return {
      mode: "streams",
      streamIds,
      since: validSince,
      until: validUntil,
    };
  }
  if (modeRaw === "date_range" && (validSince || validUntil)) {
    return {
      mode: "date_range",
      since: validSince,
      until: validUntil,
    };
  }
  return LATEST_SCOPE;
}

export function telemetryScopeToQueryParams(
  scope: TelemetryDetailScope,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("scope", scope.mode);
  if (scope.mode === "streams") {
    for (const streamId of scope.streamIds) {
      params.append("stream_ids", streamId);
    }
    if (scope.since) params.set("since", scope.since);
    if (scope.until) params.set("until", scope.until);
  } else if (scope.mode === "date_range") {
    if (scope.since) params.set("since", scope.since);
    if (scope.until) params.set("until", scope.until);
  }
  return params;
}

export function telemetryScopeToQueryObject(
  scope: TelemetryDetailScope,
): Record<string, string | string[]> {
  const params = telemetryScopeToQueryParams(scope);
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of params.entries()) {
    const existing = result[key];
    if (existing == null) {
      result[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      result[key] = [existing, value];
    }
  }
  return result;
}

export function telemetryScopeKey(scope: TelemetryDetailScope): string {
  return telemetryScopeToQueryParams(scope).toString();
}

export function telemetryScopesEqual(
  a: TelemetryDetailScope,
  b: TelemetryDetailScope,
): boolean {
  return telemetryScopeKey(a) === telemetryScopeKey(b);
}

export function isRealtimeEligible(scope: TelemetryDetailScope): boolean {
  return scope.mode === "latest";
}

/**
 * Query params for compare-channel `/recent` fetch: same UTC window + mode as primary,
 * but never `stream_ids`. When primary is `streams` without a time window, falls back to
 * latest so the backend accepts the request (Option A — time-aligned, not same streams).
 */
export function telemetryScopeToCompareRecentParams(
  scope: TelemetryDetailScope,
): URLSearchParams {
  if (scope.mode === "latest") {
    return telemetryScopeToQueryParams(LATEST_SCOPE);
  }
  if (scope.mode === "date_range") {
    return telemetryScopeToQueryParams(scope);
  }
  if (scope.since || scope.until) {
    return telemetryScopeToQueryParams({
      mode: "date_range",
      since: scope.since ?? null,
      until: scope.until ?? null,
    });
  }
  return telemetryScopeToQueryParams(LATEST_SCOPE);
}

function formatScopeTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function telemetryScopeSummary(scope: TelemetryDetailScope): string {
  if (scope.mode === "latest") return "Viewing latest stream";
  if (scope.mode === "streams") {
    const count = scope.streamIds.length;
    const base = `Viewing ${count.toLocaleString()} selected ${count === 1 ? "stream" : "streams"}`;
    if (scope.since && scope.until) {
      return `${base} from ${formatScopeTime(scope.since)} to ${formatScopeTime(scope.until)}`;
    }
    if (scope.since) return `${base} since ${formatScopeTime(scope.since)}`;
    if (scope.until) return `${base} until ${formatScopeTime(scope.until)}`;
    return base;
  }
  if (scope.since && scope.until) {
    return `Viewing data from ${formatScopeTime(scope.since)} to ${formatScopeTime(scope.until)}`;
  }
  if (scope.since) return `Viewing data since ${formatScopeTime(scope.since)}`;
  if (scope.until) return `Viewing data until ${formatScopeTime(scope.until)}`;
  return "Viewing selected date range";
}

export function telemetryScopeBadge(scope: TelemetryDetailScope): string {
  if (scope.mode === "latest") return "Latest";
  if (scope.mode === "streams") {
    const count = scope.streamIds.length;
    return `${count.toLocaleString()} ${count === 1 ? "stream" : "streams"}`;
  }
  return "Date range";
}

export function telemetryScopeSubtitle(scope: TelemetryDetailScope): string {
  if (scope.mode === "latest") return "Computed from latest stream";
  if (scope.mode === "streams") {
    const count = scope.streamIds.length;
    return `Computed from ${count.toLocaleString()} selected ${count === 1 ? "stream" : "streams"}`;
  }
  return "Computed from selected date range";
}
