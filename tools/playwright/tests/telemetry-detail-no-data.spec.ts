import { expect, test } from "@playwright/test";

const API_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("registered channel detail renders when no samples or statistics exist", async ({
  page,
  request,
}) => {
  const sourcesResponse = await request.get(`${API_URL}/telemetry/sources`);
  expect(sourcesResponse.ok()).toBeTruthy();

  const sources = (await sourcesResponse.json()) as Array<{
    id: string;
    source_type?: string;
  }>;
  const source = sources.find((entry) => entry.source_type === "vehicle") ?? sources[0];
  expect(source).toBeTruthy();

  const channelName = `NO_DATA_DETAIL_${Date.now()}`;
  const schemaResponse = await request.post(`${API_URL}/telemetry/schema`, {
    data: {
      source_id: source.id,
      name: channelName,
      units: "deg",
      description: "Registered channel with no samples",
    },
  });
  expect(schemaResponse.ok()).toBeTruthy();

  await page.goto(
    `/sources/${encodeURIComponent(source.id)}/telemetry/${encodeURIComponent(channelName)}`,
  );

  await expect(page).toHaveURL(
    new RegExp(
      `${escapeRegExp(`/sources/${source.id}/telemetry/${channelName}`)}$`,
    ),
  );
  await expect(page.getByRole("heading", { name: new RegExp(channelName) })).toBeVisible();
  await expect(page.locator("header [data-value='']")).toContainText("No data");
  await expect(
    page.getByText(
      "No statistics yet. This channel is registered, but no samples have been received.",
    ),
  ).toBeVisible();
});
