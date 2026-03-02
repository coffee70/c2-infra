"use client";

import { useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ["/", "⌘K"], description: "Focus search" },
  { keys: ["j", "↓"], description: "Next channel (in recent)" },
  { keys: ["k", "↑"], description: "Previous channel (in recent)" },
  { keys: ["f"], description: "Toggle favorite (on detail page)" },
  { keys: ["?"], description: "Show this shortcuts dialog" },
];

export function KeyboardShortcutsDialog({ open, onClose }: KeyboardShortcutsDialogProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (open) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-dialog-title"
        className="w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle id="shortcuts-dialog-title">Keyboard Shortcuts</CardTitle>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3">
            {SHORTCUTS.map(({ keys, description }) => (
              <div
                key={description}
                className="flex items-center justify-between gap-4"
              >
                <dt className="text-sm text-muted-foreground">{description}</dt>
                <dd className="flex gap-1">
                  {keys.map((key) => (
                    <kbd
                      key={key}
                      className="rounded border bg-muted px-2 py-0.5 text-xs font-mono"
                    >
                      {key}
                    </kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
