import { Suspense } from "react";
import { PlanningEarthPage } from "@/components/planning-earth-page";
import { Spinner } from "@/components/ui/spinner";

export const metadata = {
  title: "Planning",
};

export default function PlanningPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-full flex items-center justify-center">
          <Spinner size="lg" className="h-10 w-10" />
        </div>
      }
    >
      <PlanningEarthPage />
    </Suspense>
  );
}
