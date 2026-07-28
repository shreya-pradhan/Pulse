import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { domainOf, pathOf } from "@/lib/dashboard-utils";
import {
  generateReport,
  PERIOD_DAYS,
  type ReportChange,
  type ReportPeriod,
} from "@/lib/report";

export const maxDuration = 60;

type ChangeRow = {
  summary: string;
  detected_at: string;
  tracked_urls:
    | { url: string }
    | { url: string }[]
    | null;
};

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const period: ReportPeriod = body?.period === "monthly" ? "monthly" : "weekly";

  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - PERIOD_DAYS[period]);

  // RLS keeps this to the caller's own tracked URLs.
  const { data, error } = await supabase
    .from("changes")
    .select("summary, detected_at, tracked_urls!inner(url)")
    .gte("detected_at", start.toISOString())
    .order("detected_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const changes: ReportChange[] = ((data ?? []) as ChangeRow[]).map((row) => {
    const tracked = Array.isArray(row.tracked_urls)
      ? row.tracked_urls[0]
      : row.tracked_urls;
    const url = tracked?.url ?? "";

    return {
      domain: domainOf(url),
      path: pathOf(url),
      detectedAt: row.detected_at,
      summary: row.summary,
    };
  });

  if (changes.length === 0) {
    return NextResponse.json({
      period,
      changeCount: 0,
      report: null,
      message: `No changes were recorded in the last ${PERIOD_DAYS[period]} days, so there's nothing to analyse yet.`,
    });
  }

  try {
    const report = await generateReport(changes, period, start, end);
    return NextResponse.json({
      period,
      changeCount: changes.length,
      report,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[report] Failed to generate:", message);
    return NextResponse.json(
      { error: "Failed to generate report" },
      { status: 500 }
    );
  }
}
