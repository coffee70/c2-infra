"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/empty-state";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function WatchlistConfig() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<{ name: string; display_order: number }[]>([]);
  const [allNames, setAllNames] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingName, setAddingName] = useState<string | null>(null);

  const watchlistNames = new Set(entries.map((e) => e.name));
  const availableToAdd = allNames.filter(
    (n) =>
      !watchlistNames.has(n) &&
      n.toLowerCase().includes(searchQuery.toLowerCase())
  );

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const [watchRes, listRes] = await Promise.all([
        fetch(`${API_URL}/telemetry/watchlist`, { cache: "no-store" }),
        fetch(`${API_URL}/telemetry/list`, { cache: "no-store" }),
      ]);
      if (watchRes.ok) {
        const w = await watchRes.json();
        setEntries(w.entries || []);
      }
      if (listRes.ok) {
        const l = await listRes.json();
        setAllNames(l.names || []);
      }
    } catch (e) {
      setError("Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) fetchData();
  }, [open]);

  async function handleAdd(name: string) {
    setAddingName(name);
    try {
      const res = await fetch(`${API_URL}/telemetry/watchlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telemetry_name: name }),
      });
      if (res.ok) {
        await fetchData();
        router.refresh();
      }
    } catch {
      setError("Failed to add");
    } finally {
      setAddingName(null);
    }
  }

  async function handleRemove(name: string) {
    try {
      const res = await fetch(
        `${API_URL}/telemetry/watchlist/${encodeURIComponent(name)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        await fetchData();
        router.refresh();
      }
    } catch {
      setError("Failed to remove");
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        Edit watchlist
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle id="watchlist-config-title">Configure Watchlist</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto max-h-[60vh] pr-2">
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <div>
              <h4 className="text-sm font-medium mb-2">Current watchlist</h4>
                {loading ? (
                  <div className="flex items-center gap-2 py-4">
                    <Spinner size="sm" />
                    <span className="text-sm text-muted-foreground">Loading...</span>
                  </div>
                ) : entries.length === 0 ? (
                  <EmptyState
                    icon="chart"
                    title="No channels in watchlist"
                    description="Add channels using the search below."
                  />
                ) : (
                  <ul className="space-y-2">
                    {entries.map((e) => (
                      <li
                        key={e.name}
                        className="flex items-center justify-between gap-2 p-2 rounded border"
                      >
                        <span className="text-sm font-medium truncate">
                          {e.name}
                        </span>
                        <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                          onClick={() => handleRemove(e.name)}
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h4 className="text-sm font-medium mb-2">Add channel</h4>
                <Input
                  placeholder="Search telemetry..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="mb-2"
                />
                <ul className="space-y-1 max-h-40 overflow-y-auto">
                  {availableToAdd.slice(0, 20).map((name) => (
                    <li key={name}>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full justify-start text-left font-normal"
                        onClick={() => handleAdd(name)}
                        disabled={addingName === name}
                      >
                        {addingName === name ? "Adding..." : `+ ${name}`}
                      </Button>
                    </li>
                  ))}
                  {availableToAdd.length === 0 && searchQuery && (
                    <EmptyState
                      title="No matches"
                      description="Try a different search term."
                    />
                  )}
                  {availableToAdd.length === 0 && !searchQuery && (
                    <EmptyState
                      icon="chart"
                      title="All telemetry already in watchlist"
                      description="Every channel is already in your watchlist."
                    />
                  )}
                </ul>
              </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
