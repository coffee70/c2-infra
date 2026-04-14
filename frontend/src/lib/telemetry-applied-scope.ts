/** Mirrors backend `TelemetryDetailPageScope` (summary API `scope` field). */

export type TelemetryAppliedScopeWindow = {
  since?: string | null;
  until?: string | null;
};

export type TelemetryAppliedScope = {
  mode: "latest" | "streams" | "date_range";
  stream_count?: number | null;
  stream_ids?: string[];
  resolved_stream_id?: string | null;
  window?: TelemetryAppliedScopeWindow | null;
  preset?: string | null;
};

function formatUtcShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** Operator-facing one-line summary for the applied scope (from structured API only). */
export function formatAppliedScopeSummaryLine(
  s: TelemetryAppliedScope | null | undefined,
): string {
  if (!s) return "Scope: —";
  if (s.mode === "latest") {
    return "Scope: Latest stream (this channel)";
  }
  if (s.mode === "streams") {
    const n = s.stream_count ?? s.stream_ids?.length ?? 0;
    const parts = [`Streams (${n.toLocaleString()})`];
    const w = s.window;
    if (w?.since && w?.until) {
      parts.push(`${formatUtcShort(w.since)} – ${formatUtcShort(w.until)}`);
    } else if (w?.since) parts.push(`since ${formatUtcShort(w.since)}`);
    else if (w?.until) parts.push(`until ${formatUtcShort(w.until)}`);
    if (s.preset) parts.push(s.preset);
    return `Scope: ${parts.join(" · ")}`;
  }
  const w = s.window;
  if (w?.since && w?.until) {
    return `Scope: Date range · ${formatUtcShort(w.since)} – ${formatUtcShort(w.until)}`;
  }
  if (w?.since) return `Scope: Date range · since ${formatUtcShort(w.since)}`;
  if (w?.until) return `Scope: Date range · until ${formatUtcShort(w.until)}`;
  return "Scope: Date range";
}

export function appliedScopeBadge(s: TelemetryAppliedScope | null | undefined): string {
  if (!s) return "—";
  if (s.mode === "latest") return "Latest";
  if (s.mode === "streams") {
    const n = s.stream_count ?? s.stream_ids?.length ?? 0;
    return `${n.toLocaleString()} stream${n === 1 ? "" : "s"}`;
  }
  return "Date range";
}
