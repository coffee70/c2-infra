"use client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const API_FALLBACK_URL = process.env.NEXT_PUBLIC_API_FALLBACK_URL || "";

export interface ApiError extends Error {
  status?: number;
  detail?: string;
}

function getApiBases(useFallback = false): string[] {
  const bases = useFallback ? [API_URL, API_FALLBACK_URL] : [API_URL];
  return bases.filter(Boolean).filter((value, index, all) => all.indexOf(value) === index);
}

function isIdempotentMethod(method: string | undefined): boolean {
  const normalized = (method ?? "GET").toUpperCase();
  return normalized === "GET" || normalized === "HEAD";
}

async function parseError(response: Response): Promise<ApiError> {
  let message = response.statusText || `HTTP ${response.status}`;
  let detail: string | undefined;

  try {
    const text = await response.text();
    if (text) {
      try {
        const json = JSON.parse(text) as { detail?: string; message?: string };
        detail = typeof json.detail === "string" ? json.detail : undefined;
        message = detail || (typeof json.message === "string" ? json.message : message);
      } catch {
        detail = text;
        message = text;
      }
    }
  } catch {}

  const error = new Error(message) as ApiError;
  error.status = response.status;
  error.detail = detail;
  return error;
}

export async function fetchJson<T>(
  path: string,
  init: RequestInit & { signal?: AbortSignal; useFallback?: boolean } = {}
): Promise<T> {
  const { useFallback = false, ...requestInit } = init;
  const bases = getApiBases(useFallback && isIdempotentMethod(requestInit.method));
  let lastError: unknown = null;

  for (const base of bases) {
    try {
      const response = await fetch(`${base}${path}`, requestInit);
      if (!response.ok) {
        throw await parseError(response);
      }
      if (response.status === 204) {
        return undefined as T;
      }
      return (await response.json()) as T;
    } catch (error) {
      if (requestInit.signal?.aborted) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError ?? new Error("Request failed");
}

export async function fetchVoid(
  path: string,
  init: RequestInit & { signal?: AbortSignal; useFallback?: boolean } = {}
): Promise<void> {
  await fetchJson(path, init);
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
