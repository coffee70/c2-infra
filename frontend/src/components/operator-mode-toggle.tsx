"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MonitorIcon } from "lucide-react";

const STORAGE_KEY = "operator_mode";
type OperatorMode = "default" | "high-contrast" | "large-type";

function getStoredMode(): OperatorMode {
  if (typeof window === "undefined") return "default";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "high-contrast" || v === "large-type") return v;
    return "default";
  } catch {
    return "default";
  }
}

function applyMode(mode: OperatorMode) {
  if (typeof document === "undefined") return;
  const body = document.body;
  if (mode === "default") {
    body.removeAttribute("data-operator-mode");
  } else {
    body.setAttribute("data-operator-mode", mode);
  }
}

const MODE_LABELS: Record<OperatorMode, string> = {
  default: "Default",
  "high-contrast": "High contrast",
  "large-type": "Large type",
};

export function OperatorModeToggle() {
  const [mode, setMode] = useState<OperatorMode>(() => getStoredMode());

  useEffect(() => {
    applyMode(mode);
  }, [mode]);

  const setModeAndStore = (m: OperatorMode) => {
    setMode(m);
    if (m === "default") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, m);
    }
    applyMode(m);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          title="Display mode for long console shifts"
        >
          <MonitorIcon className="size-3.5" />
          {MODE_LABELS[mode]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setModeAndStore(v as OperatorMode)}>
          <DropdownMenuRadioItem value="default">Default</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="high-contrast">High contrast</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="large-type">Large type</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
