import { createTwoFilesPatch } from "diff";
import { generateWithFallback } from "@/lib/gemini";

/**
 * A failure here is not recoverable on the next run: the cron path saves the
 * new snapshot before summarising, so a thrown error advances next_run_at and
 * the following scan compares against the already-updated content and reports
 * "unchanged". The change is lost for good, which is why this retries and
 * falls back rather than failing on a single blip.
 */
const SUMMARY_MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest"] as const;

const PROMPT = `You are a product manager reviewing competitor website changes.
Here is a diff of a competitor page. Summarize ONLY meaningful
changes (pricing, features, messaging) in 2-3 bullet points.
Ignore nav, footer, cookie banner, and layout changes.
If there are no meaningful changes, respond with: NO_CHANGE`;

export function computeDiff(
  yesterday: string,
  today: string
): string | null {
  if (yesterday === today) return null;

  const patch = createTwoFilesPatch("yesterday", "today", yesterday, today);
  const hasChanges = patch
    .split("\n")
    .some((line) => line.startsWith("+") || line.startsWith("-"));

  return hasChanges ? patch : null;
}

export async function summarizeDiff(diff: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const summary = await generateWithFallback(
    apiKey,
    SUMMARY_MODELS,
    `${PROMPT}\n\n${diff}`
  );

  if (summary.toUpperCase().includes("NO_CHANGE")) {
    return "NO_CHANGE";
  }

  return summary;
}

export async function diffAndSummarize(
  yesterday: string,
  today: string
): Promise<{ summary: string; diff: string | null }> {
  const diff = computeDiff(yesterday, today);

  if (!diff) {
    return { summary: "NO_CHANGE", diff: null };
  }

  const summary = await summarizeDiff(diff);
  return { summary, diff };
}
