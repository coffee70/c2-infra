"use client";

import { useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { addToRecent } from "@/lib/recent-telemetry";
import {
  useAddToWatchlistMutation,
  useRemoveFromWatchlistMutation,
  useWatchlistNames,
} from "@/lib/query-hooks";

interface TelemetryDetailActionsProps {
  name: string;
  sourceId: string;
}

export function TelemetryDetailActions({ name, sourceId }: TelemetryDetailActionsProps) {
  const { names } = useWatchlistNames(sourceId);
  const addMutation = useAddToWatchlistMutation(sourceId);
  const removeMutation = useRemoveFromWatchlistMutation(sourceId);
  const isFavorite = names.includes(name);
  const loading = addMutation.isPending || removeMutation.isPending;
  const error = addMutation.isError || removeMutation.isError;

  useEffect(() => {
    addToRecent(sourceId, name);
  }, [name, sourceId]);

  const toggleFavorite = useCallback(async () => {
    if (isFavorite) {
      await removeMutation.mutateAsync(name);
    } else {
      await addMutation.mutateAsync(name);
    }
  }, [addMutation, isFavorite, name, removeMutation]);

  useEffect(() => {
    const handler = () => toggleFavorite();
    window.addEventListener("telemetry-toggle-favorite", handler);
    return () => window.removeEventListener("telemetry-toggle-favorite", handler);
  }, [toggleFavorite]);

  return (
    <div className="flex flex-col gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleFavorite}
            disabled={loading}
            className="h-8 gap-1.5 text-xs"
            aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
          >
        {loading ? (
          <Spinner size="sm" className="shrink-0" />
        ) : (
          <span>{isFavorite ? "★" : "☆"}</span>
        )}
        {loading ? "Updating..." : isFavorite ? "Remove from Favorites" : "Add to Favorites"}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {isFavorite ? "Remove from favorites" : "Add to favorites"}
        </TooltipContent>
      </Tooltip>
      {error && (
        <Alert variant="destructive" className="py-2">
          <AlertDescription className="text-xs">
            Failed to update favorites
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
