"use client";

import { useState, useEffect, useCallback } from "react";
import { Trash2, Check } from "lucide-react";
import { auditLog } from "@/lib/audit-log";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/empty-state";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const ADD_RESULTS_CAP = 30;
const ADDED_SUCCESS_MS = 1500;

interface WatchlistConfigProps {
  onChanged?: () => void | Promise<void>;
}

export function WatchlistConfig({ onChanged }: WatchlistConfigProps) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<{ name: string; display_order: number }[]>([]);
  const [allNames, setAllNames] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingName, setAddingName] = useState<string | null>(null);
  const [removingName, setRemovingName] = useState<string | null>(null);
  const [addedName, setAddedName] = useState<string | null>(null);

  const watchlistNames = new Set(entries.map((e) => e.name));
  const availableToAdd = allNames.filter(
    (n) =>
      !watchlistNames.has(n) &&
      n.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const displayedAvailable = availableToAdd.slice(0, ADD_RESULTS_CAP);

  const clearAddedFlash = useCallback(() => setAddedName(null), []);

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
    } catch {
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
    setError(null);
    try {
      const res = await fetch(`${API_URL}/telemetry/watchlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telemetry_name: name }),
      });
      if (res.ok) {
        auditLog("watchlist.add", { telemetry_name: name });
        setAddedName(name);
        setTimeout(clearAddedFlash, ADDED_SUCCESS_MS);
        await fetchData();
        await onChanged?.();
      } else {
        setError("Failed to add");
      }
    } catch {
      auditLog("watchlist.add", { telemetry_name: name, error: "Failed to add" });
      setError("Failed to add");
    } finally {
      setAddingName(null);
    }
  }

  async function handleRemove(name: string) {
    setRemovingName(name);
    setError(null);
    try {
      const res = await fetch(
        `${API_URL}/telemetry/watchlist/${encodeURIComponent(name)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        auditLog("watchlist.remove", { name });
        await fetchData();
        await onChanged?.();
      } else {
        setError("Failed to remove");
      }
    } catch {
      auditLog("watchlist.remove", { name, error: "Failed to remove" });
      setError("Failed to remove");
    } finally {
      setRemovingName(null);
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
        <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle id="watchlist-config-title">Configure Watchlist</DialogTitle>
            <DialogDescription id="watchlist-config-description">
              Add or remove channels shown on the Overview. Order here matches the cards.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 overflow-y-auto max-h-[60vh] pr-2">
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <section aria-labelledby="current-watchlist-heading">
              <h4 id="current-watchlist-heading" className="text-sm font-medium mb-2">
                Current watchlist ({entries.length})
              </h4>
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
                <ul className="space-y-2" role="list">
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
                        size="icon"
                        className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleRemove(e.name)}
                        disabled={removingName !== null}
                        aria-label={`Remove ${e.name} from watchlist`}
                      >
                        {removingName === e.name ? (
                          <Spinner size="sm" className="size-4" />
                        ) : (
                          <Trash2 className="size-4" aria-hidden />
                        )}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <Separator />

            <section aria-labelledby="add-channel-heading">
              <h4 id="add-channel-heading" className="text-sm font-medium mb-2">
                Add channel — {availableToAdd.length} of {allNames.length} available
              </h4>
              <Label htmlFor="watchlist-search" className="sr-only">
                Search by name to add a channel
              </Label>
              <Input
                id="watchlist-search"
                placeholder="Search by name to add a channel"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="mb-2"
                aria-describedby={availableToAdd.length > ADD_RESULTS_CAP ? "add-channel-hint" : undefined}
              />
              {availableToAdd.length > ADD_RESULTS_CAP && (
                <p id="add-channel-hint" className="text-xs text-muted-foreground mb-2">
                  Showing up to {ADD_RESULTS_CAP} matches. Narrow your search to see fewer.
                </p>
              )}
              <ul className="space-y-1 max-h-48 overflow-y-auto" role="list">
                {displayedAvailable.map((name) => (
                  <li key={name}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start text-left font-normal"
                      onClick={() => handleAdd(name)}
                      disabled={addingName !== null && addingName !== name}
                    >
                      {addedName === name ? (
                        <>
                          <Check className="size-4 shrink-0 mr-2 text-green-600" aria-hidden />
                          Added
                        </>
                      ) : addingName === name ? (
                        "Adding..."
                      ) : (
                        `+ ${name}`
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
              {availableToAdd.length === 0 && searchQuery && (
                <EmptyState
                  title="No matches"
                  description="Try a different search term."
                />
              )}
              {availableToAdd.length === 0 && !searchQuery && allNames.length > 0 && (
                <EmptyState
                  icon="chart"
                  title="All telemetry already in watchlist"
                  description="Every channel is already in your watchlist."
                />
              )}
            </section>
          </div>
          <DialogFooter className="border-t pt-4 mt-2">
            <Button onClick={() => setOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
