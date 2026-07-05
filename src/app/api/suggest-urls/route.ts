import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";

export type SuggestedUrl = {
  url: string;
  reason: string;
  priority: "high" | "medium" | "low";
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const raw = typeof body.domain === "string" ? body.domain.trim() : "";

    if (!raw) {
      return NextResponse.json({ error: "domain is required" }, { status: 400 });
    }

    // Normalise to an https URL
    const baseUrl = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let origin: string;
    try {
      origin = new URL(baseUrl).origin;
    } catch {
      return NextResponse.json({ error: "Invalid domain" }, { status: 400 });
    }

    // ── 1. Fetch homepage ────────────────────────────────────────────────────
    let html: string;
    try {
      const homeRes = await fetch(baseUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; PulseBot/1.0; +https://pulse.app)",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!homeRes.ok) {
        return NextResponse.json(
          { error: `Could not fetch ${baseUrl} (HTTP ${homeRes.status})` },
          { status: 400 }
        );
      }
      html = await homeRes.text();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      return NextResponse.json(
        { error: `Failed to reach ${baseUrl}: ${msg}` },
        { status: 400 }
      );
    }

    // ── 2. Extract internal links with cheerio ───────────────────────────────
    const $ = cheerio.load(html);
    const seen = new Set<string>();

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) return;

      try {
        const resolved = new URL(href, origin);
        if (resolved.origin !== origin) return; // external link

        // Strip fragment and query string
        resolved.hash = "";
        resolved.search = "";
        const normalised = resolved.toString().replace(/\/$/, "");

        // Skip bare origin
        if (normalised === origin || normalised === `${origin}/`) return;

        seen.add(normalised);
      } catch {
        // unparseable — skip
      }
    });

    const links = Array.from(seen).slice(0, 80); // cap tokens sent to Gemini

    if (links.length === 0) {
      return NextResponse.json(
        { error: "No internal links found on this domain's homepage" },
        { status: 400 }
      );
    }

    // ── 3. Score links with keyword heuristics (no API needed) ───────────────
    const RULES: Array<{
      pattern: RegExp;
      reason: string;
      priority: SuggestedUrl["priority"];
    }> = [
      // High priority — strongest competitive signals
      { pattern: /\/(pricing|price|plans?|buy|upgrade|billing|subscription)(\b|\/|$)/i,  reason: "Pricing & plans",       priority: "high" },
      { pattern: /\/(blog|news|articles?|insights?)(\b|\/|$)/i,                          reason: "Blog & news",           priority: "high" },
      { pattern: /\/(features?|capabilities|product|solutions?)(\b|\/|$)/i,              reason: "Product features",      priority: "high" },
      { pattern: /\/(compare|vs\b|versus|competitors?)(\b|\/|$)/i,                       reason: "Competitor comparison", priority: "high" },
      { pattern: /\/(enterprise|business|teams?)(\b|\/|$)/i,                             reason: "Enterprise offering",   priority: "high" },
      // Medium priority — useful context
      { pattern: /\/(changelog|releases?|updates?|whats-?new)(\b|\/|$)/i,               reason: "Product changelog",     priority: "medium" },
      { pattern: /\/(roadmap|upcoming|future)(\b|\/|$)/i,                                reason: "Roadmap & vision",      priority: "medium" },
      { pattern: /\/(about|company|mission|story|team)(\b|\/|$)/i,                       reason: "Company & mission",     priority: "medium" },
      { pattern: /\/(docs?|documentation|guides?|help|support)(\b|\/|$)/i,               reason: "Documentation",         priority: "medium" },
      { pattern: /\/(integrations?|ecosystem|marketplace|plugins?)(\b|\/|$)/i,           reason: "Integrations",          priority: "medium" },
      { pattern: /\/(api|developers?|platform|sdk)(\b|\/|$)/i,                           reason: "Developer platform",    priority: "medium" },
      { pattern: /\/(customers?|case-?studies|success|stories)(\b|\/|$)/i,               reason: "Customer stories",      priority: "medium" },
      // Low priority
      { pattern: /\/(careers?|jobs?|hiring|work-?with-?us)(\b|\/|$)/i,                  reason: "Hiring signals",         priority: "low" },
      { pattern: /\/(press|media|brand|assets?)(\b|\/|$)/i,                              reason: "Press & brand",          priority: "low" },
      { pattern: /\/(legal|terms|privacy|security|compliance)(\b|\/|$)/i,               reason: "Legal & compliance",     priority: "low" },
    ];

    const scored: SuggestedUrl[] = [];

    for (const url of links) {
      for (const rule of RULES) {
        if (rule.pattern.test(url)) {
          scored.push({ url, reason: rule.reason, priority: rule.priority });
          break; // first matching rule wins
        }
      }
    }

    // If nothing matched the rules, surface the top-level paths as "low"
    // so the user always gets something back
    if (scored.length === 0) {
      for (const url of links.slice(0, 10)) {
        scored.push({ url, reason: "Page to monitor", priority: "low" });
      }
    }

    // Sort: high → medium → low, then cap at 3
    const ORDER = { high: 0, medium: 1, low: 2 } as const;
    scored.sort((a, b) => ORDER[a.priority] - ORDER[b.priority]);
    const top3 = scored.slice(0, 3);

    // ── 4. Validate each URL with a HEAD request ─────────────────────────────
    const settled = await Promise.allSettled(
      top3.map(async (s) => {
        try {
          const res = await fetch(s.url, {
            method: "HEAD",
            headers: {
              "User-Agent":
                "Mozilla/5.0 (compatible; PulseBot/1.0; +https://pulse.app)",
            },
            signal: AbortSignal.timeout(5_000),
          });
          return res.ok ? s : null;
        } catch {
          return null;
        }
      })
    );

    const valid = settled
      .map((r) => (r.status === "fulfilled" ? r.value : null))
      .filter((s): s is SuggestedUrl => s !== null);

    return NextResponse.json({ suggestions: valid });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to suggest URLs";
    console.error("[suggest-urls] Unhandled error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
