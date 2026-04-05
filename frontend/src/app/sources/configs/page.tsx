"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { getErrorMessage } from "@/lib/api-client";
import {
  useCreateVehicleConfigMutation,
  useUpdateVehicleConfigMutation,
  useValidateVehicleConfigMutation,
  useVehicleConfigQuery,
  useVehicleConfigsQuery,
  type VehicleConfigParsedSummary,
} from "@/lib/query-hooks";

export default function VehicleConfigsPage() {
  const [selectedPath, setSelectedPath] = useState("");
  const [draftPath, setDraftPath] = useState("");
  const [content, setContent] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [parsedSummary, setParsedSummary] = useState<VehicleConfigParsedSummary | null>(null);

  const listQuery = useVehicleConfigsQuery();
  const configQuery = useVehicleConfigQuery(selectedPath, selectedPath.length > 0);
  const validateMutation = useValidateVehicleConfigMutation();
  const createMutation = useCreateVehicleConfigMutation();
  const updateMutation = useUpdateVehicleConfigMutation();

  useEffect(() => {
    const firstPath = listQuery.data?.[0]?.path;
    if (!selectedPath && firstPath) {
      setSelectedPath(firstPath);
      setDraftPath(firstPath);
    }
  }, [listQuery.data, selectedPath]);

  useEffect(() => {
    if (!configQuery.data) return;
    setDraftPath(configQuery.data.path);
    setContent(configQuery.data.content);
    setParsedSummary(configQuery.data.parsed ?? null);
    setErrorMessage(null);
    setStatusMessage(null);
  }, [configQuery.data]);

  async function handleValidate() {
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      const result = await validateMutation.mutateAsync({
        path: draftPath,
        content,
      });
      setParsedSummary(result.parsed ?? null);
      if (!result.valid) {
        setErrorMessage(result.errors.map((error) => error.message).join("\n"));
        return;
      }
      setStatusMessage("Vehicle configuration is valid.");
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Validation failed"));
    }
  }

  async function handleSave() {
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      if (selectedPath && draftPath === selectedPath) {
        const result = await updateMutation.mutateAsync({ path: draftPath, content });
        setParsedSummary(result.parsed);
        setStatusMessage(`Saved ${result.path}.`);
      } else {
        const result = await createMutation.mutateAsync({ path: draftPath, content });
        setSelectedPath(result.path);
        setParsedSummary(result.parsed);
        setStatusMessage(`Created ${result.path}.`);
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Save failed"));
    }
  }

  return (
    <div className="min-h-full p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Vehicle Configurations
            </h1>
            <p className="text-muted-foreground text-sm">
              Load, validate, and save vehicle configuration files.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/sources">Back to Sources</Link>
          </Button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Files</CardTitle>
              <CardDescription>Available vehicle and simulator configurations.</CardDescription>
            </CardHeader>
            <CardContent>
              {listQuery.isLoading ? (
                <div className="flex justify-center py-8">
                  <Spinner />
                </div>
              ) : (
                <div className="space-y-2">
                  {(listQuery.data ?? []).map((item) => (
                    <button
                      key={item.path}
                      type="button"
                      onClick={() => setSelectedPath(item.path)}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                        selectedPath === item.path ? "border-foreground" : "border-border"
                      }`}
                    >
                      <div className="font-medium">{item.name || item.filename}</div>
                      <div className="text-muted-foreground font-mono text-xs">{item.path}</div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Editor</CardTitle>
              <CardDescription>Raw YAML or JSON only. Validate before save.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div>
                  <Label htmlFor="vehicle-config-path">Vehicle Configuration Path</Label>
                  <Input
                    id="vehicle-config-path"
                    value={draftPath}
                    onChange={(event) => setDraftPath(event.target.value)}
                    placeholder="vehicles/iss.yaml"
                    className="mt-1"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <Button
                    variant="outline"
                    onClick={handleValidate}
                    disabled={validateMutation.isPending || content.trim().length === 0}
                  >
                    Validate
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={
                      createMutation.isPending ||
                      updateMutation.isPending ||
                      draftPath.trim().length === 0 ||
                      content.trim().length === 0
                    }
                  >
                    Save
                  </Button>
                </div>
              </div>

              {parsedSummary ? (
                <div className="text-muted-foreground flex flex-wrap gap-4 text-sm">
                  <span>{parsedSummary.channel_count} channels</span>
                  <span>{parsedSummary.scenario_names.length} scenarios</span>
                  <span>{parsedSummary.has_position_mapping ? "Has position mapping" : "No position mapping"}</span>
                </div>
              ) : null}

              {statusMessage ? (
                <Alert>
                  <AlertTitle>Status</AlertTitle>
                  <AlertDescription>{statusMessage}</AlertDescription>
                </Alert>
              ) : null}

              {errorMessage ? (
                <Alert variant="destructive">
                  <AlertTitle>Validation Error</AlertTitle>
                  <AlertDescription className="whitespace-pre-wrap">{errorMessage}</AlertDescription>
                </Alert>
              ) : null}

              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                className="min-h-[32rem] w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                spellCheck={false}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
