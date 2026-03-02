"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useTelemetryKeyboardShortcuts } from "@/lib/keyboard-shortcuts";
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts-dialog";

export function KeyboardShortcutsHandler() {
  const pathname = usePathname();
  const match = pathname?.match(/^\/telemetry\/([^/]+)$/);
  const currentChannelName = match
    ? decodeURIComponent(match[1])
    : undefined;
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useTelemetryKeyboardShortcuts(currentChannelName);

  useEffect(() => {
    const handler = () => setShortcutsOpen(true);
    window.addEventListener("show-keyboard-shortcuts", handler);
    return () => window.removeEventListener("show-keyboard-shortcuts", handler);
  }, []);

  return (
    <>
      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </>
  );
}
