import { Resend } from "resend";
import { NextRequest, NextResponse } from "next/server";
import {
  type DigestChange,
  getDigestSubject,
  renderDigestEmail,
} from "@/lib/emails/competitor-digest";
import { computeNextRunAt, type ScheduleInput } from "@/lib/schedule";
import { createAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type DueUrlRow = {
  id: string;
  url: string;
  label: string | null;
  user_id: string;
  schedule_type: "daily" | "weekly";
  schedule_time: string;
  schedule_day: number | null;
  timezone: string;
  users: { email: string } | { email: string }[];
};

function getUserEmail(users: DueUrlRow["users"]): string {
  return Array.isArray(users) ? users[0].email : users.email;
}

type DigestEntry = {
  email: string;
  changes: DigestChange[];
};

type ScrapeResponse = {
  current: string;
  previous: string | null;
};

function getBaseUrl(request: NextRequest): string {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  const host = request.headers.get("host");
  if (host) {
    const protocol = host.startsWith("localhost") ? "http" : "https";
    return `${protocol}://${host}`;
  }

  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

async function callScrapeApi(
  baseUrl: string,
  cronSecret: string,
  url: string,
  trackedUrlId: string
): Promise<ScrapeResponse> {
  const response = await fetch(`${baseUrl}/api/scrape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cronSecret}`,
    },
    body: JSON.stringify({ url, tracked_url_id: trackedUrlId }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Scrape API failed (${response.status})`);
  }

  return response.json();
}

async function callDiffApi(
  baseUrl: string,
  previous: string,
  current: string
): Promise<{ summary: string; diff: string | null }> {
  const response = await fetch(`${baseUrl}/api/diff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ yesterday: previous, today: current }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Diff API failed (${response.status})`);
  }

  return response.json();
}

async function sendDigestEmail(entry: DigestEntry, dashboardUrl: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !from) {
    throw new Error("RESEND_API_KEY and RESEND_FROM_EMAIL must be configured");
  }

  const resend = new Resend(apiKey);

  await resend.emails.send({
    from,
    to: entry.email,
    subject: getDigestSubject(entry.changes.length),
    html: renderDigestEmail(entry.changes, dashboardUrl),
  });
}

function toScheduleInput(row: DueUrlRow): ScheduleInput {
  const time = row.schedule_time.slice(0, 5);

  return {
    scheduleType: row.schedule_type,
    scheduleTime: time,
    scheduleDay: row.schedule_day,
    timezone: row.timezone,
  };
}

async function advanceNextRunAt(supabase: ReturnType<typeof createAdminClient>, row: DueUrlRow) {
  const nextRunAt = await computeNextRunAt(
    supabase,
    toScheduleInput(row),
    new Date()
  );

  const { error } = await supabase
    .from("tracked_urls")
    .update({ next_run_at: nextRunAt })
    .eq("id", row.id);

  if (error) {
    throw new Error(`Failed to update next_run_at: ${error.message}`);
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const baseUrl = getBaseUrl(request);
  const now = new Date().toISOString();

  const { data: dueUrls, error } = await supabase
    .from("tracked_urls")
    .select(
      "id, url, label, user_id, schedule_type, schedule_time, schedule_day, timezone, users!inner(email)"
    )
    .lte("next_run_at", now);

  if (error) {
    return NextResponse.json(
      { error: `Failed to fetch due URLs: ${error.message}` },
      { status: 500 }
    );
  }

  if (!dueUrls?.length) {
    return new NextResponse(null, { status: 204 });
  }

  const digests = new Map<string, DigestEntry>();
  const results: {
    url: string;
    status: string;
    error?: string;
  }[] = [];

  for (const tracked of dueUrls as DueUrlRow[]) {
    try {
      const { current, previous } = await callScrapeApi(
        baseUrl,
        cronSecret,
        tracked.url,
        tracked.id
      );

      if (previous === null) {
        await advanceNextRunAt(supabase, tracked);
        results.push({ url: tracked.url, status: "initial_snapshot" });
        continue;
      }

      if (previous === current) {
        await advanceNextRunAt(supabase, tracked);
        results.push({ url: tracked.url, status: "unchanged" });
        continue;
      }

      const { summary, diff } = await callDiffApi(baseUrl, previous, current);

      if (summary !== "NO_CHANGE" && diff) {
        const { error: changeError } = await supabase.from("changes").insert({
          tracked_url_id: tracked.id,
          diff,
          summary,
        });

        if (changeError) throw changeError;

        const existing = digests.get(tracked.user_id);
        const change: DigestChange = {
          label: tracked.label,
          url: tracked.url,
          summary,
        };

        if (existing) {
          existing.changes.push(change);
        } else {
          digests.set(tracked.user_id, {
            email: getUserEmail(tracked.users),
            changes: [change],
          });
        }

        results.push({ url: tracked.url, status: "change_detected" });
      } else {
        results.push({ url: tracked.url, status: "no_meaningful_change" });
      }

      await advanceNextRunAt(supabase, tracked);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      results.push({ url: tracked.url, status: "error", error: message });

      try {
        await advanceNextRunAt(supabase, tracked);
      } catch {
        // Avoid leaving a due URL stuck if reschedule fails.
      }
    }
  }

  const emailResults: { email: string; status: string; error?: string }[] = [];

  for (const entry of Array.from(digests.values())) {
    try {
      await sendDigestEmail(entry, `${baseUrl}/dashboard`);
      emailResults.push({ email: entry.email, status: "sent" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      emailResults.push({
        email: entry.email,
        status: "failed",
        error: message,
      });
    }
  }

  return NextResponse.json({
    processed: dueUrls.length,
    changesFound: results.filter((r) => r.status === "change_detected").length,
    emailsSent: emailResults.filter((r) => r.status === "sent").length,
    results,
    emailResults,
  });
}
