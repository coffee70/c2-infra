import { expect, test } from "@playwright/test";

const API_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";

test.describe.configure({ mode: "serial" });

test("telemetry inventory supports browsing, routing, and watchlist toggles", async ({
  page,
  request,
}) => {
  const sourcesResponse = await request.get(`${API_URL}/telemetry/sources`);
  expect(sourcesResponse.ok()).toBeTruthy();
  const sources = (await sourcesResponse.json()) as Array<{ id: string; source_type?: string }>;
  const source = sources.find((entry) => entry.source_type === "vehicle") ?? sources[0];
  expect(source).toBeTruthy();
  if (!source) return;

  const channelName = `INV_ROUTE_${Date.now()}`;
  const schemaResponse = await request.post(`${API_URL}/telemetry/schema`, {
    data: {
      source_id: source.id,
      name: channelName,
      units: "V",
      description: "Inventory route test channel",
      subsystem_tag: "power",
    },
  });
  expect(schemaResponse.ok()).toBeTruthy();

  await page.goto(`/telemetry?source=${encodeURIComponent(source.id)}`);
  await expect(page.getByRole("heading", { name: "Telemetry" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Telemetry" })).toHaveAttribute("aria-current", "page");

  const search = page.getByLabel("Search");
  await search.fill(channelName);
  await expect(page.getByText(channelName)).toBeVisible();

  const addButton = page.getByRole("button", { name: `Add ${channelName} to watchlist` });
  await addButton.click();
  await expect(page.getByRole("button", { name: `Remove ${channelName} from watchlist` })).toBeVisible();

  await page.getByText(channelName).click();
  await expect(page).toHaveURL(new RegExp(`/telemetry/${source.id}/${channelName}$`));
  await expect(page.getByRole("link", { name: "Telemetry" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Back to Telemetry" })).toBeVisible();

  await page.goto(`/telemetry?source=${encodeURIComponent(source.id)}`);
  await search.fill(channelName);
  const removeButton = page.getByRole("button", { name: `Remove ${channelName} from watchlist` });
  await removeButton.click();
  await expect(page.getByRole("button", { name: `Add ${channelName} to watchlist` })).toBeVisible();
});

test("telemetry inventory redirects unavailable channels back to telemetry root", async ({
  page,
  request,
}) => {
  const sourcesResponse = await request.get(`${API_URL}/telemetry/sources`);
  expect(sourcesResponse.ok()).toBeTruthy();
  const sources = (await sourcesResponse.json()) as Array<{ id: string }>;
  const source = sources[0];
  expect(source).toBeTruthy();
  if (!source) return;

  const missingChannel = `MISSING_${Date.now()}`;
  await page.goto(`/telemetry/${encodeURIComponent(source.id)}/${encodeURIComponent(missingChannel)}`);
  await expect(page).toHaveURL(
    new RegExp(`/telemetry\\?source=${encodeURIComponent(source.id)}&channel_unavailable=${encodeURIComponent(missingChannel)}$`)
  );
  await expect(page.getByText(`${missingChannel} is not available for this source.`)).toBeVisible();
});

test("old sources-scoped telemetry detail route does not exist", async ({ page, request }) => {
  const sourcesResponse = await request.get(`${API_URL}/telemetry/sources`);
  expect(sourcesResponse.ok()).toBeTruthy();
  const sources = (await sourcesResponse.json()) as Array<{ id: string }>;
  const source = sources[0];
  expect(source).toBeTruthy();
  if (!source) return;

  await page.goto(`/sources/${encodeURIComponent(source.id)}/telemetry/DOES_NOT_EXIST`);
  await expect(page.getByText("This page could not be found")).toBeVisible();
});
