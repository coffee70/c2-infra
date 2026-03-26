import { expect, test } from "@playwright/test";

const API_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";
const CHANNEL_NAME = "decoder.aprs.payload_temp";

test("overview search labels discovered channels", async ({ page, request }) => {
  const sourcesResponse = await request.get(`${API_URL}/telemetry/sources`);
  expect(sourcesResponse.ok()).toBeTruthy();

  const sources = (await sourcesResponse.json()) as Array<{
    id: string;
    source_type?: string;
  }>;
  const source = sources.find((entry) => entry.source_type === "vehicle") ?? sources[0];
  expect(source).toBeTruthy();

  const ingestResponse = await request.post(`${API_URL}/telemetry/realtime/ingest`, {
    data: {
      events: [
        {
          source_id: source.id,
          generation_time: "2026-03-26T16:10:00Z",
          value: 41.25,
          tags: { decoder: "APRS", field_name: "Payload Temp" },
        },
      ],
    },
  });
  expect(ingestResponse.ok()).toBeTruthy();

  await expect
    .poll(async () => {
      const response = await request.get(
        `${API_URL}/telemetry/list?source_id=${encodeURIComponent(source.id)}`,
      );
      const payload = (await response.json()) as {
        channels?: Array<{ name: string; channel_origin?: string }>;
      };
      return payload.channels?.find((channel) => channel.name === CHANNEL_NAME)?.channel_origin ?? null;
    })
    .toBe("discovered");

  await page.goto(`/overview?source=${encodeURIComponent(source.id)}`);

  await page.getByRole("button", { name: /Search telemetry/i }).click();
  await page.locator("[data-telemetry-search-input]").fill(CHANNEL_NAME);
  await page.getByRole("button", { name: "Search", exact: true }).click();

  const resultCard = page.locator("div.rounded-2xl").filter({ has: page.getByRole("link", { name: CHANNEL_NAME }) }).first();
  await expect(resultCard).toBeVisible();
  await expect(resultCard.getByText("Discovered", { exact: true })).toBeVisible();
});
