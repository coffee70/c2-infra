"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { SimulatorPanel } from "@/components/simulator-panel";
import { useTelemetrySourcesQuery } from "@/lib/query-hooks";

export default function SimulatorManagePage() {
  const params = useParams();
  const sourceId = params.sourceId as string;
  const sourcesQuery = useTelemetrySourcesQuery<{ id: string; name: string }[]>();
  const sourceName = sourcesQuery.data?.find((source) => source.id === sourceId)?.name ?? sourceId;

  if (!sourceId) {
    return null;
  }

  return (
    <div className="min-h-full p-4 sm:p-6 lg:p-8">
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
