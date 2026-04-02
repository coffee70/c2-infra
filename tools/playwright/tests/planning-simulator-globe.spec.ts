import { expect, test, type APIRequestContext } from "@playwright/test";

const API_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

interface TelemetrySource {
  id: string;
  name: string;
  source_type?: string;
}

async function getPlanningSimulator(request: APIRequestContext): Promise<TelemetrySource> {
  const response = await request.get(`${API_URL}/telemetry/sources`);
  expect(response.ok()).toBeTruthy();
  const sources = (await response.json()) as TelemetrySource[];
  const simulator = sources.find((source) => source.source_type === "simulator");
  expect(simulator).toBeTruthy();
  return simulator!;
}

async function ensureSimulatorPositionMapping(
  request: APIRequestContext,
  simulatorId: string
) {
  const response = await request.post(`${API_URL}/telemetry/position/config`, {
    data: {
      vehicle_id: simulatorId,
      frame_type: "gps_lla",
      lat_channel_name: "GPS_LAT",
      lon_channel_name: "GPS_LON",
      alt_channel_name: "GPS_ALT",
      active: true,
    },
  });

  expect(response.ok()).toBeTruthy();
}

async function ensureSimulatorRunning(
  request: APIRequestContext,
  simulatorId: string
) {
  const statusResponse = await request.get(
    `${API_URL}/simulator/status?vehicle_id=${encodeURIComponent(simulatorId)}`
  );
  expect(statusResponse.ok()).toBeTruthy();

  const status = (await statusResponse.json()) as {
    connected?: boolean;
    state?: string | null;
  };

  if (status.connected === true && status.state === "running") {
    return;
  }

  const response = await request.post(`${API_URL}/simulator/start`, {
    data: {
      scenario: "orbit_nominal",
      duration: 0,
      speed: 1,
      drop_prob: 0,
      jitter: 0.1,
      vehicle_id: simulatorId,
    },
  });

  expect(response.ok()).toBeTruthy();
}

async function stopSimulator(request: APIRequestContext, simulatorId: string) {
  const response = await request.post(
    `${API_URL}/simulator/stop?vehicle_id=${encodeURIComponent(simulatorId)}`
  );
  expect(response.ok()).toBeTruthy();
}

test("planning renders the live simulator marker on the globe", async ({
  page,
  request,
}) => {
  const simulator = await getPlanningSimulator(request);
  await ensureSimulatorPositionMapping(request, simulator.id);
  await ensureSimulatorRunning(request, simulator.id);

  await page.addInitScript((simulatorId: string) => {
    window.sessionStorage.setItem(
      "planningShowOnGlobeIds",
      JSON.stringify([simulatorId])
    );
  }, simulator.id);

  await page.goto("/planning");

  await expect(
    page.getByText("An error occurred while rendering. Rendering has stopped.")
  ).toHaveCount(0);
  await expect(page.locator("main")).toContainText("Live", { timeout: 30_000 });
});

test("planning shows no data for a selected simulator after it stops", async ({
  page,
  request,
}) => {
  const simulator = await getPlanningSimulator(request);
  await ensureSimulatorPositionMapping(request, simulator.id);
  await ensureSimulatorRunning(request, simulator.id);

  await page.addInitScript((simulatorId: string) => {
    window.sessionStorage.setItem(
      "planningShowOnGlobeIds",
      JSON.stringify([simulatorId])
    );
  }, simulator.id);

  await page.goto("/planning");
  await expect(page.locator("main")).toContainText("Live", { timeout: 30_000 });

  await stopSimulator(request, simulator.id);

  await expect(page.locator("main")).toContainText("No data", { timeout: 30_000 });
});
