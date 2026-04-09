"use client";

import { useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getRecentChannels } from "@/lib/recent-telemetry";
import { buildTelemetryDetailHref } from "@/lib/telemetry-routes";
import {
  AUTO_FOCUS_STORAGE_KEY,
  OVERVIEW_SEARCH_FOCUS_EVENT,
  SEARCH_INPUT_SELECTOR,
} from "@/components/overview-search";

function isTypingInInput(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute?.("role");
  const isContentEditable = (el as HTMLElement).isContentEditable;
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    role === "textbox" ||
    role === "searchbox" ||
    isContentEditable
  );
}

export function useTelemetryKeyboardShortcuts(
  currentChannelName?: string | null,
  currentSourceId?: string | null
) {
  const router = useRouter();
  const pathname = usePathname();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (isTypingInInput()) return;

      // / or Cmd+K: Focus search
      if (e.key === "/" || (e.metaKey && e.key === "k")) {
        e.preventDefault();
        if (pathname === "/overview") {
          window.dispatchEvent(new CustomEvent(OVERVIEW_SEARCH_FOCUS_EVENT));
          const input = document.querySelector<HTMLInputElement>(
            SEARCH_INPUT_SELECTOR
          );
          input?.focus();
        } else {
          try {
            sessionStorage.setItem(AUTO_FOCUS_STORAGE_KEY, "1");
          } catch {}
          router.push("/overview");
        }
        return;
      }

      // j / ArrowDown: Next channel (second in recent)
      if (e.key === "j" || e.key === "ArrowDown") {
        const recent = getRecentChannels();
        if (!currentSourceId) return;
        if (recent.length < 2) return;
        const scopedRecent = recent.filter((entry) => entry.sourceId === currentSourceId);
        if (scopedRecent.length < 2) return;
        const current = currentChannelName ?? scopedRecent[0]?.name;
        const idx = scopedRecent.findIndex((entry) => entry.name === current);
        const nextIdx = idx < 0 ? 1 : idx + 1;
        const target = scopedRecent[nextIdx % scopedRecent.length];
        e.preventDefault();
        router.push(buildTelemetryDetailHref(target.sourceId, target.name));
        return;
      }

      // k / ArrowUp: Previous channel (wrap to last in recent)
      if (e.key === "k" || e.key === "ArrowUp") {
        const recent = getRecentChannels();
        if (!currentSourceId) return;
        const scopedRecent = recent.filter((entry) => entry.sourceId === currentSourceId);
        if (scopedRecent.length < 2) return;
        const current = currentChannelName ?? scopedRecent[0]?.name;
        const idx = scopedRecent.findIndex((entry) => entry.name === current);
        const prevIdx = idx <= 0 ? scopedRecent.length - 1 : idx - 1;
        const target = scopedRecent[prevIdx];
        e.preventDefault();
        router.push(buildTelemetryDetailHref(target.sourceId, target.name));
        return;
      }

      // f: Toggle favorite (detail page only)
      if (e.key === "f" && pathname?.match(/^\/sources\/[^/]+\/telemetry\/[^/]+$/)) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("telemetry-toggle-favorite"));
        return;
      }

      // ?: Show keyboard shortcuts
      if (e.key === "?" && !e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("show-keyboard-shortcuts"));
        return;
      }
    },
    [pathname, router, currentChannelName, currentSourceId]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
