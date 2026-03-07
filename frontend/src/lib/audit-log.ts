/**
 * Structured audit logging for frontend user actions.
 * Logs to console for debugging; enabled in dev or when NEXT_PUBLIC_AUDIT_LOG is set.
 */

const AUDIT_ENABLED =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_AUDIT_LOG === "true";

export function auditLog(
  action: string,
  params?: Record<string, unknown>
): void {
  if (!AUDIT_ENABLED) return;

  const entry = {
    ts: new Date().toISOString(),
    level: "info",
    audit: true,
    action,
    component: "frontend",
    ...params,
  };

  if (typeof window !== "undefined") {
    console.info("[audit]", JSON.stringify(entry));
  }
}
