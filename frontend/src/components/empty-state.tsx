import { cn } from "@/lib/utils";
import { Search, Inbox, BarChart3 } from "lucide-react";

interface EmptyStateProps {
  title?: string;
  description?: string;
  className?: string;
  children?: React.ReactNode;
  icon?: "search" | "inbox" | "chart";
}

const ICON_MAP = {
  search: Search,
  inbox: Inbox,
  chart: BarChart3,
};

export function EmptyState({
  title,
  description,
  className,
  children,
  icon,
}: EmptyStateProps) {
  const Icon = icon ? ICON_MAP[icon] : null;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 text-center",
        className
      )}
    >
      {Icon && (
        <Icon className="size-10 text-muted-foreground/50 mb-3" aria-hidden />
      )}
      {title && (
        <p className="text-sm font-medium text-foreground">{title}</p>
      )}
      {description && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
