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
  if (!source) {
    redirect("/overview");
  }
  redirect(`/sources/${encodeURIComponent(source)}/telemetry/${encodeURIComponent(name)}`);
}
