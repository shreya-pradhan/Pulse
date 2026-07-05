import { GoogleGenerativeAI } from "@google/generative-ai";
import { createTwoFilesPatch } from "diff";

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

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });

  const result = await model.generateContent(`${PROMPT}\n\n${diff}`);
  const summary = result.response.text().trim();

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
