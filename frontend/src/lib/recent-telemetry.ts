const RECENT_STORAGE_KEY = "telemetry_recent";
const RECENT_MAX = 12;

interface RecentTelemetryEntry {
  sourceId: string;
  name: string;
}

export function getRecentChannels(): RecentTelemetryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<string | RecentTelemetryEntry>;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (typeof entry === "string") {
        return [];
      }
      if (entry && typeof entry.sourceId === "string" && typeof entry.name === "string") {
        return [entry];
      }
      return [];
    });
  } catch {
    return [];
  }
}

export function addToRecent(sourceId: string, name: string): void {
  if (typeof window === "undefined") return;
  try {
    const current = getRecentChannels();
    const filtered = current.filter((entry) => !(entry.sourceId === sourceId && entry.name === name));
    const updated = [{ sourceId, name }, ...filtered].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
}
