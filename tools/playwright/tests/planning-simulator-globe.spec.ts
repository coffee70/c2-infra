import { expect, test, type APIRequestContext } from "@playwright/test";

const API_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";

async function ensureSimulatorPositionMapping(request: APIRequestContext) {
  const response = await request.post(`${API_URL}/telemetry/position/config`, {
    data: {
      source_id: "simulator",
      frame_type: "gps_lla",
      lat_channel_name: "GPS_LAT",
      lon_channel_name: "GPS_LON",
      alt_channel_name: "GPS_ALT",
      active: true,
    },
  });

  expect(response.ok()).toBeTruthy();
}

async function ensureSimulatorRunning(request: APIRequestContext) {
  const statusResponse = await request.get(
    `${API_URL}/simulator/status?source_id=simulator`
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
      source_id: "simulator",
    },
  });

  expect(response.ok()).toBeTruthy();
}

test("planning renders the live simulator marker on the globe", async ({
  page,
  request,
}) => {
  await ensureSimulatorPositionMapping(request);
  await ensureSimulatorRunning(request);

  await page.addInitScript(() => {
    window.sessionStorage.setItem(
      "planningShowOnGlobeIds",
      JSON.stringify(["simulator"])
    );
  });

  await page.goto("/planning");

  await expect(
    page.getByText("An error occurred while rendering. Rendering has stopped.")
  ).toHaveCount(0);
  await expect(page.getByText("Live")).toBeVisible();
  await expect(page.locator(".cesium-widget canvas")).toHaveCount(1);
  await expect(page.getByTestId("earth-overview-rendered-sources")).toContainText("Simulator");
});
