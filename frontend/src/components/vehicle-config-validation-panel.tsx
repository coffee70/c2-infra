"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { VehicleConfigValidationError } from "@/lib/query-hooks";

type VehicleConfigValidationPanelProps = {
  validationErrors: VehicleConfigValidationError[];
  statusMessage: string | null;
  errorMessage: string | null;
};

export function VehicleConfigValidationPanel({
  validationErrors,
  statusMessage,
  errorMessage,
}: VehicleConfigValidationPanelProps) {
  return (
    <div className="space-y-4">
      {statusMessage ? (
        <Alert>
          <AlertTitle>Status</AlertTitle>
          <AlertDescription>{statusMessage}</AlertDescription>
        </Alert>
      ) : null}

      {validationErrors.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>{errorMessage || "Validation failed"}</AlertTitle>
          <AlertDescription>
            <ul className="mt-2 space-y-2">
              {validationErrors.map((error, index) => (
                <li key={`${error.type}-${error.loc.join(".")}-${index}`}>
                  <div className="font-medium">{error.message}</div>
                  <div className="text-xs opacity-80">
                    {error.loc.length > 0 ? error.loc.join(" > ") : "document"} · {error.type}
                  </div>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
