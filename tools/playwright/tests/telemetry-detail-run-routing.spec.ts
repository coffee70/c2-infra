import { expect, test, type APIRequestContext } from "@playwright/test";

const API_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";

function formatRunLabel(runId: string): string {
  const match = runId.match(/-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (!match) return runId;
  return `Run started at ${match[1]} ${match[2]}:${match[3]} UTC`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function ingestRealtimeSample(
  request: APIRequestContext,
  sourceId: string,
  streamId: string,
  channelName: string,
  value: number,
  receptionTime: string,
) {
  const response = await request.post(`${API_URL}/telemetry/realtime/ingest`, {
    data: {
      events: [
        {
          vehicle_id: sourceId,
          stream_id: streamId,
          channel_name: channelName,
          value,
          reception_time: receptionTime,
        },
      ],
    },
  });

  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { accepted?: number };
  expect(payload.accepted).toBe(1);
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

test("telemetry history run dropdown preserves backend ordering for opaque ids", async ({
  page,
  request,
}) => {
  const sourceId = "86a0057f-4733-4de6-af60-455cb3954f1d";
  const channelName = "PWR_MAIN_BUS_VOLT";
  const olderRunId = "fffffff0-0000-0000-0000-000000000000";
  const newerRunId = "00000000-0000-0000-0000-000000000001";

  await ingestRealtimeSample(
    request,
    sourceId,
    olderRunId,
    channelName,
    3.1,
    "2026-03-28T12:00:00Z",
  );
  await ingestRealtimeSample(
    request,
    sourceId,
    newerRunId,
    channelName,
    3.2,
    "2026-03-28T12:05:00Z",
  );

  await expect
    .poll(
      async () => {
        const runsResponse = await request.get(
          `${API_URL}/telemetry/sources/${encodeURIComponent(sourceId)}/channels/${encodeURIComponent(channelName)}/runs`,
        );
        expect(runsResponse.ok()).toBeTruthy();
        const runsPayload = (await runsResponse.json()) as {
          sources?: Array<{ stream_id?: string }>;
        };
        return (runsPayload.sources ?? [])
          .map((run) => run.stream_id)
          .filter((runId): runId is string => typeof runId === "string" && runId.length > 0);
      },
      { timeout: 45_000 },
    )
    .toEqual([newerRunId, olderRunId]);

  await page.goto(
    `/sources/${encodeURIComponent(sourceId)}/telemetry/${encodeURIComponent(channelName)}?run=${encodeURIComponent(newerRunId)}`,
  );

  await expect(page).toHaveURL(
    new RegExp(
      `${escapeRegExp(`/sources/${sourceId}/telemetry/${channelName}`)}\\?run=${escapeRegExp(newerRunId)}$`,
    ),
  );

  await page.getByRole("tab", { name: "History" }).click();
  await page.locator("#history-run").click();

  const options = page.getByRole("option");
  await expect(options).toHaveCount(3);
  await expect(options.nth(0)).toContainText("Active / latest");
  await expect(options.nth(1)).toContainText(newerRunId);
  await expect(options.nth(2)).toContainText(olderRunId);
});

test("telemetry detail defaults to the latest stream that contains the channel", async ({
  page,
  request,
}) => {
  const sourcesResponse = await request.get(`${API_URL}/telemetry/sources`);
  expect(sourcesResponse.ok()).toBeTruthy();

  const sources = (await sourcesResponse.json()) as Array<{ id: string }>;
  let selected:
    | {
        sourceId: string;
        channelName: string;
        fallbackChannelName: string;
        runId: string;
      }
    | null = null;

  for (const source of sources) {
    const channelsResponse = await request.get(
      `${API_URL}/telemetry/list?source_id=${encodeURIComponent(source.id)}`,
    );
    if (!channelsResponse.ok()) continue;
    const channelsPayload = (await channelsResponse.json()) as {
      channels?: Array<{ name?: string }>;
    };
    const channelNames = (channelsPayload.channels ?? [])
      .map((channel) => channel.name)
      .filter((channelName): channelName is string => typeof channelName === "string" && channelName.length > 0);
    if (channelNames.length < 2) continue;

    for (let channelIndex = 0; channelIndex < channelNames.length; channelIndex += 1) {
      const channelName = channelNames[channelIndex];
      const runsResponse = await request.get(
        `${API_URL}/telemetry/sources/${encodeURIComponent(source.id)}/channels/${encodeURIComponent(channelName)}/runs`,
      );
      if (!runsResponse.ok()) continue;
      const runsPayload = (await runsResponse.json()) as {
        sources?: Array<{ stream_id?: string }>;
      };
      const runIds = (runsPayload.sources ?? [])
        .map((run) => run.stream_id)
        .filter((runId): runId is string => typeof runId === "string" && runId.length > 0);
      if (runIds.length === 0) continue;

      const fallbackChannelName = channelNames.find((name) => name !== channelName);
      if (!fallbackChannelName) continue;

      selected = {
        sourceId: source.id,
        channelName,
        fallbackChannelName,
        runId: runIds[0],
      };
      break;
    }

    if (selected) break;
  }

  expect(selected).toBeTruthy();
  if (!selected) return;

  const newerRunId = "mixed-new-9999-01-01T00-05-00Z";
  await ingestRealtimeSample(
    request,
    selected.sourceId,
    newerRunId,
    selected.fallbackChannelName,
    4.56,
    "9999-01-01T00:05:00Z",
  );

  await expect
    .poll(
      async () => {
        const runsResponse = await request.get(
          `${API_URL}/telemetry/sources/${encodeURIComponent(selected.sourceId)}/runs`,
        );
        expect(runsResponse.ok()).toBeTruthy();
        const runsPayload = (await runsResponse.json()) as {
          sources?: Array<{ stream_id?: string }>;
        };
        return (runsPayload.sources ?? [])
          .map((run) => run.stream_id)
          .filter((runId): runId is string => typeof runId === "string" && runId.length > 0)
          .includes(newerRunId);
      },
      { timeout: 45_000 },
    )
    .toBeTruthy();

  await page.goto(
    `/sources/${encodeURIComponent(selected.sourceId)}/telemetry/${encodeURIComponent(selected.channelName)}`,
  );

  await expect(page).toHaveURL(
    new RegExp(
      `${escapeRegExp(`/sources/${selected.sourceId}/telemetry/${selected.channelName}`)}$`,
    ),
  );

  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.locator("#history-run")).toContainText(formatRunLabel(selected.runId));
  await expect(page.locator("#history-run")).not.toContainText(formatRunLabel(newerRunId));
});
