import { redirect } from "next/navigation";

export default async function TimelineRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  const resolved = await searchParams;

  for (const [key, value] of Object.entries(resolved)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else {
      params.set(key, value);
    }
  }

  params.set("tab", "event-history");
  const query = params.toString();
  redirect(query ? `/overview?${query}` : "/overview?tab=event-history");
}
