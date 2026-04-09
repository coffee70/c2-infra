"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ContextBanner } from "@/components/context-banner";
import { EmptyState } from "@/components/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { TelemetryInventoryFilters } from "@/components/telemetry-inventory-filters";
import { TelemetryInventoryTable } from "@/components/telemetry-inventory-table";
import {
  type TelemetryInventoryEntry,
  type TelemetrySource,
  useAddToWatchlistMutation,
  useRemoveFromWatchlistMutation,
  useTelemetryInventoryQuery,
  useTelemetrySourcesQuery,
  useWatchlistQuery,
} from "@/lib/query-hooks";

const TELEMETRY_SOURCE_STORAGE_KEY = "telemetryInventorySourceId";

function compareStateRank(entry: TelemetryInventoryEntry): number {
  if (entry.is_anomalous || entry.state === "warning") return 0;
  if (entry.has_data) return 1;
  return 2;
}

function sortInventory(
  rows: TelemetryInventoryEntry[],
  sortKey: "operational" | "name" | "subsystem" | "last_updated" | "state"
) {
  return [...rows].sort((left, right) => {
    if (sortKey === "name") {
      return left.name.localeCompare(right.name);
    }
    if (sortKey === "subsystem") {
      return (
        left.subsystem_tag.localeCompare(right.subsystem_tag) ||
        left.name.localeCompare(right.name)
      );
    }
    if (sortKey === "last_updated") {
      const leftTime = left.last_timestamp ? new Date(left.last_timestamp).getTime() : 0;
      const rightTime = right.last_timestamp ? new Date(right.last_timestamp).getTime() : 0;
      return rightTime - leftTime || left.name.localeCompare(right.name);
    }
    if (sortKey === "state") {
      return left.state.localeCompare(right.state) || left.name.localeCompare(right.name);
    }

    return (
      compareStateRank(left) - compareStateRank(right) ||
      left.name.localeCompare(right.name)
    );
  });
}

