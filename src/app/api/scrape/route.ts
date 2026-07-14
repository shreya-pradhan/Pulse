import { NextRequest, NextResponse } from "next/server";
import { ScrapeError, scrapePageContent } from "@/lib/scrape";
import { saveSnapshotForUrl } from "@/lib/snapshots";
import { createAdminClient } from "@/lib/supabase-admin";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const maxDuration = 60;

function isCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  return Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);
}

async function logScrapeAttempt(
  request: NextRequest,
  url: string,
  trackedUrlId: string | undefined,
  outcome: { status: "success" } | { status: "error"; message: string }
) {
  try {
    await createAdminClient()
      .from("scrape_log")
      .insert({
        tracked_url_id: trackedUrlId ?? null,
        url,
        triggered_by: isCronRequest(request) ? "cron" : "manual",
        status: outcome.status,
        error_message: outcome.status === "error" ? outcome.message : null,
      });
  } catch {
    // Logging must never break the actual scrape response.
  }
}

async function scrapeAndPersist(
  request: NextRequest,
  url: string,
  trackedUrlId?: string
) {
  const current = await scrapePageContent(url);
  const supabase = isCronRequest(request)
    ? createAdminClient()
    : await createServerSupabaseClient();

  const { trackedUrlId: resolvedId, previousContent } =
    await saveSnapshotForUrl(supabase, url, current, trackedUrlId);

  return {
    url,
    current,
    previous: previousContent,
    trackedUrlId: resolvedId,
  };
}

async function handleScrapeRequest(
  request: NextRequest,
  url: string,
  trackedUrlId: string | undefined
) {
  try {
    const result = await scrapeAndPersist(request, url, trackedUrlId);
    await logScrapeAttempt(request, url, result.trackedUrlId, {
      status: "success",
    });
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof ScrapeError ? error.message : "Failed to scrape page";
    await logScrapeAttempt(request, url, trackedUrlId, {
      status: "error",
      message,
    });
    return handleScrapeError(error);
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const url = body?.url;
  const trackedUrlId = body?.tracked_url_id;

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  return handleScrapeRequest(
    request,
    url,
    typeof trackedUrlId === "string" ? trackedUrlId : undefined
  );
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  const trackedUrlId =
    request.nextUrl.searchParams.get("tracked_url_id") ?? undefined;

  if (!url) {
    return NextResponse.json(
      { error: "A valid http(s) URL is required via ?url=" },
      { status: 400 }
    );
  }

  return handleScrapeRequest(request, url, trackedUrlId);
}

function handleScrapeError(error: unknown) {
  if (error instanceof ScrapeError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  return NextResponse.json({ error: "Failed to scrape page" }, { status: 500 });
}
