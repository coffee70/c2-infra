"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDownIcon } from "lucide-react";
import { SimilarTelemetryCard } from "@/components/similar-telemetry-card";
import { Spinner } from "@/components/ui/spinner";
import { useTelemetryExplanationQuery } from "@/lib/query-hooks";

interface ExplanationBlockProps {
  channelName: string;
  sourceId: string;
  streamId?: string;
}

export function ExplanationBlock({ channelName, sourceId, streamId }: ExplanationBlockProps) {
  const explanationQuery = useTelemetryExplanationQuery(channelName, sourceId, streamId);
  const loading = explanationQuery.isLoading;
  const data = explanationQuery.data ?? null;
  const error = explanationQuery.isError;

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Explanation</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-12">
          <Spinner className="h-8 w-8" />
          <span className="text-muted-foreground ml-2 text-sm">
            Generating explanation…
          </span>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Explanation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Unable to load explanation. You can try again later.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Explanation</CardTitle>
            {data.confidence_indicator && (
              <Badge variant="secondary" className="text-xs font-normal">
                {data.confidence_indicator}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="text-muted-foreground mb-1 text-sm font-medium">
              What this means
            </h3>
            <p className="text-base">
              {data.what_this_means || data.llm_explanation}
            </p>
          </div>
          {data.llm_explanation && (
            <Collapsible>
              <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-2 text-xs data-[state=open]:[&_svg]:rotate-180">
                Full explanation
                <ChevronDownIcon className="size-3.5 transition-transform duration-200" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p className="mt-2 text-sm whitespace-pre-wrap">
                  {data.llm_explanation}
                </p>
              </CollapsibleContent>
            </Collapsible>
          )}
        </CardContent>
      </Card>

      <SimilarTelemetryCard detailSourceId={streamId ?? sourceId} channels={data.what_to_check_next ?? []} />
    </>
  );
}
