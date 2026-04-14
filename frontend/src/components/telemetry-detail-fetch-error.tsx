"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ContextBanner } from "@/components/context-banner";
import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

interface TelemetryDetailFetchErrorProps {
  sourceId: string;
  channelName: string;
  sourceName?: string;
}

export function TelemetryDetailFetchError({
  sourceId,
  channelName,
  sourceName = sourceId,
}: TelemetryDetailFetchErrorProps) {
  const router = useRouter();
  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <ContextBanner sourceId={sourceId} sources={[]} onSourceChange={() => {}} />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link
                  href={`/telemetry?source=${encodeURIComponent(sourceId)}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Telemetry
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="max-w-50 truncate" title={sourceName}>
                {sourceName}
              </BreadcrumbPage>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="max-w-50 truncate" title={channelName}>
                {channelName}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6">
          <h1 className="text-lg font-semibold">Unable to load channel summary</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            The telemetry service did not return data for this channel. Check your
            connection and API configuration, then retry.
          </p>
          <Button type="button" className="mt-4" onClick={() => router.refresh()}>
            Retry
          </Button>
        </div>
      </div>
    </div>
  );
}
