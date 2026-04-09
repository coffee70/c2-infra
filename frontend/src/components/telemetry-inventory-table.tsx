"use client";

import { useRouter } from "next/navigation";
import { Star, StarOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatSmartValue } from "@/lib/format-value";
import { buildTelemetryDetailHref } from "@/lib/telemetry-routes";
import type { TelemetryInventoryEntry } from "@/lib/query-hooks";

interface TelemetryInventoryTableProps {
  sourceId: string;
  rows: TelemetryInventoryEntry[];
  watchlistNames: Set<string>;
  watchlistBusyName?: string | null;
  onAddToWatchlist: (name: string) => void;
  onRemoveFromWatchlist: (name: string) => void;
}

function formatRelativeTime(timestamp: string | null | undefined): string {
  if (!timestamp) return "Waiting for data";
  const ts = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - ts.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} d ago`;
}

function statusVariant(
  state: string
): "default" | "secondary" | "destructive" | "success" | "outline" {
  if (state === "warning") return "destructive";
  if (state === "normal") return "success";
  if (state === "no_data") return "outline";
  return "secondary";
}

export function TelemetryInventoryTable({
  sourceId,
  rows,
  watchlistNames,
  watchlistBusyName,
  onAddToWatchlist,
  onRemoveFromWatchlist,
}: TelemetryInventoryTableProps) {
  const router = useRouter();

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Status</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Current value</TableHead>
          <TableHead>Units</TableHead>
          <TableHead>Subsystem</TableHead>
          <TableHead>Last updated</TableHead>
          <TableHead>Origin</TableHead>
          <TableHead className="text-right">Watchlist</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const href = buildTelemetryDetailHref(sourceId, row.name);
          const inWatchlist = watchlistNames.has(row.name);
          const watchlistBusy = watchlistBusyName === row.name;
          return (
            <TableRow
              key={row.name}
              className="cursor-pointer"
              tabIndex={0}
              onClick={() => router.push(href)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  router.push(href);
                }
              }}
            >
              <TableCell>
                <Badge variant={statusVariant(row.state)} className="text-xs">
                  {row.state}
                </Badge>
              </TableCell>
              <TableCell className="max-w-[320px] whitespace-normal">
                <div className="font-medium">{row.name}</div>
                {row.description && (
                  <div className="text-muted-foreground line-clamp-2 text-xs">
                    {row.description}
                  </div>
                )}
                {row.aliases.length > 0 && (
                  <div className="text-muted-foreground mt-1 text-xs">
                    Aliases: {row.aliases.join(", ")}
                  </div>
                )}
              </TableCell>
              <TableCell>{formatSmartValue(row.current_value, row.units)}</TableCell>
              <TableCell>{row.units || "—"}</TableCell>
              <TableCell>{row.subsystem_tag}</TableCell>
              <TableCell>{formatRelativeTime(row.last_timestamp)}</TableCell>
              <TableCell>
                <div>{row.channel_origin}</div>
                {row.discovery_namespace && (
                  <div className="text-muted-foreground text-xs">
                    {row.discovery_namespace}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={watchlistBusy}
                  aria-label={inWatchlist ? `Remove ${row.name} from watchlist` : `Add ${row.name} to watchlist`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (inWatchlist) {
                      onRemoveFromWatchlist(row.name);
                    } else {
                      onAddToWatchlist(row.name);
                    }
                  }}
                >
                  {inWatchlist ? (
                    <Star className="size-4 fill-current" />
                  ) : (
                    <StarOff className="size-4" />
                  )}
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
