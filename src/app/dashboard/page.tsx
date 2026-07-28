export const dynamic = "force-dynamic";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { buildDiff } from "@/lib/diff-render";
import { domainOf, pathOf } from "@/lib/dashboard-utils";
import ChangeViews, {
  type ChangeEntry,
  type FrequencyRow,
} from "./change-views";

const DAYS_WINDOW = 14;

type ChangeRow = {
  id: string;
  summary: string;
  detected_at: string;
  diff: string | null;
  tracked_urls:
    | { label: string | null; url: string }
    | { label: string | null; url: string }[]
    | null;
};

/** The last DAYS_WINDOW dates as UTC ISO days, oldest first. */
function recentDays(): string[] {
  const today = new Date();
  return Array.from({ length: DAYS_WINDOW }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - (DAYS_WINDOW - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();

  const [{ data: trackedUrls }, { data: changeRows }] = await Promise.all([
    supabase.from("tracked_urls").select("url"),
    supabase
      .from("changes")
      .select("id, summary, detected_at, diff, tracked_urls!inner(label, url)")
      .order("detected_at", { ascending: false }),
  ]);

  const changes: ChangeEntry[] = ((changeRows ?? []) as ChangeRow[]).map((row) => {
    const tracked = Array.isArray(row.tracked_urls)
      ? row.tracked_urls[0]
      : row.tracked_urls;
    const url = tracked?.url ?? "";
    const rendered = buildDiff(row.diff);

    return {
      id: row.id,
      domain: domainOf(url),
      path: pathOf(url),
      url,
      label: tracked?.label ?? null,
      summary: row.summary,
      detectedAt: row.detected_at,
      segments: rendered?.segments ?? [],
      minorCount: rendered?.minorCount ?? 0,
      oldLength: rendered?.oldLength ?? 0,
    };
  });

  const days = recentDays();
  const domains = Array.from(
    new Set((trackedUrls ?? []).map((t) => domainOf(t.url)))
  ).sort();

  const frequency: FrequencyRow[] = domains
    .map((domain) => {
      const counts = days.map(
        (day) =>
          changes.filter(
            (c) => c.domain === domain && c.detectedAt.slice(0, 10) === day
          ).length
      );
      return {
        domain,
        counts,
        total: counts.reduce((sum, n) => sum + n, 0),
      };
    })
    .sort((a, b) => b.total - a.total || a.domain.localeCompare(b.domain));

  return (
    <ChangeViews
      changes={changes}
      days={days}
      frequency={frequency}
      domains={domains}
      timezone="UTC"
    />
  );
}
