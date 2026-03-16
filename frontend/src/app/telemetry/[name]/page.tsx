import { redirect } from "next/navigation";

export default async function TelemetryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ source?: string }>;
}) {
  const { name } = await params;
  const { source } = await searchParams;
  const sourceId = source ?? "default";
  redirect(`/sources/${encodeURIComponent(sourceId)}/telemetry/${encodeURIComponent(name)}`);
}
