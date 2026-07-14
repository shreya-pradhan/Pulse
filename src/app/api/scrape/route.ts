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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const url = body?.url;
    const trackedUrlId = body?.tracked_url_id;

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    const result = await scrapeAndPersist(
      request,
      url,
      typeof trackedUrlId === "string" ? trackedUrlId : undefined
    );
    return NextResponse.json(result);
  } catch (error) {
    return handleScrapeError(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl.searchParams.get("url");
    const trackedUrlId =
      request.nextUrl.searchParams.get("tracked_url_id") ?? undefined;

    if (!url) {
      return NextResponse.json(
        { error: "A valid http(s) URL is required via ?url=" },
        { status: 400 }
      );
    }

    const result = await scrapeAndPersist(request, url, trackedUrlId);
    return NextResponse.json(result);
  } catch (error) {
    return handleScrapeError(error);
  }
}

function handleScrapeError(error: unknown) {
  if (error instanceof ScrapeError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  return NextResponse.json({ error: "Failed to scrape page" }, { status: 500 });
}
