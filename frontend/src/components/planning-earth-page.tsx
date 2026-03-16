"use client";

import { useSearchParams } from "next/navigation";
import { EarthOverviewView } from "@/components/earth-overview-view";
import { runIdToSourceId } from "@/lib/source-ids";
import { Spinner } from "@/components/ui/spinner";
import { useTelemetrySourcesQuery } from "@/lib/query-hooks";
import { DEFAULT_SOURCE_ID } from "@/lib/source-ids";

interface TelemetrySource {
  id: string;
  name: string;
  description?: string | null;
  source_type?: string;
}

export function PlanningEarthPage() {
  const searchParams = useSearchParams();
  const sourceFromUrl = searchParams.get("source");
  const normalizedSourceFromUrl = sourceFromUrl
    ? runIdToSourceId(sourceFromUrl)
    : null;

  const sourcesQuery = useTelemetrySourcesQuery<TelemetrySource[]>();
  const loading = sourcesQuery.isLoading;
  const error = sourcesQuery.error?.message ?? null;
  const sources = sourcesQuery.data ?? [];

  const initialSourceId =
    normalizedSourceFromUrl &&
    sources.some((s) => s.id === normalizedSourceFromUrl)
      ? normalizedSourceFromUrl
      : sources.some((s) => s.id === DEFAULT_SOURCE_ID)
        ? DEFAULT_SOURCE_ID
        : sources[0]?.id ?? DEFAULT_SOURCE_ID;

  if (loading) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center gap-4">
        <Spinner size="lg" className="h-10 w-10" />
        <p className="text-sm text-muted-foreground">
          Loading Planning Earth view…
        </p>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 top-14 w-full"
      style={{ height: "calc(100vh - 3.5rem)" }}
    >
      <EarthOverviewView
        sources={sources}
        initialSelectedSourceId={initialSourceId}
      />
      {error && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-30 rounded-md border bg-background/90 px-3 py-2 text-sm text-destructive shadow">
          {error}
        </div>
      )}
    </div>
  );
}
