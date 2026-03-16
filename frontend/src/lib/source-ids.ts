export const DEFAULT_SOURCE_ID = "86a0057f-4733-4de6-af60-455cb3954f1d";
export const DROGONSAT_SOURCE_ID = "27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6";
export const RHAEGALSAT_SOURCE_ID = "63b0c0ab-8173-44ff-918f-2616ebb449b8";

const RUN_ID_RE = /^(.+)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z?)$/;

const LEGACY_SOURCE_ALIAS_MAP: Record<string, string> = {
  default: DEFAULT_SOURCE_ID,
  simulator: DROGONSAT_SOURCE_ID,
  simulator2: RHAEGALSAT_SOURCE_ID,
};

export function resolveSourceAlias(sourceId: string): string {
  return LEGACY_SOURCE_ALIAS_MAP[sourceId] ?? sourceId;
}

export function runIdToSourceId(runId: string): string {
  const match = runId.match(RUN_ID_RE);
  if (!match) return runId;
  const prefix = match[1]!;
  if (prefix.startsWith("simulator2-")) return RHAEGALSAT_SOURCE_ID;
  if (prefix.startsWith("simulator-")) return DROGONSAT_SOURCE_ID;
  if (prefix === DROGONSAT_SOURCE_ID || prefix.startsWith(`${DROGONSAT_SOURCE_ID}-`)) {
    return DROGONSAT_SOURCE_ID;
  }
  if (prefix === RHAEGALSAT_SOURCE_ID || prefix.startsWith(`${RHAEGALSAT_SOURCE_ID}-`)) {
    return RHAEGALSAT_SOURCE_ID;
  }
  return prefix;
}

export function canonicalizeRunId(runId: string): string {
  const match = runId.match(RUN_ID_RE);
  if (!match) return runId;

  const [, prefix, timestamp] = match;
  const sourceId = runIdToSourceId(runId);
  if (prefix === sourceId) return runId;

  const suffix = prefix.startsWith("simulator2-")
    ? prefix.slice("simulator2".length)
    : prefix.startsWith("simulator-")
      ? prefix.slice("simulator".length)
      : prefix.startsWith(`${sourceId}-`)
        ? prefix.slice(sourceId.length)
        : "";

  return `${sourceId}${suffix}-${timestamp}`;
}
