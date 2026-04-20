"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  formatPositionMappingSummary,
  fetchPositionConfig,
  upsertPositionConfig,
  deletePositionConfig,
  type PositionChannelMapping,
} from "@/lib/position-client";
import { useTelemetryListQuery } from "@/lib/query-hooks";

interface TelemetrySource {
  id: string;
  name: string;
  description?: string | null;
  source_type?: string;
}

interface PositionMappingConfigProps {
  sources: TelemetrySource[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialSourceId?: string | null;
  onMappingsChange?: () => void;
}

export function PositionMappingConfig({
  sources,
  open: controlledOpen,
  onOpenChange,
  initialSourceId,
  onMappingsChange,
}: PositionMappingConfigProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [mapping, setMapping] = useState<PositionChannelMapping | null>(null);
  const [mappingsBySource, setMappingsBySource] = useState<
    Record<string, PositionChannelMapping | null>
  >({});
  const [frameType, setFrameType] = useState<string>("gps_lla");
  const [latChannel, setLatChannel] = useState("");
  const [lonChannel, setLonChannel] = useState("");
  const [altChannel, setAltChannel] = useState("");
  const [xChannel, setXChannel] = useState("");
  const [yChannel, setYChannel] = useState("");
  const [zChannel, setZChannel] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const telemetryListQuery = useTelemetryListQuery(selectedSourceId ?? "", open && !!selectedSourceId);
  const allNames = (telemetryListQuery.data ?? []).map((channel) => channel.name);

  const savedSnapshot = useRef({
    frameType: "gps_lla",
    latChannel: "",
    lonChannel: "",
    altChannel: "",
    xChannel: "",
    yChannel: "",
    zChannel: "",
  });

  const isDirty = useMemo(() => {
    const s = savedSnapshot.current;
    return (
      frameType !== s.frameType ||
      latChannel !== s.latChannel ||
      lonChannel !== s.lonChannel ||
      altChannel !== s.altChannel ||
      xChannel !== s.xChannel ||
      yChannel !== s.yChannel ||
      zChannel !== s.zChannel
    );
  }, [
    frameType,
    latChannel,
    lonChannel,
    altChannel,
    xChannel,
    yChannel,
    zChannel,
  ]);

  const snapshotCurrentValues = useCallback(() => {
    savedSnapshot.current = {
      frameType,
      latChannel,
      lonChannel,
      altChannel,
      xChannel,
      yChannel,
      zChannel,
    };
  }, [frameType, latChannel, lonChannel, altChannel, xChannel, yChannel, zChannel]);

  const commitOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) {
        setInternalOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange]
  );

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isDirty) {
        if (!window.confirm("You have unsaved changes. Close anyway?")) return;
      }
      commitOpenChange(nextOpen);
    },
    [commitOpenChange, isDirty]
  );

  const currentSource = useMemo(
    () => sources.find((s) => s.id === selectedSourceId) ?? sources[0],
    [selectedSourceId, sources]
  );

  const canSaveMapping = useMemo(() => {
    if (frameType === "gps_lla") {
      return latChannel.trim().length > 0 && lonChannel.trim().length > 0;
    }
    return (
      xChannel.trim().length > 0 &&
      yChannel.trim().length > 0 &&
      zChannel.trim().length > 0
    );
  }, [frameType, latChannel, lonChannel, xChannel, yChannel, zChannel]);

  const handleSourceSelect = useCallback(
    (sourceId: string) => {
      if (sourceId === selectedSourceId) return;
      if (isDirty) {
        const confirmed = window.confirm(
          "You have unsaved changes. Switch sources and discard them?"
        );
        if (!confirmed) return;
      }
      setSelectedSourceId(sourceId);
    },
    [isDirty, selectedSourceId]
  );

  useEffect(() => {
    if (!open) return;
    const preferredSourceId =
      initialSourceId && sources.some((source) => source.id === initialSourceId)
        ? initialSourceId
        : sources[0]?.id;
    if (!selectedSourceId && preferredSourceId) {
      setSelectedSourceId(preferredSourceId);
    }
  }, [initialSourceId, open, selectedSourceId, sources]);

  useEffect(() => {
    if (!open || sources.length === 0) return;
    let cancelled = false;

    async function loadAllMappings() {
      try {
        const configs = await fetchPositionConfig();
        if (cancelled) return;
        const next: Record<string, PositionChannelMapping | null> = {};
        for (const source of sources) {
          next[source.id] = null;
        }
        for (const config of configs) {
          if (config.vehicle_id in next) {
            next[config.vehicle_id] = config;
          }
        }
        setMappingsBySource(next);
      } catch {
        // The selected-source load below reports actionable errors.
      }
    }

    loadAllMappings();
    return () => {
      cancelled = true;
    };
  }, [open, sources]);

  useEffect(() => {
    if (!open || !selectedSourceId) return;
    let cancelled = false;
    const sourceId = selectedSourceId;

    async function loadMapping() {
      setLoading(true);
      setError(null);
      try {
        const configs = await fetchPositionConfig(sourceId);
        if (cancelled) return;
        const first = configs[0] ?? null;
        setMapping(first);
        setMappingsBySource((prev) => ({
          ...prev,
          [sourceId]: first,
        }));
        const ft = first?.frame_type ?? "gps_lla";
        const lat = first?.lat_channel_name ?? "";
        const lon = first?.lon_channel_name ?? "";
        const alt = first?.alt_channel_name ?? "";
        const x = first?.x_channel_name ?? "";
        const y = first?.y_channel_name ?? "";
        const z = first?.z_channel_name ?? "";
        setFrameType(ft);
        setLatChannel(lat);
        setLonChannel(lon);
        setAltChannel(alt);
        setXChannel(x);
        setYChannel(y);
        setZChannel(z);
        savedSnapshot.current = {
          frameType: ft,
          latChannel: lat,
          lonChannel: lon,
          altChannel: alt,
          xChannel: x,
          yChannel: y,
          zChannel: z,
        };
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Failed to load position mapping"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadMapping();
    return () => {
      cancelled = true;
    };
  }, [open, selectedSourceId]);

  async function handleSave() {
    if (!currentSource) return;
    if (!canSaveMapping) {
      setError(
        frameType === "gps_lla"
          ? "Latitude and longitude channel names are required."
          : "X, Y, and Z channel names are required."
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await upsertPositionConfig({
        vehicle_id: currentSource.id,
        frame_type: frameType,
        lat_channel_name:
          frameType === "gps_lla" ? latChannel.trim() || null : null,
        lon_channel_name:
          frameType === "gps_lla" ? lonChannel.trim() || null : null,
        alt_channel_name:
          frameType === "gps_lla" ? altChannel.trim() || null : null,
        x_channel_name: frameType !== "gps_lla" ? xChannel.trim() || null : null,
        y_channel_name: frameType !== "gps_lla" ? yChannel.trim() || null : null,
        z_channel_name: frameType !== "gps_lla" ? zChannel.trim() || null : null,
      });
      setMapping(saved);
      setMappingsBySource((prev) => ({ ...prev, [currentSource.id]: saved }));
      snapshotCurrentValues();
      commitOpenChange(false);
      onMappingsChange?.();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to save position mapping"
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!mapping || !currentSource) return;
    const mappingId = mapping.id;
    const sourceId = currentSource.id;
    setDeleting(true);
    setError(null);
    try {
      await deletePositionConfig(mappingId);
      setMapping(null);
      setMappingsBySource((prev) => ({ ...prev, [sourceId]: null }));
      setFrameType("gps_lla");
      setLatChannel("");
      setLonChannel("");
      setAltChannel("");
      setXChannel("");
      setYChannel("");
      setZChannel("");
      savedSnapshot.current = {
        frameType: "gps_lla",
        latChannel: "",
        lonChannel: "",
        altChannel: "",
        xChannel: "",
        yChannel: "",
        zChannel: "",
      };
      setConfirmDeleteOpen(false);
      onMappingsChange?.();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to delete position mapping"
      );
      setConfirmDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  function handleFrameSelect(value: string) {
    setFrameType(value);
  }

  const suggestionsId = "position-mapping-suggestions";

  return (
    <>
      {controlledOpen === undefined ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          Position mapping
        </Button>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[82vh] w-[92vw] max-w-none flex-col overflow-hidden sm:max-w-none lg:w-[72rem]">
          <DialogHeader>
            <DialogTitle>Configure position mapping</DialogTitle>
            <DialogDescription>
              Map telemetry channels to latitude/longitude/altitude (or XYZ) so
              the Planning globe can plot each source.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[64vh] overflow-y-auto pr-2">
            {sources.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No telemetry sources are registered yet.
              </p>
            ) : (
              <div className="grid gap-6 md:grid-cols-[minmax(16rem,0.7fr)_minmax(0,1.7fr)]">
                <section className="space-y-2">
                  <div>
                    <h3 className="text-sm font-medium">Sources</h3>
                    <p className="text-muted-foreground text-xs">
                      Select a source to edit its mapping.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    {sources.map((source) => {
                      const sourceMapping = mappingsBySource[source.id] ?? null;
                      const selected = currentSource?.id === source.id;
                      const typeLabel =
                        source.source_type === "simulator" ? "Simulator" : "Vehicle";
                      return (
                        <button
                          key={source.id}
                          type="button"
                          onClick={() => handleSourceSelect(source.id)}
                          className={`hover:bg-accent/60 flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-xs transition ${
                            selected
                              ? "border-primary/60 bg-primary/10"
                              : "border-border/70 bg-background"
                          }`}
                          aria-pressed={selected}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">
                              {source.name}
                            </span>
                            <span className="text-muted-foreground mt-0.5 block truncate text-[11px]">
                              {sourceMapping
                                ? formatPositionMappingSummary(sourceMapping)
                                : "Not configured"}
                            </span>
                          </span>
                          <Badge
                            variant={selected ? "default" : "outline"}
                            className="shrink-0 text-[9px] uppercase"
                          >
                            {typeLabel}
                          </Badge>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="space-y-5">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <section className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-medium">
                        {currentSource?.name ?? "Position mapping"}
                      </h3>
                      <p className="text-muted-foreground text-xs">
                        Choose the coordinate frame and telemetry channels for this
                        source.
                      </p>
                    </div>
                    {mapping && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-destructive/60 text-destructive hover:text-destructive hover:bg-destructive/10 hover:border-destructive h-7 shrink-0 gap-1 px-2 text-xs shadow-sm"
                        onClick={() => {
                          setError(null);
                          setConfirmDeleteOpen(true);
                        }}
                        disabled={saving || loading || deleting}
                        data-testid="position-mapping-remove"
                      >
                        <Trash2Icon className="size-3" />
                        Remove
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      ["gps_lla", "GPS", "Lat / Lon / Alt"],
                      ["ecef", "ECEF", "X / Y / Z meters"],
                      ["eci", "ECI", "X / Y / Z"],
                    ].map(([value, label, description]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => handleFrameSelect(value)}
                        className={`rounded-md border px-3 py-2 text-left text-xs transition ${
                          frameType === value
                            ? "border-primary/60 bg-primary/10"
                            : "border-border/70 hover:bg-accent/60"
                        }`}
                        aria-pressed={frameType === value}
                      >
                        <span className="block font-medium">{label}</span>
                        <span className="text-muted-foreground mt-0.5 block">
                          {description}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                {frameType === "gps_lla" ? (
                  <section className="grid grid-cols-1 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="lat-channel">Latitude channel</Label>
                      <Input
                        id="lat-channel"
                        list={suggestionsId}
                        placeholder="e.g. GPS_LAT"
                        value={latChannel}
                        title={latChannel}
                        onChange={(e) => setLatChannel(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="lon-channel">Longitude channel</Label>
                      <Input
                        id="lon-channel"
                        list={suggestionsId}
                        placeholder="e.g. GPS_LON"
                        value={lonChannel}
                        title={lonChannel}
                        onChange={(e) => setLonChannel(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="alt-channel">
                        Altitude channel (optional)
                      </Label>
                      <Input
                        id="alt-channel"
                        list={suggestionsId}
                        placeholder="e.g. GPS_ALT"
                        value={altChannel}
                        title={altChannel}
                        onChange={(e) => setAltChannel(e.target.value)}
                      />
                    </div>
                  </section>
                ) : (
                  <section className="grid grid-cols-1 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="x-channel">X channel</Label>
                      <Input
                        id="x-channel"
                        list={suggestionsId}
                        placeholder="e.g. POS_X"
                        value={xChannel}
                        title={xChannel}
                        onChange={(e) => setXChannel(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="y-channel">Y channel</Label>
                      <Input
                        id="y-channel"
                        list={suggestionsId}
                        placeholder="e.g. POS_Y"
                        value={yChannel}
                        title={yChannel}
                        onChange={(e) => setYChannel(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="z-channel">Z channel</Label>
                      <Input
                        id="z-channel"
                        list={suggestionsId}
                        placeholder="e.g. POS_Z"
                        value={zChannel}
                        title={zChannel}
                        onChange={(e) => setZChannel(e.target.value)}
                      />
                    </div>
                  </section>
                )}

                {allNames.length > 0 && (
                  <datalist id={suggestionsId}>
                    {allNames.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                )}

                {loading && (
                  <div className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Spinner size="sm" />
                    <span>Loading existing mapping…</span>
                  </div>
                )}
                </section>
              </div>
            )}
          </div>
          <DialogFooter className="mt-2 flex items-center justify-end gap-3 border-t pt-4">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
              >
                Close
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !currentSource || !canSaveMapping}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmDeleteOpen}
        onOpenChange={(next) => {
          if (deleting) return;
          setConfirmDeleteOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete position mapping for {currentSource?.name ?? "this source"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The mapping configuration will be removed. Telemetry data is
              retained, so you can re-create the mapping at any time.
            </AlertDialogDescription>
            {isDirty && (
              <AlertDialogDescription>
                Unsaved channel edits will also be discarded.
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
              disabled={deleting || !mapping}
              className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40"
              data-testid="position-mapping-delete-confirm"
            >
              {deleting ? "Deleting…" : "Delete mapping"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
