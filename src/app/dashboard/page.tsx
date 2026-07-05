export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import DashboardContent, {
  type ChangeHistoryItem,
  type TrackedUrlCard,
} from "./dashboard-content";
import SignOutButton from "./sign-out-button";

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

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  await supabase.from("users").upsert(
    { id: user.id, email: user.email! },
    { onConflict: "id" }
  );

  const { data: trackedUrls } = await supabase
    .from("tracked_urls")
    .select(
      "id, label, url, next_run_at, schedule_type, schedule_time, schedule_day, timezone"
    )
    .order("created_at", { ascending: false });

  const ids = (trackedUrls ?? []).map((t) => t.id);

  let lastCheckedMap = new Map<string, string>();
  let lastChangeMap = new Map<string, string>();
  let changeHistory: ChangeHistoryItem[] = [];

  if (ids.length > 0) {
    const { data: snapshots } = await supabase
      .from("snapshots")
      .select("tracked_url_id, created_at")
      .in("tracked_url_id", ids)
      .order("created_at", { ascending: false });

    lastCheckedMap = latestByUrlId(snapshots ?? [], "created_at");

    const { data: changes } = await supabase
      .from("changes")
      .select(
        "id, tracked_url_id, summary, detected_at, tracked_urls(label, url)"
      )
      .in("tracked_url_id", ids)
      .order("detected_at", { ascending: false });

    lastChangeMap = latestByUrlId(
      (changes ?? []).map((c) => ({
        tracked_url_id: c.tracked_url_id,
        detected_at: c.detected_at,
      })),
      "detected_at"
    );

    changeHistory = (changes ?? []).map((change) => {
      const tracked = change.tracked_urls as
        | { label: string | null; url: string }
        | { label: string | null; url: string }[]
        | null;

      const info = Array.isArray(tracked) ? tracked[0] : tracked;

      return {
        id: change.id,
        label: info?.label ?? null,
        url: info?.url ?? "",
        summary: change.summary,
        detectedAt: change.detected_at,
      };
    });
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

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
              <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </span>
            <div>
              <span className="text-sm font-semibold text-zinc-900">Pulse</span>
              <p className="text-xs text-zinc-400">{user.email}</p>
            </div>
          </div>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-10">
        <DashboardContent
          trackedUrls={cards}
          changeHistory={changeHistory}
        />
      </main>
    </div>
  );
}
