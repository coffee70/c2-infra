import { expect, test } from "@playwright/test";

test("vehicle config explorer switches files and keeps the workspace interactive", async ({
  page,
}) => {
  let documentRequestCount = 0;

  await page.route("**/vehicle-configs/**", async (route) => {
    if (
      route.request().method() === "GET" &&
      !route.request().url().endsWith("/vehicle-configs")
    ) {
      documentRequestCount += 1;
      if (documentRequestCount === 2) {
        await page.waitForTimeout(600);
      }
    }
    await route.continue();
  });
  let validateRequestCount = 0;
  await page.route("**/vehicle-configs/validate", async (route) => {
    validateRequestCount += 1;
    if (validateRequestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          valid: true,
          parsed: {
            name: "RhaegalSat",
            version: 1,
            channel_count: 21,
            scenario_names: ["nominal"],
            has_position_mapping: true,
            has_ingestion: false,
          },
          errors: [],
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        valid: false,
        parsed: null,
        errors: [
          {
            loc: ["channels", "3", "name"],
            message: "Channel name is required",
            type: "missing",
          },
        ],
      }),
    });
  });

  await page.goto("/sources/configs");

  const fileButtons = page.getByTestId("vehicle-config-file-button");
  await expect.poll(async () => fileButtons.count()).toBeGreaterThanOrEqual(2);

  const firstButton = fileButtons.nth(0);
  const secondButton = fileButtons.nth(1);
  const secondPath = (await secondButton.getAttribute("data-path")) ?? "";
  expect(secondPath.length).toBeGreaterThan(0);

  await secondButton.evaluate((element: HTMLButtonElement) => element.click());

  await expect(page.getByTestId("vehicle-config-loading-shell")).toContainText(`Loading ${secondPath}...`);
  await expect(page).toHaveURL(/\/sources\/configs$/);
  await expect(page.getByTestId("vehicle-config-path-display")).toContainText(secondPath);
  await expect(page.getByTestId("vehicle-config-loading-shell")).toHaveCount(0);
  await expect(page.getByTestId("vehicle-config-toolbar-top")).toContainText("Validate");
  await expect(page.getByTestId("vehicle-config-toolbar-top")).toContainText("Save");
  await expect(page.getByTestId("vehicle-config-toolbar-meta")).toContainText("Saved");
  await expect(page.getByTestId("vehicle-config-toolbar-meta")).toContainText("channels");
  const titleBox = await page.getByTestId("vehicle-config-toolbar-title").boundingBox();
  const actionsBox = await page.getByTestId("vehicle-config-toolbar-actions").boundingBox();
  expect(titleBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  const titleMidpoint = (titleBox?.y ?? 0) + (titleBox?.height ?? 0) / 2;
  const actionsMidpoint = (actionsBox?.y ?? 0) + (actionsBox?.height ?? 0) / 2;
  expect(Math.abs(actionsMidpoint - titleMidpoint)).toBeLessThan(4);

  await page.getByRole("button", { name: "Validate" }).click();
  const editorStage = page.getByTestId("vehicle-config-editor-stage");
  const noticeRegion = page.getByTestId("editor-status-notice-region");
  const notice = page.getByTestId("editor-status-notice");
  await expect(notice).toContainText("Validation Passed");
  await expect(notice).toContainText("Vehicle configuration is valid.");
  await expect(noticeRegion).toBeVisible();
  const editorBox = await editorStage.boundingBox();
  const noticeBox = await noticeRegion.boundingBox();
  expect(editorBox).not.toBeNull();
  expect(noticeBox).not.toBeNull();
  const editorMidpoint = (editorBox?.x ?? 0) + (editorBox?.width ?? 0) / 2;
  const noticeMidpoint = (noticeBox?.x ?? 0) + (noticeBox?.width ?? 0) / 2;
  expect(Math.abs(noticeMidpoint - editorMidpoint)).toBeLessThan(24);
  expect((noticeBox?.y ?? 0) - (editorBox?.y ?? 0)).toBeLessThan(32);
  await expect(notice).toHaveCount(0, { timeout: 6000 });

  await page.getByRole("button", { name: "Validate" }).click();
  await expect(notice).toContainText("Validation Failed");
  await expect(notice).toContainText("Channel name is required");
  await page.waitForTimeout(4500);
  await expect(notice).toHaveCount(1);
  await page.getByTestId("editor-status-notice-close").click();
  await expect(notice).toHaveCount(0);

  const resizeHandle = page.getByTestId("vehicle-config-resize-handle");
  await expect(resizeHandle).toBeVisible();
  const explorer = page.getByTestId("vehicle-config-explorer");
  const beforeResize = await explorer.boundingBox();
  expect(beforeResize).not.toBeNull();
  await resizeHandle.hover();
  await page.mouse.down();
  await page.mouse.move((beforeResize?.x ?? 0) + (beforeResize?.width ?? 0) + 120, 240);
  await page.mouse.up();
  const afterResize = await explorer.boundingBox();
  expect(afterResize).not.toBeNull();
  expect((afterResize?.width ?? 0) - (beforeResize?.width ?? 0)).toBeGreaterThan(40);

  await page.getByRole("button", { name: "Validate" }).click();
  await expect(notice).toContainText("Validation Failed");

  await firstButton.evaluate((element: HTMLButtonElement) => element.click());
  await expect(page).toHaveURL(/\/sources\/configs$/);
  await expect(page.getByTestId("vehicle-config-path-display")).toContainText(
    ((await firstButton.getAttribute("data-path")) ?? "")
  );
  await expect(notice).toHaveCount(0);
});
