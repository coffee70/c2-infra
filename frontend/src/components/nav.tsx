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
    <nav className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-40 flex flex-wrap items-center justify-between gap-4 border-b px-4 py-3 backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-6">
        {NAV_LINKS.map(({ href, label }) => {
          const isActive = pathname === href || (href !== "/overview" && pathname?.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`focus-visible:ring-ring rounded-md text-sm font-medium underline-offset-4 transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none ${
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
              className="text-muted-foreground hover:text-foreground h-8"
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
              className="text-muted-foreground hover:text-foreground h-8"
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
