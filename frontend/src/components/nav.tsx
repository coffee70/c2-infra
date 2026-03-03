"use client";

import Link from "next/link";
import { OperatorModeToggle } from "@/components/operator-mode-toggle";

export function Nav() {
  return (
    <nav className="border-b px-4 sm:px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex gap-4 min-w-0">
        <Link
          href="/overview"
          className="text-primary hover:underline font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
        >
          Overview
        </Link>
        <Link
          href="/search"
          className="text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
        >
          Search
        </Link>
        <Link
          href="/simulator"
          className="text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
        >
          Simulator
        </Link>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("show-keyboard-shortcuts"))}
          className="text-muted-foreground hover:text-foreground text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
        >
          Shortcuts (?)
        </button>
      </div>
      <OperatorModeToggle />
    </nav>
  );
}
