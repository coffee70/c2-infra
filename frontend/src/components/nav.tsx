"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  Keyboard,
  LayoutDashboard,
  Menu,
  SatelliteDish,
  Server,
  X,
} from "lucide-react";
import { OperatorModeToggle } from "@/components/operator-mode-toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const NAV_LINKS = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/telemetry", label: "Telemetry", icon: ChartNoAxesCombined },
  { href: "/planning", label: "Planning", icon: SatelliteDish },
  { href: "/sources", label: "Source", icon: Server },
] as const;

const SIDEBAR_EXPANDED_W = "md:w-52";
const SIDEBAR_COLLAPSED_W = "md:w-[52px]";
const EASING = "ease-[cubic-bezier(0.22,1,0.36,1)]";
const DURATION = "duration-300";

/*
 * Single row class used in BOTH expanded and collapsed states.
 * overflow-hidden clips labels as the sidebar width animates.
 * Icons are shrink-0 so they stay at a fixed x-position.
 */
const ITEM_ROW =
  "flex h-9 w-full items-center gap-2 overflow-hidden rounded-md px-2.5 text-sm font-medium";

export function Nav() {
  const pathname = usePathname();
  const [isDesktopExpanded, setIsDesktopExpanded] = useState(true);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  useEffect(() => {
    if (!isMobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMobileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMobileOpen]);

  useEffect(() => {
    setIsMobileOpen(false);
  }, [pathname]);

  const closeMobileMenu = () => setIsMobileOpen(false);

  const renderPageLink = ({
    href,
    label,
    icon: Icon,
    expanded,
  }: (typeof NAV_LINKS)[number] & { expanded: boolean }) => {
    const isActive =
      pathname === href ||
      (href !== "/overview" && pathname?.startsWith(href));

    const link = (
      <Link
        key={href}
        href={href}
        aria-current={isActive ? "page" : undefined}
        aria-label={label}
        title={!expanded ? label : undefined}
        className={cn(
          ITEM_ROW,
          "transition-colors focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
          isActive
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        )}
        onClick={closeMobileMenu}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="min-w-0 overflow-hidden whitespace-nowrap">{label}</span>
      </Link>
    );

    if (expanded) return link;
    return (
      <Tooltip key={href}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  };

  const renderUtilityItem = ({
    href,
    label,
    icon: Icon,
    expanded,
    onClick,
  }: {
    href?: string;
    label: string;
    icon: LucideIcon;
    expanded: boolean;
    onClick?: () => void;
  }) => {
    const colorClass =
      "text-muted-foreground hover:bg-accent/50 hover:text-foreground";
    const focusClass =
      "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none";

    const inner = (
      <>
        <Icon className="h-4 w-4 shrink-0" />
        <span className="min-w-0 overflow-hidden whitespace-nowrap">{label}</span>
      </>
    );

    if (href) {
      const link = (
        <Link
          href={href}
          aria-label={label}
          title={!expanded ? label : undefined}
          className={cn(ITEM_ROW, "transition-colors", focusClass, colorClass)}
          onClick={closeMobileMenu}
        >
          {inner}
        </Link>
      );

      return expanded ? (
        link
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      );
    }

    const button = (
      <button
        type="button"
        aria-label={label}
        title={!expanded ? label : undefined}
        className={cn(
          ITEM_ROW,
          "cursor-pointer transition-colors",
          focusClass,
          colorClass,
        )}
        onClick={() => {
          closeMobileMenu();
          onClick?.();
        }}
      >
        {inner}
      </button>
    );

    return expanded ? (
      button
    ) : (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  };

  const renderSidebarContent = ({
    expanded,
    mobile = false,
  }: {
    expanded: boolean;
    mobile?: boolean;
  }) => (
    <nav
      aria-label={mobile ? "Mobile navigation" : "Primary navigation"}
      className="flex h-full flex-col gap-2 p-2"
    >
      {/* Header: toggle */}
      <div className="flex h-9 items-center justify-end">
        {mobile ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close navigation menu"
            onClick={closeMobileMenu}
          >
            <X className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
            onClick={() => setIsDesktopExpanded((v) => !v)}
          >
            {expanded ? (
              <ChevronLeft className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>

      <Separator />

      {/* Top section: page links */}
      <div className="flex flex-col gap-1">
        {NAV_LINKS.map((link) => renderPageLink({ ...link, expanded }))}
      </div>

      {/* Bottom section: utilities */}
      <div className="mt-auto flex flex-col gap-1">
        <Separator />
        {renderUtilityItem({
          href: "/docs",
          label: "Documentation",
          icon: BookOpen,
          expanded,
        })}
        {renderUtilityItem({
          label: "Keybindings",
          icon: Keyboard,
          expanded,
          onClick: () =>
            window.dispatchEvent(new CustomEvent("show-keyboard-shortcuts")),
        })}
        {expanded ? (
          <OperatorModeToggle ariaLabel="Screen type" />
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <OperatorModeToggle ariaLabel="Screen type" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">Screen type</TooltipContent>
          </Tooltip>
        )}
      </div>
    </nav>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="bg-background fixed top-3 left-3 z-50 md:hidden"
        aria-label="Open navigation menu"
        onClick={() => setIsMobileOpen(true)}
      >
        <Menu className="h-4 w-4" />
      </Button>

      {/* Mobile overlay drawer */}
      {isMobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="bg-background/80 absolute inset-0 backdrop-blur-sm"
            onClick={() => setIsMobileOpen(false)}
            aria-label="Close navigation menu"
          />
          <aside className="bg-background absolute inset-y-0 left-0 w-52 border-r shadow-xl transition-transform duration-300 ease-in-out">
            <div className="h-full overflow-y-auto">
              {renderSidebarContent({ expanded: true, mobile: true })}
            </div>
          </aside>
        </div>
      ) : null}

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "bg-background/95 supports-[backdrop-filter]:bg-background/80 z-40 hidden overflow-hidden border-r backdrop-blur",
          "md:sticky md:top-0 md:block md:h-screen md:shrink-0",
          `md:transition-[width] ${DURATION} md:${EASING}`,
          isDesktopExpanded ? SIDEBAR_EXPANDED_W : SIDEBAR_COLLAPSED_W,
        )}
      >
        <div className="h-full overflow-y-auto overflow-x-hidden">
          {renderSidebarContent({ expanded: isDesktopExpanded })}
        </div>
      </aside>
    </>
  );
}
