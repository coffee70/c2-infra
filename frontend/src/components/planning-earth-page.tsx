"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EarthOverviewView } from "@/components/earth-overview-view";
import { Spinner } from "@/components/ui/spinner";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const API_FALLBACK_URL = process.env.NEXT_PUBLIC_API_FALLBACK_URL || "";
const DEFAULT_SOURCE_ID = "default";

async function fetchWithTimeoutAndFallback(path: string): Promise<Response> {
  const bases = [API_URL, API_FALLBACK_URL].filter(
    (v, i, arr) => arr.indexOf(v) === i
  );
  let lastError: unknown = null;
  for (const base of bases) {
    try {
      const res = await fetch(`${base}${path}`, { cache: "no-store" });
      if (res.ok) return res;
      lastError = new Error(`HTTP ${res.status} from ${base}${path}`);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error("All API paths failed");
}

interface TelemetrySource {
  id: string;
  name: string;
  description?: string | null;
  source_type?: string;
}

export function PlanningEarthPage() {
  const searchParams = useSearchParams();
  const sourceFromUrl = searchParams.get("source");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<TelemetrySource[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetchWithTimeoutAndFallback("/telemetry/sources");
        if (cancelled) return;
        const data = res.ok ? await res.json() : [];
        setSources(Array.isArray(data) ? data : []);
        if (!res.ok) setError("Failed to load sources");
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load sources");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const initialSourceId =
    sourceFromUrl && sources.some((s) => s.id === sourceFromUrl)
      ? sourceFromUrl
      : sources.some((s) => s.id === DEFAULT_SOURCE_ID)
        ? DEFAULT_SOURCE_ID
        : sources[0]?.id ?? DEFAULT_SOURCE_ID;

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
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
