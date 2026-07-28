import { GoogleGenerativeAI } from "@google/generative-ai";

export type ReportPeriod = "weekly" | "monthly";

export type ReportChange = {
  domain: string;
  path: string;
  detectedAt: string;
  summary: string;
};

export const PERIOD_DAYS: Record<ReportPeriod, number> = {
  weekly: 7,
  monthly: 30,
};

/**
 * The model is given nothing but Pulse's own change log, and is told in several
 * different ways not to reach past it. Two rules carry most of the weight:
 *
 * - The market is inferred from the changes rather than hardcoded. Pulse tracks
 *   whatever a user points it at, so assuming a sector would produce a confident
 *   but wrong framing for anyone outside that sector.
 * - The thin-data escape hatch matters more than it looks: asked where a market
 *   is heading over two or three edits, an LLM will happily invent a trend, so
 *   it needs explicit permission to say there isn't one yet.
 */
export const REPORT_PROMPT = `You are a competitive-intelligence analyst briefing a product manager.

Below is a complete log of changes detected on competitor web pages during the reporting period. Each entry is a real, observed edit to a live page, recorded automatically.

First, work out from the changes themselves what market these companies compete in. Then write a short briefing on what the changes suggest about where that market is heading.

STRICT GROUNDING RULES
- Use ONLY the changes listed below. Do not use anything you know about these companies from outside this log.
- Infer the market from the products, features, and wording described in the changes — not from prior knowledge of the brands. Name it in your first sentence.
- If the tracked pages span unrelated markets, say so and analyse only the largest coherent group.
- Every claim must trace to at least one listed change. Cite it inline as (domain, date) — e.g. (example.com, 24 Jul).
- If the evidence is too thin to support a trend, say so plainly. Do not manufacture a narrative out of one or two data points.
- Disregard entries that only record view counters, listing ages, timestamps, or capitalisation. Those are artefacts of scraping, not competitive signals.
- Do not speculate about revenue, headcount, funding, customers, or roadmap unless a listed change explicitly states it.
- Do not describe a change as significant merely because it was detected.

OUTPUT FORMAT
- Under 200 words total.
- Exactly three sections, each a short paragraph: "What moved", "What it suggests", "What to watch".
- Plain prose. No preamble, no bullet lists, no restating these instructions.
- If fewer than three substantive changes are listed, output only "What moved" followed by a single line noting there is not yet enough signal for a trend read.`;

export function buildReportInput(
  changes: ReportChange[],
  period: ReportPeriod,
  start: Date,
  end: Date
): string {
  const fmt = (d: Date | string) =>
    new Date(d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });

  const entries = changes
    .map((c) => `- [${c.domain}] ${c.path} — ${fmt(c.detectedAt)} — ${c.summary.replace(/\s+/g, " ").trim()}`)
    .join("\n");

  return `${REPORT_PROMPT}

REPORTING PERIOD: ${period} (${fmt(start)} to ${fmt(end)})
CHANGES (${changes.length} ${changes.length === 1 ? "entry" : "entries"}):
${entries || "(none recorded in this period)"}`;
}

export async function generateReport(
  changes: ReportChange[],
  period: ReportPeriod,
  start: Date,
  end: Date
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

  const result = await model.generateContent(
    buildReportInput(changes, period, start, end)
  );

  return result.response.text().trim();
}
