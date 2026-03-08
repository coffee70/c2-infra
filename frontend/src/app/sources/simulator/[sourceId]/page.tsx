"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { SimulatorPanel } from "@/components/simulator-panel";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function SimulatorManagePage() {
  const params = useParams();
  const sourceId = params.sourceId as string;
  const [sourceName, setSourceName] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceId) return;
    fetch(`${API_URL}/telemetry/sources`, { cache: "no-store" })
      .then((r) => r.ok ? r.json() : [])
      .then((sources: { id: string; name: string }[]) => {
        const s = sources.find((x) => x.id === sourceId);
        setSourceName(s?.name ?? sourceId);
      })
      .catch(() => setSourceName(sourceId));
  }, [sourceId]);

  if (!sourceId) {
    return null;
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/sources" className="text-primary hover:underline underline-offset-4">
                  Sources
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="truncate max-w-[200px]" title={sourceName ?? sourceId}>
                {sourceName ?? sourceId}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <SimulatorPanel sourceId={sourceId} />
      </div>
    </div>
  );
}
