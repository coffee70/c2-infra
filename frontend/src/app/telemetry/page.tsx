import { Suspense } from "react";
import { TelemetryInventoryPage } from "@/components/telemetry-inventory-page";
import { Spinner } from "@/components/ui/spinner";

export const metadata = {
  title: "Telemetry",
};

export default function TelemetryPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-full items-center justify-center p-4 sm:p-6 lg:p-8">
          <Spinner size="lg" className="h-10 w-10" />
        </div>
      }
    >
      <TelemetryInventoryPage />
    </Suspense>
  );
}
