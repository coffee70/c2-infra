import { Suspense } from "react";
import { OverviewContent } from "@/components/overview-content";
import { Spinner } from "@/components/ui/spinner";

export default function OverviewPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen p-4 sm:p-6 lg:p-8 flex items-center justify-center">
          <Spinner size="lg" className="h-10 w-10" />
        </div>
      }
    >
      <OverviewContent />
    </Suspense>
  );
}
