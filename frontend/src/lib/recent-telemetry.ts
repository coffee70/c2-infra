const RECENT_STORAGE_KEY = "telemetry_recent";
const RECENT_MAX = 12;

export function getRecentChannels(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addToRecent(name: string): void {
  if (typeof window === "undefined") return;
  try {
    const current = getRecentChannels();
    const filtered = current.filter((n) => n !== name);
    const updated = [name, ...filtered].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
}