function matchesSearch(entry: TelemetryInventoryEntry, query: string): boolean {
  if (!query) return true;
  const haystack = [
    entry.name,
    ...(entry.aliases ?? []),
    entry.description ?? "",
    entry.discovery_namespace ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export function TelemetryInventoryPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const sourceFromUrl = searchParams.get("source");
  const unavailableChannel = searchParams.get("channel_unavailable");

  const [storedSource, setStoredSource] = useState<string | null>(null);
  const [storageChecked, setStorageChecked] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [selectedSubsystem, setSelectedSubsystem] = useState("all");
  const [anomalousOnly, setAnomalousOnly] = useState(false);
  const [hasDataFilter, setHasDataFilter] = useState<"all" | "has_data" | "no_data">("all");
  const [sortKey, setSortKey] = useState<"operational" | "name" | "subsystem" | "last_updated" | "state">("operational");
  const [watchlistBusyName, setWatchlistBusyName] = useState<string | null>(null);

  const sourcesQuery = useTelemetrySourcesQuery<TelemetrySource[]>();
  const sources = sourcesQuery.data ?? [];

  useEffect(() => {
    try {
      setStoredSource(sessionStorage.getItem(TELEMETRY_SOURCE_STORAGE_KEY));
    } catch {
      setStoredSource(null);
    }
    setStorageChecked(true);
  }, []);

  useEffect(() => {
    if (!storageChecked || sourcesQuery.isLoading) return;

    const resolvedSource =
      (sourceFromUrl && sources.some((source) => source.id === sourceFromUrl) && sourceFromUrl) ||
      (storedSource && sources.some((source) => source.id === storedSource) && storedSource) ||
      sources[0]?.id ||
      null;

    setSelectedSource((current) => (current === resolvedSource ? current : resolvedSource));

    if (!resolvedSource) return;

    const params = new URLSearchParams(searchParams.toString());
    if (params.get("source") !== resolvedSource) {
      params.set("source", resolvedSource);
      router.replace(`${pathname}?${params.toString()}`);
    }

    try {
      sessionStorage.setItem(TELEMETRY_SOURCE_STORAGE_KEY, resolvedSource);
    } catch {}
  }, [
    pathname,
    router,
    searchParams,
    sourceFromUrl,
    sources,
    sourcesQuery.isLoading,
    storageChecked,
    storedSource,
  ]);

  const inventoryQuery = useTelemetryInventoryQuery(selectedSource ?? "", Boolean(selectedSource));
  const watchlistQuery = useWatchlistQuery(selectedSource ?? "", Boolean(selectedSource));
  const addToWatchlist = useAddToWatchlistMutation(selectedSource ?? "");
  const removeFromWatchlist = useRemoveFromWatchlistMutation(selectedSource ?? "");

  const inventory = inventoryQuery.data ?? [];
  const watchlistNames = useMemo(
    () => new Set((watchlistQuery.data ?? []).map((entry) => entry.name)),
    [watchlistQuery.data]
  );
  const subsystemOptions = useMemo(
    () => Array.from(new Set(inventory.map((entry) => entry.subsystem_tag))).sort((a, b) => a.localeCompare(b)),
    [inventory]
  );

  const filteredRows = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    const rows = inventory.filter((entry) => {
      if (!matchesSearch(entry, query)) return false;
      if (selectedSubsystem !== "all" && entry.subsystem_tag !== selectedSubsystem) return false;
      if (anomalousOnly && !entry.is_anomalous) return false;
      if (hasDataFilter === "has_data" && !entry.has_data) return false;
      if (hasDataFilter === "no_data" && entry.has_data) return false;
      return true;
    });
    return sortInventory(rows, sortKey);
  }, [anomalousOnly, hasDataFilter, inventory, searchText, selectedSubsystem, sortKey]);

  async function updateSelectedSource(nextSourceId: string) {
    setSelectedSource(nextSourceId);
    try {
      sessionStorage.setItem(TELEMETRY_SOURCE_STORAGE_KEY, nextSourceId);
    } catch {}
    const params = new URLSearchParams(searchParams.toString());
    params.set("source", nextSourceId);
    params.delete("channel_unavailable");
    router.replace(`${pathname}?${params.toString()}`);
  }

  async function handleAddToWatchlist(name: string) {
    setWatchlistBusyName(name);
    try {
      await addToWatchlist.mutateAsync(name);
    } finally {
      setWatchlistBusyName(null);
    }
  }

  async function handleRemoveFromWatchlist(name: string) {
    setWatchlistBusyName(name);
    try {
      await removeFromWatchlist.mutateAsync(name);
    } finally {
      setWatchlistBusyName(null);
    }
  }

  if (!storageChecked || sourcesQuery.isLoading || (selectedSource == null && sources.length > 0)) {
    return (
      <div className="flex min-h-full items-center justify-center p-4 sm:p-6 lg:p-8">
        <Spinner size="lg" className="h-10 w-10" />
      </div>
    );
  }

  return (
    <div className="min-h-full px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Telemetry</h1>
          <p className="text-muted-foreground text-sm">
            Browse source telemetry, inspect operational state, and manage the watchlist.
          </p>
        </div>

        {selectedSource && (
          <ContextBanner
            sourceId={selectedSource}
            sources={sources}
            onSourceChange={updateSelectedSource}
          />
        )}

        {unavailableChannel && (
          <Alert>
            <AlertDescription>
              {unavailableChannel} is not available for this source.
            </AlertDescription>
          </Alert>
        )}

        {sourcesQuery.isError && (
          <Alert variant="destructive">
            <AlertDescription>Failed to load telemetry sources.</AlertDescription>
          </Alert>
        )}

        {sources.length === 0 ? (
          <EmptyState
            icon="inbox"
            title="No telemetry sources"
            description="Register a telemetry source before using the telemetry inventory."
          />
        ) : (
          <>
            <TelemetryInventoryFilters
              searchText={searchText}
              onSearchTextChange={setSearchText}
              subsystemOptions={subsystemOptions}
              selectedSubsystem={selectedSubsystem}
              onSelectedSubsystemChange={setSelectedSubsystem}
              anomalousOnly={anomalousOnly}
              onAnomalousOnlyChange={setAnomalousOnly}
              hasDataFilter={hasDataFilter}
              onHasDataFilterChange={setHasDataFilter}
              sortKey={sortKey}
              onSortKeyChange={setSortKey}
            />

            {inventoryQuery.isLoading ? (
              <div className="flex min-h-64 items-center justify-center">
                <Spinner size="lg" className="h-10 w-10" />
              </div>
            ) : inventoryQuery.isError ? (
              <Alert variant="destructive">
                <AlertDescription className="flex items-center justify-between gap-3">
                  <span>Failed to load telemetry inventory.</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => inventoryQuery.refetch()}>
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            ) : inventory.length === 0 ? (
              <EmptyState
                icon="inbox"
                title="No telemetry channels"
                description="The selected source does not have any registered telemetry metadata yet."
              />
            ) : filteredRows.length === 0 ? (
              <EmptyState
                icon="search"
                title="No matching channels"
                description="Adjust the filters to see telemetry channels for this source."
              />
            ) : (
              <TelemetryInventoryTable
                sourceId={selectedSource ?? ""}
                rows={filteredRows}
                watchlistNames={watchlistNames}
                watchlistBusyName={watchlistBusyName}
                onAddToWatchlist={handleAddToWatchlist}
                onRemoveFromWatchlist={handleRemoveFromWatchlist}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
