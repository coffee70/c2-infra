"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDownIcon, SearchIcon, StarIcon } from "lucide-react";
import { auditLog } from "@/lib/audit-log";
import { getRecentChannels } from "@/lib/recent-telemetry";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const DEFAULT_SOURCE_ID = "default";
export const AUTO_FOCUS_STORAGE_KEY = "overviewSearchAutoFocus";

export const OVERVIEW_SEARCH_FOCUS_EVENT = "telemetry-overview-search-focus";
export const SEARCH_INPUT_SELECTOR = "[data-telemetry-search-input]";

interface SearchResult {
  name: string;
  match_confidence: number;
  description?: string | null;
  subsystem_tag?: string | null;
  units: string;
  current_value?: number | null;
  current_status?: string | null;
  last_timestamp?: string | null;
}

interface WatchlistEntry {
  name: string;
  display_order: number;
}

interface TelemetrySource {
  id: string;
  name: string;
  description?: string | null;
}

interface OverviewSearchProps {
  sourceId: string;
  sources: TelemetrySource[];
  onWatchlistChanged?: () => void | Promise<void>;
  watchlistVersion?: number;
}

interface SearchFilters {
  subsystem: string;
  units: string;
  anomalousOnly: boolean;
  recentOnly: boolean;
  recentHours: number;
}

function readBooleanParam(value: string | null): boolean {
  return value === "1" || value === "true";
}

function matchConfidenceLabel(score: number): string {
  const pct = score * 100;
  if (pct >= 80) return "High";
  if (pct >= 50) return "Medium";
  return "Low";
}

function statusVariant(status: string | null | undefined) {
  if (!status) return "secondary";
  if (status === "warning") return "destructive";
  if (status === "caution") return "secondary";
  return "success";
}

function buildDetailHref(name: string, sourceId: string) {
  if (!sourceId || sourceId === DEFAULT_SOURCE_ID) {
    return `/telemetry/${encodeURIComponent(name)}`;
  }
  return `/telemetry/${encodeURIComponent(name)}?source=${encodeURIComponent(sourceId)}`;
}

function readSearchState(searchParams: { get(name: string): string | null }) {
  return {
    open: readBooleanParam(searchParams.get("search")),
    query: searchParams.get("q") ?? "",
    filters: {
      subsystem: searchParams.get("subsystem") ?? "",
      units: searchParams.get("units") ?? "",
      anomalousOnly: readBooleanParam(searchParams.get("anomalous")),
      recentOnly: readBooleanParam(searchParams.get("recent")),
      recentHours: Math.min(
        168,
        Math.max(1, Number.parseInt(searchParams.get("recentHours") ?? "24", 10) || 24)
      ),
    },
  };
}

