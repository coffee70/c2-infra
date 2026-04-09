import { Spinner } from "@/components/ui/spinner";

export default function TelemetryDetailLoading() {
  return (
    <div className="flex min-h-full items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col items-center gap-4">
        <Spinner size="lg" className="h-10 w-10" />
        <p className="text-muted-foreground text-sm">Loading telemetry details…</p>
      </div>
    </div>
  );
}
