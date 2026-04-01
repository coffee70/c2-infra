import { expect, test } from "@playwright/test";

test("home redirects to overview and renders primary navigation @smoke", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/overview$/);
  await expect(
    page.getByRole("heading", { name: "Operator Overview" })
  ).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "Watchlist" })).toBeVisible();
  await expect(page.getByText("Key channels: power, thermal, ADCS, comms")).toBeVisible();
  await expect(page.getByText("Loading overview…")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Planning" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sources" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Help and documentation" })).toBeVisible();
});
