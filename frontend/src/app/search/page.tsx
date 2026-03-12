"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { runIdToSourceId } from "@/components/context-banner";
import { auditLog } from "@/lib/audit-log";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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
  source_type?: string;
}

/** Friendly label for ephemeral simulator run source_ids. */
function formatRunSourceLabel(sourceId: string): string {
  if (!sourceId.startsWith("simulator-")) return sourceId;
  const rest = sourceId.slice("simulator-".length);
  const lastDash = rest.lastIndexOf("-");
  const scenario = lastDash > 0 ? rest.slice(0, lastDash).replace(/-/g, " ") : rest;
  const ts = lastDash > 0 ? rest.slice(lastDash + 1) : "";
  if (ts) return `Sim run: ${scenario} (${ts})`;
  return `Sim run: ${scenario}`;
}

function matchConfidenceLabel(score: number): string {
  const pct = score * 100;
  if (pct >= 80) return "High";
  if (pct >= 50) return "Medium";
  return "Low";
}

import { getRecentChannels } from "@/lib/recent-telemetry";

const DEFAULT_SOURCE_ID = "default";

function SearchPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sourceFromUrl = searchParams.get("source");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [subsystems, setSubsystems] = useState<string[]>([]);
  const [units, setUnits] = useState<string[]>([]);
  const [sources, setSources] = useState<TelemetrySource[]>([]);
  const [filterSourceId, setFilterSourceId] = useState<string>(DEFAULT_SOURCE_ID);
  const [filterSubsystem, setFilterSubsystem] = useState<string>("");
  const [filterUnits, setFilterUnits] = useState<string>("");
  const [filterAnomalousOnly, setFilterAnomalousOnly] = useState(false);
  const [filterRecentOnly, setFilterRecentOnly] = useState(false);
  const [filterRecentHours, setFilterRecentHours] = useState(24);

  // Recent & Favorites
  const [recent, setRecent] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);

  const loadFilterOptions = useCallback(async () => {
    try {
      const [subRes, unitsRes, sourcesRes] = await Promise.all([
        fetch(`${API_URL}/telemetry/subsystems`),
        fetch(`${API_URL}/telemetry/units`),
        fetch(`${API_URL}/telemetry/sources`, { cache: "no-store" }),
      ]);
      if (subRes.ok) {
        const d = await subRes.json();
        setSubsystems(d.subsystems || []);
      }
      if (unitsRes.ok) {
        const d = await unitsRes.json();
        setUnits(d.units || []);
      }
      if (sourcesRes.ok) {
        const data = await sourcesRes.json();
        setSources(Array.isArray(data) ? data : []);
      }
    } catch {
      // ignore
    }
  }, []);

  // Sync source filter from URL; normalize run IDs to source IDs and clean URL (match Overview behavior).
  useEffect(() => {
    if (!sourceFromUrl || !sourceFromUrl.trim()) return;
    const raw = sourceFromUrl.trim();
    const isRunId = /-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z?$/.test(raw);
    const sourceId = isRunId ? runIdToSourceId(raw) : raw;
    setFilterSourceId(sourceId);
    if (isRunId) {
      router.replace(
        sourceId === DEFAULT_SOURCE_ID
          ? pathname
          : `${pathname}?source=${encodeURIComponent(sourceId)}`
      );
    }
  }, [sourceFromUrl, pathname, router]);

  const loadFavorites = useCallback(async () => {
    setFavoritesLoading(true);
    try {
      const res = await fetch(`${API_URL}/telemetry/watchlist`);
      if (res.ok) {
        const d = await res.json();
        setFavorites((d.entries || []).map((e: WatchlistEntry) => e.name));
      }
    } catch {
      // ignore
    } finally {
      setFavoritesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFilterOptions();
    loadFavorites();
    setRecent(getRecentChannels());
  }, [loadFilterOptions, loadFavorites]);

  // Refresh recent when returning to page (e.g. from detail)
  useEffect(() => {
    const onFocus = () => setRecent(getRecentChannels());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const sourceOptions = useMemo(() => {
    const byId = new Map(sources.map((s) => [s.id, s]));
    if (filterSourceId && !byId.has(filterSourceId)) {
      byId.set(filterSourceId, {
        id: filterSourceId,
        name: formatRunSourceLabel(filterSourceId),
      });
    }
    if (!byId.has(DEFAULT_SOURCE_ID)) {
      byId.set(DEFAULT_SOURCE_ID, { id: DEFAULT_SOURCE_ID, name: "Default" });
    }
    return Array.from(byId.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  }, [sources, filterSourceId]);

  const toggleFavorite = async (name: string) => {
    const isFav = favorites.includes(name);
    setFavoriteError(null);
    try {
      if (isFav) {
        await fetch(`${API_URL}/telemetry/watchlist/${encodeURIComponent(name)}`, {
          method: "DELETE",
        });
        auditLog("watchlist.remove", { name });
        setFavorites((prev) => prev.filter((n) => n !== name));
      } else {
        await fetch(`${API_URL}/telemetry/watchlist`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telemetry_name: name }),
        });
        auditLog("watchlist.add", { telemetry_name: name });
        setFavorites((prev) => [...prev, name]);
      }
    } catch {
      auditLog(isFav ? "watchlist.remove" : "watchlist.add", {
        ...(isFav ? { name } : { telemetry_name: name }),
        error: "Failed to update favorites",
      });
      setFavoriteError("Failed to update favorites");
    }
  };

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) {
      setError("Enter a search term");
      setSearched(true);
      return;
    }
    setLoading(true);
    setSearched(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: query.trim() });
      params.set("source_id", filterSourceId || DEFAULT_SOURCE_ID);
      if (filterSubsystem) params.set("subsystem", filterSubsystem);
      if (filterAnomalousOnly) params.set("anomalous_only", "true");
      if (filterUnits) params.set("units", filterUnits);
      if (filterRecentOnly && filterRecentHours > 0) {
        params.set("recent_minutes", String(filterRecentHours * 60));
      }
      const res = await fetch(
        `${API_URL}/telemetry/search?${params.toString()}`
      );
      if (!res.ok) {
        const errMsg = res.status === 500 ? "Server error" : String(res.status);
        auditLog("search", { q: query.trim(), error: errMsg });
        setError(`Search failed: ${errMsg}`);
        setResults([]);
        return;
      }
      const data = await res.json();
      const resultsList = data.results || [];
      auditLog("search", {
        q: query.trim(),
        source_id: filterSourceId || undefined,
        subsystem: filterSubsystem || undefined,
        anomalous_only: filterAnomalousOnly,
        units: filterUnits || undefined,
        result_count: resultsList.length,
      });
      setResults(resultsList);
    } catch (err) {
      console.error(err);
      auditLog("search", { q: query.trim(), error: "Network error" });
      setError("Search failed: Network error");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  const statusVariant = (s: string | null | undefined) => {
    if (!s) return "secondary";
    if (s === "warning") return "destructive";
    if (s === "caution") return "secondary";
    return "success";
  };

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Search Telemetry</h1>
        </div>

        {/* Recent & Favorites */}
        {(recent.length > 0 || favorites.length > 0) && (
          <div className="grid gap-4 md:grid-cols-2">
            {recent.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Recent</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {recent.map((name) => (
                      <Link
                        key={name}
                        href={`/telemetry/${encodeURIComponent(name)}`}
                        className="text-sm px-3 py-1.5 rounded-md border hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 text-primary hover:underline underline-offset-4"
                      >
                        {name}
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
            {favorites.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Favorites</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {favorites.map((name) => (
                      <Link
                        key={name}
                        href={`/telemetry/${encodeURIComponent(name)}`}
                        className="text-sm px-3 py-1.5 rounded-md border hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 text-primary hover:underline underline-offset-4"
                      >
                        {name}
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        <form onSubmit={handleSearch} className="flex gap-2">
          <Input
            placeholder="Search telemetry (e.g., voltage, temperature, speed)"
            data-telemetry-search-input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 min-w-0"
          />
          <Button type="submit" disabled={loading} className="gap-2">
            {loading && <Spinner size="sm" className="shrink-0" />}
            {loading ? "Searching..." : "Search"}
          </Button>
        </form>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex items-center gap-2">
                <Label htmlFor="filter-source" className="text-sm font-medium">
                  Source
                </Label>
                <Select
                  value={filterSourceId || DEFAULT_SOURCE_ID}
                  onValueChange={(v) => {
                    const next = v || DEFAULT_SOURCE_ID;
                    setFilterSourceId(next);
                    const url = next === DEFAULT_SOURCE_ID
                      ? pathname
                      : `${pathname}?source=${encodeURIComponent(next)}`;
                    router.replace(url);
                  }}
                >
                  <SelectTrigger id="filter-source" className="h-9 w-auto min-w-[180px]">
                    <SelectValue placeholder="Source" />
                  </SelectTrigger>
                  <SelectContent>
                    {sourceOptions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name || s.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="filter-subsystem" className="text-sm font-medium">
                  Subsystem
                </Label>
                <Select
                  value={filterSubsystem || "__all__"}
                  onValueChange={(v) => setFilterSubsystem(v === "__all__" ? "" : v)}
                >
                  <SelectTrigger id="filter-subsystem" className="h-9 w-auto min-w-[120px]">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All</SelectItem>
                    {subsystems.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="filter-units" className="text-sm font-medium">
                  Units
                </Label>
                <Select
                  value={filterUnits || "__all__"}
                  onValueChange={(v) => setFilterUnits(v === "__all__" ? "" : v)}
                >
                  <SelectTrigger id="filter-units" className="h-9 w-auto min-w-[120px]">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All</SelectItem>
                    {units.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="filter-anomalous"
                  checked={filterAnomalousOnly}
                  onCheckedChange={(c) => setFilterAnomalousOnly(!!c)}
                />
                <Label htmlFor="filter-anomalous" className="text-sm font-normal cursor-pointer">
                  Only anomalous
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="filter-recent"
                  checked={filterRecentOnly}
                  onCheckedChange={(c) => setFilterRecentOnly(!!c)}
                />
                <Label htmlFor="filter-recent" className="text-sm font-normal cursor-pointer">
                  Only channels with recent data
                </Label>
              </div>
              {filterRecentOnly && (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    id="filter-recent-hours"
                    min={1}
                    max={168}
                    value={filterRecentHours}
                    onChange={(e) =>
                      setFilterRecentHours(parseInt(e.target.value, 10) || 24)
                    }
                    className="w-16 h-9"
                  />
                  <label htmlFor="filter-recent-hours" className="text-sm">
                    hours
                  </label>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {favoriteError && (
          <Alert variant="destructive">
            <AlertDescription>{favoriteError}</AlertDescription>
          </Alert>
        )}
        {searched && (
          <Card>
            <CardHeader>
              <CardTitle>Results</CardTitle>
            </CardHeader>
            <CardContent>
              {error ? (
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
                <div className="overflow-x-auto">
                <Table aria-label="Search results">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Subsystem</TableHead>
                      <TableHead>Units</TableHead>
                      <TableHead>Current Value</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Match confidence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r) => (
                      <TableRow key={r.name}>
                        <TableCell className="w-8">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => toggleFavorite(r.name)}
                                className="text-lg leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
                                aria-label={
                                  favorites.includes(r.name)
                                    ? `Remove ${r.name} from favorites`
                                    : `Add ${r.name} to favorites`
                                }
                              >
                                {favorites.includes(r.name) ? "★" : "☆"}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {favorites.includes(r.name)
                                ? "Remove from favorites"
                                : "Add to favorites"}
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/telemetry/${encodeURIComponent(r.name)}`}
                            className="font-medium text-primary hover:underline underline-offset-4"
                          >
                            {r.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-md">
                          {r.description || "—"}
                        </TableCell>
                        <TableCell>
                          {r.subsystem_tag ? (
                            <Badge variant="secondary">{r.subsystem_tag}</Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>{r.units || "—"}</TableCell>
                        <TableCell>
                          {r.current_value != null
                            ? `${r.current_value} ${r.units || ""}`.trim()
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {r.current_status ? (
                            <Badge variant={statusVariant(r.current_status)}>
                              {r.current_status}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-muted-foreground text-sm">
                            {matchConfidenceLabel(r.match_confidence)} (
                            {(r.match_confidence * 100).toFixed(0)}%)
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="min-h-screen p-4 flex items-center justify-center"><Spinner /></div>}>
      <SearchPageContent />
    </Suspense>
  );
}
