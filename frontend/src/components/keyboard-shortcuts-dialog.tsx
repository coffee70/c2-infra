"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle id="shortcuts-dialog-title">Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <dl className="space-y-3">
          {SHORTCUTS.map(({ keys, description }) => (
            <div
              key={description}
              className="flex items-center justify-between gap-4"
            >
              <dt className="text-muted-foreground text-sm">{description}</dt>
              <dd className="flex gap-1">
                {keys.map((key) => (
                  <kbd
                    key={key}
                    className="bg-muted rounded border px-2 py-0.5 font-mono text-xs"
                  >
                    {key}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
