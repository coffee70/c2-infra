"use client";

import * as React from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

type CalendarDay = {
  date: Date;
  label: string;
  isCurrentMonth: boolean;
};

export interface CalendarProps {
  className?: string;
  selected?: Date;
  onSelect?: (date: Date | undefined) => void;
}

export function Calendar({ className, selected, onSelect }: CalendarProps) {
  const [view, setView] = React.useState<Date>(() => selected ?? new Date());

  React.useEffect(() => {
    if (selected) {
      setView(selected);
    }
  }, [selected]);

  const startOfMonth = React.useMemo(() => {
    const d = new Date(view);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [view]);

  const grid = React.useMemo<CalendarDay[]>(() => {
    const days: CalendarDay[] = [];
    const firstWeekday = startOfMonth.getDay(); // 0-6
    const prevMonth = new Date(startOfMonth);
    prevMonth.setMonth(prevMonth.getMonth() - 1);
    const daysInPrevMonth = new Date(
      prevMonth.getFullYear(),
      prevMonth.getMonth() + 1,
      0,
    ).getDate();

    // Leading days from previous month
    for (let i = firstWeekday - 1; i >= 0; i--) {
      const date = new Date(prevMonth);
      date.setDate(daysInPrevMonth - i);
      days.push({
        date,
        label: String(date.getDate()),
        isCurrentMonth: false,
      });
    }

    // Current month days
    const daysInMonth = new Date(
      startOfMonth.getFullYear(),
      startOfMonth.getMonth() + 1,
      0,
    ).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(startOfMonth);
      date.setDate(d);
      days.push({
        date,
        label: String(d),
        isCurrentMonth: true,
      });
    }

    // Trailing days to complete 6x7 grid
    const remaining = 42 - days.length;
    const nextMonth = new Date(startOfMonth);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    for (let d = 1; d <= remaining; d++) {
      const date = new Date(nextMonth);
      date.setDate(d);
      days.push({
        date,
        label: String(d),
        isCurrentMonth: false,
      });
    }

    return days;
  }, [startOfMonth]);

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const handleSelect = (day: CalendarDay) => {
    if (!onSelect) return;
    if (selected && isSameDay(selected, day.date)) {
      onSelect(undefined);
    } else {
      onSelect(day.date);
      setView(day.date);
    }
  };

  const monthLabel = view.toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className={cn("p-2 rounded-md border bg-popover", className)}>
      <div className="flex items-center justify-between mb-2 px-1">
        <button
          type="button"
          className={cn(
            buttonVariants({ variant: "outline", size: "icon" }),
            "h-7 w-7 bg-transparent p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
          onClick={() => {
            const d = new Date(view);
            d.setMonth(d.getMonth() - 1);
            setView(d);
          }}
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <div className="text-sm font-medium">{monthLabel}</div>
        <button
          type="button"
          className={cn(
            buttonVariants({ variant: "outline", size: "icon" }),
            "h-7 w-7 bg-transparent p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
          onClick={() => {
            const d = new Date(view);
            d.setMonth(d.getMonth() + 1);
            setView(d);
          }}
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-[0.7rem] text-muted-foreground px-1">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
          <div key={d} className="h-5 text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1 px-1">
        {grid.map((day) => {
          const isSelected = selected && isSameDay(selected, day.date);
          const isToday = isSameDay(day.date, new Date());
          return (
            <button
              key={day.date.toISOString()}
              type="button"
              onClick={() => handleSelect(day)}
              className={cn(
                "h-8 w-8 rounded-md text-xs flex items-center justify-center",
                "hover:bg-accent hover:text-accent-foreground",
                !day.isCurrentMonth && "text-muted-foreground/50",
                isToday && "border border-primary/60",
                isSelected && "bg-primary text-primary-foreground",
              )}
            >
              {day.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}


