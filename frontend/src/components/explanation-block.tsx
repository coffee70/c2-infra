"use client";

import { useEffect, useState } from "react";
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

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface RelatedChannel {
  name: string;
  subsystem_tag: string;
  link_reason: string;
  current_value?: number | null;
  current_status?: string | null;
  last_timestamp?: string | null;
  units?: string | null;
}

interface ExplainResponse {
  what_this_means: string;
  llm_explanation: string;
  what_to_check_next: RelatedChannel[];
  confidence_indicator?: string | null;
}

interface ExplanationBlockProps {
  channelName: string;
}

export function ExplanationBlock({ channelName }: ExplanationBlockProps) {
  const [data, setData] = useState<ExplainResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch(
      `${API_URL}/telemetry/${encodeURIComponent(channelName)}/explain`,
      { cache: "no-store" }
    )
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      })
      .then((explain: ExplainResponse) => {
        if (!cancelled) {
          setData(explain);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channelName]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Explanation</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-12">
          <Spinner className="h-8 w-8" />
          <span className="ml-2 text-sm text-muted-foreground">
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
          <p className="text-sm text-muted-foreground">
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
          <div className="flex items-center justify-between gap-2 flex-wrap">
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
            <h3 className="text-sm font-medium text-muted-foreground mb-1">
              What this means
            </h3>
            <p className="text-base">
              {data.what_this_means || data.llm_explanation}
            </p>
          </div>
          {data.llm_explanation && (
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer data-[state=open]:[&_svg]:rotate-180">
                Full explanation
                <ChevronDownIcon className="size-3.5 transition-transform duration-200" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p className="mt-2 whitespace-pre-wrap text-sm">
                  {data.llm_explanation}
                </p>
              </CollapsibleContent>
            </Collapsible>
          )}
        </CardContent>
      </Card>

      <SimilarTelemetryCard channels={data.what_to_check_next ?? []} />
    </>
  );
}
