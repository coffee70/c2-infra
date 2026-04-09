import { expect, test, type APIRequestContext } from "@playwright/test";

const API_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:8000";

test.describe.configure({ mode: "serial" });

function formatStreamLabel(streamId: string): string {
  const match = streamId.match(/-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (!match) return streamId;
  return `Stream started at ${match[1]} ${match[2]}:${match[3]} UTC`;
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
          source_id: sourceId,
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

test("telemetry detail preserves source scope while honoring stream query", async ({
  page,
  request,
}) => {
  const sourcesResponse = await request.get(`${API_URL}/telemetry/sources`);
  expect(sourcesResponse.ok()).toBeTruthy();

  const sources = (await sourcesResponse.json()) as Array<{ id: string }>;
  let selected: { sourceId: string; channelName: string; streamId: string } | null = null;

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

    for (const channelName of channelNames) {
      const streamsResponse = await request.get(
        `${API_URL}/telemetry/sources/${encodeURIComponent(source.id)}/channels/${encodeURIComponent(channelName)}/streams`,
      );
      if (!streamsResponse.ok()) continue;
      const streamsPayload = (await streamsResponse.json()) as {
        sources?: Array<{ stream_id?: string }>;
      };
      const streamIds = (streamsPayload.sources ?? [])
        .map((stream) => stream.stream_id)
        .filter((streamId): streamId is string => typeof streamId === "string" && streamId.length > 0);
      if (streamIds.length < 2) continue;

      selected = {
        sourceId: source.id,
        channelName,
        streamId: streamIds[1],
      };
      break;
    }

    if (selected) break;
  }

  expect(selected).toBeTruthy();
  if (!selected) return;

  const expectedStreamLabel = formatStreamLabel(selected.streamId);
  await page.goto(
    `/telemetry/${encodeURIComponent(selected.sourceId)}/${encodeURIComponent(selected.channelName)}?stream_id=${encodeURIComponent(selected.streamId)}`,
  );

  await expect(page).toHaveURL(
    new RegExp(
      `${escapeRegExp(
        `/telemetry/${selected.sourceId}/${selected.channelName}`,
      )}\\?stream_id=${escapeRegExp(selected.streamId)}$`,
    ),
  );

  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.locator("#history-stream")).toContainText(expectedStreamLabel);
});

test("telemetry history stream dropdown preserves backend ordering for opaque ids", async ({
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
        const streamsResponse = await request.get(
          `${API_URL}/telemetry/sources/${encodeURIComponent(sourceId)}/channels/${encodeURIComponent(channelName)}/streams`,
        );
        expect(streamsResponse.ok()).toBeTruthy();
        const streamsPayload = (await streamsResponse.json()) as {
          sources?: Array<{ stream_id?: string }>;
        };
        const streamIds = (streamsPayload.sources ?? [])
          .map((stream) => stream.stream_id)
          .filter((streamId): streamId is string => typeof streamId === "string" && streamId.length > 0);
        const newerIndex = streamIds.indexOf(newerRunId);
        const olderIndex = streamIds.indexOf(olderRunId);
        return newerIndex >= 0 && olderIndex >= 0 && newerIndex < olderIndex;
      },
      { timeout: 45_000 },
    )
    .toBeTruthy();

  await page.goto(
    `/telemetry/${encodeURIComponent(sourceId)}/${encodeURIComponent(channelName)}?stream_id=${encodeURIComponent(newerRunId)}`,
  );

  await expect(page).toHaveURL(
    new RegExp(
      `${escapeRegExp(`/telemetry/${sourceId}/${channelName}`)}\\?stream_id=${escapeRegExp(newerRunId)}$`,
    ),
  );

  await page.getByRole("tab", { name: "History" }).click();
  await page.locator("#history-stream").click();

  const options = page.getByRole("option");
  const optionTexts = await options.allTextContents();
  expect(optionTexts[0]).toContain("Active / latest");
  const newerIndex = optionTexts.findIndex((text) => text.includes(newerRunId));
  const olderIndex = optionTexts.findIndex((text) => text.includes(olderRunId));
  expect(newerIndex).toBeGreaterThan(0);
  expect(olderIndex).toBeGreaterThan(newerIndex);
});

test("telemetry detail defaults to the latest stream that contains the channel", async ({
  page,
  request,
}) => {
  const selected = {
    sourceId: "86a0057f-4733-4de6-af60-455cb3954f1d",
    channelName: "PWR_MAIN_BUS_VOLT",
    fallbackChannelName: "GPS_LAT",
    streamId: "selected-channel-9999-01-01T00-10-00Z",
  };
  const newerStreamId = "fallback-channel-9999-01-01T00-15-00Z";

  await ingestRealtimeSample(
    request,
    selected.sourceId,
    selected.streamId,
    selected.channelName,
    3.3,
    "9999-01-01T00:10:00Z",
  );
  await ingestRealtimeSample(
    request,
    selected.sourceId,
    newerStreamId,
    selected.fallbackChannelName,
    4.56,
    "9999-01-01T00:05:00Z",
  );

  await expect
    .poll(
      async () => {
        const streamsResponse = await request.get(
          `${API_URL}/telemetry/sources/${encodeURIComponent(selected.sourceId)}/channels/${encodeURIComponent(selected.channelName)}/streams`,
        );
        expect(streamsResponse.ok()).toBeTruthy();
        const streamsPayload = (await streamsResponse.json()) as {
          sources?: Array<{ stream_id?: string }>;
        };
        const streamIds = (streamsPayload.sources ?? [])
          .map((stream) => stream.stream_id)
          .filter((streamId): streamId is string => typeof streamId === "string" && streamId.length > 0);
        return {
          hasSelected: streamIds.includes(selected.streamId),
          hasFallback: streamIds.includes(newerStreamId),
        };
      },
      { timeout: 45_000 },
    )
    .toEqual({ hasSelected: true, hasFallback: false });

  await page.goto(
    `/telemetry/${encodeURIComponent(selected.sourceId)}/${encodeURIComponent(selected.channelName)}`,
  );

  await expect(page).toHaveURL(
    new RegExp(
      `${escapeRegExp(`/telemetry/${selected.sourceId}/${selected.channelName}`)}$`,
    ),
  );

  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.locator("#history-stream")).toContainText("Active / latest");
  await page.locator("#history-stream").click();
  const options = page.getByRole("option");
  const optionTexts = await options.allTextContents();
  expect(optionTexts.join(" ")).toContain(formatStreamLabel(selected.streamId));
  expect(optionTexts.join(" ")).not.toContain(formatStreamLabel(newerStreamId));
});
