"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
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

function matchConfidenceLabel(score: number): string {
  const pct = score * 100;
  if (pct >= 80) return "High";
  if (pct >= 50) return "Medium";
  return "Low";
}

import { getRecentChannels } from "@/lib/recent-telemetry";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [subsystems, setSubsystems] = useState<string[]>([]);
  const [units, setUnits] = useState<string[]>([]);
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
      const [subRes, unitsRes] = await Promise.all([
        fetch(`${API_URL}/telemetry/subsystems`),
        fetch(`${API_URL}/telemetry/units`),
      ]);
      if (subRes.ok) {
        const d = await subRes.json();
        setSubsystems(d.subsystems || []);
      }
      if (unitsRes.ok) {
        const d = await unitsRes.json();
        setUnits(d.units || []);
      }
    } catch {
      // ignore
    }
  }, []);

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

  const toggleFavorite = async (name: string) => {
    const isFav = favorites.includes(name);
    setFavoriteError(null);
    try {
      if (isFav) {
        await fetch(`${API_URL}/telemetry/watchlist/${encodeURIComponent(name)}`, {
          method: "DELETE",
        });
        setFavorites((prev) => prev.filter((n) => n !== name));
      } else {
        await fetch(`${API_URL}/telemetry/watchlist`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telemetry_name: name }),
        });
        setFavorites((prev) => [...prev, name]);
      }
    } catch {
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
        setError(
          `Search failed: ${res.status === 500 ? "Server error" : res.status}`
        );
        setResults([]);
        return;
      }
      const data = await res.json();
      setResults(data.results || []);
    } catch (err) {
      console.error(err);
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