export function OverviewSearch({
  sourceId,
  sources,
  onWatchlistChanged,
  watchlistVersion = 0,
}: OverviewSearchProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [query, setQuery] = useState("");
  const [filterSubsystem, setFilterSubsystem] = useState("");
  const [filterUnits, setFilterUnits] = useState("");
  const [filterAnomalousOnly, setFilterAnomalousOnly] = useState(false);
  const [filterRecentOnly, setFilterRecentOnly] = useState(false);
  const [filterRecentHours, setFilterRecentHours] = useState(24);

  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [subsystems, setSubsystems] = useState<string[]>([]);
  const [units, setUnits] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);

  const sourceName = useMemo(
    () => sources.find((entry) => entry.id === sourceId)?.name ?? sourceId ?? DEFAULT_SOURCE_ID,
    [sourceId, sources]
  );

  const hasActiveFilters =
    !!filterSubsystem || !!filterUnits || filterAnomalousOnly || filterRecentOnly;

  const hasSearchState = !!query.trim() || hasActiveFilters;

  const updateUrl = useCallback(
    (nextQuery: string, filters: SearchFilters) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("search");
      if (nextQuery.trim()) params.set("q", nextQuery.trim());
      else params.delete("q");

      if (filters.subsystem) params.set("subsystem", filters.subsystem);
      else params.delete("subsystem");

      if (filters.units) params.set("units", filters.units);
      else params.delete("units");

      if (filters.anomalousOnly) params.set("anomalous", "1");
      else params.delete("anomalous");

      if (filters.recentOnly) {
        params.set("recent", "1");
        params.set("recentHours", String(filters.recentHours));
      } else {
        params.delete("recent");
        params.delete("recentHours");
      }

      const next = params.toString();
      router.replace(next ? `${pathname}?${next}` : pathname);
    },
    [pathname, router, searchParams]
  );

  const clearSearchOpenParam = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (!readBooleanParam(params.get("search"))) return;
    params.delete("search");
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname);
  }, [pathname, router, searchParams]);

  const runSearch = useCallback(
    async (nextQuery: string, filters: SearchFilters) => {
      if (!nextQuery.trim()) {
        setSearched(false);
        setResults([]);
        setError(null);
        return;
      }

      setLoading(true);
      setSearched(true);
      setError(null);

      try {
        const params = new URLSearchParams({ q: nextQuery.trim() });
        params.set("source_id", sourceId || DEFAULT_SOURCE_ID);
        if (filters.subsystem) params.set("subsystem", filters.subsystem);
        if (filters.units) params.set("units", filters.units);
        if (filters.anomalousOnly) params.set("anomalous_only", "true");
        if (filters.recentOnly && filters.recentHours > 0) {
          params.set("recent_minutes", String(filters.recentHours * 60));
        }

        const response = await fetch(`${API_URL}/telemetry/search?${params.toString()}`);
        if (!response.ok) {
          const errMsg = response.status === 500 ? "Server error" : String(response.status);
          auditLog("search", { q: nextQuery.trim(), error: errMsg });
          setError(`Search failed: ${errMsg}`);
          setResults([]);
          return;
        }

        const data = await response.json();
        const resultList = Array.isArray(data.results) ? data.results : [];
        auditLog("search", {
          q: nextQuery.trim(),
          source_id: sourceId || undefined,
          subsystem: filters.subsystem || undefined,
          anomalous_only: filters.anomalousOnly,
          units: filters.units || undefined,
          result_count: resultList.length,
        });
        setResults(resultList);
      } catch (err) {
        console.error(err);
        auditLog("search", { q: nextQuery.trim(), error: "Network error" });
        setError("Search failed: Network error");
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [sourceId]
  );

  const loadFilterOptions = useCallback(async () => {
    try {
      const [subsystemsResponse, unitsResponse] = await Promise.all([
        fetch(`${API_URL}/telemetry/subsystems`),
        fetch(`${API_URL}/telemetry/units`),
      ]);
      if (subsystemsResponse.ok) {
        const data = await subsystemsResponse.json();
        setSubsystems(Array.isArray(data.subsystems) ? data.subsystems : []);
      }
      if (unitsResponse.ok) {
        const data = await unitsResponse.json();
        setUnits(Array.isArray(data.units) ? data.units : []);
      }
    } catch {
      // ignore filter option failures
    }
  }, []);

  const loadFavorites = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/telemetry/watchlist`);
      if (!response.ok) return;
      const data = await response.json();
      setFavorites((data.entries || []).map((entry: WatchlistEntry) => entry.name));
    } catch {
      // ignore favorites load failure
    }
  }, []);

  useEffect(() => {
    loadFilterOptions();
    setRecent(getRecentChannels());
  }, [loadFilterOptions]);

  useEffect(() => {
    void loadFavorites();
  }, [loadFavorites, watchlistVersion]);

  useEffect(() => {
    const onFocus = () => setRecent(getRecentChannels());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    const state = readSearchState(searchParams);
    setQuery(state.query);
    setFilterSubsystem(state.filters.subsystem);
    setFilterUnits(state.filters.units);
    setFilterAnomalousOnly(state.filters.anomalousOnly);
    setFilterRecentOnly(state.filters.recentOnly);
    setFilterRecentHours(state.filters.recentHours);
    setAdvancedOpen(
      !!state.filters.subsystem ||
        !!state.filters.units ||
        state.filters.anomalousOnly ||
        state.filters.recentOnly
    );

    if (state.query.trim() || state.open) {
      setOpen(true);
      if (state.query.trim()) {
        void runSearch(state.query, state.filters);
        return;
      }
    }

    setSearched(false);
    setResults([]);
    setError(null);
  }, [runSearch, searchParams]);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    const focusSearch = () => setOpen(true);

    window.addEventListener(OVERVIEW_SEARCH_FOCUS_EVENT, focusSearch);
    try {
      if (sessionStorage.getItem(AUTO_FOCUS_STORAGE_KEY) === "1") {
        sessionStorage.removeItem(AUTO_FOCUS_STORAGE_KEY);
        setOpen(true);
      }
    } catch {}

    return () => window.removeEventListener(OVERVIEW_SEARCH_FOCUS_EVENT, focusSearch);
  }, []);

  const toggleFavorite = async (name: string) => {
    const isFavorite = favorites.includes(name);
    setFavoriteError(null);
    try {
      if (isFavorite) {
        await fetch(`${API_URL}/telemetry/watchlist/${encodeURIComponent(name)}`, {
          method: "DELETE",
        });
        auditLog("watchlist.remove", { name });
        setFavorites((current) => current.filter((entry) => entry !== name));
      } else {
        await fetch(`${API_URL}/telemetry/watchlist`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telemetry_name: name }),
        });
        auditLog("watchlist.add", { telemetry_name: name });
        setFavorites((current) => [...current, name]);
      }
      await onWatchlistChanged?.();
    } catch {
      auditLog(isFavorite ? "watchlist.remove" : "watchlist.add", {
        ...(isFavorite ? { name } : { telemetry_name: name }),
        error: "Failed to update favorites",
      });
      setFavoriteError("Failed to update favorites");
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim()) {
      setError("Enter a search term");
      setSearched(true);
      return;
    }

    updateUrl(query, {
      subsystem: filterSubsystem,
      units: filterUnits,
      anomalousOnly: filterAnomalousOnly,
      recentOnly: filterRecentOnly,
      recentHours: filterRecentHours,
    });
  };

  const clearSearch = () => {
    setQuery("");
    setFilterSubsystem("");
    setFilterUnits("");
    setFilterAnomalousOnly(false);
    setFilterRecentOnly(false);
    setFilterRecentHours(24);
    setAdvancedOpen(false);
    setFavoriteError(null);
    setOpen(false);
    updateUrl("", {
      subsystem: "",
      units: "",
      anomalousOnly: false,
      recentOnly: false,
      recentHours: 24,
    });
  };

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        clearSearchOpenParam();
      }
    },
    [clearSearchOpenParam]
  );

  return (
    <div className="px-0">
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3 text-left shadow-sm transition-colors",
              "hover:border-border hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            )}
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <SearchIcon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">
                {query.trim() || "Search telemetry by meaning, anomaly, subsystem, or units"}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                Scoped to {sourceName} • Opens results under the search bar
              </div>
            </div>
            <div className="hidden shrink-0 items-center gap-1 rounded-full border bg-background px-2 py-1 text-[11px] text-muted-foreground sm:flex">
              <span>/</span>
              <span>⌘K</span>
            </div>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={10}
          className="w-[var(--radix-popover-trigger-width)] max-w-[var(--radix-popover-trigger-width)] rounded-3xl border border-border/70 bg-background p-0 shadow-2xl"
        >
          <div className="border-b border-border/60 px-4 py-4 sm:px-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Telemetry search</h2>
                <p className="text-sm text-muted-foreground">
                  Search within {sourceName}, then jump straight into channel detail.
                </p>
              </div>
              {hasSearchState && (
                <Button type="button" variant="ghost" size="sm" onClick={clearSearch}>
                  Clear
                </Button>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  ref={inputRef}
                  placeholder="Search telemetry (e.g., voltage, temperature, speed)"
                  data-telemetry-search-input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-11 rounded-xl"
                />
                <Button type="submit" disabled={loading} className="h-11 rounded-xl px-5 text-primary-foreground">
                  {loading && (
                    <Spinner
                      size="sm"
                      className="mr-2 shrink-0 border-current border-t-transparent"
                    />
                  )}
                  {loading ? "Searching..." : "Search"}
                </Button>
              </div>

              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <div className="rounded-2xl border border-border/60 bg-muted/20">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium"
                    >
                      <span className="text-left">
                        Advanced filters
                        {hasActiveFilters && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {[
                              filterSubsystem && "subsystem",
                              filterUnits && "units",
                              filterAnomalousOnly && "anomalous",
                              filterRecentOnly && `${filterRecentHours}h recent`,
                            ]
                              .filter(Boolean)
                              .join(" • ")}
                          </span>
                        )}
                      </span>
                      <ChevronDownIcon
                        className={cn(
                          "size-4 text-muted-foreground transition-transform",
                          advancedOpen && "rotate-180"
                        )}
                      />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="border-t border-border/60 px-3 py-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="overview-search-subsystem">Subsystem</Label>
                        <Select
                          value={filterSubsystem || "__all__"}
                          onValueChange={(value) =>
                            setFilterSubsystem(value === "__all__" ? "" : value)
                          }
                        >
                          <SelectTrigger id="overview-search-subsystem" className="w-full">
                            <SelectValue placeholder="All" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">All</SelectItem>
                            {subsystems.map((subsystem) => (
                              <SelectItem key={subsystem} value={subsystem}>
                                {subsystem}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="overview-search-units">Units</Label>
                        <Select
                          value={filterUnits || "__all__"}
                          onValueChange={(value) => setFilterUnits(value === "__all__" ? "" : value)}
                        >
                          <SelectTrigger id="overview-search-units" className="w-full">
                            <SelectValue placeholder="All" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">All</SelectItem>
                            {units.map((unit) => (
                              <SelectItem key={unit} value={unit}>
                                {unit}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="md:col-span-2 flex flex-wrap items-center gap-2">
                        <label className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border/60 bg-background px-3 py-2">
                          <Checkbox
                            checked={filterAnomalousOnly}
                            onCheckedChange={(checked) => setFilterAnomalousOnly(!!checked)}
                          />
                          <span className="text-sm">Only anomalous</span>
                        </label>
                        <div className="inline-flex min-h-10 flex-wrap items-center gap-2 rounded-full border border-border/60 bg-background px-3 py-2">
                          <label className="inline-flex items-center gap-2">
                            <Checkbox
                              checked={filterRecentOnly}
                              onCheckedChange={(checked) => setFilterRecentOnly(!!checked)}
                            />
                            <span className="text-sm">Only recent data</span>
                          </label>
                          {filterRecentOnly && (
                            <>
                              <span className="text-muted-foreground">•</span>
                              <div className="inline-flex items-center gap-2">
                                <Input
                                  type="number"
                                  min={1}
                                  max={168}
                                  value={filterRecentHours}
                                  onChange={(event) =>
                                    setFilterRecentHours(
                                      Math.min(
                                        168,
                                        Math.max(
                                          1,
                                          Number.parseInt(event.target.value, 10) || 24
                                        )
                                      )
                                    )
                                  }
                                  className="h-8 w-16 rounded-lg px-2 text-sm"
                                />
                                <span className="text-sm text-muted-foreground">hours</span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            </form>
          </div>

          <div className="max-h-[min(60vh,34rem)] overflow-y-auto px-4 py-4 sm:px-5">
            {favoriteError && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{favoriteError}</AlertDescription>
              </Alert>
            )}

            {!searched && !query.trim() ? (
              <div className="space-y-5">
                {recent.length > 0 && (
                  <section className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold">Recent channels</h3>
                      <span className="text-xs text-muted-foreground">Quick return</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {recent.map((name) => (
                        <Link
                          key={name}
                          href={buildDetailHref(name, sourceId)}
                          className="rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
                        >
                          {name}
                        </Link>
                      ))}
                    </div>
                  </section>
                )}

                {favorites.length > 0 && (
                  <section className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold">Watchlist favorites</h3>
                      <span className="text-xs text-muted-foreground">
                        Add from results with the star
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {favorites.map((name) => (
                        <Link
                          key={name}
                          href={buildDetailHref(name, sourceId)}
                          className="rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
                        >
                          {name}
                        </Link>
                      ))}
                    </div>
                  </section>
                )}

                {recent.length === 0 && favorites.length === 0 && (
                  <EmptyState
                    icon="search"
                    title="Search telemetry from Overview"
                    description="Start with a semantic query, then refine with filters if you need a tighter result set."
                  />
                )}
              </div>
            ) : error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : results.length === 0 ? (
              <EmptyState
                icon="search"
                title="No results found"
                description="Try a different search term or adjust your filters."
              />
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">Results</h3>
                    <p className="text-xs text-muted-foreground">
                      {results.length} match{results.length === 1 ? "" : "es"} in {sourceName}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  {results.map((result) => {
                    const isFavorite = favorites.includes(result.name);
                    return (
                      <div
                        key={result.name}
                        className="rounded-2xl border border-border/60 bg-card/60 p-3"
                      >
                        <div className="flex items-start gap-3">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => toggleFavorite(result.name)}
                                className="mt-0.5 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                aria-label={
                                  isFavorite
                                    ? `Remove ${result.name} from favorites`
                                    : `Add ${result.name} to favorites`
                                }
                              >
                                <StarIcon
                                  className={cn(
                                    "size-4",
                                    isFavorite && "fill-current text-amber-500"
                                  )}
                                />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {isFavorite ? "Remove from favorites" : "Add to favorites"}
                            </TooltipContent>
                          </Tooltip>

                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <Link
                                href={buildDetailHref(result.name, sourceId)}
                                className="font-medium text-primary hover:underline"
                              >
                                {result.name}
                              </Link>
                              {result.subsystem_tag && (
                                <Badge variant="secondary">{result.subsystem_tag}</Badge>
                              )}
                              {result.current_status && (
                                <Badge variant={statusVariant(result.current_status)}>
                                  {result.current_status}
                                </Badge>
                              )}
                            </div>

                            <p className="mb-2 line-clamp-2 text-sm text-muted-foreground">
                              {result.description || "No description available."}
                            </p>

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              <span>
                                Confidence: {matchConfidenceLabel(result.match_confidence)} (
                                {(result.match_confidence * 100).toFixed(0)}%)
                              </span>
                              <span>Units: {result.units || "—"}</span>
                              <span>
                                Current value:{" "}
                                {result.current_value != null
                                  ? `${result.current_value} ${result.units || ""}`.trim()
                                  : "—"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
