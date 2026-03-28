"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Viewer, Entity } from "resium";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import type {
  PositionSample,
  PositionHistoryEntry,
} from "@/lib/position-client";

export interface EarthOverviewGlobeProps {
  positions: PositionSample[];
  positionHistoryBySource?: Record<string, PositionHistoryEntry[]>;
}

let cesiumConfigured = false;

function configureCesium() {
  if (cesiumConfigured || typeof window === "undefined") {
    return;
  }

  const baseUrl = "/cesium/";
  try {
    (
      window as Window & {
        CESIUM_BASE_URL?: string;
      }
    ).CESIUM_BASE_URL = baseUrl;

    const buildModuleUrl = (
      Cesium as typeof Cesium & {
        buildModuleUrl?: { setBaseUrl?: (url: string) => void };
      }
    ).buildModuleUrl;

    if (buildModuleUrl?.setBaseUrl) {
      buildModuleUrl.setBaseUrl(baseUrl);
    } else {
      console.error(
        "[EarthOverviewGlobe] Cesium.buildModuleUrl.setBaseUrl is not available; static assets may fail to load and the globe may not render correctly."
      );
    }
  } catch (e) {
    console.error("[EarthOverviewGlobe] Failed to set Cesium base URL:", e);
  }

  cesiumConfigured = true;
}

configureCesium();

const terrainProvider = new Cesium.EllipsoidTerrainProvider();

const POLYLINE_WIDTH = 2;
const subscribeToClient = () => () => {};

export function EarthOverviewGlobe({
  positions,
  positionHistoryBySource = {},
}: EarthOverviewGlobeProps) {
  const isClient = useSyncExternalStore(
    subscribeToClient,
    () => true,
    () => false
  );

  useEffect(() => {
    configureCesium();
    const token = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
    if (token) {
      Cesium.Ion.defaultAccessToken = token;
    }
    // Hide the long default Ion warning text and keep the scene clean.
    if (typeof document !== "undefined") {
      const style = document.createElement("style");
      style.textContent =
        ".cesium-viewer-bottom, .cesium-credit-textContainer { display: none !important; }";
      document.head.appendChild(style);
    }
  }, []);

  if (!isClient) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black/80">
        <div className="text-sm text-muted-foreground">Preparing globe…</div>
      </div>
    );
  }

  const renderedSources = positions
    .filter((p) => p.valid && p.lat_deg != null && p.lon_deg != null)
    .map((p) => p.vehicle_name);

  return (
    <div className="absolute inset-0 bg-black" style={{ width: "100%", height: "100%" }}>
      <div
        className="sr-only"
        data-testid="earth-overview-rendered-sources"
      >
        Rendered sources:{" "}
        {renderedSources.length > 0 ? renderedSources.join(", ") : "None"}
      </div>
      <Viewer
        full
        style={{ width: "100%", height: "100%" }}
        terrainProvider={terrainProvider}
        selectionIndicator={false}
        infoBox={false}
        timeline={false}
        animation={false}
        baseLayerPicker={false}
        geocoder={false}
        homeButton={false}
        sceneModePicker={false}
        navigationHelpButton={false}
        fullscreenButton={false}
      >
        {positions
          .filter((p) => p.valid && p.lat_deg != null && p.lon_deg != null)
          .map((p) => {
            const sourceKey = p.vehicle_id;
            const sourceName = p.vehicle_name;
            const sourceType = p.vehicle_type ?? "vehicle";
            const lat = p.lat_deg!;
            const lon = p.lon_deg!;
            const alt = p.alt_m ?? 0;
            const position = Cesium.Cartesian3.fromDegrees(lon, lat, alt);
            const isSimulator = sourceType === "simulator";
            const color = isSimulator ? Cesium.Color.ORANGE : Cesium.Color.CYAN;
            const labelText = `${sourceName}`;
            const history = positionHistoryBySource[sourceKey];
            const polylinePositions =
              history && history.length >= 2
                ? [
                    ...history.map((h) =>
                      Cesium.Cartesian3.fromDegrees(
                        h.lon_deg,
                        h.lat_deg,
                        h.alt_m ?? 0
                      )
                    ),
                    position,
                  ]
                : undefined;

            return (
              <Entity
                key={sourceKey}
                name={sourceName}
                position={position}
                point={{
                  pixelSize: 10,
                  color,
                  outlineColor: Cesium.Color.BLACK,
                  outlineWidth: 1,
                }}
                polyline={
                  polylinePositions
                    ? {
                        positions: polylinePositions,
                        width: POLYLINE_WIDTH,
                        material: color.withAlpha(0.5),
                      }
                    : undefined
                }
                label={{
                  text: labelText,
                  font: "14px sans-serif",
                  fillColor: Cesium.Color.WHITE,
                  outlineColor: Cesium.Color.BLACK,
                  outlineWidth: 2,
                  style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                  pixelOffset: new Cesium.Cartesian2(0, -16),
                }}
              />
            );
          })}
      </Viewer>
    </div>
  );
}
