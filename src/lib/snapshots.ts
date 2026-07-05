import { SupabaseClient } from "@supabase/supabase-js";
import { ScrapeError } from "@/lib/scrape";

type SnapshotResult = {
  trackedUrlId: string;
  previousContent: string | null;
};

export async function saveSnapshotForUrl(
  supabase: SupabaseClient,
  url: string,
  content: string,
  trackedUrlId?: string
): Promise<SnapshotResult> {
  let resolvedId = trackedUrlId;

  if (!resolvedId) {
    const { data: trackedUrl, error: lookupError } = await supabase
      .from("tracked_urls")
      .select("id")
      .eq("url", url)
      .maybeSingle();

    if (lookupError) {
      throw new ScrapeError(
        `Failed to look up tracked URL: ${lookupError.message}`,
        500
      );
    }

    if (!trackedUrl) {
      throw new ScrapeError("Tracked URL not found", 404);
    }

    resolvedId = trackedUrl.id;
  }

  if (!resolvedId) {
    throw new ScrapeError("Tracked URL not found", 404);
  }

  const { data: previousSnapshots, error: snapshotError } = await supabase
    .from("snapshots")
    .select("content")
    .eq("tracked_url_id", resolvedId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (snapshotError) {
    throw new ScrapeError(
      `Failed to fetch previous snapshot: ${snapshotError.message}`,
      500
    );
  }

  const previousContent = previousSnapshots?.[0]?.content ?? null;

  const { error: insertError } = await supabase.from("snapshots").insert({
    tracked_url_id: resolvedId,
    content,
  });

  if (insertError) {
    throw new ScrapeError(
      `Failed to save snapshot: ${insertError.message}`,
      500
    );
  }

  return {
    trackedUrlId: resolvedId,
    previousContent,
  };
}
