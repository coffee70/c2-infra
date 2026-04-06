"use client";

import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type EditorStatusNoticeData = {
  id: number;
  variant: "success" | "error";
  title: string;
  message: string;
  details?: string[];
  dismissible?: boolean;
  autoHideMs?: number | null;
};

type EditorStatusNoticeProps = {
  notice: EditorStatusNoticeData;
  onClear: () => void;
};

const EXIT_DURATION_MS = 150;

export function EditorStatusNotice({ notice, onClear }: EditorStatusNoticeProps) {
  const [isClosing, setIsClosing] = useState(false);
  const dismissTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (dismissTimeoutRef.current !== null) window.clearTimeout(dismissTimeoutRef.current);
    };
  }, []);

  const handleDismiss = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    dismissTimeoutRef.current = window.setTimeout(() => {
      onClear();
    }, EXIT_DURATION_MS);
  }, [isClosing, onClear]);

  useEffect(() => {
    if (notice.autoHideMs == null) return;
    const timeoutId = window.setTimeout(() => {
      handleDismiss();
    }, notice.autoHideMs);
    return () => window.clearTimeout(timeoutId);
  }, [handleDismiss, notice.autoHideMs, notice.id]);

  const Icon = notice.variant === "error" ? AlertCircle : CheckCircle2;

  return (
    <div className="pointer-events-none absolute top-4 right-4 z-20" data-testid="editor-status-notice-region">
      <div
        data-testid="editor-status-notice"
        role={notice.variant === "error" ? "alert" : "status"}
        aria-live={notice.variant === "error" ? "assertive" : "polite"}
        aria-atomic="true"
        className={cn(
          "pointer-events-auto w-[min(28rem,calc(100vw-4rem))] overflow-hidden rounded-xl border shadow-lg backdrop-blur transition-[opacity,transform]",
          isClosing
            ? "animate-out fade-out slide-out-to-top-2 duration-150"
            : "animate-in fade-in slide-in-from-top-2 duration-200",
          notice.variant === "error"
            ? "border-destructive/40 bg-destructive/10 text-foreground"
            : "border-emerald-500/30 bg-emerald-500/10 text-foreground"
        )}
      >
        <div className="flex items-start gap-3 p-3">
          <Icon
            className={cn(
              "mt-0.5 size-4 shrink-0",
              notice.variant === "error" ? "text-destructive" : "text-emerald-400"
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{notice.title}</div>
            <div className="mt-1 text-sm leading-5 whitespace-pre-wrap">{notice.message}</div>
            {notice.details && notice.details.length > 0 ? (
              <div className="bg-background/50 mt-2 max-h-48 overflow-auto rounded-md px-2 py-1.5">
                <div className="text-muted-foreground space-y-1 text-xs leading-5 whitespace-pre-wrap">
                  {notice.details.map((detail, index) => (
                    <div key={`${notice.id}-${index}`}>{detail}</div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          {notice.dismissible !== false ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 shrink-0"
              onClick={handleDismiss}
              aria-label="Dismiss notice"
              data-testid="editor-status-notice-close"
            >
              <X className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
