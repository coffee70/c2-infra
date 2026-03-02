"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

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

export function OperatorModeToggle() {
  const [mode, setMode] = useState<OperatorMode>("default");

  useEffect(() => {
    const stored = getStoredMode();
    setMode(stored);
    applyMode(stored);
  }, []);

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
    <div
      className="flex items-center gap-1"
      title="Display mode for long console shifts. Default: standard colors. High contrast: stronger contrast for low-light. Large type: 1.25x font scale."
    >
      <Button
        variant={mode === "default" ? "default" : "outline"}
        size="sm"
        className="h-8 text-xs"
        onClick={() => setModeAndStore("default")}
      >
        Default
      </Button>
      <Button
        variant={mode === "high-contrast" ? "default" : "outline"}
        size="sm"
        className="h-8 text-xs"
        onClick={() => setModeAndStore("high-contrast")}
      >
        High contrast
      </Button>
      <Button
        variant={mode === "large-type" ? "default" : "outline"}
        size="sm"
        className="h-8 text-xs"
        onClick={() => setModeAndStore("large-type")}
      >
        Large type
      </Button>
    </div>
  );
}
