"use client";

import { useMemo, useState } from "react";
import { CheckIcon, SearchIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { TelemetryChannelStreamOption } from "@/lib/query-hooks";
import { cn } from "@/lib/utils";

interface TelemetryStreamSelectorProps {
  streams: TelemetryChannelStreamOption[];
  selectedStreamIds: string[];
  onChange: (streamIds: string[]) => void;
  loading?: boolean;
}

function formatTime(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function streamLabel(stream: TelemetryChannelStreamOption): string {
  return stream.label || formatTime(stream.start_time) || stream.stream_id;
}

function streamMeta(stream: TelemetryChannelStreamOption): string {
  const parts = [
    stream.stream_id,
    stream.start_time ? `Start ${formatTime(stream.start_time)}` : null,
    stream.end_time || stream.last_timestamp
      ? `Last ${formatTime(stream.end_time || stream.last_timestamp)}`
      : null,
    typeof stream.sample_count === "number"
      ? `${stream.sample_count.toLocaleString()} samples`
      : null,
    stream.provider || null,
    stream.summary || null,
  ].filter(Boolean);
  return parts.join(" / ");
}

export function TelemetryStreamSelector({
  streams,
  selectedStreamIds,
  onChange,
  loading = false,
}: TelemetryStreamSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = useMemo(
    () => new Set(selectedStreamIds),
    [selectedStreamIds],
  );
  const byId = useMemo(
    () => new Map(streams.map((stream) => [stream.stream_id, stream])),
    [streams],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return streams;
    return streams.filter((stream) => {
      const haystack = [
        streamLabel(stream),
        streamMeta(stream),
        stream.stream_id,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [query, streams]);

  const toggle = (streamId: string) => {
    if (selected.has(streamId)) {
      onChange(selectedStreamIds.filter((id) => id !== streamId));
    } else {
      onChange([...selectedStreamIds, streamId]);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {selectedStreamIds.length === 0 ? (
          <p className="text-muted-foreground text-sm">No streams selected.</p>
        ) : (
          selectedStreamIds.map((streamId) => {
            const stream = byId.get(streamId);
            return (
              <Badge key={streamId} variant="secondary" className="gap-1">
                <span className="max-w-64 truncate">
                  {stream ? streamLabel(stream) : streamId}
                </span>
                <button
                  type="button"
                  aria-label="Remove stream"
                  onClick={() =>
                    onChange(selectedStreamIds.filter((id) => id !== streamId))
                  }
                >
                  <XIcon className="h-3 w-3" />
                </button>
              </Badge>
            );
          })
        )}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            Add stream
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="flex max-h-[min(22rem,var(--radix-popover-content-available-height,22rem))] w-[min(520px,calc(100vw-2rem))] flex-col overflow-hidden p-0"
        >
          <div className="shrink-0 border-b p-2">
            <div className="relative">
              <SearchIcon className="text-muted-foreground absolute top-2.5 left-2 h-4 w-4" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search streams"
                className="pl-8"
              />
            </div>
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1"
            onWheel={(event) => event.stopPropagation()}
          >
            {loading ? (
              <p className="text-muted-foreground px-3 py-4 text-sm">
                Loading streams...
              </p>
            ) : filtered.length === 0 ? (
              <p className="text-muted-foreground px-3 py-4 text-sm">
                No streams found.
              </p>
            ) : (
              filtered.map((stream) => {
                const active = selected.has(stream.stream_id);
                return (
                  <button
                    key={stream.stream_id}
                    type="button"
                    className={cn(
                      "hover:bg-muted flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm",
                      active && "bg-muted",
                    )}
                    onClick={() => toggle(stream.stream_id)}
                  >
                    <CheckIcon
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0",
                        active ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {streamLabel(stream)}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {streamMeta(stream) || stream.stream_id}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
