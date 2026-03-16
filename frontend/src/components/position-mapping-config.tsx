"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
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
}

export function PositionMappingConfig({ sources }: PositionMappingConfigProps) {
  const [open, setOpen] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [mapping, setMapping] = useState<PositionChannelMapping | null>(null);
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
  const [error, setError] = useState<string | null>(null);
  const telemetryListQuery = useTelemetryListQuery(selectedSourceId ?? "default", open);
  const allNames = telemetryListQuery.data ?? [];

  const currentSource = useMemo(
    () => sources.find((s) => s.id === selectedSourceId) ?? sources[0],
    [selectedSourceId, sources]
  );

  useEffect(() => {
    if (!open) return;
    if (!selectedSourceId && sources.length > 0) {
      setSelectedSourceId(sources[0].id);
    }
  }, [open, selectedSourceId, sources]);

  useEffect(() => {
    if (!open || !selectedSourceId) return;
    let cancelled = false;

    async function loadMapping() {
      setLoading(true);
      setError(null);
      try {
        const configs = await fetchPositionConfig(
          selectedSourceId ?? undefined
        );
        if (cancelled) return;
        const first = configs[0] ?? null;
        setMapping(first);
        const ft = first?.frame_type ?? "gps_lla";
        setFrameType(ft);
        setLatChannel(first?.lat_channel_name ?? "");
        setLonChannel(first?.lon_channel_name ?? "");
        setAltChannel(first?.alt_channel_name ?? "");
        setXChannel(first?.x_channel_name ?? "");
        setYChannel(first?.y_channel_name ?? "");
        setZChannel(first?.z_channel_name ?? "");
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
    setSaving(true);
    setError(null);
    try {
      const saved = await upsertPositionConfig({
        source_id: currentSource.id,
        frame_type: frameType,
        lat_channel_name: frameType === "gps_lla" ? latChannel || null : null,
        lon_channel_name: frameType === "gps_lla" ? lonChannel || null : null,
        alt_channel_name: frameType === "gps_lla" ? altChannel || null : null,
        x_channel_name: frameType !== "gps_lla" ? xChannel || null : null,
        y_channel_name: frameType !== "gps_lla" ? yChannel || null : null,
        z_channel_name: frameType !== "gps_lla" ? zChannel || null : null,
      });
      setMapping(saved);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to save position mapping"
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!mapping) return;
    setDeleting(true);
    setError(null);
    try {
      await deletePositionConfig(mapping.id);
      setMapping(null);
      setLatChannel("");
      setLonChannel("");
      setAltChannel("");
      setXChannel("");
      setYChannel("");
      setZChannel("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to delete position mapping"
      );
    } finally {
      setDeleting(false);
    }
  }

  const suggestionsId = "position-mapping-suggestions";

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        Position mapping
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Configure position mapping</DialogTitle>
            <DialogDescription>
              Map telemetry channels to latitude/longitude/altitude (or XYZ) so
              the Overview Earth view can plot each source.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 overflow-y-auto max-h-[60vh] pr-2">
            {sources.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No telemetry sources are registered yet.
              </p>
            ) : (
              <>
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <section className="space-y-3">
                  <Label htmlFor="position-source">Source</Label>
                  <Select
                    value={currentSource?.id}
                    onValueChange={(v) => setSelectedSourceId(v)}
                  >
                    <SelectTrigger id="position-source" className="w-full">
                      <SelectValue placeholder="Select source" />
                    </SelectTrigger>
                    <SelectContent>
                      {sources.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}{" "}
                          {s.source_type === "simulator" ? "(simulator)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </section>

                <section className="space-y-3">
                  <Label htmlFor="position-frame">Frame</Label>
                  <Select
                    value={frameType}
                    onValueChange={(v) => setFrameType(v)}
                  >
                    <SelectTrigger id="position-frame" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gps_lla">
                        GPS (latitude / longitude / altitude)
                      </SelectItem>
                      <SelectItem value="ecef">
                        ECEF (X / Y / Z, meters)
                      </SelectItem>
                      <SelectItem value="eci">
                        ECI (X / Y / Z) — experimental
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </section>

                {frameType === "gps_lla" ? (
                  <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="lat-channel">Latitude channel</Label>
                      <Input
                        id="lat-channel"
                        list={suggestionsId}
                        placeholder="e.g. GPS_LAT"
                        value={latChannel}
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
                        onChange={(e) => setAltChannel(e.target.value)}
                      />
                    </div>
                  </section>
                ) : (
                  <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="x-channel">X channel</Label>
                      <Input
                        id="x-channel"
                        list={suggestionsId}
                        placeholder="e.g. POS_X"
                        value={xChannel}
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
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner size="sm" />
                    <span>Loading existing mapping…</span>
                  </div>
                )}
              </>
            )}
          </div>
          <DialogFooter className="border-t pt-4 mt-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {mapping && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? "Removing…" : "Remove mapping"}
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
              >
                Close
              </Button>
              <Button onClick={handleSave} disabled={saving || !currentSource}>
                {saving ? "Saving…" : "Save mapping"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
