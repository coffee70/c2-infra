"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Keyboard } from "lucide-react";
import { OperatorModeToggle } from "@/components/operator-mode-toggle";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const NAV_LINKS = [
  { href: "/overview", label: "Overview" },
  { href: "/planning", label: "Planning" },
  { href: "/sources", label: "Sources" },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-4 sm:px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-6 min-w-0">
        {NAV_LINKS.map(({ href, label }) => {
          const isActive = pathname === href || (href !== "/overview" && pathname?.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md underline-offset-4 hover:underline ${
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-8 text-muted-foreground hover:text-foreground"
            >
              <Link href="/docs" aria-label="Help and documentation">
                <BookOpen className="h-4 w-4" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Help and documentation</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-muted-foreground hover:text-foreground"
              onClick={() => window.dispatchEvent(new CustomEvent("show-keyboard-shortcuts"))}
            >
              <Keyboard className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Keyboard shortcuts</TooltipContent>
        </Tooltip>
        <OperatorModeToggle />
      </div>
    </nav>
  );
}
