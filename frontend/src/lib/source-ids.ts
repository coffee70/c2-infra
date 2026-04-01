export const DEFAULT_SOURCE_ID = "86a0057f-4733-4de6-af60-455cb3954f1d";
export const DROGONSAT_SOURCE_ID = "27a7e3d4-bbcc-4fa1-9e14-8ebabbea1be6";
export const RHAEGALSAT_SOURCE_ID = "63b0c0ab-8173-44ff-918f-2616ebb449b8";

const LEGACY_SOURCE_ALIAS_MAP: Record<string, string> = {
  default: DEFAULT_SOURCE_ID,
  simulator: DROGONSAT_SOURCE_ID,
  simulator2: RHAEGALSAT_SOURCE_ID,
};

export function resolveSourceAlias(sourceId: string): string {
  return LEGACY_SOURCE_ALIAS_MAP[sourceId] ?? sourceId;
}
