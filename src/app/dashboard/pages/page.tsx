export const dynamic = "force-dynamic";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import TrackedUrlsContent, { type TrackedUrlCard } from "./tracked-urls-content";

function latestByUrlId<T extends { tracked_url_id: string }>(
  rows: T[],
  dateKey: keyof T
): Map<string, string> {
  const map = new Map<string, string>();

  for (const row of rows) {
    if (!map.has(row.tracked_url_id)) {
      map.set(row.tracked_url_id, row[dateKey] as string);
    }
  }

  return map;
}

export default async function TrackedPagesPage() {
  const supabase = await createServerSupabaseClient();

  const { data: trackedUrls } = await supabase
    .from("tracked_urls")
    .select(
      "id, label, url, next_run_at, schedule_type, schedule_time, schedule_day, timezone"
    )
    .order("created_at", { ascending: false });

  const ids = (trackedUrls ?? []).map((t) => t.id);

  let lastCheckedMap = new Map<string, string>();
  let lastChangeMap = new Map<string, string>();

  if (ids.length > 0) {
    const [{ data: snapshots }, { data: changes }] = await Promise.all([
      supabase
        .from("snapshots")
        .select("tracked_url_id, created_at")
        .in("tracked_url_id", ids)
        .order("created_at", { ascending: false }),
      supabase
        .from("changes")
        .select("tracked_url_id, detected_at")
        .in("tracked_url_id", ids)
        .order("detected_at", { ascending: false }),
    ]);

    lastCheckedMap = latestByUrlId(snapshots ?? [], "created_at");
    lastChangeMap = latestByUrlId(changes ?? [], "detected_at");
  }

  const cards: TrackedUrlCard[] = (trackedUrls ?? []).map((tracked) => ({
    id: tracked.id,
    label: tracked.label,
    url: tracked.url,
    lastChecked: lastCheckedMap.get(tracked.id) ?? null,
    lastChange: lastChangeMap.get(tracked.id) ?? null,
    nextRunAt: tracked.next_run_at ?? null,
    scheduleType: tracked.schedule_type,
    scheduleTime: String(tracked.schedule_time).slice(0, 5),
    scheduleDay: tracked.schedule_day,
    timezone: tracked.timezone,
  }));

  return <TrackedUrlsContent trackedUrls={cards} />;
}
