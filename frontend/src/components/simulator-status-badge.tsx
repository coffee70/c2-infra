"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface SimulatorStatusBadgeProps {
  connected: boolean;
  state?: "idle" | "running" | "paused";
  className?: string;
}

export function SimulatorStatusBadge({
  connected,
  state = "idle",
  className,
}: SimulatorStatusBadgeProps) {
  if (!connected) {
    return (
      <Badge variant="destructive" className={cn("text-xs", className)}>
        Disconnected
      </Badge>
    );
  }

  const label = state.charAt(0).toUpperCase() + state.slice(1);

  if (state === "running") {
    return (
      <Badge variant="success" className={cn("text-xs", className)}>
        {label}
      </Badge>
    );
  }

  if (state === "paused") {
    return (
      <Badge
        variant="secondary"
        className={cn(
          "text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 dark:bg-amber-500/10 border-amber-500/20",
          className
        )}
      >
        {label}
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className={cn("text-xs", className)}>
      {label}
    </Badge>
  );
}
