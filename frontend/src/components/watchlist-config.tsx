"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
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
import {
  useAddToWatchlistMutation,
  useRemoveFromWatchlistMutation,
  useTelemetryListQuery,
  useWatchlistQuery,
} from "@/lib/query-hooks";
const ADD_RESULTS_CAP = 30;
const ADDED_SUCCESS_MS = 1500;

interface WatchlistConfigProps {
  sourceId: string;
  onChanged?: () => void | Promise<void>;
}

export function WatchlistConfig({ sourceId, onChanged }: WatchlistConfigProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [addedName, setAddedName] = useState<string | null>(null);
  const watchlistQuery = useWatchlistQuery(sourceId, open);
  const telemetryListQuery = useTelemetryListQuery(sourceId, open);
  const addMutation = useAddToWatchlistMutation(sourceId, {
    onSuccess: async () => {
      await onChanged?.();
    },
  });
  const removeMutation = useRemoveFromWatchlistMutation(sourceId, {
    onSuccess: async () => {
      await onChanged?.();
    },
  });

  const entries = useMemo(() => watchlistQuery.data ?? [], [watchlistQuery.data]);
  const allChannels = telemetryListQuery.data ?? [];
  const loading = watchlistQuery.isLoading || telemetryListQuery.isLoading;
  const error = watchlistQuery.error?.message
    || telemetryListQuery.error?.message
    || (addMutation.isError ? "Failed to add" : null)
    || (removeMutation.isError ? "Failed to remove" : null);
  const addingName = addMutation.variables ?? null;
  const removingName = removeMutation.variables ?? null;

  const watchlistNames = useMemo(() => new Set(entries.map((e) => e.name)), [entries]);
  const availableToAdd = allChannels.filter(
    (channel) =>
      !watchlistNames.has(channel.name) &&
      channel.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const displayedAvailable = availableToAdd.slice(0, ADD_RESULTS_CAP);

  async function handleAdd(name: string) {
    try {
      await addMutation.mutateAsync(name);
      setAddedName(name);
      window.setTimeout(() => setAddedName(null), ADDED_SUCCESS_MS);
    } catch {}
  }

  async function handleRemove(name: string) {
    try {
      await removeMutation.mutateAsync(name);
    } catch {}
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
        <DialogContent className="flex max-h-[80vh] max-w-lg flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle id="watchlist-config-title">Configure Watchlist</DialogTitle>
            <DialogDescription id="watchlist-config-description">
              Add or remove channels shown on the Overview. Order here matches the cards.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-2">
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <section aria-labelledby="current-watchlist-heading">
              <h4 id="current-watchlist-heading" className="mb-2 text-sm font-medium">
                Current watchlist ({entries.length})
              </h4>
              {loading ? (
                <div className="flex items-center gap-2 py-4">
                  <Spinner size="sm" />
                  <span className="text-muted-foreground text-sm">Loading...</span>
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
                      className="flex items-center justify-between gap-2 rounded border p-2"
                    >
                      <span className="truncate text-sm font-medium">
                        {e.name}
                      </span>
                      {e.channel_origin === "discovered" && (
                        <Badge variant="outline" className="shrink-0">
                          Discovered
                        </Badge>
                      )}
                      <Button
                        variant="outline"
                        size="icon"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                        onClick={() => handleRemove(e.name)}
                        disabled={removeMutation.isPending}
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
              <h4 id="add-channel-heading" className="mb-2 text-sm font-medium">
                Add channel — {availableToAdd.length} of {allChannels.length} available
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
                <p id="add-channel-hint" className="text-muted-foreground mb-2 text-xs">
                  Showing up to {ADD_RESULTS_CAP} matches. Narrow your search to see fewer.
                </p>
              )}
              <ul className="max-h-48 space-y-1 overflow-y-auto" role="list">
                {displayedAvailable.map((channel) => (
                  <li key={channel.name}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-between gap-2 text-left font-normal"
                      onClick={() => handleAdd(channel.name)}
                      disabled={addMutation.isPending && addingName !== channel.name}
                    >
                      <span className="truncate">
                        {addedName === channel.name ? "Added" : addingName === channel.name ? "Adding..." : `+ ${channel.name}`}
                      </span>
                      {channel.channel_origin === "discovered" && (
                        <Badge variant="outline" className="shrink-0">
                          Discovered
                        </Badge>
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
              {availableToAdd.length === 0 && !searchQuery && allChannels.length > 0 && (
                <EmptyState
                  icon="chart"
                  title="All telemetry already in watchlist"
                  description="Every channel is already in your watchlist."
                />
              )}
            </section>
          </div>
          <DialogFooter className="mt-2 border-t pt-4">
            <Button onClick={() => setOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
