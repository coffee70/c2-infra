"use client";

import { useSearchParams } from "next/navigation";
import { EarthOverviewView } from "@/components/earth-overview-view";
import { Spinner } from "@/components/ui/spinner";
import { useTelemetrySourcesQuery } from "@/lib/query-hooks";

interface TelemetrySource {
  id: string;
  name: string;
  description?: string | null;
  source_type?: string;
}

export function PlanningEarthPage() {
  const searchParams = useSearchParams();
  const sourceFromUrl = searchParams.get("source");

  const sourcesQuery = useTelemetrySourcesQuery<TelemetrySource[]>();
  const loading = sourcesQuery.isLoading;
  const error = sourcesQuery.error?.message ?? null;
  const sources = sourcesQuery.data ?? [];

  const initialSourceId =
    sourceFromUrl && sources.some((s) => s.id === sourceFromUrl)
      ? sourceFromUrl
      : sources[0]?.id;

  if (loading) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4">
        <Spinner size="lg" className="h-10 w-10" />
        <p className="text-muted-foreground text-sm">
          Loading Planning Earth view…
        </p>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-x-0 top-14 bottom-0 w-full"
      style={{ height: "calc(100vh - 3.5rem)" }}
    >
      <EarthOverviewView
        sources={sources}
        initialSelectedSourceId={initialSourceId}
      />
      {error && (
        <div className="bg-background/90 text-destructive pointer-events-none absolute bottom-4 left-4 z-30 rounded-md border px-3 py-2 text-sm shadow">
          {error}
        </div>
      )}
    </div>
  );
}
