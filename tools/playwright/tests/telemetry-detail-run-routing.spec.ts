import { expect, test } from "@playwright/test";

const API_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";

function formatRunLabel(runId: string): string {
  const match = runId.match(/-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (!match) return runId;
  return `Run started at ${match[1]} ${match[2]}:${match[3]} UTC`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("telemetry detail preserves source scope while honoring run query", async ({
  page,
  request,
}) => {
  const sourcesResponse = await request.get(`${API_URL}/telemetry/sources`);
  expect(sourcesResponse.ok()).toBeTruthy();

  const sources = (await sourcesResponse.json()) as Array<{ id: string }>;
  let selected: { sourceId: string; channelName: string; runId: string } | null = null;

  for (const source of sources) {
    const runsResponse = await request.get(`${API_URL}/telemetry/sources/${encodeURIComponent(source.id)}/runs`);
    if (!runsResponse.ok()) continue;
    const runsPayload = (await runsResponse.json()) as {
      sources?: Array<{ stream_id?: string }>;
    };
    const runIds = (runsPayload.sources ?? [])
      .map((run) => run.stream_id)
      .filter((runId): runId is string => typeof runId === "string" && runId.length > 0);
    if (runIds.length < 2) continue;

    const channelsResponse = await request.get(
      `${API_URL}/telemetry/list?source_id=${encodeURIComponent(source.id)}`,
    );
    if (!channelsResponse.ok()) continue;
    const channelsPayload = (await channelsResponse.json()) as {
      channels?: Array<{ name?: string }>;
    };
    const channelName = channelsPayload.channels?.find(
      (channel) => typeof channel.name === "string" && channel.name.length > 0,
    )?.name;
    if (!channelName) continue;

    selected = {
      sourceId: source.id,
      channelName,
      runId: runIds[1],
    };
    break;
  }

  expect(selected).toBeTruthy();
  if (!selected) return;

  const expectedRunLabel = formatRunLabel(selected.runId);
  await page.goto(
    `/sources/${encodeURIComponent(selected.sourceId)}/telemetry/${encodeURIComponent(selected.channelName)}?run=${encodeURIComponent(selected.runId)}`,
  );

  await expect(page).toHaveURL(
    new RegExp(
      `${escapeRegExp(
        `/sources/${selected.sourceId}/telemetry/${selected.channelName}`,
      )}\\?run=${escapeRegExp(selected.runId)}$`,
    ),
  );

  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.locator("#history-run")).toContainText(expectedRunLabel);
});
