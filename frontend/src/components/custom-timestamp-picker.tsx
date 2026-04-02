"use client";

import { useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TimePickerInput } from "@/components/time-picker/time-picker-input";
import { cn } from "@/lib/utils";
import { CalendarIcon } from "lucide-react";

/** Date for the time picker: the real UTC instant so getUTCHours/getUTCMinutes (with useUTC) show correct values in any timezone. */
function timeDisplayDateFromIso(iso: string): Date {
  return new Date(iso);
}

/** Default when value is null: current time in UTC. */
function defaultTimeDisplayDate(): Date {
  const n = new Date();
  return new Date(
    Date.UTC(
      n.getUTCFullYear(),
      n.getUTCMonth(),
      n.getUTCDate(),
      n.getUTCHours(),
      n.getUTCMinutes()
    )
  );
}

export interface CustomTimestampPickerProps {
  /** ISO date-time string or null */
  value: string | null;
  onChange: (iso: string | null) => void;
  placeholder?: string;
  id?: string;
  /** Aria-label for the trigger button */
  "aria-label"?: string;
  className?: string;
}

export function CustomTimestampPicker({
  value,
  onChange,
  placeholder = "Select date and time",
  id = "custom-timestamp",
  "aria-label": ariaLabel,
  className,
}: CustomTimestampPickerProps) {
  const minuteRef = useRef<HTMLInputElement>(null);
  const hourRef = useRef<HTMLInputElement>(null);

  const timeDisplayDate = useMemo(
    () => (value ? timeDisplayDateFromIso(value) : defaultTimeDisplayDate()),
    [value]
  );

  const handleTimeSetDate = (date: Date | undefined) => {
    if (!date) {
      onChange(null);
      return;
    }
    // Date part must be UTC: from value when present, else "now" UTC (picker may pass local-date dates when value is null).
    const base = value ? new Date(value) : new Date();
    const y = base.getUTCFullYear();
    const m = base.getUTCMonth();
    const d = base.getUTCDate();
    // Time part: with useUTC the picker edits UTC; read back with getUTCHours/getUTCMinutes.
    onChange(
      new Date(
        Date.UTC(y, m, d, date.getUTCHours(), date.getUTCMinutes())
      ).toISOString()
    );
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("h-8", className)}
          aria-label={ariaLabel}
        >
          <CalendarIcon className="mr-2 h-3.5 w-3.5" />
          {value
            ? new Date(value).toLocaleString(undefined, {
                timeZone: "UTC",
                year: "numeric",
                month: "short",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })
            : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex flex-col gap-3 p-3" align="start">
        <Calendar
          selected={value ? new Date(value) : undefined}
          onSelect={(date) => {
            if (!date) {
              onChange(null);
              return;
            }
            // Use calendar's local date components so the selected day is preserved (no timezone shift).
            // Interpret that day as 00:00 UTC; if we have an existing value, keep its time.
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, "0");
            const day = String(date.getDate()).padStart(2, "0");
            const isoDate = `${y}-${m}-${day}`;
            const timePart = value
              ? new Date(value).toISOString().slice(11, 19)
              : "00:00:00";
            const combined = new Date(`${isoDate}T${timePart}Z`);
            onChange(combined.toISOString());
          }}
        />
        <div className="flex items-center gap-2">
          <Label
            className="text-muted-foreground text-[11px]"
            id={`${id}-time-label`}
          >
            Time (UTC)
          </Label>
          <div className="flex items-center gap-1">
            <div className="grid gap-1 text-center">
              <TimePickerInput
                picker="hours"
                date={timeDisplayDate}
                setDate={handleTimeSetDate}
                useUTC
                ref={hourRef}
                onRightFocus={() => minuteRef.current?.focus()}
                aria-label="Hours (UTC)"
              />
            </div>
            <span className="text-muted-foreground text-sm font-medium">:</span>
            <div className="grid gap-1 text-center">
              <TimePickerInput
                picker="minutes"
                date={timeDisplayDate}
                setDate={handleTimeSetDate}
                useUTC
                ref={minuteRef}
                onLeftFocus={() => hourRef.current?.focus()}
                aria-label="Minutes (UTC)"
              />
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 text-[11px]"
            onClick={() => onChange(null)}
          >
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
