"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { addToRecent } from "@/lib/recent-telemetry";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface TelemetryDetailActionsProps {
  name: string;
}

export function TelemetryDetailActions({ name }: TelemetryDetailActionsProps) {
  const [isFavorite, setIsFavorite] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    addToRecent(name);
  }, [name]);

  useEffect(() => {
    async function check() {
      try {
        const res = await fetch(`${API_URL}/telemetry/watchlist`);
        if (res.ok) {
          const d = await res.json();
          const names = (d.entries || []).map((e: { name: string }) => e.name);
          setIsFavorite(names.includes(name));
        }
      } catch {
        // ignore
      }
    }
    check();
  }, [name]);

  const toggleFavorite = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      if (isFavorite) {
        await fetch(
          `${API_URL}/telemetry/watchlist/${encodeURIComponent(name)}`,
          { method: "DELETE" }
        );
        setIsFavorite(false);
      } else {
        await fetch(`${API_URL}/telemetry/watchlist`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telemetry_name: name }),
        });
        setIsFavorite(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [name, isFavorite]);

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
            className="h-8 text-xs gap-1.5"
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
