import { expect, test } from "@playwright/test";

test("overview bootstrap failures surface an error instead of a loading spinner", async ({
  page,
}) => {
  await page.route("**/telemetry/sources", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "test-source",
          name: "Test Source",
          source_type: "vehicle",
        },
      ]),
    });
  });

  await page.route("**/telemetry/sources/test-source/streams", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sources: [] }),
    });
  });

  await page.route("**/telemetry/overview*", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "overview snapshot unavailable" }),
    });
  });

  await page.route("**/telemetry/anomalies*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        power: [],
        thermal: [],
        adcs: [],
        comms: [],
        other: [],
      }),
    });
  });

  await page.route("**/telemetry/watchlist*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ channels: [] }),
    });
  });

  await page.goto("/overview?source=test-source");

  await expect(page.getByRole("heading", { name: "Operator Overview" })).toBeVisible();
  const alert = page.locator('[data-slot="alert"]');
  await expect(alert).toContainText("Failed to load overview");
  await expect(alert).toContainText("Retry loading overview");
  await expect(page.getByText("Loading overview…")).toHaveCount(0);
});

test("overview bootstrap HTML responses surface a JSON parsing error instead of raw syntax noise", async ({
  page,
}) => {
  await page.route("**/telemetry/sources", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!DOCTYPE html><html><body>oops</body></html>",
    });
  });

  await page.route("**/telemetry/sources/test-source/streams", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sources: [] }),
    });
  });

  await page.goto("/overview?source=test-source");

  await expect(page.getByRole("heading", { name: "Operator Overview" })).toBeVisible();
  const alert = page.locator('[data-slot="alert"]');
  await expect(alert).toContainText("Failed to load overview");
  await expect(alert).not.toContainText("Unexpected token");
  await expect(page.getByText("Loading overview…")).toHaveCount(0);
});
