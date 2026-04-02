import { Suspense } from "react";
import { OverviewContent } from "@/components/overview-content";
import { Spinner } from "@/components/ui/spinner";

export default function OverviewPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-full items-center justify-center p-4 sm:p-6 lg:p-8">
          <Spinner size="lg" className="h-10 w-10" />
        </div>
      }
    >
      <OverviewContent />
    </Suspense>
  );
}
