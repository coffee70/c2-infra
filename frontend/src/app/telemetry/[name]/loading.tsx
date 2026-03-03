import { Spinner } from "@/components/ui/spinner";

export default function TelemetryDetailLoading() {
  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Spinner size="lg" className="h-10 w-10" />
        <p className="text-sm text-muted-foreground">Loading telemetry details…</p>
      </div>
    </div>
  );
}
